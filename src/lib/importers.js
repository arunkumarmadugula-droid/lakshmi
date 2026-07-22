import { CATEGORIES } from "../data/defaults.js";
import { dateDMY, normalizeDate, normalizeDateResult, number, todayISO, uid } from "./format.js";

function parseDate(text) {
  return normalizeDate(text, { fallback: todayISO(), reference: todayISO() });
}

function amountAfter(text, labels) {
  for (const label of labels) {
    const expression = new RegExp(`${label}[^0-9-]{0,20}\\$?\\s*([0-9][0-9,]*\\.?[0-9]{0,2})`, "i");
    const match = text.match(expression);
    if (match) return number(match[1]);
  }
  return 0;
}

function cleanLines(text) {
  return text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function likelyStore(lines) {
  return lines.find((line) => line.length >= 2 && line.length <= 60 && !/statement|invoice|receipt|page \d|\d{4}/i.test(line)) || "";
}

function receiptDraft(text = "") {
  const lines = cleanLines(text);
  const total = amountAfter(text, ["grand total", "amount due", "total"]);
  const tax = amountAfter(text, ["hst", "gst", "pst", "tax"]);
  const ignored = /subtotal|total|tax|hst|gst|pst|balance|change|visa|mastercard|debit|cash|thank you/i;
  const items = lines.flatMap((line) => {
    const match = line.match(/^(.{2,70}?)\s+\$?([0-9][0-9,]*\.\d{2})$/);
    if (!match || ignored.test(match[1])) return [];
    return [{ id: uid("item"), name: match[1].trim(), qty: 1, unit: "ea", lineTotal: number(match[2]) }];
  }).slice(0, 30);
  return {
    kind: "receipt",
    transactionType: /\b(refund|returned|return receipt|credit issued)\b/i.test(text) ? "refund" : "expense",
    store: likelyStore(lines),
    date: parseDate(text),
    category: /fuel|gasoline|litres|liter|octane/i.test(text) ? "Fuel" : "Groceries",
    subtotal: Math.max(0, amountAfter(text, ["subtotal"]) || total - tax),
    tax,
    tip: amountAfter(text, ["tip", "gratuity"]),
    discount: amountAfter(text, ["discount", "coupon", "savings"]),
    total,
    paymentMethod: "bank",
    originalReceiptNumber: "",
    cardId: "",
    items,
    warnings: [],
    splitEnabled: false,
    splitCount: 2,
  };
}

function payslipDraft(text = "") {
  const lines = cleanLines(text);
  const grossPay = amountAfter(text, ["gross pay", "gross earnings", "current gross", "gross"]);
  const netPay = amountAfter(text, ["net pay", "net deposit", "net amount"]);
  const deductions = [
    ["Federal tax", ["federal tax"]],
    ["Provincial tax", ["provincial tax"]],
    ["Income tax", ["income tax", "tax deductions"]],
    ["CPP", ["cpp2", "cpp"]],
    ["EI", ["employment insurance", " ei"]],
    ["Pension", ["pension"]],
    ["Benefits", ["benefits", "health", "dental"]],
  ].map(([name, labels]) => ({ id: uid("deduction"), name, amount: amountAfter(text, labels), ytd: 0, direction: "out" })).filter((item) => item.amount > 0);
  return {
    kind: "payslip",
    employer: likelyStore(lines),
    owner: "me",
    payDate: parseDate(text),
    periodStart: "",
    periodEnd: "",
    frequency: "biweekly",
    grossPay,
    netPay,
    ytdGross: amountAfter(text, ["ytd gross", "gross ytd"]),
    ytdNet: amountAfter(text, ["ytd net", "net ytd"]),
    deductions,
    warnings: [],
  };
}

function cardDraft(text = "") {
  const lines = cleanLines(text);
  const last4Match = text.match(/(?:ending in|last four|account number|card number|\*{2,}|x{2,})[^0-9]{0,12}(\d{4})\b/i);
  const dueContext = text.match(/(?:payment due date|due date)[\s:]*([^\n]{0,40})/i)?.[1] || text;
  const statementContext = text.match(/(?:statement date|billing date)[\s:]*([^\n]{0,40})/i)?.[1] || text;
  return {
    kind: "card",
    bank: /royal bank|\brbc\b/i.test(text) ? "RBC" : /toronto.dominion|\btd\b/i.test(text) ? "TD" : /scotiabank/i.test(text) ? "Scotiabank" : /cibc/i.test(text) ? "CIBC" : /bmo|bank of montreal/i.test(text) ? "BMO" : likelyStore(lines),
    cardName: /mastercard/i.test(text) ? "Mastercard" : /visa/i.test(text) ? "Visa" : "Credit card",
    last4: last4Match?.[1] || "",
    statementDate: parseDate(statementContext),
    dueDate: parseDate(dueContext),
    statementBalance: amountAfter(text, ["new balance", "closing balance", "statement balance", "total balance"]),
    minimumPayment: amountAfter(text, ["minimum payment", "minimum amount due"]),
    transactions: [],
    warnings: [],
  };
}

export function blankDraft(kind) {
  if (kind === "payslip") return payslipDraft();
  if (kind === "card") return cardDraft();
  return receiptDraft();
}

function draftFromText(kind, text) {
  if (kind === "payslip") return payslipDraft(text);
  if (kind === "card") return cardDraft(text);
  return receiptDraft(text);
}

async function extractPdf(file, maxPages = 5) {
  const [{ GlobalWorkerOptions, getDocument }, { default: workerUrl }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = workerUrl;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: bytes }).promise;
  const pages = Math.min(pdf.numPages, maxPages);
  const output = [];
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    output.push(content.items.map((item) => item.str).join(" "));
  }
  return { text: output.join("\n"), pageCount: pdf.numPages };
}

