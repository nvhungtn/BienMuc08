/**
 * Utility to format and unify ISBN-10 and ISBN-13 according to standard guidelines
 */
export function formatIsbn(isbn: string | null | undefined): string {
  if (!isbn) return "";
  
  // Clean input: remove spaces, hyphens, and any non-alphanumeric characters, convert check digit X to uppercase
  const cleaned = isbn.trim().toUpperCase().replace(/[^0-9X]/g, "");
  
  if (cleaned.length === 13) {
    const prefix = cleaned.substring(0, 3); // 978 or 979
    const rest = cleaned.substring(3);
    
    // Group identifiers:
    // 1 digit: 0-5, 7 (English, French, German, Japanese, Chinese, etc.)
    // 2 digits: 80-94
    // 3 digits: 600-649, 950-989
    // 4 digits: 9900-9989
    // 5 digits: 99900-99999
    
    const firstChar = rest.charAt(0);
    const firstTwo = rest.substring(0, 2);
    const firstThree = rest.substring(0, 3);
    const firstFour = rest.substring(0, 4);
    const firstFive = rest.substring(0, 5);
    
    let group = "";
    let publisherAndItem = "";
    
    if (firstThree === "604") {
      // Vietnam registration group 604
      const grp = "604";
      const rem = rest.substring(3); // 7 characters remaining (pub + item + check)
      const pub = rem.substring(0, 3);
      const item = rem.substring(3, 6);
      const check = rem.substring(6);
      return `${prefix}-${grp}-${pub}-${item}-${check}`;
    } else if (["0", "1", "2", "3", "4", "5", "7"].includes(firstChar)) {
      group = firstChar;
      publisherAndItem = rest.substring(1);
    } else {
      const firstTwoNum = parseInt(firstTwo, 10);
      if (firstTwoNum >= 80 && firstTwoNum <= 94) {
        group = firstTwo;
        publisherAndItem = rest.substring(2);
      } else {
        const firstThreeNum = parseInt(firstThree, 10);
        if ((firstThreeNum >= 600 && firstThreeNum <= 649) || (firstThreeNum >= 950 && firstThreeNum <= 989)) {
          group = firstThree;
          publisherAndItem = rest.substring(3);
        } else {
          const firstFourNum = parseInt(firstFour, 10);
          if (firstFourNum >= 9900 && firstFourNum <= 9989) {
            group = firstFour;
            publisherAndItem = rest.substring(4);
          } else {
            group = firstFive;
            publisherAndItem = rest.substring(5);
          }
        }
      }
    }
    
    // Split the remaining publisher + item parts beautifully
    const check = publisherAndItem.slice(-1);
    const payload = publisherAndItem.slice(0, -1);
    const mid = Math.ceil(payload.length / 2);
    const pub = payload.substring(0, mid);
    const item = payload.substring(mid);
    
    return `${prefix}-${group}-${pub}-${item}-${check}`;
  } else if (cleaned.length === 10) {
    const firstChar = cleaned.charAt(0);
    if (["0", "1", "2", "3", "4", "5", "7"].includes(firstChar)) {
      const group = firstChar;
      const rest = cleaned.substring(1);
      const check = rest.slice(-1);
      const payload = rest.slice(0, -1);
      const mid = Math.ceil(payload.length / 2);
      const pub = payload.substring(0, mid);
      const item = payload.substring(mid);
      return `${group}-${pub}-${item}-${check}`;
    } else {
      const part1 = cleaned.substring(0, 1);
      const part2 = cleaned.substring(1, 5);
      const part3 = cleaned.substring(5, 9);
      const part4 = cleaned.substring(9, 10);
      return `${part1}-${part2}-${part3}-${part4}`;
    }
  }
  
  // For other custom / non-standard lengths, return original trimmed
  return isbn.trim();
}
