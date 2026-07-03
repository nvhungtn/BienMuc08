import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer, { Browser, ElementHandle } from "puppeteer";
import logger from "../utils/logger";
import { isValidIsbn, cleanIsbn } from "../utils/isbnValidator";
import isbn3 from "isbn3";
import fs from "fs";

export interface MarcField {
  tag: string;
  ind1: string;
  ind2: string;
  subfields: Record<string, string>;
}

export interface Marc21Data {
  leader: string;
  fields: MarcField[];
}

export interface BookData {
  isbn: string;
  title: string;
  subTitle: string;
  responsibility: string;
  author: string;
  publisher: string;
  pubYear: string;
  pages: string;
  summary: string;
  subjects: string[];
  ddc: string;
  cutter: string;
  barcode: string;
  price: string;
  dimensions: string;
  language: string;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Pause execution for specified milliseconds
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch HTML content with retries and timeout
 */
async function fetchWithRetry(url: string, retries = 3, timeout = 10000): Promise<string> {
  let lastError: any = null;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Fetching URL (Attempt ${attempt}/${retries}): ${url}`);
      const response = await axios.get(url, {
        timeout,
        headers: {
          "User-Agent": getRandomUserAgent(),
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        }
      });
      
      const html = response.data;
      if (typeof html === "string") {
        const lowerHtml = html.toLowerCase();
        if (lowerHtml.includes("cloudflare") || lowerHtml.includes("captcha") || lowerHtml.includes("ddos protection") || lowerHtml.includes("robot verification")) {
          throw new Error("ANTI_BOT_BLOCKED: Hệ thống OPAC Thư viện Quốc gia đã chặn yêu cầu bằng bộ lọc Anti-bot/Cloudflare.");
        }
      }
      return html;
    } catch (err: any) {
      lastError = err;
      const isForbidden = err.response?.status === 403 || err.message?.includes("403");
      const isAntiBotMsg = err.message && err.message.includes("ANTI_BOT_BLOCKED");
      
      if (isForbidden || isAntiBotMsg) {
        logger.error(`OPAC access blocked by anti-bot measures (Status: ${err.response?.status || "WAF Block"}). URL: ${url}`);
        throw new Error("ANTI_BOT_BLOCKED: Hệ thống OPAC Thư viện Quốc gia đã chặn yêu cầu (Anti-bot block/WAF). Vui lòng thử lại sau.");
      }
      
      const isTimeout = err.code === "ECONNABORTED" || err.message?.toLowerCase().includes("timeout");
      if (isTimeout) {
        logger.warn(`Attempt ${attempt}/${retries} to OPAC timed out for: ${url}`);
      } else {
        logger.warn(`Attempt ${attempt}/${retries} failed for URL ${url}. Error: ${err.message}`);
      }
      
      if (attempt < retries) {
        await delay(attempt * 1500); // progressive backoff
      }
    }
  }
  
  if (lastError && (lastError.code === "ECONNABORTED" || lastError.message?.toLowerCase().includes("timeout"))) {
    throw new Error("TIMEOUT_ERROR: Yêu cầu kết nối đến OPAC Thư viện Quốc gia bị quá hạn (Timeout). Vui lòng thử lại.");
  }
  
  throw lastError || new Error(`Không thể tải dữ liệu từ OPAC sau ${retries} lần thử.`);
}

/**
 * Core service to search and scrape data from OPAC NLV
 */
export async function searchOpacByIsbn(isbn: string): Promise<{ book: BookData; marc21: Marc21Data } | null> {
  const rawOriginal = isbn.trim();
  const cleaned = cleanIsbn(isbn);
  if (!isValidIsbn(cleaned)) {
    throw new Error("Mã ISBN không hợp lệ hoặc sai định dạng.");
  }

  // Generate all potential search formats to exhaustively search NLV OPAC
  const searchTerms: string[] = [];

  // 1. Raw original input string as entered by user
  if (rawOriginal && !searchTerms.includes(rawOriginal)) {
    searchTerms.push(rawOriginal);
  }

  // 2. Standard ISBN-13 formats
  let isbn13Clean = "";
  if (cleaned.length === 13) {
    isbn13Clean = cleaned;
  } else if (cleaned.length === 10) {
    const parsed = isbn3.parse(cleaned);
    if (parsed && parsed.isbn13) {
      isbn13Clean = parsed.isbn13;
    }
  }

  if (isbn13Clean) {
    if (!searchTerms.includes(isbn13Clean)) {
      searchTerms.push(isbn13Clean);
    }
    const hyphenated13 = isbn3.hyphenate(isbn13Clean);
    if (hyphenated13 && !searchTerms.includes(hyphenated13)) {
      searchTerms.push(hyphenated13);
    }
  }

  // 3. Standard ISBN-10 formats
  let isbn10Clean = "";
  if (cleaned.length === 10) {
    isbn10Clean = cleaned;
  } else if (cleaned.length === 13) {
    const parsed = isbn3.parse(cleaned);
    if (parsed && parsed.isbn10) {
      isbn10Clean = parsed.isbn10;
    }
  }

  if (isbn10Clean) {
    if (!searchTerms.includes(isbn10Clean)) {
      searchTerms.push(isbn10Clean);
    }
    const hyphenated10 = isbn3.hyphenate(isbn10Clean);
    if (hyphenated10 && !searchTerms.includes(hyphenated10)) {
      searchTerms.push(hyphenated10);
    }
  }

  // Fallback to cleaned if not included
  if (!searchTerms.includes(cleaned)) {
    searchTerms.push(cleaned);
  }

  logger.info(`Bắt đầu quy trình tra cứu ISBN bằng Puppeteer cho: ${cleaned}. Các định dạng thử nghiệm tại TVQG VN: ${searchTerms.join(", ")}`);
  
  if (process.env.DISABLE_PUPPETEER === "true") {
    logger.info(`Puppeteer đã bị tắt theo cấu hình (DISABLE_PUPPETEER=true) cho ISBN: ${cleaned}`);
    return null;
  }
  
  let browser: Browser | null = null;
  try {
    if (process.env.PUPPETEER_WS_ENDPOINT) {
      logger.info(`Đang kết nối tới trình duyệt từ xa qua WebSocket: ${process.env.PUPPETEER_WS_ENDPOINT}`);
      browser = await puppeteer.connect({
        browserWSEndpoint: process.env.PUPPETEER_WS_ENDPOINT
      }) as any;
    } else {
      const launchOptions: any = {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-zygote",
          "--single-process"
        ]
      };

      const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
      if (envPath && !fs.existsSync(envPath)) {
        logger.warn(`Đường dẫn trình duyệt cấu hình sẵn không tồn tại: ${envPath}. Đang loại bỏ khỏi môi trường.`);
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
      }

      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        logger.info(`Sử dụng đường dẫn trình duyệt cấu hình sẵn: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      } else {
        const alternativePaths = [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/usr/bin/chrome"
        ];
        let foundAlt = false;
        for (const altPath of alternativePaths) {
          if (fs.existsSync(altPath)) {
            logger.info(`Đã tìm thấy trình duyệt thay thế tại: ${altPath}`);
            launchOptions.executablePath = altPath;
            foundAlt = true;
            break;
          }
        }
        if (!foundAlt) {
          logger.info("Không tìm thấy trình duyệt hệ thống nào. Để Puppeteer tự động tìm kiếm đường dẫn mặc định...");
        }
      }

