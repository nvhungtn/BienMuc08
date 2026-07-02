import { BookRecord, MarcField } from "../types";
import { formatDateTimeGMT7 } from "./dateFormatter";
import { formatIsbn } from "./isbnFormatter";

export function parseMarc21(rawText: string): BookRecord {
  const lines = rawText.split("\n");
  const fields: MarcField[] = [];
  let currentField: MarcField | null = null;

  for (let line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Detect if line starts with whitespace (continuation of previous tag)
    const isContinuation = /^\s+/.test(line);

    if (isContinuation) {
      if (!currentField) continue;
      // Parse continuation line
      // Format is usually: [whitespace] [subfield_char] [whitespace] [value]
      const trimmedLine = line.trim();
      // Split by tab or multiple spaces
      const parts = trimmedLine.split(/\t+| {2,}/).map(p => p.trim());
      if (parts.length >= 2) {
        const subfieldCode = parts[0];
        const value = parts.slice(1).join(" ");
        if (subfieldCode && value) {
          if (!currentField.subfields[subfieldCode]) {
            currentField.subfields[subfieldCode] = [];
          }
          currentField.subfields[subfieldCode].push(value);
        }
      } else {
        // Fallback for single line without tabs, e.g. "a value"
        const firstSpace = trimmedLine.indexOf(" ");
        if (firstSpace > 0) {
          const subfieldCode = trimmedLine.substring(0, firstSpace).trim();
          const value = trimmedLine.substring(firstSpace + 1).trim();
          if (subfieldCode && value && subfieldCode.length === 1) {
            if (!currentField.subfields[subfieldCode]) {
              currentField.subfields[subfieldCode] = [];
            }
            currentField.subfields[subfieldCode].push(value);
          }
        }
      }
    } else {
      // New tag
      const trimmedLine = line.trim();
      // Split by tab or multiple spaces
      const parts = trimmedLine.split(/\t+| {2,}/).map(p => p.trim());
      if (parts.length >= 1) {
        const tag = parts[0];
        // Must be a 3-digit tag
        if (/^\d{3}$/.test(tag)) {
          // Parse indicators
          let ind1 = "#";
          let ind2 = "#";
          let subfieldIndex = 1;

          if (parts.length > 2 && (parts[1] === "#" || parts[1].length === 1) && (parts[2] === "#" || parts[2].length === 1)) {
            ind1 = parts[1];
            ind2 = parts[2];
            subfieldIndex = 3;
          } else if (parts.length > 1 && parts[1].length === 2) {
            ind1 = parts[1][0];
            ind2 = parts[1][1];
            subfieldIndex = 2;
          } else if (parts.length > 1) {
            // Check if parts[1] is indicator
            ind1 = parts[1];
            subfieldIndex = 2;
          }

          currentField = {
            tag,
            ind1,
            ind2,
            subfields: {}
          };
          fields.push(currentField);

          // Parse rest of the parts on this line as subfields
          // Example: [subfield_code, value, subfield_code, value...]
          const remaining = parts.slice(subfieldIndex);
          if (remaining.length >= 2) {
            // It could be like "a", "9786043184815"
            let i = 0;
            while (i < remaining.length) {
              const code = remaining[i];
              const val = remaining[i + 1];
              if (code && val && code.length === 1) {
                if (!currentField.subfields[code]) {
                  currentField.subfields[code] = [];
                }
                currentField.subfields[code].push(val);
                i += 2;
              } else {
                // If it doesn't match clean structure, just increment
                i++;
              }
            }
          } else if (remaining.length === 1) {
            // E.g. "a9786043184815"
            const item = remaining[0];
            if (item.length > 1) {
              const code = item[0];
              const val = item.substring(1);
              if (!currentField.subfields[code]) {
                currentField.subfields[code] = [];
              }
              currentField.subfields[code].push(val);
            }
          }
        }
      }
    }
  }

  // Map parsed MARC fields to BookRecord
  const record: BookRecord = {
    isbn: "",
    title: "",
    subTitle: "",
    author: "",
    publisher: "",
    pubYear: "",
    pages: "",
    language: "",
    ddc: "",
    cutter: "",
    price: "",
    dimensions: "",
    summary: "",
    subjects: [],
    barcode: "",
    quantity: "1",
    rawMarc: rawText,
    createdAt: formatDateTimeGMT7(new Date())
  };

  const subjectList: string[] = [];

  for (const field of fields) {
    const getFirst = (code: string) => field.subfields[code]?.[0] || "";
    const getAll = (code: string) => field.subfields[code] || [];

    switch (field.tag) {
      case "020":
        record.isbn = formatIsbn(getFirst("a")) || record.isbn;
        record.price = getFirst("c") || record.price;
        break;
      case "041":
        record.language = getFirst("a") || record.language;
        break;
      case "082":
        record.ddc = getFirst("a") || record.ddc;
        record.cutter = getFirst("b") || record.cutter;
        break;
      case "100":
      case "110":
      case "700":
        // Author field
        if (!record.author) {
          record.author = getFirst("a");
        }
        break;
      case "245":
        record.title = getFirst("a") || record.title;
        record.subTitle = getFirst("b") || record.subTitle;
        if (!record.author && getFirst("c")) {
          // If no author field yet, try to clean and use statement of responsibility
          // e.g. "Hồng Đức" or "Tuyển chọn..."
          const resp = getFirst("c");
          // Extract name: e.g. "bởi Nguyễn Văn A" or just "Nguyễn Văn A"
          record.author = resp.replace(/^(bởi|tác giả|dịch giả|biên soạn|tuyển chọn)\s+/i, "").trim();
        }
        break;
      case "260":
      case "264":
        record.publisher = getFirst("b") || record.publisher;
        record.pubYear = getFirst("c") || record.pubYear;
        // Clean year (extract first 4-digit number)
        if (record.pubYear) {
          const match = record.pubYear.match(/\d{4}/);
          if (match) {
            record.pubYear = match[0];
          }
        }
        break;
      case "300":
        record.pages = getFirst("a") || record.pages;
        record.dimensions = getFirst("c") || record.dimensions;
        break;
      case "520":
        record.summary = getFirst("a") || record.summary;
        break;
      case "650":
        const sub = getFirst("a");
        if (sub && !subjectList.includes(sub)) {
          subjectList.push(sub);
        }
        break;
      case "930":
        record.barcode = getFirst("a") || record.barcode;
        break;
    }
  }

  record.subjects = subjectList;
  return record;
}

