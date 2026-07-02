/**
 * Utility for validating and clean-formatting ISBNs (ISBN-10 and ISBN-13)
 */

/**
 * Clean ISBN string from spacing, hyphens
 */
export function cleanIsbn(isbn: string): string {
  return isbn.replace(/[- ]/g, "").trim();
}

/**
 * Validates whether a string is a valid ISBN-10 or ISBN-13
 */
export function isValidIsbn(isbn: string): boolean {
  const cleaned = cleanIsbn(isbn);
  
  if (cleaned.length === 10) {
    return isValidIsbn10(cleaned);
  } else if (cleaned.length === 13) {
    return isValidIsbn13(cleaned);
  }
  
  return false;
}

/**
 * Validates ISBN-10
 */
function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dXx]$/.test(isbn)) {
    return false;
  }
  
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(isbn[i], 10) * (10 - i);
  }
  
  const lastChar = isbn[9].toUpperCase();
  const checksum = lastChar === "X" ? 10 : parseInt(lastChar, 10);
  sum += checksum;
  
  return sum % 11 === 0;
}

/**
 * Validates ISBN-13
 */
function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) {
    return false;
  }
  
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const weight = i % 2 === 0 ? 1 : 3;
    sum += parseInt(isbn[i], 10) * weight;
  }
  
  return sum % 10 === 0;
}
