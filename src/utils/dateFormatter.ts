export function formatDateTimeGMT7(dateInput?: Date | string): string {
  if (!dateInput) {
    dateInput = new Date();
  }
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  
  // If the dateInput is already formatted as "dd/mm/yyyy hh-mm-ss gmt+7", return it
  if (typeof dateInput === "string" && dateInput.toLowerCase().includes("gmt+7")) {
    return dateInput;
  }
  
  const targetDate = isNaN(d.getTime()) ? new Date() : d;

  // Convert targetDate to a GMT+7 date manually by shifting UTC timestamp, then use UTC methods
  const utcMs = targetDate.getTime();
  const gmt7Date = new Date(utcMs + 7 * 3600000);
  
  const dd = String(gmt7Date.getUTCDate()).padStart(2, "0");
  const mm = String(gmt7Date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = gmt7Date.getUTCFullYear();
  const hh = String(gmt7Date.getUTCHours()).padStart(2, "0");
  const min = String(gmt7Date.getUTCMinutes()).padStart(2, "0");
  const ss = String(gmt7Date.getUTCSeconds()).padStart(2, "0");

  return `${dd}/${mm}/${yyyy} ${hh}-${min}-${ss} gmt+7`;
}
