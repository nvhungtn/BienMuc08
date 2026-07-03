import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import helmet from "helmet";
import cors from "cors";
import axios from "axios";
import { GoogleAuth } from "google-auth-library";
import searchRouter from "./server/routes/search";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Keep a cached token and its expiry to avoid requesting it on every API call
let cachedBackendToken: string | null = null;
let tokenExpiryTime = 0;

async function getBackendSheetsToken(): Promise<string | null> {
  // If we have a cached token that is still valid (with 5-minute safety margin)
  if (cachedBackendToken && Date.now() < tokenExpiryTime - 5 * 60 * 1000) {
    return cachedBackendToken;
  }

  try {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    
    if (tokenResponse.token) {
      cachedBackendToken = tokenResponse.token;
      // Access tokens usually last 1 hour. Set expiration to 55 minutes from now.
      tokenExpiryTime = Date.now() + 55 * 60 * 1000;
      console.log("Successfully obtained Google Sheets access token from Application Default Credentials.");
      return cachedBackendToken;
    }
  } catch (error: any) {
    console.warn("Could not fetch Application Default Credentials from google-auth-library:", error.message);
  }
  return null;
}

let cachedServiceAccountEmail: string | null = null;

async function getServiceAccountEmail(): Promise<string> {
  if (cachedServiceAccountEmail) return cachedServiceAccountEmail;
  try {
    // Try to get from metadata server (Cloud Run environment)
    const response = await axios.get(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email",
      { headers: { "Metadata-Flavor": "Google" }, timeout: 1000 }
    );
    if (response.data && typeof response.data === "string") {
      cachedServiceAccountEmail = response.data.trim();
      return cachedServiceAccountEmail;
    }
  } catch (e) {
    // Fallback if not on Cloud Run or metadata server fails
    try {
      const auth = new GoogleAuth();
      const credentials = await auth.getCredentials();
      if (credentials.client_email) {
        cachedServiceAccountEmail = credentials.client_email;
        return cachedServiceAccountEmail;
      }
    } catch (err) {}
  }
  return "email-he-thong@example.com"; // Fallback email
}

// Trust reverse proxy (needed for express-rate-limit on Cloud Run/Render/Heroku/etc)
app.set("trust proxy", 1);

// Enable CORS
app.use(cors());

// Security Middleware (CSPs disabled to allow sandbox and preview frames to run smoothly)
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());

// Google Sheets API Server-side Proxy to bypass client-side iframe CORS restrictions
app.all("/api/sheets-proxy", async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl || !targetUrl.startsWith("https://sheets.googleapis.com/")) {
    res.status(400).json({ error: "Invalid target URL" });
    return;
  }

  const authHeader = (req.headers["x-sheets-authorization"] as string) || req.headers.authorization;
  const method = req.method;
  const body = req.body;

  try {
    const headers: Record<string, string> = {};
    let isServiceAccount = false;
    let finalAuth = "";

    // Robust check for client-supplied OAuth tokens
    if (
      authHeader &&
      authHeader !== "Bearer auto-backend-token" &&
      authHeader !== "Bearer null" &&
      authHeader !== "Bearer undefined" &&
      authHeader !== "Bearer" &&
      authHeader.trim() !== "Bearer"
    ) {
      finalAuth = authHeader;
      isServiceAccount = false;
    } else {
      // Fallback to backend's Application Default Credentials (service account)
      const token = await getBackendSheetsToken();
      if (token) {
        finalAuth = `Bearer ${token}`;
        isServiceAccount = true;
      }
    }

    if (finalAuth) {
      headers["Authorization"] = finalAuth;
    } else {
      res.status(200).json({
        error: {
          message: "Chưa thiết lập phiên kết nối Google Sheets. Vui lòng nhấp nút 'Đăng nhập tài khoản Google của bạn' để kết nối bằng tài khoản Google của bạn."
        }
      });
      return;
    }

    if (req.headers["content-type"]) {
      headers["Content-Type"] = req.headers["content-type"] as string;
    }

    const axiosConfig: any = {
      method,
      url: targetUrl,
      headers,
      validateStatus: () => true // Allow forwarding error status codes from Google Sheets
    };

    if (method !== "GET" && method !== "HEAD") {
      axiosConfig.data = body;
    }

    const response = await axios(axiosConfig);
    let responseData = response.data;

    // Defensive check: If the response is HTML, convert it to a friendly JSON error
    const isHtml = typeof responseData === "string" && 
      (responseData.toLowerCase().includes("<html") || responseData.toLowerCase().includes("<!doctype"));

    if (isHtml || response.status === 403 || response.status === 401) {
      if (isServiceAccount) {
        const email = await getServiceAccountEmail();
        responseData = {
          error: {
            message: `Lỗi kết nối Google Sheets (${response.status}): Tài khoản hệ thống (${email}) chưa được phân quyền truy cập Trang tính này.\n\nHướng dẫn khắc phục:\n1. Mở tệp Google Sheets (ID: 1CxNsLi1GPoOmsK1uBIuQgewpSBAFKvNl_0thEOEJJ9k).\n2. Nhấp nút 'Chia sẻ' (Share) ở góc trên bên phải.\n3. Thêm tài khoản email: ${email} với vai trò 'Người chỉnh sửa' (Editor), sau đó tải lại trang này.`
          }
        };
      } else {
        responseData = {
          error: {
            message: `Lỗi kết nối Google Sheets (${response.status}): Phiên đăng nhập Google của bạn không có quyền chỉnh sửa tài liệu này.\n\nHướng dẫn khắc phục:\n1. Hãy chắc chắn rằng bạn đã đăng nhập bằng tài khoản Google có quyền chỉnh sửa trang tính.\n2. Hoặc mở trang tính Google Sheets, nhấp nút 'Chia sẻ' (Share) và thiết lập quyền chỉnh sửa công khai hoặc thêm tài khoản của bạn.`
          }
        };
      }
      res.status(200).json(responseData);
      return;
    }

    // For any other non-OK status (like 400, 404, 500)
    if (response.status < 200 || response.status >= 300) {
      const errMsg = (responseData && (responseData.error?.message || responseData.error || responseData.message)) || `Google API error (Status: ${response.status})`;
      res.status(200).json({
        error: {
          message: `Lỗi Google API (${response.status}): ${errMsg}`
        }
      });
      return;
    }

    res.status(200).json(responseData);
  } catch (error: any) {
    console.error("Sheets proxy error:", error);
    res.status(200).json({ 
      error: {
        message: "Failed to proxy request: " + error.message
      }
    });
  }
});

