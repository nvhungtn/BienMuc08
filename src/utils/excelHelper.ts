import * as XLSX from "xlsx";
import { BookRecord } from "../types";
import { formatDateTimeGMT7 } from "./dateFormatter";
import { formatIsbn } from "./isbnFormatter";

export const EXCEL_COLUMNS = [
  { key: "isbn", label: "ISBN", required: false, desc: "Mã số tiêu chuẩn quốc tế cho sách (ví dụ: 9786043184815)" },
  { key: "author", label: "Tác giả", required: true, desc: "Tên tác giả chính (ví dụ: Hồng Đức hoặc Nguyễn Văn A)" },
  { key: "title", label: "Tên tác phẩm", required: true, desc: "Tên chính của sách (ví dụ: Kỹ năng giao tiếp và quy tắc ứng xử)" },
  { key: "subTitle", label: "Tên tác phẩm phụ", required: false, desc: "Tên phụ hoặc thông tin bổ sung" },
  { key: "publisher", label: "Nhà xuất bản", required: true, desc: "Nhà xuất bản (ví dụ: Hồng Đức)" },
  { key: "pubYear", label: "Năm xuất bản", required: true, desc: "Năm xuất bản gồm 4 chữ số (ví dụ: 2021)" },
  { key: "pages", label: "Số trang", required: true, desc: "Số trang của cuốn sách (ví dụ: 408)" },
  { key: "language", label: "Ngôn ngữ", required: false, desc: "Mã ngôn ngữ 3 chữ cái theo MARC (ví dụ: vie, eng)" },
  { key: "ddc", label: "Số phân loại DDC", required: true, desc: "Mã phân loại thập phân Dewey (ví dụ: 302.2)" },
  { key: "cutter", label: "Mã Cutter", required: true, desc: "Ký hiệu Cutter chỉ tên tác giả (ví dụ: K600N)" },
  { key: "price", label: "Giá tiền", required: false, desc: "Giá bìa cuốn sách (ví dụ: 395000đ)" },
  { key: "dimensions", label: "Kích thước", required: false, desc: "Chiều cao hoặc kích thước sách (ví dụ: 27cm)" },
  { key: "summary", label: "Tóm tắt/Mô tả", required: false, desc: "Nội dung tóm tắt sơ lược của sách" },
  { key: "subjects", label: "Chủ đề", required: false, desc: "Các đề mục chủ đề, phân tách bởi dấu phẩy (ví dụ: Kĩ năng xã hội, Giao tiếp)" },
  { key: "barcode", label: "Số Đăng ký cá biệt", required: true, desc: "Số đăng ký cá biệt hoặc mã vạch của sách (ví dụ: 494911)" },
  { key: "quantity", label: "Số lượng", required: true, desc: "Số lượng bản sách nhập kho (ví dụ: 5)" }
];

// Generate an Excel Template with columns and a sample row
export function downloadExcelTemplate(): void {
  const headers = EXCEL_COLUMNS.map(c => c.label);
  const sampleRow = {
    "ISBN": "9786043184815",
    "Tác giả": "Hồng Đức tuyển chọn",
    "Tên tác phẩm": "Kỹ năng giao tiếp và quy tắc ứng xử",
    "Tên tác phẩm phụ": "Tuyển chọn các bài diễn văn, phát biểu thường dùng",
    "Nhà xuất bản": "Hồng Đức",
    "Năm xuất bản": "2021",
    "Số trang": "408",
    "Ngôn ngữ": "vie",
    "Số phân loại DDC": "302.2",
    "Mã Cutter": "K600N",
    "Giá tiền": "395000đ",
    "Kích thước": "27cm",
    "Tóm tắt/Mô tả": "Hướng dẫn xây dựng kỹ năng giao tiếp và quy tắc ứng xử...",
    "Chủ đề": "Kĩ năng xã hội, Giao tiếp, Ứng xử",
    "Số Đăng ký cá biệt": "494911",
    "Số lượng": "1"
  };

  const explanationRows = [
    {},
    { "ISBN": "HƯỚNG DẪN ĐỊNH DẠNG CÁC TRƯỜNG THÔNG TIN:" },
    ...EXCEL_COLUMNS.map(col => ({
      "ISBN": col.label,
      "Tác giả": col.required ? "BẮT BUỘC" : "Tùy chọn",
      "Tên tác phẩm": col.desc
    }))
  ];

  const worksheet = XLSX.utils.json_to_sheet([sampleRow, ...explanationRows], { header: headers });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Template Bien Muc");
  XLSX.writeFile(workbook, "mau_nhap_lieu_bien_muc.xlsx");
}

