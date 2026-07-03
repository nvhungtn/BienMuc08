import { useState, useEffect, useRef, FormEvent, ChangeEvent, useMemo } from "react";
import { 
  BookOpen, 
  FileSpreadsheet, 
  Plus, 
  Trash, 
  Save, 
  Download, 
  Upload, 
  Database, 
  Sparkles, 
  RefreshCw, 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  LogOut, 
  Info, 
  Lock, 
  Layers, 
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Clipboard,
  X,
  FileCode,
  Calendar,
  Check,
  UserCheck,
  Shield,
  ShieldAlert,
  Search,
  BookMarked,
  Pencil,
  Sun,
  Moon
} from "lucide-react";
import { BookRecord } from "./types";
import { parseMarc21, generateMarc21Text } from "./utils/marcParser";
import { formatDateTimeGMT7 } from "./utils/dateFormatter";
import { 
  initAuth, 
  googleSignIn, 
  logout 
} from "./utils/firebaseAuth";
import { 
  SPREADSHEET_ID, 
  getSpreadsheetDetails, 
  fetchSheetRecords, 
  initializeSheetHeaders, 
  appendSheetRecord, 
  appendMultipleSheetRecords,
  ensureBienMucSheet,
  createNewSpreadsheet,
  overwriteSheetRecords
} from "./utils/googleSheets";
import { 
  EXCEL_COLUMNS, 
  downloadExcelTemplate, 
  exportToExcel, 
  parseExcelFile 
} from "./utils/excelHelper";
import { formatIsbn } from "./utils/isbnFormatter";

// Default empty book record state
const emptyRecord: BookRecord = {
  isbn: "",
  title: "",
  subTitle: "",
  author: "",
  publisher: "",
  pubYear: "",
  pages: "",
  language: "vie",
  ddc: "",
  cutter: "",
  price: "",
  dimensions: "",
  summary: "",
  subjects: [],
  barcode: "",
  quantity: "1",
  rawMarc: ""
};

// Parse GMT+7 formatted date string to timestamp for sorting
function parseDateGMT7(str: string | undefined): number {
  if (!str) return 0;
  // Match DD/MM/YYYY HH-MM-SS
  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})-(\d{2})-(\d{2})/);
  if (!match) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  const [, dd, mm, yyyy, hh, min, ss] = match;
  const date = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(min),
    Number(ss)
  );
  return date.getTime();
}

