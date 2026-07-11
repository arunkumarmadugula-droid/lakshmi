import { money, number } from "./format.js";

function splitDetails(expense) {
  const count = Math.max(2, Math.round(number(expense.split?.count || expense.splitCount || 2)));
  const total = number(expense.total);
  return { count, total, each: total / count };
}

export function splitShareText(expense) {
  const { count, total, each } = splitDetails(expense);
  const itemLines = (expense.items || [])
    .filter((item) => item.name)
    .slice(0, 16)
    .map((item) => `${item.name}: ${money(item.lineTotal)}`);
  return [
    `${expense.store || "Shared bill"}`,
    `${expense.date || ""}${expense.category ? ` | ${expense.category}` : ""}`,
    ...itemLines,
    itemLines.length ? "" : null,
    `Bill total: ${money(total)}`,
    `Split between ${count} people: ${money(each)} each`,
    "",
    "Powered by Lakshmi",
  ].filter((line) => line !== null).join("\n");
}

function pdfEscape(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(value, width = 72) {
  const words = String(value).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

export function splitReceiptPdf(expense) {
  const lines = splitShareText(expense).split("\n").flatMap((line) => line ? wrapLine(line) : [""]).slice(0, 34);
  const stream = [
    "BT",
    "/F1 12 Tf",
    "50 760 Td",
    ...lines.flatMap((line, index) => [index ? "0 -19 Td" : "", `(${pdfEscape(line)}) Tj`]).filter(Boolean),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new File([pdf], `lakshmi-split-${expense.date || "bill"}.pdf`, { type: "application/pdf" });
}

export async function shareSplitExpense(expense) {
  const text = splitShareText(expense);
  const file = splitReceiptPdf(expense);
  if (navigator.share) {
    const data = navigator.canShare?.({ files: [file] })
      ? { title: `${expense.store || "Bill"} split`, text, files: [file] }
      : { title: `${expense.store || "Bill"} split`, text };
    await navigator.share(data);
    return "shared";
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}

export async function copySplitExpense(expense) {
  await navigator.clipboard.writeText(splitShareText(expense));
}

export function saveSplitPdf(expense) {
  const file = splitReceiptPdf(expense);
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