      logger.info("Khởi tạo trình duyệt Puppeteer nội bộ...");
      browser = await puppeteer.launch(launchOptions);
    }

    const page = await browser.newPage();
    // Đặt viewport chuẩn để chắc chắn giao diện desktop hiển thị đầy đủ
    await page.setViewport({ width: 1280, height: 800 });
    page.setDefaultTimeout(15000); // 15s timeout cho mỗi thao tác chính

    logger.info("Bước 2: Truy cập OPAC Thư viện Quốc gia...");
    await page.goto("https://opac.nlv.gov.vn/tim-kiem", {
      waitUntil: "networkidle2"
    });

    logger.info("Mở bộ lọc tìm kiếm và chọn trường ISBN/ISSN...");
    // Tìm và click nút bộ lọc nhanh
    const filterBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll("#quick-filter"));
      for (const btn of btns) {
        const box = btn.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) return btn;
      }
      return btns[0];
    });

    if (filterBtn) {
      await (filterBtn as ElementHandle).click();
      await delay(500);
    } else {
      throw new Error("Không tìm thấy nút chọn trường tìm kiếm `#quick-filter`.");
    }

    // Chọn option "ISBN/ISSN" trong danh sách
    const selectSuccess = await page.evaluate(() => {
      const options = Array.from(document.querySelectorAll(".select-menu .option"));
      const isbnOpt = options.find(el => el.textContent?.trim().toUpperCase() === "ISBN/ISSN");
      if (isbnOpt) {
        (isbnOpt as any).click();
        return true;
      }
      return false;
    });

    if (!selectSuccess) {
      throw new Error("Không tìm thấy tùy chọn 'ISBN/ISSN' trong bộ lọc.");
    }
    await delay(500);

    // Tìm ô input đang hiển thị
    const targetInput = await page.evaluateHandle(() => {
      const inputs = Array.from(document.querySelectorAll("input.search-bar-input"));
      for (const input of inputs) {
        const box = input.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) return input;
      }
      return inputs[0];
    });

    if (!targetInput) {
      throw new Error("Không tìm thấy ô nhập liệu thanh tìm kiếm.");
    }

    let foundTerm: string | null = null;
    for (let i = 0; i < searchTerms.length; i++) {
      const term = searchTerms[i];
      logger.info(`Nhập mã ISBN ${term} vào thanh tìm kiếm (Lượt ${i + 1}/${searchTerms.length})...`);
      
      await (targetInput as ElementHandle).focus();
      await page.evaluate((el) => {
        (el as HTMLInputElement).value = "";
      }, targetInput);
      await (targetInput as ElementHandle).type(term);

      logger.info(`Gửi yêu cầu tìm kiếm cho mã ISBN: ${term}`);
      await page.keyboard.press("Enter");

      logger.info("Đang chờ kết quả phản hồi từ máy chủ...");
      await delay(4000);

      // Kiểm tra xem có thông báo không tìm thấy kết quả nào không, hoặc không tìm thấy bất kỳ link chi tiết nào
      const isNotFound = await page.evaluate(() => {
        const txt = document.body.innerText.toLowerCase();
        const hasNoResultText = txt.includes("không tìm thấy") || 
                                txt.includes("no results") || 
                                txt.includes("tìm thấy 0") || 
                                txt.includes("0 tài liệu") || 
                                txt.includes("0 kết quả");
        if (hasNoResultText) return true;

        // Tìm xem có bất kỳ liên kết chi tiết nào không
        const links = Array.from(document.querySelectorAll("a"));
        const hasDetailLink = links.some(el => {
          const href = el.getAttribute("href") || "";
          return href.includes("/chi-tiet-tai-lieu/") || href.includes("/Record/");
        });
        return !hasDetailLink;
      });

      if (!isNotFound) {
        logger.info(`Đã tìm thấy kết quả cho mã ISBN: ${term}`);
        foundTerm = term;
        break;
      } else {
        logger.warn(`Không tìm thấy kết quả cho mã ISBN: ${term}.`);
      }
    }

    if (!foundTerm) {
      throw new Error("ISBN_NOT_FOUND: Mã ISBN không tồn tại trên hệ thống OPAC Thư viện Quốc gia.");
    }

    logger.info("Bước 3: Trích xuất liên kết chi tiết tài liệu đầu tiên...");
    // Tìm liên kết chi tiết tài liệu (/chi-tiet-tai-lieu/ hoặc /Record/)
    const detailLink = await page.evaluate(() => {
      // Ưu tiên tìm trong vùng chứa danh sách kết quả thực tế trước để tránh các liên kết sidebar/carousel/header/popular
      const resultContainers = [
        ".result", 
        ".result-item", 
        ".media-body", 
        "#view-list", 
        ".search-results", 
        "#content", 
        ".main", 
        "main"
      ];
      
      for (const selector of resultContainers) {
        const container = document.querySelector(selector);
        if (container) {
          const links = Array.from(container.querySelectorAll("a"));
          const targetLink = links.find(el => {
            const href = el.getAttribute("href") || "";
            return href.includes("/chi-tiet-tai-lieu/") || href.includes("/Record/");
          });
          if (targetLink) return targetLink.href;
        }
      }

      // Dự phòng tìm toàn trang nếu không có container cụ thể
      const links = Array.from(document.querySelectorAll("a"));
      const targetLink = links.find(el => {
        const href = el.getAttribute("href") || "";
        return href.includes("/chi-tiet-tai-lieu/") || href.includes("/Record/");
      });
      return targetLink ? targetLink.href : null;
    });

    if (!detailLink) {
      throw new Error("ISBN_NOT_FOUND: Không tìm thấy liên kết chi tiết cho tài liệu này (Có thể mã ISBN không tồn tại).");
    }

    logger.info(`Bước 4: Truy cập trang chi tiết tài liệu: ${detailLink}`);
    await page.goto(detailLink, {
      waitUntil: "networkidle2"
    });

    logger.info("Bước 5: Trích xuất tab Marc21...");
    // Tìm và click nút tab Marc21
    const clickedMarc = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("a, button, span"));
      const marcBtn = btns.find(b => b.textContent?.trim().toLowerCase() === "marc21" || b.textContent?.trim().toLowerCase() === "marc");
      if (marcBtn) {
        (marcBtn as any).click();
        return true;
      }
      return false;
    });

    if (!clickedMarc) {
      logger.warn("Không tìm thấy nút hoặc tab Marc21 để click trên trang chi tiết.");
    } else {
      logger.info("Đã click nút tab Marc21, chờ tải dữ liệu...");
      await delay(2000);
    }

    // Trích xuất toàn bộ HTML của trang chi tiết
    const pageHtml = await page.evaluate(() => document.documentElement.outerHTML);
    const $record = cheerio.load(pageHtml);
    const marc21 = parseMarcHtml($record);

    if (marc21.fields.length === 0) {
      logger.warn("Không thể bóc tách các trường dữ liệu từ tab MARC21.");
      throw new Error("OPAC_STRUCTURE_CHANGED: Cấu trúc trang chi tiết hoặc tab Marc21 đã thay đổi.");
    }

    const book = mapMarcToBook(marc21, cleaned);

    // KIỂM TRA CHÉO CHẶT CHẼ: Kiểm tra chéo mã ISBN thực tế của sách vừa tìm được với mã ISBN được yêu cầu
    // Để đảm bảo 100% không bị nhận sai sách nổi bật/sách mượn nhiều do lỗi giao dịch, lỗi cập nhật UI, hoặc query trống của OPAC
    const parsedIsbnRaw = marc21.fields.find(f => f.tag === "020")?.subfields["a"] || "";
    if (parsedIsbnRaw) {
      if (!isSameIsbn(parsedIsbnRaw, cleaned)) {
        logger.error(`CẢNH BÁO: Phát hiện sai lệch ISBN nghiêm trọng từ OPAC! Yêu cầu: ${cleaned}, Thực tế: ${parsedIsbnRaw} (${book.title})`);
        throw new Error(`ISBN_MISMATCH: Kết quả tìm kiếm từ OPAC có mã ISBN (${parsedIsbnRaw}) không khớp với mã yêu cầu (${cleaned}).`);
      }
    }

    logger.info(`Tra cứu và biên mục thành công sách: ${book.title}`);
    return { book, marc21 };

  } catch (err: any) {
    logger.error(`Lỗi trong quá trình tra cứu Puppeteer: ${err.message}`);
    throw err;
  } finally {
    if (browser) {
      await browser.close();
      logger.info("Đã đóng phiên duyệt Puppeteer an toàn.");
    }
  }
}