// Generate raw MARC 21 text from a BookRecord
export function generateMarc21Text(record: BookRecord): string {
  const lines: string[] = [];

  const addLine = (tag: string, ind1: string, ind2: string, subfields: { code: string; val: string }[]) => {
    if (subfields.length === 0) return;
    const first = subfields[0];
    lines.push(`${tag}\t${ind1}\t${ind2}\t${first.code}\t${first.val}`);
    for (let i = 1; i < subfields.length; i++) {
      lines.push(`\t\t\t${subfields[i].code}\t${subfields[i].val}`);
    }
  };

  if (record.isbn || record.price) {
    const subs = [];
    if (record.isbn) subs.push({ code: "a", val: record.isbn });
    if (record.price) subs.push({ code: "c", val: record.price });
    addLine("020", "#", "#", subs);
  }

  if (record.language) {
    addLine("041", "0", "#", [{ code: "a", val: record.language }]);
  }

  if (record.ddc || record.cutter) {
    const subs = [];
    if (record.ddc) subs.push({ code: "a", val: record.ddc });
    if (record.cutter) subs.push({ code: "b", val: record.cutter });
    addLine("082", "0", "4", subs);
  }

  if (record.author) {
    addLine("100", "1", "#", [{ code: "a", val: record.author }]);
  }

  if (record.title || record.subTitle) {
    const subs = [];
    if (record.title) subs.push({ code: "a", val: record.title });
    if (record.subTitle) subs.push({ code: "b", val: record.subTitle });
    if (record.author) subs.push({ code: "c", val: record.author });
    addLine("245", "0", "0", subs);
  }

  if (record.publisher || record.pubYear) {
    const subs = [];
    subs.push({ code: "a", val: "H." }); // place placeholder
    if (record.publisher) subs.push({ code: "b", val: record.publisher });
    if (record.pubYear) subs.push({ code: "c", val: record.pubYear });
    addLine("260", "#", "#", subs);
  }

  if (record.pages || record.dimensions) {
    const subs = [];
    if (record.pages) subs.push({ code: "a", val: record.pages.endsWith("tr.") || record.pages.endsWith("p.") ? record.pages : `${record.pages}tr.` });
    if (record.dimensions) subs.push({ code: "c", val: record.dimensions });
    addLine("300", "#", "#", subs);
  }

  if (record.summary) {
    addLine("520", "#", "#", [{ code: "a", val: record.summary }]);
  }

  if (record.subjects && record.subjects.length > 0) {
    for (const sub of record.subjects) {
      if (sub.trim()) {
        addLine("650", "#", "7", [
          { code: "2", val: "Bộ TK TVQG" },
          { code: "a", val: sub.trim() }
        ]);
      }
    }
  }

  if (record.barcode) {
    addLine("930", "#", "#", [{ code: "a", val: record.barcode }]);
  }

  return lines.join("\n");
}