export default function App() {
  // State variables
  const [records, setRecords] = useState<BookRecord[]>(() => {
    try {
      const saved = localStorage.getItem("cataloged_records");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [formRecord, setFormRecord] = useState<BookRecord>({ ...emptyRecord });

  // Check for duplicate ISBN (ignore spaces/hyphens)
  const duplicateIsbnBook = useMemo(() => {
    const isbn = formRecord.isbn?.trim().replace(/[- ]/g, "");
    if (!isbn) return null;
    return records.find(r => {
      if (formRecord.id && r.id === formRecord.id) return false;
      const rIsbn = r.isbn?.trim().replace(/[- ]/g, "");
      return rIsbn && rIsbn === isbn;
    });
  }, [formRecord.isbn, formRecord.id, records]);

  // Check for duplicate Barcode (Số ĐKCB)
  const duplicateBarcodeBook = useMemo(() => {
    const barcode = formRecord.barcode?.trim();
    if (!barcode) return null;
    return records.find(r => {
      if (formRecord.id && r.id === formRecord.id) return false;
      const rBarcode = r.barcode?.trim();
      return rBarcode && rBarcode.toLowerCase() === barcode.toLowerCase();
    });
  }, [formRecord.barcode, formRecord.id, records]);

  // Search & Filter states for saved records list
  const [recordSearchQuery, setRecordSearchQuery] = useState("");
  const [recordFilterAuthor, setRecordFilterAuthor] = useState("");
  const [recordFilterYear, setRecordFilterYear] = useState("");
  const [recordFilterDdc, setRecordFilterDdc] = useState("");

  const [subjectInput, setSubjectInput] = useState("");
  const [rawMarcInput, setRawMarcInput] = useState("");
  const [inputMode, setInputMode] = useState<"manual" | "marc">("manual");
  
  // Auth states
  const [user, setUser] = useState<any>(() => {
    try {
      const saved = localStorage.getItem("google_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [accessToken, setAccessToken] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem("google_access_token");
      return saved || "auto-backend-token";
    } catch {
      return "auto-backend-token";
    }
  });
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Admin access control states
  const [isAdminMode, setIsAdminMode] = useState<boolean>(() => {
    return localStorage.getItem("is_admin_mode_override") === "true";
  });
  const [adminPasskey, setAdminPasskey] = useState("");
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  // ISBN Search states
  const [isbnSearchQuery, setIsbnSearchQuery] = useState("");
  const [isSearchingIsbn, setIsSearchingIsbn] = useState(false);

  // Duplicate modal states
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [pendingRecord, setPendingRecord] = useState<BookRecord | null>(null);
  const [duplicateWarningInfo, setDuplicateWarningInfo] = useState<{ title: string; barcode: string; isbn: string; isEdit: boolean } | null>(null);

  // Barcode scanner automatic search auto-trigger refs
  const lastAutoSearched = useRef("");
  const autoSearchTimeout = useRef<any>(null);

  // Dark Mode State
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem("theme") === "dark");

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [darkMode]);

  // Persist records state to localStorage when changed
  useEffect(() => {
    localStorage.setItem("cataloged_records", JSON.stringify(records));
  }, [records]);

  // OPAC Search results panel state
  const [opacSearchResult, setOpacSearchResult] = useState<{ book: BookRecord; marc21: any } | null>(null);
  const [activeSearchResultTab, setActiveSearchResultTab] = useState<"metadata" | "marc">("metadata");

  // Memoized Admin Checker - Catalog management is now completely free and open for everyone
  const isUserAdmin = true;
  
  // Google Sheets states - Locked to the provided Sheet ID as per requirements
  const [currentSpreadsheetId, setCurrentSpreadsheetId] = useState<string>(SPREADSHEET_ID);
  const [isEditingSheetId, setIsEditingSheetId] = useState(false);
  const [sheetIdInput, setSheetIdInput] = useState(currentSpreadsheetId);
  const [sheetTabs, setSheetTabs] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("BienMuc");
  const [isLoadingSheets, setIsLoadingSheets] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ type: "idle" | "success" | "error"; message: string }>({ type: "idle", message: "" });
  
  // UI helper states
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState<"records" | "template" | "marcViewer">("records");
  const [selectedRecordForMarc, setSelectedRecordForMarc] = useState<BookRecord | null>(null);
  const [itemsPerPage, setItemsPerPage] = useState<number>(30);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isSaving, setIsSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Show a temporary action message
  const triggerMessage = (type: "success" | "error" | "info", message: string) => {
    setActionMessage({ type, message });
    setTimeout(() => {
      setActionMessage(null);
    }, 5000);
  };

  // Reset auth state on authentication failure
  const checkAndHandleAuthError = (err: any): boolean => {
    const errorMsg = String(err?.message || "").toLowerCase();
    const isAuthError = 
      err?.status === 401 ||
      errorMsg.includes("401") ||
      errorMsg.includes("invalid credentials") ||
      errorMsg.includes("authentication") ||
      errorMsg.includes("unauthenticated") ||
      errorMsg.includes("token") ||
      errorMsg.includes("expired");

    if (isAuthError) {
      setUser(null);
      setAccessToken(null);
      setNeedsAuth(true);
      if (typeof window !== "undefined") {
        localStorage.removeItem("google_user");
        localStorage.removeItem("google_access_token");
      }
      triggerMessage("error", "Phiên kết nối Google Sheets đã hết hạn. Vui lòng kết nối lại tài khoản.");
      return true;
    }
    return false;
  };

  // Auto background sync of unsynced records
  const syncUnsyncedRecords = async (token: string, currentRecords: BookRecord[]) => {
    const unsynced = currentRecords.filter(r => r.unsynced);
    if (unsynced.length === 0) return;

    try {
      console.log("Detecting unsynced records. Synchronizing to Google Sheets...", unsynced);
      // We will overwrite Google Sheets with the merged and cleaned list
      const cleanRecords = currentRecords.map(r => {
        const { unsynced: dummy, ...rest } = r;
        return rest as BookRecord;
      });

      await ensureBienMucSheet(token, currentSpreadsheetId);
      await overwriteSheetRecords(token, "BienMuc", cleanRecords, currentSpreadsheetId);

      // Once successful, update state and local storage to clear unsynced flags
      const fullySyncedRecords = currentRecords.map(r => ({ ...r, unsynced: false }));
      setRecords(fullySyncedRecords);
      localStorage.setItem("cataloged_records", JSON.stringify(fullySyncedRecords));
      triggerMessage("success", `Tự động đồng bộ thành công ${unsynced.length} bản ghi biên mục ngoại tuyến lên Google Sheets!`);
    } catch (err) {
      console.warn("Auto background sync failed:", err);
    }
  };

  // Synchronize records automatically to "BienMuc" sheet on Google Sheets
  const syncRecordsToGoogleSheets = async (token: string, recordsToSync: BookRecord[]) => {
    if (!token || recordsToSync.length === 0) return;
    try {
      await ensureBienMucSheet(token, currentSpreadsheetId);

      // Fetch existing records in "BienMuc" sheet to avoid duplicating
      let existing: BookRecord[] = [];
      try {
        existing = await fetchSheetRecords(token, "BienMuc", currentSpreadsheetId);
      } catch (e) {
        console.warn("Lỗi đọc dữ liệu sheet BienMuc cũ (có thể sheet mới tạo):", e);
      }

      const existingKeys = new Set(existing.map(r => `${r.isbn || ""}_${r.barcode || ""}`));
      const cleanRecordsToSync = recordsToSync.map(r => {
        const { unsynced: dummy, ...rest } = r;
        return rest as BookRecord;
      });
      const unsynced = cleanRecordsToSync.filter(r => !existingKeys.has(`${r.isbn || ""}_${r.barcode || ""}`));

      if (unsynced.length > 0) {
        await appendMultipleSheetRecords(token, "BienMuc", unsynced, currentSpreadsheetId);
        triggerMessage("success", `Tự động đồng bộ thành công ${unsynced.length} bản ghi sang Google Sheets (Trang tính "BienMuc")!`);
      }
    } catch (err: any) {
      console.warn("Auto-sync to Google Sheets failed:", err);
      const wasAuthError = checkAndHandleAuthError(err);
      if (!wasAuthError) {
        triggerMessage("error", `Lỗi tự động đồng bộ Google Sheets: ${err?.message || "Mất kết nối"}`);
      }
    }
  };

  // Trigger auto background sync of local records to Google Sheet on load
  useEffect(() => {
    const triggerSyncOnLoad = async () => {
      try {
        const token = localStorage.getItem("google_access_token");
        if (token && token !== "auto-backend-token") {
          const saved = localStorage.getItem("cataloged_records");
          const localRecords = saved ? JSON.parse(saved) : [];
          if (localRecords.length > 0) {
            await syncUnsyncedRecords(token, localRecords);
          }
        }
      } catch (e) {
        console.error(e);
      }
    };
    triggerSyncOnLoad();
  }, []);

  // Listen to network changes to trigger auto background sync
  useEffect(() => {
    const handleOnline = () => {
      if (accessToken && records.length > 0) {
        syncUnsyncedRecords(accessToken, records);
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [accessToken, records]);

  // Periodically check and auto-sync any unsynced offline records every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
      if (isOnline && accessToken && records.some(r => r.unsynced)) {
        syncUnsyncedRecords(accessToken, records);
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [accessToken, records]);

  // Helper to ensure Google Sheets connection is established on demand
  const ensureGoogleConnection = async (): Promise<string | null> => {
    if (accessToken) return accessToken;
    setIsLoggingIn(true);
    try {
      triggerMessage("info", "Đang tự động liên kết tài khoản Google để đồng bộ...");
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        setNeedsAuth(false);
        localStorage.setItem("google_user", JSON.stringify(result.user));
        localStorage.setItem("google_access_token", result.accessToken);
        triggerMessage("success", `Chào mừng ${result.user.displayName || "Thủ thư"}! Đã tự động kết nối Google Sheets.`);
        return result.accessToken;
      }
    } catch (err: any) {
      console.error(err);
      triggerMessage("error", `Không thể kết nối Google Sheets: ${err?.message || "Lỗi kết nối"}. Sách sẽ được lưu tạm tại trình duyệt.`);
    } finally {
      setIsLoggingIn(false);
    }
    return null;
  };

  // Automatically load records from Google Sheets when accessToken is available on load
  useEffect(() => {
    if (accessToken) {
      const autoLoad = async () => {
        setIsLoadingSheets(true);
        try {
          await ensureBienMucSheet(accessToken, currentSpreadsheetId);
          const sheetRecords = await fetchSheetRecords(accessToken, "BienMuc", currentSpreadsheetId);
          
          // Sort records from newest to oldest
          const sorted = [...sheetRecords].sort((a, b) => parseDateGMT7(b.createdAt) - parseDateGMT7(a.createdAt));
          
          setRecords(sorted);
          localStorage.setItem("cataloged_records", JSON.stringify(sorted));
          triggerMessage("success", `Tự động nạp thành công ${sorted.length} bản ghi biên mục từ Google Sheets!`);
        } catch (err: any) {
          console.warn("Auto load failed:", err);
          checkAndHandleAuthError(err);
          // Fallback to local storage if Google Sheet read fails
          try {
            const saved = localStorage.getItem("cataloged_records");
            if (saved) {
              const local = JSON.parse(saved);
              const sorted = [...local].sort((a, b) => parseDateGMT7(b.createdAt) - parseDateGMT7(a.createdAt));
              setRecords(sorted);
            }
          } catch (e) {
            console.error(e);
          }
        } finally {
          setIsLoadingSheets(false);
        }
      };
      autoLoad();
    } else {
      // If offline/not connected, load local storage sorted newest to oldest
      try {
        const saved = localStorage.getItem("cataloged_records");
        if (saved) {
          const local = JSON.parse(saved);
          const sorted = [...local].sort((a, b) => parseDateGMT7(b.createdAt) - parseDateGMT7(a.createdAt));
          setRecords(sorted);
        }
      } catch (e) {
        console.error(e);
      }
    }
  }, [accessToken, currentSpreadsheetId]);

  // Google Sign In
  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        setNeedsAuth(false);
        localStorage.setItem("google_user", JSON.stringify(result.user));
        localStorage.setItem("google_access_token", result.accessToken);
        triggerMessage("success", `Chào mừng ${result.user.displayName || "Thủ thư"}! Đã kết nối Google Sheets.`);
        
        // Auto-sync existing local records to Google Sheet
        const localRecords = (() => {
          try {
            const saved = localStorage.getItem("cataloged_records");
            return saved ? JSON.parse(saved) : [];
          } catch (e) {
            return [];
          }
        })();
        if (localRecords.length > 0) {
          triggerMessage("info", "Đang tự động đồng bộ dữ liệu local lên Google Sheets...");
          await syncRecordsToGoogleSheets(result.accessToken, localRecords);
        }
      }
    } catch (err: any) {
      console.error(err);
      triggerMessage("error", `Đăng nhập thất bại: ${err?.message || "Lỗi không xác định"}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Google Sign Out
  const handleGoogleSignOut = async () => {
    if (window.confirm("Bạn có chắc chắn muốn ngắt kết nối tài khoản Google?")) {
      try {
        await logout();
        setUser(null);
        setAccessToken(null);
        setNeedsAuth(true);
        setSheetTabs([]);
        localStorage.removeItem("google_user");
        localStorage.removeItem("google_access_token");
        triggerMessage("info", "Đã ngắt kết nối tài khoản Google.");
      } catch (err: any) {
        console.error(err);
      }
    }
  };

  // Load spreadsheet tabs/sheets
  const loadSheetTabs = async (token: string, sheetId?: string) => {
    setIsLoadingSheets(true);
    const targetId = sheetId || currentSpreadsheetId;
    try {
      const tabs = await getSpreadsheetDetails(token, targetId);
      setSheetTabs(tabs);
      if (tabs.length > 0) {
        setSelectedSheet(tabs[0]);
      }
      setSyncStatus({ type: "success", message: "Kết nối Google Sheets thành công!" });
    } catch (err: any) {
      console.error(err);
      const wasAuthError = checkAndHandleAuthError(err);
      if (!wasAuthError) {
        setSyncStatus({ type: "error", message: err?.message || "Lỗi nạp danh sách Sheet." });
      }
    } finally {
      setIsLoadingSheets(false);
    }
  };

  // Load existing records from selected sheet
  const handleLoadFromSheet = async () => {
    if (!isUserAdmin) {
      setShowAdminLogin(true);
      triggerMessage("error", "Chỉ Quản trị viên mới được tải dữ liệu từ Google Sheets.");
      return;
    }
    if (!accessToken) {
      triggerMessage("error", "Vui lòng đăng nhập Google trước.");
      return;
    }
    setIsLoadingSheets(true);
    try {
      const sheetRecords = await fetchSheetRecords(accessToken, selectedSheet, currentSpreadsheetId);
      setRecords(sheetRecords);
      triggerMessage("success", `Đã tải thành công ${sheetRecords.length} bản ghi biên mục từ Google Sheet!`);
    } catch (err: any) {
      console.error(err);
      const wasAuthError = checkAndHandleAuthError(err);
      if (!wasAuthError) {
        triggerMessage("error", `Lỗi tải dữ liệu: ${err?.message}`);
      }
    } finally {
      setIsLoadingSheets(false);
    }
  };

  // Initialize sheet headers
  const handleInitHeaders = async () => {
    if (!isUserAdmin) {
      setShowAdminLogin(true);
      triggerMessage("error", "Chỉ Quản trị viên mới được khởi tạo tiêu đề Google Sheets.");
      return;
    }
    if (!accessToken) {
      triggerMessage("error", "Vui lòng đăng nhập Google trước.");
      return;
    }
    if (window.confirm(`Bạn có muốn khởi tạo dòng tiêu đề chuẩn DDC/MARC21 trên trang tính "${selectedSheet}"? Việc này có thể ghi đè dòng đầu tiên.`)) {
      setIsLoadingSheets(true);
      try {
        await initializeSheetHeaders(accessToken, selectedSheet, currentSpreadsheetId);
        triggerMessage("success", `Đã khởi tạo dòng tiêu đề chuẩn trên trang tính "${selectedSheet}"!`);
      } catch (err: any) {
        console.error(err);
        const wasAuthError = checkAndHandleAuthError(err);
        if (!wasAuthError) {
          triggerMessage("error", `Lỗi khởi tạo tiêu đề: ${err?.message}`);
        }
      } finally {
        setIsLoadingSheets(false);
      }
    }
  };

  // Admin Login Handler
  const handleAdminLogin = (e: FormEvent) => {
    e.preventDefault();
    const cleanKey = adminPasskey.trim();
    if (cleanKey === "admin123" || cleanKey === "THUTHU2026" || cleanKey === "nvhungtn") {
      setIsAdminMode(true);
      localStorage.setItem("is_admin_mode_override", "true");
      setAdminPasskey("");
      setShowAdminLogin(false);
      triggerMessage("success", "Đã mở khóa thành công quyền Quản trị viên (Admin)!");
    } else {
      triggerMessage("error", "Mật mã Quản trị viên không chính xác.");
    }
  };

  // Admin Logout Handler
  const handleAdminLogout = () => {
    setIsAdminMode(false);
    localStorage.removeItem("is_admin_mode_override");
    triggerMessage("info", "Đã thoát khỏi chế độ Quản trị viên.");
  };

  // Client-side MARC XML generator helper
  const generateMarcXml = (marc: any): string => {
    if (!marc) return "";
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<record xmlns="http://www.loc.gov/MARC21/slim">\n`;
    xml += `  <leader>${marc.leader || "00000cam a2200000 a 4500"}</leader>\n`;

    (marc.fields || []).forEach((f: any) => {
      const isControl = parseInt(f.tag) < 10;
      if (isControl) {
        xml += `  <controlfield tag="${f.tag}">${f.subfields["a"] || ""}</controlfield>\n`;
      } else {
        const ind1Attr = f.ind1 === "#" ? " " : f.ind1;
        const ind2Attr = f.ind2 === "#" ? " " : f.ind2;
        xml += `  <datafield tag="${f.tag}" ind1="${ind1Attr}" ind2="${ind2Attr}">\n`;
        
        Object.entries(f.subfields || {}).forEach(([code, value]) => {
          xml += `    <subfield code="${code}">${value}</subfield>\n`;
        });
        
        xml += `  </datafield>\n`;
      }
    });

    xml += `</record>`;
    return xml;
  };

  // Prepopulate form with fully-detailed manual fields (including DDC, Cutter, Barcode, Quantity)
  const loadExampleManual = () => {
    setFormRecord({
      isbn: "9786043184815",
      title: "Kỹ năng giao tiếp và quy tắc ứng xử",
      subTitle: "Tuyển chọn các bài diễn văn, phát biểu thường dùng trong các ngày lễ, hội nghị, hội thảo, diễn đàn trong các cơ quan, đơn vị, doanh nghiệp",
      author: "Hồng Đức tuyển chọn",
      publisher: "Hồng Đức",
      pubYear: "2021",
      pages: "408",
      language: "vie",
      ddc: "302.2",
      cutter: "K600N",
      price: "395000đ",
      dimensions: "27cm",
      summary: "Hướng dẫn xây dựng kỹ năng giao tiếp và quy tắc ứng xử, kỹ năng quản lý thời gian; kỹ năng làm việc nhóm; kỹ năng soạn thảo văn bản hành chính kỹ năng thuyết trình trong hoạt động công vụ; kỹ năng tổ chức và điều hành hội họp...",
      subjects: ["Kĩ năng xã hội", "Giao tiếp", "Ứng xử"],
      barcode: "494911",
      quantity: "5",
      rawMarc: ""
    });
    triggerMessage("success", "Đã nạp đầy đủ thông tin mẫu (gồm phân loại, Cutter, ĐKCB, số lượng)!");
  };

  // Search ISBN from the National Library / API proxy (using OPAC crawling and hybrid caching)
  const handleIsbnSearch = async (e?: FormEvent | string) => {
    if (e && typeof e !== "string") {
      e.preventDefault();
    }
    const query = typeof e === "string" ? e : isbnSearchQuery;
    if (!query.trim()) {
      triggerMessage("error", "Vui lòng nhập mã ISBN.");
      return;
    }
    setIsSearchingIsbn(true);
    setOpacSearchResult(null);
    triggerMessage("info", "Đang tra cứu dữ liệu sách từ Thư viện Quốc gia...");
    try {
      const apiBaseUrl = (import.meta as any).env?.VITE_API_BASE_URL || "";
      const res = await fetch(`${apiBaseUrl}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isbn: query.trim() })
      });
      
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : {};
      } catch (err) {
        const isHtml = text.toLowerCase().includes("<html") || text.toLowerCase().includes("<!doctype");
        if (isHtml) {
          throw new Error("Phản hồi từ máy chủ không hợp lệ (Trang HTML). Vui lòng kiểm tra lại trạng thái đăng nhập hoặc tải lại trang.");
        }
        throw new Error(`Phản hồi không phải là JSON hợp lệ: ${text.substring(0, 50)}...`);
      }

      if (!res.ok) {
        throw new Error(data?.error || "Không tìm thấy kết quả từ thư viện.");
      }
      
      if (data.success && data.book) {
        const formattedBook = {
          ...data.book,
          isbn: formatIsbn(data.book.isbn)
        };
        setFormRecord({ ...emptyRecord, ...formattedBook });
        setOpacSearchResult({ book: formattedBook, marc21: data.marc21 });
        
        // Populate raw MARC block view!
        setRawMarcInput(generateMarc21Text(formattedBook));
        
        if (data.warning) {
          triggerMessage("info", `[Chế độ dự phòng]: ${data.warning}`);
        } else {
          triggerMessage("success", `Đã tải thành công biên mục cuốn sách: "${data.book.title}"!`);
        }
      } else {
        triggerMessage("error", data.error || "Không nhận diện được phản hồi từ dịch vụ tra cứu.");
      }
    } catch (err: any) {
      console.error(err);
      triggerMessage("error", `Không tra cứu được thông tin: ${err?.message || "Lỗi kết nối máy chủ"}`);
    } finally {
      setIsSearchingIsbn(false);
    }
  };

  // Auto-search and format when barcode scanner scans or user inputs a complete ISBN
  const handleIsbnInputChange = (val: string) => {
    setIsbnSearchQuery(val);
    const digits = val.replace(/[^0-9Xx]/g, "");
    if (digits.length === 10 || digits.length === 13) {
      if (autoSearchTimeout.current) clearTimeout(autoSearchTimeout.current);
      autoSearchTimeout.current = setTimeout(() => {
        if (digits !== lastAutoSearched.current) {
          lastAutoSearched.current = digits;
          handleIsbnSearch(val);
        }
      }, 400); // 400ms debounce allows rapid typed scanner output to settle
    }
  };

  // Prepopulate form with example MARC 21 data from Vietnamese Library
  const loadExampleMarc = () => {
    const sample = `020\t#\t#\ta\t9786043184815
\t\t\tc\t395000đ
\t\t\td\t500b
041\t0\t#\ta\tvie
082\t0\t4\t2\t23
\t\t\ta\t302.2
\t\t\tb\tK600N
245\t0\t0\ta\tKỹ năng giao tiếp và quy tắc ứng xử
\t\t\tb\tTuyển chọn các bài diễn văn, phát biểu thường dùng trong các ngày lễ, hội nghị, hội thảo, diễn đàn trong các cơ quan, đơn vị, doanh nghiệp
260\t#\t#\ta\tH.
\t\t\tb\tHồng Đức
\t\t\tc\t2021
300\t#\t#\ta\t408tr.
\t\t\tb\tbảng
\t\t\tc\t27cm
520\t#\t#\ta\tHướng dẫn xây dựng kỹ năng giao tiếp và quy tắc ứng xử, kỹ năng quản lý thời gian; kỹ năng làm việc nhóm; kỹ năng soạn thảo văn bản hành chính kỹ năng thuyết trình trong hoạt động công vụ; kỹ năng tổ chức và điều hành hội họp...
650\t#\t7\t2\tBộ TK TVQG
\t\t\ta\tKĩ năng xã hội
650\t#\t7\t2\tBộ TK TVQG
\t\t\ta\tGiao tiếp
650\t#\t7\t2\tBộ TK TVQG
\t\t\ta\tỨng xử
930\t#\t#\ta\t494911`;
    setRawMarcInput(sample);
    setInputMode("marc");
    triggerMessage("info", "Đã nạp văn bản MARC 21 mẫu. Nhấn nút 'Phân tích MARC' để xem kết quả.");
  };

  // Parse Raw MARC input to Manual Form
  const handleParseMarc = () => {
    if (!rawMarcInput.trim()) {
      triggerMessage("error", "Vui lòng nhập văn bản MARC 21 thô để phân tích.");
      return;
    }
    try {
      const record = parseMarc21(rawMarcInput);
      setFormRecord({ ...emptyRecord, ...record });
      setInputMode("manual");
      triggerMessage("success", "Phân tích cú pháp MARC 21 thành công! Đã điền vào form chỉnh sửa.");
    } catch (err: any) {
      console.error(err);
      triggerMessage("error", "Lỗi phân tích MARC 21. Kiểm tra lại định dạng.");
    }
  };

  // Add subject tag
  const addSubjectTag = () => {
    if (subjectInput.trim() && !formRecord.subjects.includes(subjectInput.trim())) {
      setFormRecord({
        ...formRecord,
        subjects: [...formRecord.subjects, subjectInput.trim()]
      });
      setSubjectInput("");
    }
  };

  // Remove subject tag
  const removeSubjectTag = (tag: string) => {
    setFormRecord({
      ...formRecord,
      subjects: formRecord.subjects.filter(t => t !== tag)
    });
  };

  // Handle manual record save / add to local list
  const handleSaveRecord = async (e: FormEvent) => {
    e.preventDefault();

    // Check required fields
    const missing = [];
    if (!formRecord.title?.trim()) missing.push("Tên tác phẩm");
    if (!formRecord.ddc?.trim()) missing.push("Nhóm phân loại DDC");
    if (!formRecord.cutter?.trim()) missing.push("Chỉ số định danh Cutter");
    if (!formRecord.author?.trim()) missing.push("Tác giả");
    if (!formRecord.publisher?.trim()) missing.push("Nhà xuất bản");
    if (!formRecord.pubYear?.trim()) missing.push("Năm xuất bản");
    if (!formRecord.pages?.trim()) missing.push("Số trang");
    if (!formRecord.barcode?.trim()) missing.push("Số ĐKCB");
    if (!formRecord.quantity?.trim() || formRecord.quantity?.trim() === "0") missing.push("Số lượng");

    if (missing.length > 0) {
      triggerMessage("error", `Thiếu thông tin bắt buộc: ${missing.join(", ")}`);
      return;
    }

    // Prepare full record
    const isEdit = !!formRecord.id;
    const newRecord: BookRecord = {
      ...formRecord,
      isbn: formatIsbn(formRecord.isbn),
      id: formRecord.id || Math.random().toString(36).substring(2, 9).toUpperCase(),
      createdAt: formRecord.createdAt || formatDateTimeGMT7(new Date())
    };

    // If it doesn't have rawMarc, generate it
    if (!newRecord.rawMarc) {
      newRecord.rawMarc = generateMarc21Text(newRecord);
    }

    // Check for duplicate barcode or duplicate ISBN/Title
    const cleanNewIsbn = newRecord.isbn?.replace(/[- ]/g, "") || "";
    const duplicateBook = records.find(r => {
      if (r.id === newRecord.id) return false;

      // 1. Same barcode (most common identifier of duplicate copy)
      const sameBarcode = r.barcode?.trim().toLowerCase() === newRecord.barcode?.trim().toLowerCase();

      // 2. Same ISBN & Title (duplicate book title entry)
      const cleanRecordIsbn = r.isbn?.replace(/[- ]/g, "") || "";
      const sameIsbnAndTitle = cleanNewIsbn && cleanNewIsbn === cleanRecordIsbn && r.title?.trim().toLowerCase() === newRecord.title?.trim().toLowerCase();

      return sameBarcode || sameIsbnAndTitle;
    });

    if (duplicateBook) {
      setPendingRecord(newRecord);
      setDuplicateWarningInfo({
        title: duplicateBook.title,
        barcode: duplicateBook.barcode || "",
        isbn: duplicateBook.isbn || "",
        isEdit
      });
      setShowDuplicateModal(true);
      return;
    }

    await executeSaveRecord(newRecord, isEdit);
  };

  const executeSaveRecord = async (recordToSave: BookRecord, isEdit: boolean) => {
    setIsSaving(true);
    try {
      // Correctly update local records list depending on edit vs add
      let updatedRecords: BookRecord[];
      if (isEdit) {
        updatedRecords = records.map(r => r.id === recordToSave.id ? recordToSave : r);
      } else {
        updatedRecords = [recordToSave, ...records];
      }

      // Sort records from newest to oldest
      updatedRecords = [...updatedRecords].sort((a, b) => parseDateGMT7(b.createdAt) - parseDateGMT7(a.createdAt));

      // Reset form (this only happens on SUCCESSFUL save)
      setFormRecord({ ...emptyRecord });
      setRawMarcInput("");

      // Try syncing immediately if online and connected
      const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
      if (accessToken && isOnline) {
        try {
          const cleanRecords = updatedRecords.map(r => {
            const { unsynced: dummy, ...rest } = r;
            return rest as BookRecord;
          });
          await ensureBienMucSheet(accessToken, currentSpreadsheetId);
          await overwriteSheetRecords(accessToken, "BienMuc", cleanRecords, currentSpreadsheetId);

          const fullySyncedRecords = updatedRecords.map(r => ({ ...r, unsynced: false }));
          setRecords(fullySyncedRecords);
          localStorage.setItem("cataloged_records", JSON.stringify(fullySyncedRecords));
          triggerMessage("success", isEdit ? "Đã cập nhật bản ghi thành công và đồng bộ sang Google Sheets!" : "Đã biên mục bản ghi mới thành công và đồng bộ sang Google Sheets!");
        } catch (syncErr: any) {
          console.warn("Direct sync failed, saving locally as unsynced:", syncErr);
          const unsyncedRecords = updatedRecords.map(r => r.id === recordToSave.id ? { ...r, unsynced: true } : r);
          setRecords(unsyncedRecords);
          localStorage.setItem("cataloged_records", JSON.stringify(unsyncedRecords));
          triggerMessage("success", "Đã lưu tạm tại máy tính (Chờ đồng bộ) do mất kết nối Google Sheets.");
        }
      } else {
        const unsyncedRecords = updatedRecords.map(r => r.id === recordToSave.id ? { ...r, unsynced: true } : r);
        setRecords(unsyncedRecords);
        localStorage.setItem("cataloged_records", JSON.stringify(unsyncedRecords));
        triggerMessage("success", "Đang ngoại tuyến. Đã lưu tạm tại máy tính, hệ thống sẽ tự động đồng bộ khi có mạng.");
      }
    } catch (err: any) {
      console.error(err);
      triggerMessage("error", `Lỗi khi lưu bản ghi: ${err?.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Excel upload
  const handleExcelUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setExcelFile(file);
    try {
      const result = await parseExcelFile(file);
      setImportErrors(result.errors);

      if (result.records.length > 0) {
        // Add to local list of records
        const updatedRecords = [...result.records, ...records];
        setRecords(updatedRecords);
        localStorage.setItem("cataloged_records", JSON.stringify(updatedRecords));

        if (accessToken) {
          triggerMessage("info", `Đang tự động đồng bộ ${result.records.length} bản ghi sang Google Sheets...`);
          await syncRecordsToGoogleSheets(accessToken, result.records);
        } else {
          triggerMessage("success", `Đã nhập thành công ${result.records.length} bản ghi từ file Excel vào bộ lưu trữ local!`);
        }
      } else {
        triggerMessage("error", "Không tìm thấy bản ghi hợp lệ nào trong file Excel.");
      }
    } catch (err: any) {
      console.error(err);
      triggerMessage("error", `Lỗi tải file: ${err?.message}`);
    }

    // Reset input file value
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Export current list to Excel
  const handleExportExcel = () => {
    if (records.length === 0) {
      triggerMessage("error", "Chưa có bản ghi nào để xuất Excel.");
      return;
    }
    exportToExcel(records, `bien_muc_sach_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    triggerMessage("success", "Đã xuất dữ liệu ra file Excel thành công!");
  };

  // Delete a record from session
  const handleDeleteRecord = async (id: string | undefined) => {
    if (!id) return;

    const confirmMessage = accessToken
      ? "Bạn có chắc chắn muốn xóa bản ghi này? (Bản ghi tương ứng trên Google Sheets của bạn cũng sẽ được xóa đồng bộ)"
      : "Bạn có chắc chắn muốn xóa bản ghi này khỏi danh sách phiên làm việc hiện tại không?";

    if (window.confirm(confirmMessage)) {
      const updatedRecords = records.filter(r => r.id !== id);
      setRecords(updatedRecords);
      localStorage.setItem("cataloged_records", JSON.stringify(updatedRecords));

      if (selectedRecordForMarc?.id === id) {
        setSelectedRecordForMarc(null);
      }

      if (accessToken) {
        setIsLoadingSheets(true);
        try {
          await ensureBienMucSheet(accessToken, currentSpreadsheetId);
          await overwriteSheetRecords(accessToken, "BienMuc", updatedRecords, currentSpreadsheetId);
          triggerMessage("success", "Đã xóa bản ghi thành công và đồng bộ cập nhật lên Google Sheets!");
        } catch (err: any) {
          console.error(err);
          const wasAuthError = checkAndHandleAuthError(err);
          if (!wasAuthError) {
            triggerMessage("error", `Đã xóa cục bộ nhưng không thể đồng bộ xóa lên Google Sheets: ${err?.message}`);
          }
        } finally {
          setIsLoadingSheets(false);
        }
      } else {
        triggerMessage("success", "Đã xóa bản ghi thành công khỏi danh sách cục bộ.");
      }
    }
  };

  // Clean form
  const handleClearForm = () => {
    setFormRecord({ ...emptyRecord });
    setRawMarcInput("");
    triggerMessage("info", "Đã làm trống biểu mẫu nhập.");
  };

  // View raw MARC 21 text of a saved record
  const viewMarcDetails = (record: BookRecord) => {
    setSelectedRecordForMarc(record);
    setActiveTab("marcViewer");
  };

  // Extract unique authors for filtering
  const uniqueAuthors = useMemo(() => {
    const authors = records
      .map(r => r.author?.trim())
      .filter((a): a is string => !!a);
    const uniqueList: string[] = Array.from(new Set(authors));
    return uniqueList.sort();
  }, [records]);

  // Extract unique publication years for filtering
  const uniqueYears = useMemo(() => {
    const years = records
      .map(r => r.pubYear?.trim())
      .filter((y): y is string => !!y);
    const uniqueList: string[] = Array.from(new Set(years));
    return uniqueList.sort((a, b) => b.localeCompare(a));
  }, [records]);

  // Dewey Decimal Classification main classes
  const ddcGroups = useMemo(() => [
    { value: "000", label: "000 - Tin học, TT & Tổng quát" },
    { value: "100", label: "100 - Triết học & Tâm lý học" },
    { value: "200", label: "200 - Tôn giáo" },
    { value: "300", label: "300 - Khoa học xã hội" },
    { value: "400", label: "400 - Ngôn ngữ" },
    { value: "500", label: "500 - KH tự nhiên & Toán học" },
    { value: "600", label: "600 - Công nghệ & KH ứng dụng" },
    { value: "700", label: "700 - Nghệ thuật & Giải trí" },
    { value: "800", label: "800 - Văn học" },
    { value: "900", label: "900 - Lịch sử & Địa lý" },
  ], []);

  // Multi-criteria filtering logic
  const filteredRecords = useMemo(() => {
    return records.filter(record => {
      // 1. Keyword search (title, subtitle, author, ddc, publisher, isbn, barcode)
      const q = recordSearchQuery.trim().toLowerCase();
      if (q) {
        const titleMatch = record.title?.toLowerCase().includes(q);
        const subTitleMatch = record.subTitle?.toLowerCase().includes(q);
        const authorMatch = record.author?.toLowerCase().includes(q);
        const publisherMatch = record.publisher?.toLowerCase().includes(q);
        const isbnMatch = record.isbn?.toLowerCase().includes(q);
        const barcodeMatch = record.barcode?.toLowerCase().includes(q);
        const ddcMatch = record.ddc?.toLowerCase().includes(q);
        
        if (!titleMatch && !subTitleMatch && !authorMatch && !publisherMatch && !isbnMatch && !barcodeMatch && !ddcMatch) {
          return false;
        }
      }

      // 2. Author Filter
      if (recordFilterAuthor && record.author !== recordFilterAuthor) {
        return false;
      }

      // 3. Year Filter
      if (recordFilterYear && record.pubYear !== recordFilterYear) {
        return false;
      }

      // 4. DDC Group Filter (matching by first digit)
      if (recordFilterDdc) {
        const recordDdc = record.ddc?.trim() || "";
        const expectedPrefix = recordFilterDdc.substring(0, 1); // e.g. "3" from "300"
        if (!recordDdc.startsWith(expectedPrefix)) {
          return false;
        }
      }

      return true;
    });
  }, [records, recordSearchQuery, recordFilterAuthor, recordFilterYear, recordFilterDdc]);

  // Derived pagination calculations
  const totalPages = Math.ceil(filteredRecords.length / itemsPerPage) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedRecords = filteredRecords.slice(startIndex, endIndex);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col font-sans text-slate-800 dark:text-slate-100" id="main-app">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10 shadow-xs" id="app-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="bg-emerald-600 text-white p-2 rounded-lg shadow-sm">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Hệ Thống Biên Mục Sách Quốc Gia</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Chuẩn phân loại DDC 14 & Khung dữ liệu MARC 21</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Dark Mode Toggle */}
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 hover:dark:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg p-2 text-xs font-semibold flex items-center justify-center shadow-2xs cursor-pointer transition-all"
              title={darkMode ? "Chuyển sang Giao diện Sáng" : "Chuyển sang Giao diện Tối"}
            >
              {darkMode ? <Sun className="h-4 w-4 text-amber-500" /> : <Moon className="h-4 w-4 text-slate-600" />}
            </button>

            {/* Unified Status indicator */}
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 shadow-2xs" id="system-status-badge">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>
                Hệ thống: Đang đồng bộ Google Sheets
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Floating alert message */}
      {actionMessage && (
        <div className="fixed bottom-5 right-5 z-50 animate-bounce" id="alert-toast">
          <div className={`flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-lg text-white font-medium text-sm ${
            actionMessage.type === "success" ? "bg-slate-900 border border-emerald-500" :
            actionMessage.type === "error" ? "bg-red-600 border border-red-500" : "bg-blue-600"
          }`}>
            {actionMessage.type === "success" && <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />}
            {actionMessage.type === "error" && <AlertTriangle className="h-5 w-5 text-red-200 shrink-0" />}
            {actionMessage.type === "info" && <Info className="h-5 w-5 text-blue-200 shrink-0" />}
            <span>{actionMessage.message}</span>
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8" id="app-workspace">
        
        {/* Left Column: Input Panel (cols: 5) */}
        <div className="lg:col-span-5 space-y-6" id="input-container">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
            {/* Input mode selection */}
            <div className="flex border-b border-slate-200 bg-slate-50">
              <button
                onClick={() => setInputMode("manual")}
                className={`flex-1 py-3 text-sm font-semibold flex items-center justify-center border-b-2 transition-all ${
                  inputMode === "manual"
                    ? "border-emerald-600 text-emerald-700 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100/50"
                }`}
                id="tab-manual-input"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Nhập Thủ Công (Form)
              </button>
              <button
                onClick={() => setInputMode("marc")}
                className={`flex-1 py-3 text-sm font-semibold flex items-center justify-center border-b-2 transition-all ${
                  inputMode === "marc"
                    ? "border-emerald-600 text-emerald-700 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100/50"
                }`}
                id="tab-marc-input"
              >
                <FileCode className="h-4 w-4 mr-1.5" />
                Nhập từ MARC 21 Thô
              </button>
            </div>

            <div className="p-5">
              {/* Manual mode form */}
              {inputMode === "manual" && (
                <form onSubmit={handleSaveRecord} className="space-y-5" id="manual-form">
                  {/* ISBN Search Bar */}
                  <div className="bg-gradient-to-r from-emerald-50 to-emerald-100/50 p-4 rounded-xl border border-emerald-200 shadow-3xs">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center">
                      <Search className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                      Tra cứu nhanh bằng mã ISBN
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={isbnSearchQuery}
                        onChange={(e) => handleIsbnInputChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleIsbnSearch();
                          }
                        }}
                        placeholder="Nhập mã ISBN hoặc quét bằng máy quét..."
                        className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={handleIsbnSearch}
                        disabled={isSearchingIsbn}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
                      >
                        {isSearchingIsbn ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Search className="h-3.5 w-3.5" />
                        )}
                        Tìm
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2 leading-normal flex items-center gap-1">
                      <span className="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                      <span>Hỗ trợ máy quét mã vạch. Tự động tra cứu khi điền đủ 10 hoặc 13 số ISBN trên CSDL Thư viện Quốc gia Việt Nam.</span>
                    </p>
                  </div>

                  {/* OPAC Search results visualization */}
                  {opacSearchResult && (
                    <div className="bg-emerald-50/30 dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 shadow-3xs space-y-3 transition-all duration-300">
                      <div className="flex items-center justify-between border-b border-emerald-100 dark:border-slate-800 pb-2">
                        <span className="text-xs font-bold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider flex items-center">
                          <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                          Kết quả tra cứu OPAC Quốc Gia
                        </span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              const xmlContent = generateMarcXml(opacSearchResult.marc21);
                              const blob = new Blob([xmlContent], { type: "application/xml" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `MARC21_${opacSearchResult.book.isbn}.xml`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              triggerMessage("success", "Đã xuất và tải tệp MARCXML thành công!");
                            }}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 px-2.5 py-1 rounded-md text-[10.5px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <Download className="h-3 w-3" />
                            Xuất MARCXML
                          </button>
                        </div>
                      </div>

                      {/* Tab buttons */}
                      <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 text-xs">
                        <button
                          type="button"
                          onClick={() => setActiveSearchResultTab("metadata")}
                          className={`flex-1 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
                            activeSearchResultTab === "metadata"
                              ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-3xs"
                              : "text-slate-500 hover:text-slate-800 hover:dark:text-slate-200"
                          }`}
                        >
                          Thông tin thư mục
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveSearchResultTab("marc")}
                          className={`flex-1 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
                            activeSearchResultTab === "marc"
                              ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-3xs"
                              : "text-slate-500 hover:text-slate-800 hover:dark:text-slate-200"
                          }`}
                        >
                          Dữ liệu MARC21 (Chuẩn)
                        </button>
                      </div>

                      {activeSearchResultTab === "metadata" ? (
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-1">
                            <span className="text-slate-500 dark:text-slate-400">Nhan đề (245 $a):</span>
                            <span className="font-semibold text-slate-850 dark:text-slate-200 text-right max-w-[200px] truncate" title={opacSearchResult.book.title}>
                              {opacSearchResult.book.title}
                            </span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-1">
                            <span className="text-slate-500 dark:text-slate-400">Tác giả (100 $a):</span>
                            <span className="font-semibold text-slate-850 dark:text-slate-200 text-right">
                              {opacSearchResult.book.author}
                            </span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-1">
                            <span className="text-slate-500 dark:text-slate-400">NXB (260 $b):</span>
                            <span className="font-semibold text-slate-850 dark:text-slate-200 text-right">
                              {opacSearchResult.book.publisher}
                            </span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-1">
                            <span className="text-slate-500 dark:text-slate-400">Năm xuất bản (260 $c):</span>
                            <span className="font-semibold text-slate-850 dark:text-slate-200 text-right">
                              {opacSearchResult.book.pubYear}
                            </span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-1">
                            <span className="text-slate-500 dark:text-slate-400">Phân loại DDC:</span>
                            <span className="font-semibold text-slate-850 dark:text-slate-200 text-right">
                              {opacSearchResult.book.ddc}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500 dark:text-slate-400">Chỉ số Cutter:</span>
                            <span className="font-semibold text-slate-850 dark:text-slate-200 text-right">
                              {opacSearchResult.book.cutter}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-slate-950 text-slate-200 font-mono text-[10.5px] rounded-lg p-2.5 max-h-[180px] overflow-y-auto space-y-1 scrollbar-thin">
                          <div className="text-emerald-400 mb-1 border-b border-slate-800 pb-1">LEADER {opacSearchResult.marc21?.leader}</div>
                          {opacSearchResult.marc21?.fields.map((field: any, idx: number) => (
                            <div key={idx} className="hover:bg-slate-800/50 p-0.5 rounded flex items-start gap-1">
                              <span className="text-amber-400 font-bold shrink-0">{field.tag}</span>
                              <span className="text-purple-400 shrink-0 font-bold">{field.ind1}{field.ind2}</span>
                              <div className="flex-1 text-slate-300 break-all">
                                {Object.entries(field.subfields).map(([code, value]: [string, any]) => (
                                  <span key={code} className="inline-block mr-1.5">
                                    <span className="text-rose-400 font-bold">${code}</span>
                                    <span>{value}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Phiếu Biên Mục</span>
                    <button
                      type="button"
                      onClick={loadExampleManual}
                      className="text-xs text-emerald-600 hover:text-emerald-700 hover:underline flex items-center font-semibold"
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      Nạp dữ liệu mẫu
                    </button>
                  </div>

                  {/* Section 1: Required Information (9 fields) */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3 shadow-3xs">
                    <p className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5 uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping"></span>
                      1. CÁC TRƯỜNG BẮT BUỘC NHẬP
                    </p>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Tên tác phẩm (245 $a) <span className="text-rose-500 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        disabled={!isUserAdmin}
                        value={formRecord.title || ""}
                        onChange={e => setFormRecord({ ...formRecord, title: e.target.value })}
                        className="w-full bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all placeholder-slate-400"
                        placeholder="Kỹ năng giao tiếp và quy tắc ứng xử"
                        id="field-title"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Phân loại DDC (082 $a) <span className="text-rose-500 font-bold">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          disabled={!isUserAdmin}
                          value={formRecord.ddc || ""}
                          onChange={e => setFormRecord({ ...formRecord, ddc: e.target.value })}
                          className="w-full bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
                          placeholder="Ví dụ: 302.2"
                          id="field-ddc"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Mã Cutter (082 $b) <span className="text-rose-500 font-bold">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          disabled={!isUserAdmin}
                          value={formRecord.cutter || ""}
                          onChange={e => setFormRecord({ ...formRecord, cutter: e.target.value })}
                          className="w-full bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
                          placeholder="Ví dụ: K600N"
                          id="field-cutter"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Tác giả chính (100 $a / 245 $c) <span className="text-rose-500 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        disabled={!isUserAdmin}
                        value={formRecord.author || ""}
                        onChange={e => setFormRecord({ ...formRecord, author: e.target.value })}
                        className="w-full bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all placeholder-slate-400"
                        placeholder="Ví dụ: Hồng Đức hoặc Nguyễn Văn A"
                        id="field-author"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Nhà xuất bản (260 $b) <span className="text-rose-500 font-bold">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          disabled={!isUserAdmin}
                          value={formRecord.publisher || ""}
                          onChange={e => setFormRecord({ ...formRecord, publisher: e.target.value })}
                          className="w-full bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all placeholder-slate-400"
                          placeholder="Ví dụ: Hồng Đức"
                          id="field-publisher"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Năm xuất bản (260 $c) <span className="text-rose-500 font-bold">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          disabled={!isUserAdmin}
                          value={formRecord.pubYear || ""}
                          onChange={e => setFormRecord({ ...formRecord, pubYear: e.target.value })}
                          className="w-full bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all placeholder-slate-400"
                          placeholder="Ví dụ: 2021"
                          id="field-pubyear"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-1">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Số trang (300 $a) <span className="text-rose-500 font-bold">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          disabled={!isUserAdmin}
                          value={formRecord.pages || ""}
                          onChange={e => setFormRecord({ ...formRecord, pages: e.target.value })}
                          className="w-full bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all placeholder-slate-400"
                          placeholder="Ví dụ: 408"
                          id="field-pages"
                        />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Số ĐKCB (930 $a) <span className="text-rose-500 font-bold">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          disabled={!isUserAdmin}
                          value={formRecord.barcode || ""}
                          onChange={e => setFormRecord({ ...formRecord, barcode: e.target.value })}
                          className={`w-full bg-white disabled:bg-slate-100 border rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 transition-all placeholder-slate-400 ${
                            duplicateBarcodeBook
                              ? "border-amber-400 bg-amber-50/20 focus:ring-amber-500/30 focus:border-amber-500"
                              : "border-slate-300 focus:ring-emerald-500/30 focus:border-emerald-500"
                          }`}
                          placeholder="Ví dụ: 494911"
                          id="field-barcode"
                        />
                        {duplicateBarcodeBook && (
                          <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium flex items-start gap-1">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5 animate-pulse" />
                            <span>
                              Mã ĐKCB đã trùng với sách: <strong className="font-semibold">{duplicateBarcodeBook.title}</strong>
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="col-span-1">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Số lượng <span className="text-rose-500 font-bold">*</span>
                        </label>
                        <input
                          type="number"
                          required
                          min="1"
                          disabled={!isUserAdmin}
                          value={formRecord.quantity || ""}
                          onChange={e => setFormRecord({ ...formRecord, quantity: e.target.value })}
                          className="w-full bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all placeholder-slate-400"
                          id="field-quantity"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Optional Information */}
                  <div className="border border-slate-200 rounded-xl p-4 space-y-3 shadow-3xs">
                    <p className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5 uppercase tracking-wider">
                      <FileText className="h-3.5 w-3.5 text-slate-500" />
                      2. THÔNG TIN BỔ SUNG & KHÁC
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Mã ISBN (020 $a)
                        </label>
                        <input
                          type="text"
                          disabled={!isUserAdmin}
                          value={formRecord.isbn || ""}
                          onChange={e => setFormRecord({ ...formRecord, isbn: e.target.value })}
                          onBlur={() => setFormRecord({ ...formRecord, isbn: formatIsbn(formRecord.isbn) })}
                          className={`w-full bg-white disabled:bg-slate-100 border rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 transition-all ${
                            duplicateIsbnBook
                              ? "border-amber-400 bg-amber-50/20 focus:ring-amber-500/30 focus:border-amber-500"
                              : "border-slate-300 focus:ring-emerald-500/30 focus:border-emerald-500"
                          }`}
                          placeholder="9786043184815"
                          id="field-isbn"
                        />
                        {duplicateIsbnBook && (
                          <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium flex items-start gap-1">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5 animate-pulse" />
                            <span>
                              Mã ISBN đã trùng với sách: <strong className="font-semibold">{duplicateIsbnBook.title}</strong>
                            </span>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Ngôn ngữ (041 $a)
                        </label>
                        <input
                          type="text"
                          disabled={!isUserAdmin}
                          value={formRecord.language || ""}
                          onChange={e => setFormRecord({ ...formRecord, language: e.target.value })}
                          className="w-full bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
                          placeholder="vie"
                          id="field-language"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Tên tác phẩm phụ/bổ sung (245 $b)
                      </label>
                      <textarea
                        disabled={!isUserAdmin}
                        value={formRecord.subTitle || ""}
                        onChange={e => setFormRecord({ ...formRecord, subTitle: e.target.value })}
                        rows={2}
                        className="w-full bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all placeholder-slate-400"
                        placeholder="Thông tin phụ đề, các phát biểu hội thảo thường dùng..."
                        id="field-subtitle"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Khổ sách (300 $c)
                        </label>
                        <input
                          type="text"
                          disabled={!isUserAdmin}
                          value={formRecord.dimensions || ""}
                          onChange={e => setFormRecord({ ...formRecord, dimensions: e.target.value })}
                          className="w-full bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
                          placeholder="27cm"
                          id="field-dimensions"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Giá bìa (020 $c)
                        </label>
                        <input
                          type="text"
                          disabled={!isUserAdmin}
                          value={formRecord.price || ""}
                          onChange={e => setFormRecord({ ...formRecord, price: e.target.value })}
                          className="w-full bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
                          placeholder="395000đ"
                          id="field-price"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Tóm tắt nội dung (520 $a)
                      </label>
                      <textarea
                        disabled={!isUserAdmin}
                        value={formRecord.summary || ""}
                        onChange={e => setFormRecord({ ...formRecord, summary: e.target.value })}
                        rows={3}
                        className="w-full bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all placeholder-slate-400"
                        placeholder="Nội dung giới thiệu cuốn sách, các kỹ năng quản lý và thuyết trình..."
                        id="field-summary"
                      />
                    </div>

                    {/* Subject Tags Selector */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Đề mục Chủ đề (650 $a)
                      </label>
                      <div className="flex gap-2 mb-2">
                        <input
                          type="text"
                          disabled={!isUserAdmin}
                          value={subjectInput}
                          onChange={e => setSubjectInput(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addSubjectTag())}
                          className="flex-1 bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30"
                          placeholder="Ví dụ: Kĩ năng xã hội"
                          id="field-subject-input"
                        />
                        <button
                          type="button"
                          disabled={!isUserAdmin}
                          onClick={addSubjectTag}
                          className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-3.5 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-colors"
                        >
                          Thêm
                        </button>
                      </div>
                      {formRecord.subjects.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 p-2 bg-slate-100 rounded-lg border border-slate-200">
                          {formRecord.subjects.map(tag => (
                            <span 
                              key={tag} 
                              className="inline-flex items-center bg-white border border-slate-300 text-xs font-medium text-slate-700 px-2.5 py-1 rounded-full shadow-2xs"
                            >
                              {tag}
                              <button
                                type="button"
                                disabled={!isUserAdmin}
                                onClick={() => removeSubjectTag(tag)}
                                className="ml-1.5 text-slate-400 hover:text-red-500 cursor-pointer disabled:cursor-not-allowed"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 italic">Chưa khai báo đề mục chủ đề nào.</p>
                      )}
                    </div>
                  </div>

                  {(duplicateIsbnBook || duplicateBarcodeBook) && (
                    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-900/60 rounded-xl p-4 text-xs space-y-2 text-amber-900 dark:text-amber-300 shadow-2xs">
                      <span className="font-bold flex items-center gap-1.5 text-amber-800 dark:text-amber-400">
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 animate-pulse" />
                        Cảnh báo trùng lặp dữ liệu biên mục
                      </span>
                      <div className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400 space-y-1">
                        {duplicateBarcodeBook && (
                          <p>
                            • Mã ĐKCB <strong className="font-bold text-amber-800 dark:text-amber-300">{formRecord.barcode}</strong> đã tồn tại trong bản ghi <strong className="font-bold text-slate-800 dark:text-slate-200">"{duplicateBarcodeBook.title}"</strong> (Tác giả: {duplicateBarcodeBook.author}).
                          </p>
                        )}
                        {duplicateIsbnBook && (
                          <p>
                            • Mã ISBN <strong className="font-bold text-amber-800 dark:text-amber-300">{formatIsbn(formRecord.isbn)}</strong> đã tồn tại trong bản ghi <strong className="font-bold text-slate-800 dark:text-slate-200">"{duplicateIsbnBook.title}"</strong> (Tác giả: {duplicateIsbnBook.author}).
                          </p>
                        )}
                        <p className="text-slate-500 dark:text-slate-400 italic mt-1 font-medium">
                          * Vui lòng kiểm tra kỹ trước khi lưu để tránh trùng lặp dữ liệu trong hệ thống.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Form Actions */}
                  <div className="flex justify-end space-x-3 pt-2">
                    <button
                      type="button"
                      onClick={handleClearForm}
                      className="border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-semibold cursor-pointer transition-all"
                    >
                      Xóa trắng Form
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg text-sm font-bold flex items-center shadow-md cursor-pointer disabled:opacity-50 transition-all hover:shadow-lg"
                      id="save-book-btn"
                    >
                      {isSaving ? (
                        <RefreshCw className="animate-spin h-4 w-4 mr-2" />
                      ) : !isUserAdmin ? (
                        <Lock className="h-4 w-4 mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Lưu Biên Mục
                    </button>
                  </div>
                </form>
              )}

              {/* MARC 21 raw code block parser mode */}
              {inputMode === "marc" && (
                <div className="space-y-4" id="marc-input-container">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">MARC 21 Text Block</span>
                    <button
                      onClick={loadExampleMarc}
                      className="text-xs text-emerald-600 hover:text-emerald-700 hover:underline flex items-center font-medium"
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      Tải mẫu MARC 21 từ TVQG
                    </button>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed">
                    Dán văn bản trường thông tin MARC 21 dạng khối ký tự phân tách bởi khoảng trắng hoặc dấu Tab (thường thấy tại Thư viện Quốc gia Việt Nam). Hệ thống sẽ tự động bóc tách các trường 020, 082, 245, 260, 300, 520, 650...
                  </p>

                  <textarea
                    value={rawMarcInput}
                    onChange={e => setRawMarcInput(e.target.value)}
                    rows={16}
                    className="w-full bg-slate-900 text-slate-100 font-mono text-xs rounded-xl p-4 border border-slate-800 shadow-inner focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30"
                    placeholder={`020\t#\t#\ta\t9786043184815
\t\t\tc\t395000đ
082\t0\t4\ta\t302.2
\t\t\tb\tK600N
245\t0\t0\ta\tKỹ năng giao tiếp và quy tắc ứng xử
260\t#\t#\ta\tH.\t\tb\tHồng Đức\t\tc\t2021`}
                    id="marc-raw-textarea"
                  />

                  <div className="flex justify-between items-center pt-2">
                    <button
                      onClick={() => setRawMarcInput("")}
                      className="text-xs text-slate-500 hover:text-slate-800 underline font-medium"
                    >
                      Xóa văn bản
                    </button>
                    <button
                      onClick={handleParseMarc}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg text-sm font-bold flex items-center shadow-md cursor-pointer transition-all hover:shadow-lg"
                      id="parse-marc-btn"
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      Phân Tích Cú Pháp MARC 21
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Google Sheets, Excel Tools & Saved Records (cols: 7) */}
        <div className="lg:col-span-7 space-y-6" id="output-container">
          
          {/* Section: Sheets & Excel Integration Hub */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center">
              <Database className="h-4.5 w-4.5 mr-2 text-emerald-600" />
              Quản lý và Xuất nhập dữ liệu
            </h2>

            {/* Google Sheets Lock Status Panel */}
            <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300 rounded-xl p-4 text-xs space-y-3 shadow-2xs">
              <div className="flex items-center justify-between font-bold">
                <div className="flex items-center">
                  <CheckCircle className="h-4 w-4 mr-1.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Đồng bộ đám mây tự động</span>
                </div>
                {accessToken && accessToken !== "auto-backend-token" ? (
                  <span className="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 text-[10px] px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800 font-bold">
                    Tài khoản cá nhân
                  </span>
                ) : (
                  <span className="bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 text-[10px] px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-900/40 font-bold">
                    Tài khoản hệ thống
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Tất cả dữ liệu biên mục được đồng bộ hóa trực tiếp thời gian thực sang Google Sheets ID: <code className="bg-emerald-100 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded font-mono font-bold text-[10px] text-emerald-950 dark:text-emerald-300">1CxNsLi1GPoOmsK1uBIuQgewpSBAFKvNl_0thEOEJJ9k</code>.
              </p>
              
              <div className="pt-2 border-t border-emerald-200/50 dark:border-emerald-800/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                {accessToken && accessToken !== "auto-backend-token" ? (
                  <div className="space-y-0.5 text-left">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Đang liên kết bằng:</p>
                    <p className="font-semibold text-slate-700 dark:text-slate-300 text-[11px] flex items-center gap-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                      {user?.displayName || "Thủ thư"} ({user?.email || "Cá nhân"})
                    </p>
                  </div>
                ) : (
                  <div className="space-y-0.5 text-left">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Đang liên kết bằng:</p>
                    <p className="font-semibold text-slate-600 dark:text-slate-400 text-[11px] flex items-center gap-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                      Hệ thống tự động (Yêu cầu chia sẻ Sheet cho email hệ thống)
                    </p>
                  </div>
                )}
                
                <div className="flex gap-2 w-full sm:w-auto">
                  {accessToken && accessToken !== "auto-backend-token" ? (
                    <button
                      onClick={handleGoogleSignOut}
                      className="w-full sm:w-auto bg-white hover:bg-red-50 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-900/50 px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer shadow-3xs"
                    >
                      Ngắt kết nối Google
                    </button>
                  ) : (
                    <button
                      onClick={handleGoogleSignIn}
                      disabled={isLoggingIn}
                      className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700 px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer shadow-xs disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {isLoggingIn ? (
                        <>
                          <span className="h-2 w-2 rounded-full bg-white animate-ping"></span>
                          Đang kết nối...
                        </>
                      ) : (
                        "Đăng nhập tài khoản Google của bạn"
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Excel integration controls */}
            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3">

              <span className="text-xs font-bold text-slate-700 flex items-center">
                <FileSpreadsheet className="h-4 w-4 mr-1.5 text-blue-600" />
                Trao đổi tài liệu qua Excel (Nhập/Xuất offline)
              </span>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                {/* Download Template & Export Button */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Xuất bản & Tải biểu mẫu</p>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={downloadExcelTemplate}
                      className="w-full bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center justify-center transition-all cursor-pointer shadow-2xs"
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
                      Tải file Excel mẫu chuẩn
                    </button>

                    <button
                      onClick={handleExportExcel}
                      disabled={records.length === 0}
                      className="w-full bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center justify-center transition-all cursor-pointer shadow-2xs disabled:opacity-50"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5 text-blue-600" />
                      Xuất {records.length} bản ghi ra Excel
                    </button>
                  </div>
                </div>

                {/* Import Excel Upload Button */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nhập dữ liệu hàng loạt</p>
                  <div className="relative">
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept=".xlsx, .xls"
                      onChange={handleExcelUpload}
                      className="hidden"
                      id="excel-file-upload"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-20 bg-white hover:bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center text-slate-500 hover:text-slate-700 cursor-pointer transition-all"
                    >
                      <Upload className="h-5 w-5 text-slate-400 mb-1" />
                      <span className="text-xs font-semibold">Tải lên file Excel</span>
                      <span className="text-[9px] text-slate-400 mt-0.5">DDC, ISBN, MARC 21 đầy đủ</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Show spreadsheet format specs link */}
              <div className="flex justify-between items-center text-[11px] text-slate-500 pt-1">
                <span className="flex items-center">
                  <Info className="h-3.5 w-3.5 mr-1 text-slate-400" />
                  Đầy đủ 15 trường thông tin biên mục.
                </span>
                <button
                  onClick={() => setActiveTab("template")}
                  className="text-emerald-600 hover:text-emerald-700 font-semibold hover:underline"
                >
                  Xem định dạng cột chi tiết →
                </button>
              </div>
            </div>
          </div>

          {/* Section: List of Cataloged Books / Template Details / MARC Viewer */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
            {/* Tab selection */}
            <div className="flex border-b border-slate-200 bg-slate-50">
              <button
                onClick={() => setActiveTab("records")}
                className={`px-5 py-3 text-sm font-semibold flex items-center border-b-2 transition-all ${
                  activeTab === "records"
                    ? "border-emerald-600 text-emerald-700 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100/50"
                }`}
                id="tab-view-records"
              >
                Danh sách sách biên mục ({records.length})
              </button>
              <button
                onClick={() => setActiveTab("template")}
                className={`px-5 py-3 text-sm font-semibold flex items-center border-b-2 transition-all ${
                  activeTab === "template"
                    ? "border-emerald-600 text-emerald-700 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100/50"
                }`}
                id="tab-view-template"
              >
                Quy ước định dạng Excel
              </button>
              {selectedRecordForMarc && (
                <button
                  onClick={() => setActiveTab("marcViewer")}
                  className={`px-5 py-3 text-sm font-semibold flex items-center border-b-2 transition-all ${
                    activeTab === "marcViewer"
                      ? "border-emerald-600 text-emerald-700 bg-white"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                  id="tab-view-marc"
                >
                  Khung MARC 21
                </button>
              )}
            </div>

            <div className="p-5">
              {/* Tab 1: Records Table */}
              {activeTab === "records" && (
                <div className="space-y-4">
                  {records.length > 0 ? (
                    <>
                      {/* Multi-criteria Search & Filter Panel */}
                      <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 shadow-xs">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                            <Search className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                            Bộ lọc tra cứu nhanh
                          </span>
                          {filteredRecords.length !== records.length ? (
                            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full border border-emerald-200/50 dark:border-emerald-800/30">
                              Tìm thấy {filteredRecords.length} / {records.length} bản ghi
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                              Tổng cộng: {records.length} bản ghi
                            </span>
                          )}
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-2.5">
                          {/* Text Search input */}
                          <div className="md:col-span-4 relative">
                            <input
                              type="text"
                              value={recordSearchQuery}
                              onChange={(e) => {
                                setRecordSearchQuery(e.target.value);
                                setCurrentPage(1);
                              }}
                              placeholder="Tìm tên sách, tác giả, ISBN, ĐKCB..."
                              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all placeholder-slate-400"
                            />
                            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                          </div>

                          {/* Author Dropdown */}
                          <div className="md:col-span-3">
                            <select
                              value={recordFilterAuthor}
                              onChange={(e) => {
                                setRecordFilterAuthor(e.target.value);
                                setCurrentPage(1);
                              }}
                              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all cursor-pointer font-medium"
                            >
                              <option value="">-- Tất cả tác giả ({uniqueAuthors.length}) --</option>
                              {uniqueAuthors.map((author) => (
                                <option key={author} value={author}>
                                  {author}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Year Dropdown */}
                          <div className="md:col-span-2">
                            <select
                              value={recordFilterYear}
                              onChange={(e) => {
                                setRecordFilterYear(e.target.value);
                                setCurrentPage(1);
                              }}
                              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all cursor-pointer font-medium"
                            >
                              <option value="">-- Tất cả năm ({uniqueYears.length}) --</option>
                              {uniqueYears.map((year) => (
                                <option key={year} value={year}>
                                  Năm {year}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* DDC Classification Group Dropdown */}
                          <div className="md:col-span-2">
                            <select
                              value={recordFilterDdc}
                              onChange={(e) => {
                                setRecordFilterDdc(e.target.value);
                                setCurrentPage(1);
                              }}
                              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all cursor-pointer font-medium"
                            >
                              <option value="">-- Tất cả nhóm DDC --</option>
                              {ddcGroups.map((group) => (
                                <option key={group.value} value={group.value}>
                                  {group.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Reset Filters button */}
                          <div className="md:col-span-1">
                            <button
                              type="button"
                              disabled={!recordSearchQuery && !recordFilterAuthor && !recordFilterYear && !recordFilterDdc}
                              onClick={() => {
                                setRecordSearchQuery("");
                                setRecordFilterAuthor("");
                                setRecordFilterYear("");
                                setRecordFilterDdc("");
                                setCurrentPage(1);
                              }}
                              className="w-full h-full border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-45 disabled:hover:bg-white dark:disabled:hover:bg-slate-800 text-xs font-semibold py-1.5 px-2 transition-all flex items-center justify-center gap-1 cursor-pointer"
                              title="Xóa tất cả bộ lọc"
                            >
                              <X className="h-3.5 w-3.5" />
                              <span className="md:hidden">Xóa lọc</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {filteredRecords.length > 0 ? (
                        <>
                          <div className="overflow-x-auto border border-slate-200 rounded-lg">
                          <table className="w-full text-left border-collapse text-xs" id="records-table">
                            <thead>
                              <tr className="bg-slate-100 text-slate-700 uppercase font-bold tracking-wider border-b border-slate-200">
                                <th className="px-4 py-3">ISBN / ĐKCB</th>
                                <th className="px-4 py-3">Tác phẩm</th>
                                <th className="px-4 py-3">Tác giả</th>
                                <th className="px-4 py-3">Phân loại (DDC)</th>
                                <th className="px-4 py-3">Thông tin xuất bản</th>
                                <th className="px-4 py-3 text-center">Hành động</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                              {paginatedRecords.map((record) => (
                                <tr key={record.id} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="px-4 py-3 whitespace-nowrap space-y-1">
                                    {record.isbn ? (
                                      <div className="font-mono text-slate-900 font-semibold">{formatIsbn(record.isbn)}</div>
                                    ) : (
                                      <div className="text-slate-400 italic">Không có ISBN</div>
                                    )}
                                    {record.barcode && (
                                      <div className="inline-block bg-slate-100 text-[10px] text-slate-600 font-mono px-1.5 py-0.5 rounded border border-slate-200">
                                        ĐKCB: {record.barcode}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="font-bold text-slate-900 flex items-center flex-wrap gap-1.5" title={record.title}>
                                      <span className="line-clamp-2">{record.title}</span>
                                      {record.unsynced && (
                                        <span className="bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 animate-pulse flex items-center gap-1">
                                          <span className="h-1 w-1 bg-amber-500 rounded-full"></span>
                                          Chờ đồng bộ
                                        </span>
                                      )}
                                    </div>
                                    {record.subTitle && (
                                      <div className="text-slate-500 text-[11px] line-clamp-1 mt-0.5" title={record.subTitle}>
                                        {record.subTitle}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 font-medium text-slate-700">
                                    {record.author}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    {record.ddc ? (
                                      <div className="space-y-0.5">
                                        <div className="font-mono text-slate-900 font-bold bg-slate-100 px-1.5 py-0.5 rounded inline-block">
                                          {record.ddc}
                                        </div>
                                        {record.cutter && (
                                          <div className="text-[10px] text-slate-500 font-mono pl-1">
                                            Cutter: {record.cutter}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-slate-400 italic">Chưa phân loại</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 space-y-0.5">
                                    <div className="text-slate-700 font-semibold">{record.publisher}</div>
                                    <div className="text-slate-500 text-[10px] flex items-center">
                                      <Calendar className="h-3 w-3 mr-1 text-slate-400" />
                                      Năm {record.pubYear} • {record.pages}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-center whitespace-nowrap">
                                    <div className="flex items-center justify-center space-x-2">
                                      <button
                                        onClick={() => viewMarcDetails(record)}
                                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-slate-100 rounded-md transition-colors"
                                        title="Xem khung MARC 21"
                                      >
                                        <FileCode className="h-4 w-4" />
                                      </button>
                                      <button
                                        onClick={() => {
                                          setFormRecord({ ...emptyRecord, ...record });
                                          setRawMarcInput(record.rawMarc || "");
                                          setInputMode("manual");
                                          triggerMessage("info", "Đã nạp bản ghi vào Form để chỉnh sửa.");
                                        }}
                                        className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-md transition-colors"
                                        title="Sửa bản ghi này"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Pagination Controls */}
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 text-xs shadow-2xs" id="catalog-pagination">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 dark:text-slate-400 font-medium">Hiển thị:</span>
                            <select
                              value={itemsPerPage}
                              onChange={(e) => {
                                setItemsPerPage(Number(e.target.value));
                                setCurrentPage(1); // Reset page on limit change
                              }}
                              className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 font-bold text-slate-700 dark:text-slate-200 cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20"
                            >
                              <option value={30}>30 bản ghi</option>
                              <option value={50}>50 bản ghi</option>
                              <option value={100}>100 bản ghi</option>
                            </select>
                          </div>

                          <div className="text-slate-500 dark:text-slate-400 font-medium">
                            Bản ghi <strong className="text-slate-700 dark:text-slate-200">{filteredRecords.length > 0 ? startIndex + 1 : 0}</strong> - <strong className="text-slate-700 dark:text-slate-200">{Math.min(filteredRecords.length, endIndex)}</strong> trong tổng số <strong className="text-slate-700 dark:text-slate-200">{filteredRecords.length}</strong> {filteredRecords.length !== records.length && `(lọc từ ${records.length} bản ghi)`}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={safeCurrentPage === 1}
                              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                              className="p-1.5 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-slate-800 transition-colors cursor-pointer flex items-center justify-center"
                              title="Trang trước"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                              if (p === 1 || p === totalPages || Math.abs(p - safeCurrentPage) <= 1) {
                                return (
                                  <button
                                    key={p}
                                    type="button"
                                    onClick={() => setCurrentPage(p)}
                                    className={`px-3 py-1.5 border rounded-lg font-bold transition-all cursor-pointer text-xs min-w-[32px] ${
                                      safeCurrentPage === p
                                        ? "bg-emerald-600 border-emerald-600 text-white shadow-xs"
                                        : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                                    }`}
                                  >
                                    {p}
                                  </button>
                                );
                              } else if (p === 2 || p === totalPages - 1) {
                                return <span key={p} className="px-1 text-slate-400 dark:text-slate-600 select-none">...</span>;
                              }
                              return null;
                            })}

                            <button
                              type="button"
                              disabled={safeCurrentPage === totalPages}
                              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                              className="p-1.5 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-slate-800 transition-colors cursor-pointer flex items-center justify-center"
                              title="Trang sau"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        </>
                      ) : (
                        <div className="text-center py-12 border border-slate-200 rounded-xl bg-slate-50/50">
                          <Search className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                          <p className="text-sm text-slate-600 font-bold">Không tìm thấy bản ghi nào khớp với điều kiện lọc</p>
                          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">Vui lòng thử tìm kiếm với từ khóa khác, hoặc nhấn nút bên dưới để khôi phục lại danh sách đầy đủ.</p>
                          <button
                            onClick={() => {
                              setRecordSearchQuery("");
                              setRecordFilterAuthor("");
                              setRecordFilterYear("");
                              setRecordFilterDdc("");
                              setCurrentPage(1);
                            }}
                            className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-all shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                          >
                            <X className="h-3.5 w-3.5" />
                            Xóa các bộ lọc
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
                      <BookOpen className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                      <p className="text-sm text-slate-500 font-medium">Chưa có bản ghi biên mục sách nào được lưu.</p>
                      <p className="text-xs text-slate-400 mt-1">Hãy bắt đầu bằng cách quét ISBN hoặc điền thông tin và lưu sách ở khung bên trái!</p>
                    </div>
                  )}

                  {importErrors.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-4">
                      <h4 className="text-xs font-bold text-red-800 flex items-center mb-2">
                        <AlertTriangle className="h-4 w-4 mr-1.5 text-red-600" />
                        Lỗi bỏ qua khi nhập Excel ({importErrors.length} bản ghi lỗi):
                      </h4>
                      <ul className="text-xs text-red-700 list-disc list-inside space-y-1 overflow-y-auto max-h-32">
                        {importErrors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Excel Template specification */}
              {activeTab === "template" && (
                <div className="space-y-4 text-xs leading-relaxed text-slate-600" id="template-spec-tab">
                  <h3 className="text-sm font-bold text-slate-900">Quy ước Định dạng các cột trong file Excel Nhập liệu</h3>
                  <p>
                    Hệ thống biên mục sách hỗ trợ nhập liệu hàng loạt từ file Excel (`.xlsx`, `.xls`). Để việc nạp dữ liệu diễn ra thành công tốt đẹp, vui lòng định dạng các cột theo thứ tự hoặc đặt tên dòng tiêu đề trùng khớp với các thông tin sau:
                  </p>

                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                          <th className="px-4 py-2">Tên cột Excel</th>
                          <th className="px-4 py-2">Yêu cầu</th>
                          <th className="px-4 py-2">Trường MARC 21</th>
                          <th className="px-4 py-2">Mô tả và Định dạng chuẩn</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {EXCEL_COLUMNS.map((col) => (
                          <tr key={col.key} className="hover:bg-slate-50/50">
                            <td className="px-4 py-2 font-semibold text-slate-900">{col.label}</td>
                            <td className="px-4 py-2 whitespace-nowrap">
                              {col.required ? (
                                <span className="text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded text-[10px]">Bắt buộc *</span>
                              ) : (
                                <span className="text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded text-[10px]">Tùy chọn</span>
                              )}
                            </td>
                            <td className="px-4 py-2 font-mono text-[10px] text-slate-500">
                              {col.key === "isbn" && "020 $a"}
                              {col.key === "author" && "100 $a / 245 $c"}
                              {col.key === "title" && "245 $a"}
                              {col.key === "subTitle" && "245 $b"}
                              {col.key === "publisher" && "260 $b"}
                              {col.key === "pubYear" && "260 $c"}
                              {col.key === "pages" && "300 $a"}
                              {col.key === "language" && "041 $a"}
                              {col.key === "ddc" && "082 $a"}
                              {col.key === "cutter" && "082 $b"}
                              {col.key === "price" && "020 $c"}
                              {col.key === "dimensions" && "300 $c"}
                              {col.key === "summary" && "520 $a"}
                              {col.key === "subjects" && "650 $a"}
                              {col.key === "barcode" && "930 $a"}
                            </td>
                            <td className="px-4 py-2 text-slate-500">{col.desc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-2 pt-4">
                    <CheckCircle className="h-4.5 w-4.5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-emerald-900">Mẹo nhanh nhập liệu</p>
                      <p className="text-emerald-800 mt-0.5">
                        Bạn nên tải xuống <strong className="cursor-pointer underline" onClick={downloadExcelTemplate}>Biểu mẫu Excel mẫu</strong> của chúng tôi. File mẫu đã được cấu hình sẵn định dạng cột tiêu đề chuẩn, một dòng dữ liệu mẫu, và ghi chú chi tiết. Chỉ việc điền thông tin của bạn vào và tải lên!
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: Detailed MARC Viewer */}
              {activeTab === "marcViewer" && selectedRecordForMarc && (
                <div className="space-y-4" id="marc-viewer-tab">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Khung phiếu biên mục MARC 21</h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">Tác phẩm: <strong className="text-slate-800">{selectedRecordForMarc.title}</strong></p>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedRecordForMarc.rawMarc || "");
                        triggerMessage("success", "Đã sao chép nội dung MARC 21 vào clipboard!");
                      }}
                      className="text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg flex items-center font-semibold cursor-pointer"
                    >
                      <Clipboard className="h-3.5 w-3.5 mr-1.5" />
                      Sao chép MARC
                    </button>
                  </div>

                  <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 shadow-lg text-slate-200 font-mono text-xs overflow-x-auto leading-relaxed whitespace-pre-wrap">
                    {selectedRecordForMarc.rawMarc || generateMarc21Text(selectedRecordForMarc)}
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px] text-slate-500 space-y-1">
                    <p className="font-bold text-slate-700 flex items-center">
                      <Info className="h-3.5 w-3.5 mr-1 text-slate-500" />
                      Giải nghĩa một số tag chính được phân tích:
                    </p>
                    <ul className="list-disc list-inside space-y-0.5 pl-1.5">
                      <li><strong>020</strong>: Mã số sách tiêu chuẩn quốc tế (ISBN) và thông tin phụ bản/giá tiền ($c)</li>
                      <li><strong>082</strong>: Chỉ số phân loại thập phân Dewey (DDC) và Ký hiệu Cutter tác giả ($b)</li>
                      <li><strong>245</strong>: Tiêu đề tác phẩm chính ($a), tác phẩm phụ ($b), và trách nhiệm tác giả ($c)</li>
                      <li><strong>260</strong>: Thông tin xuất bản (Nơi xuất bản $a, Nhà xuất bản $b, Năm xuất bản $c)</li>
                      <li><strong>300</strong>: Mô tả vật lý (Số trang $a, Kích thước sách $c)</li>
                      <li><strong>520</strong>: Trường mô tả tóm tắt nội dung cuốn sách</li>
                      <li><strong>650</strong>: Đề mục chủ đề tìm kiếm mục lục liên quan</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-12" id="app-footer">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4 text-slate-500 text-xs">
          <div className="flex items-center space-x-2">
            <BookOpen className="h-4 w-4 text-slate-400" />
            <span>© 2026 Hệ Thống Biên Mục Thư Viện Số • Đăng ký liên kết Google Sheets API</span>
          </div>
          <div className="flex items-center space-x-4">
            {accessToken && (
              <a 
                href={`https://docs.google.com/spreadsheets/d/${currentSpreadsheetId}/edit`} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-emerald-600 dark:text-emerald-400 hover:underline font-semibold flex items-center"
              >
                Mở Trang tính Google Sheets <ExternalLink className="h-3.5 w-3.5 ml-1" />
              </a>
            )}
          </div>
        </div>
      </footer>

      {/* Duplicate Warning Modal */}
      {showDuplicateModal && duplicateWarningInfo && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-fade-in" id="duplicate-warning-modal">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 transform scale-100 transition-all duration-300">
            <div className="flex items-center gap-3 text-amber-600 mb-4">
              <div className="bg-amber-100 p-2.5 rounded-full">
                <AlertTriangle className="h-6 w-6 text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Cảnh báo dữ liệu bị trùng</h3>
            </div>
            
            <div className="space-y-3 text-slate-600 text-sm leading-relaxed mb-6">
              <p>
                Phát hiện thông tin tài liệu biên mục này bị trùng lặp với bản ghi đã tồn tại trong cơ sở dữ liệu:
              </p>
              
              <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-3.5 space-y-2 text-xs">
                <div>
                  <span className="text-slate-400 block mb-0.5 font-medium">Tên sách trùng:</span>
                  <strong className="text-slate-800 text-sm block font-bold">{duplicateWarningInfo.title}</strong>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-amber-100/50">
                  {duplicateWarningInfo.barcode && (
                    <div>
                      <span className="text-slate-400 block font-medium">Số ĐKCB:</span>
                      <strong className="text-slate-700 font-bold">{duplicateWarningInfo.barcode}</strong>
                    </div>
                  )}
                  {duplicateWarningInfo.isbn && (
                    <div>
                      <span className="text-slate-400 block font-medium">Mã ISBN:</span>
                      <strong className="text-slate-700 font-bold">{duplicateWarningInfo.isbn}</strong>
                    </div>
                  )}
                </div>
              </div>

              <p className="text-xs text-rose-600 font-bold bg-rose-50 px-3 py-2 rounded-lg leading-normal">
                ⚠️ Bạn có muốn tiếp tục lưu đè/lưu thêm bản ghi trùng lặp này hay không?
              </p>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowDuplicateModal(false);
                  setPendingRecord(null);
                  setDuplicateWarningInfo(null);
                  triggerMessage("info", "Đã hủy lưu bản ghi trùng. Bạn có thể chỉnh sửa lại thông tin form.");
                }}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border border-slate-200 cursor-pointer text-center"
              >
                Quay lại chỉnh sửa (Giữ form)
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (pendingRecord) {
                    const isEdit = duplicateWarningInfo.isEdit;
                    setShowDuplicateModal(false);
                    setPendingRecord(null);
                    setDuplicateWarningInfo(null);
                    await executeSaveRecord(pendingRecord, isEdit);
                  }
                }}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md hover:shadow-lg cursor-pointer text-center"
              >
                Vẫn tiếp tục lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