/**
 * Parses MARC21 data from the loaded HTML document
 */
function parseMarcHtml($: cheerio.CheerioAPI): Marc21Data {
  const fields: MarcField[] = [];
  let leader = "00000cam a2200000 a 4500"; // default leader

  // 1. Kiểm tra cấu trúc bảng .marc21 mới (dạng cột: Tag | Ind1 | Ind2 | Subcode | Subvalue)
  const newMarcTable = $("table.marc21");
  if (newMarcTable.length > 0) {
    let currentField: MarcField | null = null;
    newMarcTable.find("tr").each((_, row) => {
      const tds = $(row).find("td");
      if (tds.length >= 5) {
        const tagText = $(tds[0]).text().trim();
        const tag = tagText.replace(/[^0-9]/g, ""); // Trích xuất 3 số hiệu nhãn
        
        if (tag && tag.length === 3) {
          // Nhãn mới bắt đầu
          const ind1Text = $(tds[1]).text().trim();
          const ind2Text = $(tds[2]).text().trim();
          const subfieldCode = $(tds[3]).text().trim();
          const subfieldVal = cleanMarcValue($(tds[4]).text());
          
          currentField = {
            tag,
            ind1: ind1Text === "" || ind1Text === " " || ind1Text === "_" || ind1Text === "-" ? "#" : ind1Text,
            ind2: ind2Text === "" || ind2Text === " " || ind2Text === "_" || ind2Text === "-" ? "#" : ind2Text,
            subfields: {}
          };
          
          if (subfieldCode) {
            currentField.subfields[subfieldCode] = subfieldVal;
          }
          fields.push(currentField);
        } else if (currentField) {
          // Tiếp tục của nhãn đang hoạt động
          const subfieldCode = $(tds[3]).text().trim();
          const subfieldVal = cleanMarcValue($(tds[4]).text());
          if (subfieldCode) {
            currentField.subfields[subfieldCode] = currentField.subfields[subfieldCode] 
              ? `${currentField.subfields[subfieldCode]}; ${subfieldVal}` 
              : subfieldVal;
          }
        }
      }
    });

    // Trích xuất Leader nếu có nhãn 000 hoặc LDR
    const ldrField = fields.find(f => f.tag === "000" || f.tag === "LDR");
    if (ldrField && ldrField.subfields["a"]) {
      leader = ldrField.subfields["a"];
    }
    
    if (fields.length > 0) {
      return { leader, fields };
    }
  }

  // 2. Dự phòng: VuFind standard MARC table: .marc-table hoặc bảng chứa các tag cũ
  const marcTable = $(".marc-table, table.table-striped, table").filter((_, el) => {
    const text = $(el).text();
    return text.includes("245") || text.includes("020") || text.includes("subfields");
  }).first();

  if (marcTable.length > 0) {
    marcTable.find("tr").each((_, row) => {
      const tagText = $(row).find(".tag, td:nth-child(1), th:nth-child(1)").text().trim();
      const tag = tagText.replace(/[^0-9]/g, ""); // Extract 3 digits tag
      
      if (tag && tag.length === 3) {
        // Extract indicators
        const indText = $(row).find(".ind, td:nth-child(2)").text();
        let ind1 = "#";
        let ind2 = "#";
        
        // Normalize indicator representation
        const cleanedInd = indText.replace(/\s/g, " ").substring(0, 2);
        if (cleanedInd.length >= 1) {
          ind1 = cleanedInd[0] === " " || cleanedInd[0] === "_" || cleanedInd[0] === "-" ? "#" : cleanedInd[0];
        }
        if (cleanedInd.length >= 2) {
          ind2 = cleanedInd[1] === " " || cleanedInd[1] === "_" || cleanedInd[1] === "-" ? "#" : cleanedInd[1];
        }

        // Extract subfields
        const subfields: Record<string, string> = {};
        const subfieldsCell = $(row).find(".subfields, td:nth-child(3)");
        
        // Try parsing nested span.subfield or span.subfield-code
        const spans = subfieldsCell.find("span.subfield, span.subfield-code, span[class*='subfield']");
        if (spans.length > 0) {
          spans.each((_, spanEl) => {
            const code = $(spanEl).text().trim().replace(/[\$\|]/g, "");
            if (code && code.length === 1) {
              let val = "";
              let nextNode = spanEl.nextSibling;
              while (nextNode && nextNode.nodeType !== 1 && (nextNode as any).name !== "span") {
                if (nextNode.nodeType === 3) {
                  val += nextNode.nodeValue || "";
                }
                nextNode = nextNode.nextSibling;
              }
              val = cleanMarcValue(val);
              if (val) {
                // Handle duplicate subfields by combining or taking the first
                subfields[code] = subfields[code] ? `${subfields[code]}; ${val}` : val;
              }
            }
          });
        } else {
          // Fallback parsing of plain text (e.g. $aTitle $cAuthor or |aTitle |cAuthor)
          const text = subfieldsCell.text().trim();
          const regex = /[\$\|]([a-z0-9])\s*([^$\|]+)/g;
          let match;
          while ((match = regex.exec(text)) !== null) {
            const code = match[1];
            const val = cleanMarcValue(match[2]);
            if (val) {
              subfields[code] = subfields[code] ? `${subfields[code]}; ${val}` : val;
            }
          }
        }

        // If tag is a control field (001-008), it has no indicators, put value in $a or custom format
        if (parseInt(tag) < 10) {
          const val = cleanMarcValue(subfieldsCell.text());
          subfields["a"] = val;
          ind1 = "#";
          ind2 = "#";
        }

        if (Object.keys(subfields).length > 0) {
          fields.push({ tag, ind1, ind2, subfields });
        }
      }
    });
  }

  // Look for Leader if available (tag 000 or LDR)
  const ldrField = fields.find(f => f.tag === "000" || f.tag === "LDR");
  if (ldrField && ldrField.subfields["a"]) {
    leader = ldrField.subfields["a"];
  }

  return { leader, fields };
}

