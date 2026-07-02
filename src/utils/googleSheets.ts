import { BookRecord } from "../types";
import { formatDateTimeGMT7 } from "./dateFormatter";

export const SPREADSHEET_ID = "1CxNsLi1GPoOmsK1uBIuQgewpSBAFKvNl_0thEOEJJ9k";

export const SHEET_HEADERS = [
  "ID",
  "ISBN",
  "Tác giả",
  "Tên tác phẩm",
  "Tên tác phẩm phụ",
  "Nhà xuất bản",
  "Năm xuất bản",
  "Số trang",
  "Ngôn ngữ",
  "Số phân loại DDC",
  "Mã Cutter",
  "Giá tiền",
  "Kích thước",
  "Tóm tắt/Mô tả",
  "Chủ đề",
  "Số Đăng ký cá biệt",
  "Số lượng",
  "Thời gian tạo"
];

export function recordToRow(record: BookRecord, index?: number): string[] {
  return [
    record.id || (index !== undefined ? String(index) : Math.random().toString(36).substring(2, 9).toUpperCase()),
    record.isbn || "",
    record.author || "",
    record.title || "",
    record.subTitle || "",
    record.publisher || "",
    record.pubYear || "",
    record.pages || "",
    record.language || "",
    record.ddc || "",
    record.cutter || "",
    record.price || "",
    record.dimensions || "",
    record.summary || "",
    record.subjects ? record.subjects.join(", ") : "",
    record.barcode || "",
    record.quantity || "1",
    formatDateTimeGMT7(record.createdAt)
  ];
}

export function rowToRecord(row: any[]): BookRecord {
  const generatedId = Math.random().toString(36).substring(2, 9).toUpperCase();
  return {
    id: row[0] ? String(row[0]) : generatedId,
    isbn: String(row[1] || ""),
    author: String(row[2] || ""),
    title: String(row[3] || ""),
    subTitle: String(row[4] || ""),
    publisher: String(row[5] || ""),
    pubYear: String(row[6] || ""),
    pages: String(row[7] || ""),
    language: String(row[8] || ""),
    ddc: String(row[9] || ""),
    cutter: String(row[10] || ""),
    price: String(row[11] || ""),
    dimensions: String(row[12] || ""),
    summary: String(row[13] || ""),
    subjects: row[14] ? String(row[14]).split(",").map(s => s.trim()).filter(Boolean) : [],
    barcode: String(row[15] || ""),
    quantity: String(row[16] || "1"),
    createdAt: String(row[17] || "")
  };
}

// Robust JSON response handler preventing syntax crashes with HTML pages
async function handleResponseJson(response: Response, defaultErrorPrefix: string): Promise<any> {
  let text = "";
  try {
    text = await response.text();
  } catch (e) {
    throw new Error(`${defaultErrorPrefix} (${response.status}): Không thể đọc nội dung phản hồi.`);
  }

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    const isHtml = text.toLowerCase().includes("<html") || text.toLowerCase().includes("<!doctype");
    const previewText = isHtml ? "Phản hồi HTML từ máy chủ" : text.substring(0, 150);
    if (!response.ok) {
      // If the response is not ok and is HTML or text, show a clean message
      throw new Error(`${defaultErrorPrefix} (${response.status}): ${previewText}`);
    }
    throw new Error(`Phản hồi không phải là JSON hợp lệ (status: ${response.status}): ${previewText}`);
  }

  if (!response.ok) {
    const errorMsg = data?.error?.message || data?.error || `${defaultErrorPrefix} (${response.status})`;
    throw new Error(errorMsg);
  }

  if (data && data.error) {
    const errorMsg = data.error.message || data.error || defaultErrorPrefix;
    throw new Error(errorMsg);
  }

  return data;
}

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || "";

// Check spreadsheet metadata and return sheet names
export async function getSpreadsheetDetails(accessToken: string, customSpreadsheetId?: string): Promise<string[]> {
  const sId = customSpreadsheetId || SPREADSHEET_ID;
  const targetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sId}`;
  const url = `${API_BASE_URL}/api/sheets-proxy?url=${encodeURIComponent(targetUrl)}`;
  const response = await fetch(url, {
    headers: { "X-Sheets-Authorization": `Bearer ${accessToken}` }
  });

  const data = await handleResponseJson(response, "Lỗi khi kết nối Google Sheet");
  const sheets = data.sheets || [];
  return sheets.map((s: any) => s.properties?.title || "Sheet1");
}

// Fetch records from sheet
export async function fetchSheetRecords(accessToken: string, sheetName: string, customSpreadsheetId?: string): Promise<BookRecord[]> {
  const sId = customSpreadsheetId || SPREADSHEET_ID;
  const range = `${sheetName}!A:R`;
  const targetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sId}/values/${encodeURIComponent(range)}`;
  const url = `${API_BASE_URL}/api/sheets-proxy?url=${encodeURIComponent(targetUrl)}`;
  const response = await fetch(url, {
    headers: { "X-Sheets-Authorization": `Bearer ${accessToken}` }
  });

  const data = await handleResponseJson(response, "Lỗi khi lấy dữ liệu");
  const rows = data.values || [];
  if (rows.length === 0) return [];

  // Skip header row if it matches SHEET_HEADERS[0] or resembles headers
  let startIndex = 0;
  if (rows[0] && (rows[0][0] === "ID" || rows[0][2] === "Tác giả" || rows[0][3] === "Tên tác phẩm")) {
    startIndex = 1;
  }

  const records: BookRecord[] = [];
  for (let i = startIndex; i < rows.length; i++) {
    records.push(rowToRecord(rows[i]));
  }
  return records;
}

