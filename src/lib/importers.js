import { CATEGORIES } from "../data/defaults.js";
import { number, todayISO, uid } from "./format.js";

const RECEIPT_SCHEMA = {
  store: "",
  date: "YYYY-MM-DD",
  category: CATEGORIES.join(" | "),
  subtotal: 0,
  tax: 0,
  total: 0,
  paymentMethod: "bank | cash | credit",
  items: [{ name: "", qty: 1, unit: "ea | kg | g | lb | L | ml", lineTotal: 0 }],
};

const PAYSLIP_SCHEMA = {
  employer: "",
  owner: "me | spouse",
  payDate: "YYYY-MM-DD",
  periodStart: "YYYY-MM-DD",
  periodEnd: "YYYY-MM-DD",
  frequency: "weekly | biweekly | semimonthly | monthly",
  grossPay: 0,
  netPay: 0,
  ytdGross: 0,
  ytdNet: 0,
  deductions: [{ name: "", amount: 0, ytd: 0 }],
};

const CARD_SCHEMA = {
  bank: "",
  cardName: "",
  last4: "",
  statementDate: "YYYY-MM-DD",
  dueDate: "YYYY-MM-DD",
  statementBalance: 0,
  minimumPayment: 0,
};

export const AI_PROMPTS = {
  receipt: `Read the attached receipt and return only valid JSON. Do not use markdown fences. Use this shape: ${JSON.stringify(RECEIPT_SCHEMA)}. Capture every visible item. Use plain numbers. Use an ISO date. Choose the closest listed category. Do not invent unreadable values.`,
  payslip: `Read the attached Canadian payslip and return only valid JSON. Do not use markdown fences. Use this shape: ${JSON.stringify(PAYSLIP_SCHEMA)}. Capture every deduction line exactly as printed, including this-period and YTD values. Use plain numbers and ISO dates.`,
  card: `Read the attached credit-card statement or account summary and return only valid JSON. Do not use markdown fences. Use this shape: ${JSON.stringify(CARD_SCHEMA)}. The statement balance is the new or closing balance. Capture the bill generation date, due date, minimum payment, bank, card name, and last four digits. Use plain numbers and ISO dates.`,
};

function parseDate(text) {
  const iso = text.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
  const named = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (named) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    return `${named[3]}-${String(month).padStart(2, "0")}-${String(named[2]).padStart(2, "0")}`;
  }
  return todayISO();
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
    store: likelyStore(lines),
    date: parseDate(text),
    category: /fuel|gasoline|litres|liter|octane/i.test(text) ? "Fuel" : "Groceries",
    subtotal: Math.max(0, amountAfter(text, ["subtotal"]) || total - tax),
    tax,
    total,
    paymentMethod: "bank",
    cardId: "",
    items,
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
  ].map(([name, labels]) => ({ id: uid("deduction"), name, amount: amountAfter(text, labels), ytd: 0 })).filter((item) => item.amount > 0);
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

async function compressImage(file, maxDimension = 1500, quality = 0.76) {
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
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = file.type.startsWith("image/");
  if (!isPdf && !isImage) throw new Error("Lakshmi accepts PDF, JPG, PNG, HEIC, and browser-supported images.");
  let text = "";
  let shareFile = file;
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
      shareFile = await compressImage(file);
    } catch {
      shareFile = file;
    }
  }
  return {
    kind,
    fileName: file.name,
    mimeType: file.type,
    originalBytes: file.size,
    preparedBytes: shareFile.size,
    pageCount,
    text,
    shareFile,
    draft: draftFromText(kind, text),
  };
}

export async function shareForChatGPT(prepared) {
  const prompt = AI_PROMPTS[prepared.kind];
  const files = [prepared.shareFile];
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files }))) {
    await navigator.share({ title: "Read for Lakshmi", text: prompt, files });
    return "shared";
  }
  await navigator.clipboard.writeText(prompt);
  return "copied";
}

export async function copyAiPrompt(kind) {
  await navigator.clipboard.writeText(AI_PROMPTS[kind]);
}

export function parseAiResult(value, kind) {
  const clean = String(value || "").replace(/```json|```/gi, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error("The pasted result is not valid JSON. Ask ChatGPT to return JSON only.");
  }
  const base = blankDraft(kind);
  if (kind === "receipt") {
    return {
      ...base,
      ...parsed,
      kind,
      date: parsed.date || todayISO(),
      category: CATEGORIES.includes(parsed.category) ? parsed.category : "Other",
      subtotal: number(parsed.subtotal), tax: number(parsed.tax), total: number(parsed.total),
      items: Array.isArray(parsed.items) ? parsed.items.map((item) => ({ id: uid("item"), name: item.name || "", qty: number(item.qty) || 1, unit: item.unit || "ea", lineTotal: number(item.lineTotal) })) : [],
    };
  }
  if (kind === "payslip") {
    return {
      ...base, ...parsed, kind,
      grossPay: number(parsed.grossPay), netPay: number(parsed.netPay), ytdGross: number(parsed.ytdGross), ytdNet: number(parsed.ytdNet),
      deductions: Array.isArray(parsed.deductions) ? parsed.deductions.map((item) => ({ id: uid("deduction"), name: item.name || "", amount: number(item.amount), ytd: number(item.ytd) })) : [],
    };
  }
  return {
    ...base, ...parsed, kind,
    last4: String(parsed.last4 || "").replace(/\D/g, "").slice(-4),
    statementBalance: number(parsed.statementBalance), minimumPayment: number(parsed.minimumPayment),
  };
}

export async function readClipboardImage(kind) {
  if (!navigator.clipboard?.read) throw new Error("Use Photo library on this browser, or paste ChatGPT JSON instead.");
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith("image/"));
    if (!imageType) continue;
    const blob = await item.getType(imageType);
    const file = new File([blob], `clipboard-${Date.now()}.png`, { type: imageType });
    return prepareDocument(file, kind);
  }
  throw new Error("No image was found on the clipboard.");
}