// Export a list of book records to an Excel file
export function exportToExcel(records: BookRecord[], filename = "danh_sach_bien_muc.xlsx"): void {
  const data = records.map((record, index) => ({
    "STT": index + 1,
    "ID": record.id || "",
    "ISBN": record.isbn || "",
    "Tác giả *": record.author || "",
    "Tên tác phẩm *": record.title || "",
    "Tên tác phẩm phụ": record.subTitle || "",
    "Nhà xuất bản *": record.publisher || "",
    "Năm xuất bản *": record.pubYear || "",
    "Số trang *": record.pages || "",
    "Ngôn ngữ": record.language || "",
    "Số phân loại DDC *": record.ddc || "",
    "Mã Cutter *": record.cutter || "",
    "Giá tiền": record.price || "",
    "Kích thước": record.dimensions || "",
    "Tóm tắt/Mô tả": record.summary || "",
    "Chủ đề": record.subjects ? record.subjects.join(", ") : "",
    "Số Đăng ký cá biệt *": record.barcode || "",
    "Số lượng *": record.quantity || "1",
    "Ngày tạo": formatDateTimeGMT7(record.createdAt)
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Danh sach bien muc");
  XLSX.writeFile(workbook, filename);
}

// Parse uploaded Excel file and validate fields
export function parseExcelFile(file: File): Promise<{ records: BookRecord[]; errors: string[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to array of arrays to have control over headers
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        if (rows.length === 0) {
          resolve({ records: [], errors: ["File Excel trống."] });
          return;
        }

        const headers = rows[0].map(h => String(h || "").trim());
        const records: BookRecord[] = [];
        const errors: string[] = [];

        // Helper to find column index based on name/label
        const findColIndex = (colLabels: string[]): number => {
          return headers.findIndex(h => 
            colLabels.some(label => h.toLowerCase() === label.toLowerCase() || h.toLowerCase().includes(label.toLowerCase()))
          );
        };

        const colIndices = {
          isbn: findColIndex(["isbn", "mã isbn", "mã số tiêu chuẩn"]),
          author: findColIndex(["tác giả", "author", "tác giả *"]),
          title: findColIndex(["tên tác phẩm", "tên chính", "tiêu đề", "title", "tên tác phẩm *"]),
          subTitle: findColIndex(["tên tác phẩm phụ", "tên phụ", "subtitle", "phụ đề"]),
          publisher: findColIndex(["nhà xuất bản", "nxb", "publisher", "nhà xuất bản *"]),
          pubYear: findColIndex(["năm xuất bản", "năm xb", "năm", "pubyear", "năm xuất bản *"]),
          pages: findColIndex(["số trang", "trang", "pages", "số trang *"]),
          language: findColIndex(["ngôn ngữ", "language", "mã ngôn ngữ"]),
          ddc: findColIndex(["ddc", "số phân loại ddc", "mã ddc", "phân loại"]),
          cutter: findColIndex(["cutter", "mã cutter", "ký hiệu cutter"]),
          price: findColIndex(["giá tiền", "giá", "price", "giá bìa"]),
          dimensions: findColIndex(["kích thước", "dimensions", "khổ"]),
          summary: findColIndex(["tóm tắt", "mô tả", "summary", "nội dung"]),
          subjects: findColIndex(["chủ đề", "đề mục", "subjects", "từ khóa"]),
          barcode: findColIndex(["số đăng ký cá biệt", "đăng ký cá biệt", "barcode", "mã vạch", "đkcb", "số đăng ký cá biệt *"]),
          quantity: findColIndex(["số lượng", "quantity", "số lượng *"])
        };

        // If headers don't match, try to use position-based indices if they look like our template
        // Excel template layout: A: ISBN, B: Tác giả, C: Tên tác phẩm, D: Tên tác phẩm phụ, E: Nhà xuất bản, F: Năm xuất bản, G: Số trang, H: Ngôn ngữ, I: Số phân loại DDC, J: Mã Cutter, K: Giá tiền, L: Kích thước, M: Tóm tắt, N: Chủ đề, O: Số ĐKCB, P: Số lượng
        const isTemplateLayout = headers.includes("ISBN") && headers.includes("Tác giả") && headers.includes("Tên tác phẩm");
        
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          // Skip empty or instruction rows (often starting with instructions)
          if (!row || row.length === 0) continue;
          
          // Check if it's the instruction row in our template
          const firstVal = String(row[0] || "").trim();
          if (firstVal.startsWith("HƯỚNG DẪN") || firstVal.startsWith("ISBN") || firstVal === "STT") continue;
          if (row.every(cell => cell === null || cell === undefined || String(cell).trim() === "")) continue;

          const getVal = (indices: number[], fallbackIndex: number): string => {
            for (const idx of indices) {
              if (idx !== -1 && row[idx] !== undefined && row[idx] !== null) {
                return String(row[idx]).trim();
              }
            }
            if (isTemplateLayout && row[fallbackIndex] !== undefined && row[fallbackIndex] !== null) {
              return String(row[fallbackIndex]).trim();
            }
            return "";
          };

          const isbnVal = getVal([colIndices.isbn], 0);
          const authorVal = getVal([colIndices.author], 1);
          const titleVal = getVal([colIndices.title], 2);
          const subTitleVal = getVal([colIndices.subTitle], 3);
          const publisherVal = getVal([colIndices.publisher], 4);
          const pubYearVal = getVal([colIndices.pubYear], 5);
          const pagesVal = getVal([colIndices.pages], 6);
          const languageVal = getVal([colIndices.language], 7);
          const ddcVal = getVal([colIndices.ddc], 8);
          const cutterVal = getVal([colIndices.cutter], 9);
          const priceVal = getVal([colIndices.price], 10);
          const dimensionsVal = getVal([colIndices.dimensions], 11);
          const summaryVal = getVal([colIndices.summary], 12);
          const subjectsVal = getVal([colIndices.subjects], 13);
          const barcodeVal = getVal([colIndices.barcode], 14);
          const quantityVal = getVal([colIndices.quantity], 15) || "1";

          // Validation of REQUIRED fields
          const rowNum = i + 1;
          const missingFields = [];
          if (!authorVal) missingFields.push("Tác giả");
          if (!titleVal) missingFields.push("Tên tác phẩm");
          if (!publisherVal) missingFields.push("Nhà xuất bản");
          if (!pubYearVal) missingFields.push("Năm xuất bản");
          if (!pagesVal) missingFields.push("Số trang");
          if (!ddcVal) missingFields.push("Số phân loại DDC");
          if (!cutterVal) missingFields.push("Mã Cutter");
          if (!barcodeVal) missingFields.push("Số Đăng ký cá biệt");
          if (!quantityVal || quantityVal === "0") missingFields.push("Số lượng");

          if (missingFields.length > 0) {
            errors.push(`Dòng ${rowNum}: Thiếu trường bắt buộc (${missingFields.join(", ")}). Bỏ qua dòng này.`);
            continue;
          }

          const subjectsList = subjectsVal
            ? subjectsVal.split(/[;,]/).map(s => s.trim()).filter(Boolean)
            : [];

          records.push({
            id: Math.random().toString(36).substring(2, 9).toUpperCase(),
            isbn: formatIsbn(isbnVal),
            author: authorVal,
            title: titleVal,
            subTitle: subTitleVal,
            publisher: publisherVal,
            pubYear: pubYearVal,
            pages: pagesVal,
            language: languageVal,
            ddc: ddcVal,
            cutter: cutterVal,
            price: priceVal,
            dimensions: dimensionsVal,
            summary: summaryVal,
            subjects: subjectsList,
            barcode: barcodeVal,
            quantity: quantityVal,
            createdAt: formatDateTimeGMT7(new Date())
          });
        }

        resolve({ records, errors });
      } catch (err: any) {
        console.error(err);
        resolve({ records: [], errors: [`Lỗi đọc file: ${err?.message || "Không rõ nguyên nhân"}`] });
      }
    };
    reader.onerror = () => {
      resolve({ records: [], errors: ["Lỗi đọc file Excel từ trình duyệt."] });
    };
    reader.readAsArrayBuffer(file);
  });
}