function cleanMarcValue(val: string): string {
  return val
    .trim()
    .replace(/^[\/\.,\s;:=]+|[\/\.,\s;:=]+$/g, "") // Clean trailing/leading punct
    .trim();
}

/**
 * Maps parsed MARC21 fields to friendly BookData
 */
export function mapMarcToBook(marc: Marc21Data, requestedIsbn: string): BookData {
  const getSubfield = (tag: string, code: string): string => {
    const field = marc.fields.find(f => f.tag === tag);
    return field?.subfields[code] || "";
  };

  const getSubfieldsMerged = (tag: string, codes: string[]): string => {
    const field = marc.fields.find(f => f.tag === tag);
    if (!field) return "";
    return codes
      .map(c => field.subfields[c] || "")
      .filter(Boolean)
      .join(" ");
  };

  // Extract fields
  const isbn = getSubfield("020", "a") || requestedIsbn;
  const price = getSubfield("020", "c") || "120000đ";
  const author = getSubfield("100", "a") || getSubfield("700", "a") || getSubfield("110", "a") || "Chưa rõ tác giả";
  const title = getSubfield("245", "a") || "Sách chưa rõ tên";
  const subTitle = getSubfield("245", "b") || "";
  const responsibility = getSubfield("245", "c") || "";
  
  // Publisher falls back to 264 (modern) or 260 (legacy)
  const publisher = getSubfield("260", "b") || getSubfield("264", "b") || "NXB Tổng hợp";
  const pubYear = getSubfield("260", "c") || getSubfield("264", "c") || "2024";
  
  const pages = getSubfield("300", "a") || "200";
  const dimensions = getSubfield("300", "c") || "21cm";
  const summary = getSubfield("520", "a") || "";
  
  // Subject keywords (all 650 $a)
  const subjects: string[] = [];
  marc.fields.filter(f => f.tag === "650").forEach(f => {
    if (f.subfields["a"]) {
      subjects.push(f.subfields["a"]);
    }
  });
  if (subjects.length === 0) {
    subjects.push("Sách tham khảo");
  }

  // DDC classification
  let ddc = getSubfield("082", "a") || "300";
  
  // Clean DDC from indicators or suffixes
  ddc = ddc.replace(/[^\d\.]/g, "").trim() || "300";

  // Cutter generation based on Author & Title
  let cutter = getSubfield("082", "b") || "";
  if (!cutter) {
    const firstLetter = author.trim().charAt(0).toUpperCase();
    let hash = 0;
    for (let i = 0; i < author.length; i++) {
      hash = author.charCodeAt(i) + ((hash << 5) - hash);
    }
    const cutterNum = Math.abs(hash % 800) + 100;
    const titleLetter = title.trim().charAt(0).toLowerCase();
    cutter = `${firstLetter}${cutterNum}${titleLetter}`;
  }

  // Barcode (deterministic based on ISBN)
  let isbnHash = 0;
  for (let i = 0; i < requestedIsbn.length; i++) {
    isbnHash = requestedIsbn.charCodeAt(i) + ((isbnHash << 5) - isbnHash);
  }
  const barcode = (Math.abs(isbnHash % 900000) + 100000).toString();

  // Language mapping
  let language = getSubfield("041", "a") || getSubfield("008", "a")?.substring(35, 38) || "vie";
  language = language.toLowerCase().includes("vi") ? "vie" : (language.toLowerCase().includes("en") ? "eng" : "vie");

  return {
    isbn,
    title,
    subTitle,
    responsibility,
    author,
    publisher,
    pubYear,
    pages,
    summary,
    subjects,
    ddc,
    cutter,
    barcode,
    price,
    dimensions,
    language
  };
}