// Register modular search routes
app.use("/api", searchRouter);

// Share-able server-side Gemini client
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not defined in environment variables.");
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

// Search book metadata by ISBN
app.post("/api/search-isbn", async (req, res) => {
  const { isbn } = req.body || {};
  if (!isbn || typeof isbn !== "string" || !isbn.trim()) {
    res.status(400).json({ error: "Vui lòng cung cấp mã ISBN hợp lệ." });
    return;
  }

  const cleanedIsbn = isbn.replace(/[- ]/g, "").trim();
  let googleBooksData: any = null;

  // 1. Try querying Google Books API first
  try {
    const gBooksResponse = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanedIsbn}`);
    if (gBooksResponse.ok) {
      const json = await gBooksResponse.json();
      if (json.items && json.items.length > 0) {
        googleBooksData = json.items[0].volumeInfo;
      }
    }
  } catch (e) {
    console.error("Error fetching from Google Books API:", e);
  }

  try {
    // 2. Call Gemini model with Google Search Grounding to search the web/National Library of Vietnam
    const ai = getGeminiClient();
    
    const prompt = `Bạn là một thủ thư chuyên nghiệp thuộc Thư viện Quốc gia Việt Nam.
Hãy tra cứu và biên mục cuốn sách có mã số ISBN: "${cleanedIsbn}".
Sử dụng công cụ tìm kiếm Google để tìm thông tin chính xác về cuốn sách này trên các trang web thư viện (Thư viện Quốc gia Việt Nam nl独立.gov.vn, Thư viện trường đại học), các nhà xuất bản lớn (NXB Trẻ, Hồng Đức, Kim Đồng, v.v.), hoặc các hệ thống phát hành sách (Fahasa, Tiki).

${googleBooksData ? `Dưới đây là một số thông tin sơ bộ tìm thấy từ Google Books:
- Tên: ${googleBooksData.title}
- Tác giả: ${googleBooksData.authors?.join(", ")}
- Nhà xuất bản: ${googleBooksData.publisher}
- Năm: ${googleBooksData.publishedDate}
- Mô tả: ${googleBooksData.description}` : ""}

Nếu không tìm thấy thông tin chính xác trên mạng, hãy sử dụng tri thức của bạn để tạo ra thông tin biên mục chuẩn nhất dựa trên cấu trúc của mã ISBN (ví dụ nhà xuất bản liên quan, chủ đề có thể có) nhưng cố gắng tìm kiếm thực tế trước.

Yêu cầu bắt buộc trả về các trường thông tin sau theo định dạng JSON với các thuộc tính cụ thể:
1. title (Tên tác phẩm - tương ứng trường 245 $a)
2. author (Tác giả chính - tương ứng 100 $a hoặc 245 $c)
3. publisher (Nhà xuất bản - tương ứng 260 $b)
4. pubYear (Năm xuất bản 4 chữ số - tương ứng 260 $c)
5. pages (Số trang của cuốn sách, chỉ ghi số - tương ứng 300 $a)
6. ddc (Mã phân loại thập phân Dewey DDC chuẩn cho chủ đề sách - tương ứng 082 $a. Ví dụ: Sách giao tiếp là 302.2, Tin học là 004, Văn học Việt Nam là 899.213, v.v.)
7. cutter (Ký hiệu định danh Cutter chuẩn cho tác giả dựa trên tên tác giả chính - tương ứng 082 $b, ví dụ: K600N, N302T, v.v.)
8. barcode (Số Đăng ký cá biệt - 930 $a. Một dãy số ngẫu nhiên dài 6 ký tự số, ví dụ "494911")
9. isbn (Trả về lại mã ISBN đã định dạng hoặc giữ nguyên)
10. subTitle (Tên tác phẩm phụ/phụ đề nếu có - 245 $b)
11. language (Ngôn ngữ sách, mã 3 chữ cái viết thường ví dụ: "vie", "eng")
12. price (Giá bìa sách kèm đơn vị ví dụ "150000đ")
13. dimensions (Kích thước khổ sách ví dụ "24cm" hoặc "27cm")
14. summary (Tóm tắt nội dung ngắn gọn của cuốn sách - 520 $a)
15. subjects (Mảng các chủ đề/đề mục liên quan đến cuốn sách - 650 $a, ví dụ: ["Kĩ năng xã hội", "Giao tiếp", "Ứng xử"])
16. quantity (Số lượng mặc định là "1")`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            author: { type: Type.STRING },
            publisher: { type: Type.STRING },
            pubYear: { type: Type.STRING },
            pages: { type: Type.STRING },
            ddc: { type: Type.STRING },
            cutter: { type: Type.STRING },
            barcode: { type: Type.STRING },
            isbn: { type: Type.STRING },
            subTitle: { type: Type.STRING },
            language: { type: Type.STRING },
            price: { type: Type.STRING },
            dimensions: { type: Type.STRING },
            summary: { type: Type.STRING },
            subjects: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            quantity: { type: Type.STRING }
          },
          required: ["title", "author", "publisher", "pubYear", "pages", "ddc", "cutter", "barcode", "isbn", "quantity"]
        }
      }
    });

    const resultText = response.text?.trim() || "{}";
    const bookRecord = JSON.parse(resultText);

    res.json({ record: bookRecord });
  } catch (err: any) {
    console.warn("Gemini service failed or was rate-limited. Falling back to Google Books + rule-based parser. Error:", err);

    // High quality rule-based fallback
    const title = googleBooksData?.title || "Sách chưa rõ tên (ISBN: " + cleanedIsbn + ")";
    const author = googleBooksData?.authors?.join(", ") || "Chưa rõ tác giả";
    const publisher = googleBooksData?.publisher || "NXB Tổng hợp";
    
    let pubYear = "2024";
    if (googleBooksData?.publishedDate) {
      const match = googleBooksData.publishedDate.match(/\d{4}/);
      if (match) {
        pubYear = match[0];
      } else {
        pubYear = googleBooksData.publishedDate.substring(0, 4);
      }
    }
    
    const pages = googleBooksData?.pageCount?.toString() || "200";
    
    // Smart DDC classification based on title and subjects
    let ddc = "300"; // default
    const titleLower = title.toLowerCase();
    const categoriesLower = (googleBooksData?.categories || []).join(" ").toLowerCase();
    const searchStr = `${titleLower} ${categoriesLower}`;

    if (searchStr.includes("tin học") || searchStr.includes("máy tính") || searchStr.includes("lập trình") || searchStr.includes("python") || searchStr.includes("javascript") || searchStr.includes("computer") || searchStr.includes("software")) {
      ddc = "004";
    } else if (searchStr.includes("triết học") || searchStr.includes("tâm lý") || searchStr.includes("tâm lí") || searchStr.includes("philosophy") || searchStr.includes("psychology")) {
      ddc = "150";
    } else if (searchStr.includes("tôn giáo") || searchStr.includes("phật giáo") || searchStr.includes("religion")) {
      ddc = "200";
    } else if (searchStr.includes("giao tiếp") || searchStr.includes("ứng xử") || searchStr.includes("kỹ năng") || searchStr.includes("kĩ năng") || searchStr.includes("xã hội") || searchStr.includes("social")) {
      ddc = "302.2";
    } else if (searchStr.includes("kinh tế") || searchStr.includes("kinh doanh") || searchStr.includes("tài chính") || searchStr.includes("marketing") || searchStr.includes("quản trị") || searchStr.includes("economics") || searchStr.includes("business")) {
      ddc = "330";
    } else if (searchStr.includes("luật") || searchStr.includes("pháp luật") || searchStr.includes("law")) {
      ddc = "340";
    } else if (searchStr.includes("giáo dục") || searchStr.includes("sư phạm") || searchStr.includes("education")) {
      ddc = "370";
    } else if (searchStr.includes("ngôn ngữ") || searchStr.includes("tiếng anh") || searchStr.includes("từ điển") || searchStr.includes("language") || searchStr.includes("english")) {
      ddc = "400";
    } else if (searchStr.includes("toán") || searchStr.includes("vật lý") || searchStr.includes("hóa học") || searchStr.includes("sinh học") || searchStr.includes("khoa học") || searchStr.includes("science") || searchStr.includes("math")) {
      ddc = "500";
    } else if (searchStr.includes("y học") || searchStr.includes("sức khỏe") || searchStr.includes("công nghệ") || searchStr.includes("kỹ thuật") || searchStr.includes("technology") || searchStr.includes("medical")) {
      ddc = "600";
    } else if (searchStr.includes("nghệ thuật") || searchStr.includes("âm nhạc") || searchStr.includes("mỹ thuật") || searchStr.includes("thể thao") || searchStr.includes("art") || searchStr.includes("music")) {
      ddc = "700";
    } else if (searchStr.includes("văn học") || searchStr.includes("tiểu thuyết") || searchStr.includes("truyện") || searchStr.includes("thơ") || searchStr.includes("literature") || searchStr.includes("novel")) {
      ddc = "899.213";
    } else if (searchStr.includes("lịch sử") || searchStr.includes("địa lý") || searchStr.includes("history") || searchStr.includes("geography")) {
      ddc = "900";
    }

    // Deterministic Cutter generator based on author and title
    const authorClean = (googleBooksData?.authors?.[0] || "Khuyết danh").trim();
    const firstLetter = authorClean.charAt(0).toUpperCase();
    let hash = 0;
    for (let i = 0; i < authorClean.length; i++) {
      hash = authorClean.charCodeAt(i) + ((hash << 5) - hash);
    }
    const cutterNum = Math.abs(hash % 800) + 100;
    const titleLetter = title.trim().charAt(0).toLowerCase();
    const cutter = `${firstLetter}${cutterNum}${titleLetter}`;

    // Deterministic barcode based on ISBN
    let isbnHash = 0;
    for (let i = 0; i < cleanedIsbn.length; i++) {
      isbnHash = cleanedIsbn.charCodeAt(i) + ((isbnHash << 5) - isbnHash);
    }
    const barcode = (Math.abs(isbnHash % 900000) + 100000).toString();

    const bookRecord = {
      title,
      author,
      publisher,
      pubYear,
      pages,
      ddc,
      cutter,
      barcode,
      isbn: cleanedIsbn,
      subTitle: googleBooksData?.subtitle || "",
      language: googleBooksData?.language === "vi" ? "vie" : (googleBooksData?.language === "en" ? "eng" : "vie"),
      price: "120000đ",
      dimensions: "21cm",
      summary: googleBooksData?.description || "Thông tin biên mục dự phòng được xây dựng từ Google Books.",
      subjects: googleBooksData?.categories || ["Sách tham khảo"],
      quantity: "1"
    };

    res.json({ 
      record: bookRecord, 
      warning: "Hệ thống đang chạy ở chế độ dự phòng hiệu năng cao do giới hạn lượt truy cập AI (Quota 429)." 
    });
  }
});

// Catch-all for undefined API routes to prevent falling back to index.html (which would cause "Unexpected token '<'" parsing errors on the client)
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
});

// Configure Vite middleware or static serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT} in ${process.env.NODE_ENV || "development"} mode`);
    });
  } else {
    console.log("Server initialized as a serverless function (Vercel mode)");
  }
}

startServer();

export default app;