async function compressImage(file, maxDimension = 1800, quality = 0.78) {
  let image;
  let revoke = null;
  try {
    image = await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    revoke = () => URL.revokeObjectURL(url);
    image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("This image format is not supported by the browser."));
      element.src = url;
    });
  }
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();
  revoke?.();
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image compression failed.")), "image/jpeg", quality));
  const name = file.name.replace(/\.[^.]+$/, "") + "-compressed.jpg";
  return new File([blob], name, { type: "image/jpeg" });
}

export async function prepareDocument(file, kind) {
  if (!file) throw new Error("Choose a PDF or image first.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Choose a document smaller than 25 MB.");
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = file.type.startsWith("image/");
  if (!isPdf && !isImage) throw new Error("Lakshmi accepts PDF, JPG, PNG, HEIC, and browser-supported images.");
  let text = "";
  let preparedFile = file;
  let pageCount = 1;
  if (isPdf) {
    try {
      const result = await extractPdf(file);
      text = result.text;
      pageCount = result.pageCount;
    } catch {
      text = "";
    }
  } else {
    try {
      preparedFile = await compressImage(file);
    } catch {
      preparedFile = file;
    }
  }
  return {
    kind,
    fileName: file.name,
    mimeType: isPdf ? "application/pdf" : (preparedFile.type || file.type),
    originalBytes: file.size,
    preparedBytes: preparedFile.size,
    pageCount,
    text,
    archiveFile: preparedFile,
    analysisFile: preparedFile,
    shareFile: preparedFile,
    draft: draftFromText(kind, text),
  };
}

function dateWarnings(results) {
  return results.flatMap(({ label, result }) => {
    if (result.corrected) return [`${label} was corrected from "${result.original}" to ${dateDMY(result.date)}. Confirm it before saving.`];
    if (result.invalid) return [`${label} could not be read. ${dateDMY(result.date)} is selected; confirm it before saving.`];
    return [];
  });
}

export function parseAiResult(value, kind, { referenceDate = todayISO() } = {}) {
  let parsed = value;
  if (typeof value === "string") {
    const clean = String(value || "").replace(/```json|```/gi, "").trim();
    try {
      parsed = JSON.parse(clean);
    } catch {
      throw new Error("The AI result is not valid JSON.");
    }
  }
  if (!parsed || typeof parsed !== "object") parsed = {};
  const base = blankDraft(kind);
  if (kind === "receipt") {
    const receiptDate = normalizeDateResult(parsed.date, { fallback: todayISO(), reference: referenceDate });
    return {
      ...base,
      ...parsed,
      kind,
      transactionType: ["expense", "refund", "uncertain"].includes(parsed.transactionType) ? parsed.transactionType : "uncertain",
      date: receiptDate.date,
      category: CATEGORIES.includes(parsed.category) ? parsed.category : "Other",
      subtotal: number(parsed.subtotal), tax: number(parsed.tax), tip: number(parsed.tip), discount: number(parsed.discount), total: number(parsed.total),
      warnings: [...(Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : []), ...dateWarnings([{ label: "Receipt date", result: receiptDate }])],
      items: Array.isArray(parsed.items) ? parsed.items.map((item) => ({ id: uid("item"), name: item.name || "", qty: number(item.qty) || 1, unit: item.unit || "ea", lineTotal: number(item.lineTotal) })) : [],
    };
  }
  if (kind === "payslip") {
    const payDate = normalizeDateResult(parsed.payDate, { fallback: todayISO(), reference: referenceDate });
    return {
      ...base, ...parsed, kind,
      payDate: payDate.date,
      periodStart: normalizeDate(parsed.periodStart, { fallback: "", reference: referenceDate }),
      periodEnd: normalizeDate(parsed.periodEnd, { fallback: "", reference: referenceDate }),
      grossPay: number(parsed.grossPay), netPay: number(parsed.netPay), ytdGross: number(parsed.ytdGross), ytdNet: number(parsed.ytdNet),
      deductions: Array.isArray(parsed.deductions) ? parsed.deductions.map((item) => ({ id: uid("deduction"), name: item.name || "", amount: number(item.amount), ytd: number(item.ytd), direction: item.direction === "in" ? "in" : "out" })) : [],
      warnings: [...(Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : []), ...dateWarnings([{ label: "Pay date", result: payDate }])],
    };
  }
  const statementDate = normalizeDateResult(parsed.statementDate, { fallback: todayISO(), reference: referenceDate });
  const dueDate = normalizeDateResult(parsed.dueDate, { fallback: todayISO(), reference: referenceDate });
  let transactionDateCorrected = false;
  const transactions = Array.isArray(parsed.transactions) ? parsed.transactions.map((item) => {
    const transactionDate = normalizeDateResult(item.date, { fallback: "", reference: referenceDate });
    transactionDateCorrected ||= transactionDate.corrected;
    return { id: uid("statement-transaction"), date: transactionDate.date, description: item.description || "Card transaction", amount: Math.abs(number(item.amount)), direction: item.direction === "credit" ? "credit" : "debit" };
  }) : [];
  return {
    ...base, ...parsed, kind,
    statementDate: statementDate.date,
    dueDate: dueDate.date,
    last4: String(parsed.last4 || "").replace(/\D/g, "").slice(-4),
    statementBalance: number(parsed.statementBalance), minimumPayment: number(parsed.minimumPayment),
    transactions,
    warnings: [
      ...(Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : []),
      ...dateWarnings([{ label: "Statement date", result: statementDate }, { label: "Due date", result: dueDate }]),
      ...(transactionDateCorrected ? ["One or more transaction dates were corrected. Confirm them before saving."] : []),
    ],
  };
}