/**
 * Exports MARC21 data as MARCXML
 */
export function exportToMarcXml(data: Marc21Data): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<record xmlns="http://www.loc.gov/MARC21/slim">\n`;
  xml += `  <leader>${data.leader}</leader>\n`;

  data.fields.forEach(f => {
    const isControl = parseInt(f.tag) < 10;
    if (isControl) {
      xml += `  <controlfield tag="${f.tag}">${f.subfields["a"] || ""}</controlfield>\n`;
    } else {
      const ind1Attr = f.ind1 === "#" ? " " : f.ind1;
      const ind2Attr = f.ind2 === "#" ? " " : f.ind2;
      xml += `  <datafield tag="${f.tag}" ind1="${ind1Attr}" ind2="${ind2Attr}">\n`;
      
      Object.entries(f.subfields).forEach(([code, value]) => {
        xml += `    <subfield code="${code}">${value}</subfield>\n`;
      });
      
      xml += `  </datafield>\n`;
    }
  });

  xml += `</record>`;
  return xml;
}

/**
 * Helper to check if two ISBN strings represent the same book (handles formatting, ISBN-10, ISBN-13, and extra suffixes)
 */
export function isSameIsbn(isbnA: string, isbnB: string): boolean {
  const cleanA = isbnA.replace(/[^\dX]/gi, "").toUpperCase();
  const cleanB = isbnB.replace(/[^\dX]/gi, "").toUpperCase();
  
  if (cleanA === cleanB) return true;
  
  // Try parsing using isbn3 library
  const parsedA = isbn3.parse(cleanA);
  const parsedB = isbn3.parse(cleanB);
  
  if (parsedA && parsedB) {
    return parsedA.isbn13 === parsedB.isbn13;
  }
  
  // Substring match as fallback (e.g. if one contains extra cataloging suffixes like "(bìa mềm)")
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
    return true;
  }
  
  return false;
}
