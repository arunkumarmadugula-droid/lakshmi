export const pad = (value) => String(value).padStart(2, "0");

export function todayISO(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const monthKey = (date) => String(date || "").slice(0, 7);
export const currentMonth = () => todayISO().slice(0, 7);

export function monthLabel(month, style = "long") {
  if (!/^\d{4}-\d{2}$/.test(month || "")) return "All months";
  const [year, value] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { month: style, year: "numeric" }).format(
    new Date(year, value - 1, 1),
  );
}

export function shiftMonth(month, amount) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(year, value - 1 + amount, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function money(value, digits = 2) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value) || 0);
}

export function compactMoney(value) {
  const amount = Number(value) || 0;
  if (Math.abs(amount) >= 1000000) return `$${(amount / 1000000).toFixed(1)}m`;
  if (Math.abs(amount) >= 10000) return `$${Math.round(amount / 1000)}k`;
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
