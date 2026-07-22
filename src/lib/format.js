export const pad = (value) => String(value).padStart(2, "0");

let activeLocale = "en-CA";
let activeCurrency = "CAD";

export function applyFormattingPreferences({ locale, currency } = {}) {
  activeLocale = locale === "en-IN" ? "en-IN" : "en-CA";
  activeCurrency = currency === "INR" ? "INR" : "CAD";
  return { locale: activeLocale, currency: activeCurrency };
}

export function formattingPreferences() {
  return { locale: activeLocale, currency: activeCurrency };
}

export function todayISO(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function calendarISO(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || y < 1900 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(d) || d < 1 || d > 31) return "";
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "";
  return `${y}-${pad(m)}-${pad(d)}`;
}

function strictISO(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? calendarISO(match[1], match[2], match[3]) : "";
}

function shortYear(value, referenceYear) {
  const digits = String(value || "");
  if (digits.length === 4) return Number(digits);
  if (digits.length !== 2) return 0;
  let year = Math.floor(referenceYear / 100) * 100 + Number(digits);
  if (year > referenceYear + 20) year -= 100;
  if (year < referenceYear - 80) year += 100;
  return year;
}

function dateDistance(a, b) {
  return Math.abs((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
}

// Receipt OCR sometimes turns DD/MM/YYYY into 20DD-MM-YY or 20DD-YY-MM.
function numericDate(parts, reference) {
  const [first, second, third] = parts;
  const referenceYear = Number(reference.slice(0, 4));
  if (first.length === 4) {
    const canonical = calendarISO(first, second, third);
    const dayFromFirst = Number(first.slice(-2));
    const repairs = [
      calendarISO(shortYear(third, referenceYear), second, dayFromFirst),
      calendarISO(shortYear(second, referenceYear), third, dayFromFirst),
    ].filter(Boolean).sort((a, b) => dateDistance(a, reference) - dateDistance(b, reference));
    const repair = repairs[0] || "";
    if (canonical && repair && dateDistance(canonical, reference) > 730 && dateDistance(repair, reference) <= 45) return { date: repair, corrected: true };
    if (canonical) return { date: canonical, corrected: false };
    if (repair && dateDistance(repair, reference) <= 550) return { date: repair, corrected: true };
    return null;
  }

  const year = shortYear(third, referenceYear);
  if (!year) return null;
  const firstNumber = Number(first);
  const secondNumber = Number(second);
  const month = firstNumber <= 12 && secondNumber > 12 ? firstNumber : secondNumber;
  const day = firstNumber <= 12 && secondNumber > 12 ? secondNumber : firstNumber;
  const date = calendarISO(year, month, day);
  return date ? { date, corrected: false } : null;
}

export function normalizeDateResult(value, { fallback = todayISO(), reference = todayISO() } = {}) {
  const original = String(value ?? "").trim();
  const referenceDate = strictISO(reference) || todayISO();
  const fallbackDate = fallback === "" ? "" : strictISO(fallback) || referenceDate;
  if (!original) return { date: fallbackDate, original, corrected: false, invalid: true };

  const cleaned = original
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/(\d)(st|nd|rd|th)\b/gi, "$1")
    .replace(/,/g, " ");
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthPattern = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const monthFirst = cleaned.match(new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})\\s+(\\d{2,4})\\b`, "i"));
  if (monthFirst) {
    const date = calendarISO(shortYear(monthFirst[3], Number(referenceDate.slice(0, 4))), monthNames.indexOf(monthFirst[1].slice(0, 3).toLowerCase()) + 1, monthFirst[2]);
    if (date) return { date, original, corrected: false, invalid: false };
  }
  const dayFirst = cleaned.match(new RegExp(`\\b(\\d{1,2})\\s+${monthPattern}\\s+(\\d{2,4})\\b`, "i"));
  if (dayFirst) {
    const date = calendarISO(shortYear(dayFirst[3], Number(referenceDate.slice(0, 4))), monthNames.indexOf(dayFirst[2].slice(0, 3).toLowerCase()) + 1, dayFirst[1]);
    if (date) return { date, original, corrected: false, invalid: false };
  }

  const compact = cleaned.match(/\b(\d{8})\b/);
  if (compact) {
    const digits = compact[1];
    const yearFirst = calendarISO(digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8));
    const dayFirstDate = calendarISO(digits.slice(4), digits.slice(2, 4), digits.slice(0, 2));
    const date = yearFirst || dayFirstDate;
    if (date) return { date, original, corrected: false, invalid: false };
  }

  for (const match of cleaned.matchAll(/\b(\d{1,4})[\s./-]+(\d{1,2})[\s./-]+(\d{1,4})\b/g)) {
    const result = numericDate([match[1], match[2], match[3]], referenceDate);
    if (result) return { ...result, original, invalid: false };
  }
  return { date: fallbackDate, original, corrected: false, invalid: true };
}

export function normalizeDate(value, options) {
  return normalizeDateResult(value, options).date;
}

export function dateDMY(value) {
  const iso = strictISO(value);
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : String(value || "");
}

export const monthKey = (date) => String(date || "").slice(0, 7);
export const currentMonth = () => todayISO().slice(0, 7);

export function monthLabel(month, style = "long") {
  if (!/^\d{4}-\d{2}$/.test(month || "")) return "All months";
  const [year, value] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(activeLocale, { month: style, year: "numeric" }).format(
    new Date(year, value - 1, 1),
  );
}

export function shiftMonth(month, amount) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(year, value - 1 + amount, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function money(value, digits = 2) {
  return new Intl.NumberFormat(activeLocale, {
    style: "currency",
    currency: activeCurrency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value) || 0);
}

export function compactMoney(value) {
  const amount = Number(value) || 0;
  if (Math.abs(amount) >= 10000) {
    return new Intl.NumberFormat(activeLocale, {
      style: "currency",
      currency: activeCurrency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  }
  return money(amount, 0);
}

export function number(value) {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function uid(prefix = "id") {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
}

export function addDays(iso, amount) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return todayISO(date);
}