// Initialize sheet headers
export async function initializeSheetHeaders(accessToken: string, sheetName: string, customSpreadsheetId?: string): Promise<void> {
  const sId = customSpreadsheetId || SPREADSHEET_ID;
  const range = `${sheetName}!A1:R1`;
  const targetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const url = `${API_BASE_URL}/api/sheets-proxy?url=${encodeURIComponent(targetUrl)}`;
  
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "X-Sheets-Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      range,
      majorDimension: "ROWS",
      values: [SHEET_HEADERS]
    })
  });

  await handleResponseJson(response, "Lỗi khi khởi tạo tiêu đề");
}

// Append a record to sheet
export async function appendSheetRecord(accessToken: string, sheetName: string, record: BookRecord, customSpreadsheetId?: string): Promise<void> {
  const sId = customSpreadsheetId || SPREADSHEET_ID;
  const range = `${sheetName}!A:A`;
  const targetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const url = `${API_BASE_URL}/api/sheets-proxy?url=${encodeURIComponent(targetUrl)}`;

  const row = recordToRow(record);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Sheets-Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      range,
      majorDimension: "ROWS",
      values: [row]
    })
  });

  await handleResponseJson(response, "Lỗi khi lưu dữ liệu");
}

// Append multiple records to sheet (bulk import)
export async function appendMultipleSheetRecords(accessToken: string, sheetName: string, records: BookRecord[], customSpreadsheetId?: string): Promise<void> {
  const sId = customSpreadsheetId || SPREADSHEET_ID;
  const range = `${sheetName}!A:A`;
  const targetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const url = `${API_BASE_URL}/api/sheets-proxy?url=${encodeURIComponent(targetUrl)}`;

  const rows = records.map(r => recordToRow(r));
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Sheets-Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      range,
      majorDimension: "ROWS",
      values: rows
    })
  });

  await handleResponseJson(response, "Lỗi khi lưu nhiều dữ liệu");
}

// Create a completely new Spreadsheet
export async function createNewSpreadsheet(accessToken: string, title: string): Promise<string> {
  const targetUrl = `https://sheets.googleapis.com/v4/spreadsheets`;
  const url = `${API_BASE_URL}/api/sheets-proxy?url=${encodeURIComponent(targetUrl)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Sheets-Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      properties: {
        title
      }
    })
  });

  const data = await handleResponseJson(response, "Lỗi khi tạo file Google Sheet mới");
  if (!data.spreadsheetId) {
    throw new Error("Không nhận được Spreadsheet ID từ phản hồi của Google API");
  }
  return data.spreadsheetId;
}

// Create a new sheet dynamically
export async function createSheet(accessToken: string, sheetName: string, customSpreadsheetId?: string): Promise<void> {
  const sId = customSpreadsheetId || SPREADSHEET_ID;
  const targetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sId}:batchUpdate`;
  const url = `${API_BASE_URL}/api/sheets-proxy?url=${encodeURIComponent(targetUrl)}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Sheets-Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetName
            }
          }
        }
      ]
    })
  });

  await handleResponseJson(response, `Lỗi khi tạo trang tính ${sheetName}`);
}

// Ensure the "BienMuc" sheet exists, and initialize headers if created
export async function ensureBienMucSheet(accessToken: string, customSpreadsheetId?: string): Promise<void> {
  const sheets = await getSpreadsheetDetails(accessToken, customSpreadsheetId);
  if (!sheets.includes("BienMuc")) {
    await createSheet(accessToken, "BienMuc", customSpreadsheetId);
    await initializeSheetHeaders(accessToken, "BienMuc", customSpreadsheetId);
  }
}

// Clear and overwrite the sheet with updated list of records (retaining headers at row 1)
export async function overwriteSheetRecords(accessToken: string, sheetName: string, records: BookRecord[], customSpreadsheetId?: string): Promise<void> {
  const sId = customSpreadsheetId || SPREADSHEET_ID;
  
  // 1. Clear everything from row 2 onwards to remove existing items
  const clearRange = `${sheetName}!A2:R100000`;
  const clearTargetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sId}/values/${encodeURIComponent(clearRange)}:clear`;
  const clearUrl = `${API_BASE_URL}/api/sheets-proxy?url=${encodeURIComponent(clearTargetUrl)}`;
  
  const clearResponse = await fetch(clearUrl, {
    method: "POST",
    headers: {
      "X-Sheets-Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });
  
  await handleResponseJson(clearResponse, `Lỗi khi làm sạch dữ liệu cũ trên trang tính ${sheetName}`);
  
  // 2. If there are remaining records, write them
  if (records.length > 0) {
    const range = `${sheetName}!A2`;
    const updateTargetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const updateUrl = `${API_BASE_URL}/api/sheets-proxy?url=${encodeURIComponent(updateTargetUrl)}`;
    
    const rows = records.map(r => recordToRow(r));
    const updateResponse = await fetch(updateUrl, {
      method: "PUT",
      headers: {
        "X-Sheets-Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        range,
        majorDimension: "ROWS",
        values: rows
      })
    });
    
    await handleResponseJson(updateResponse, `Lỗi khi đồng bộ dữ liệu mới sang trang tính ${sheetName}`);
  }
}

