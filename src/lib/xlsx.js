import { number, todayISO } from "./format.js";

const encoder = new TextEncoder();

function xml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function columnName(index) {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + value % 26) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function worksheet(rows) {
  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  const widths = Array.from({ length: maxColumns }, (_, column) => Math.min(42, Math.max(10, ...rows.map((row) => String(row[column] ?? "").length + 2))));
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      const style = rowIndex === 0 ? ' s="1"' : "";
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}"${style}><v>${value}</v></c>`;
      return `<c r="${reference}" t="inlineStr"${style}><is><t>${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${columnName(maxColumns - 1)}${Math.max(1, rows.length)}"/></worksheet>`;
}

function crcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
}

const CRC_TABLE = crcTable();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32(value) {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function join(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const checksum = crc32(data);
    const local = join([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ]);
    localParts.push(local);
    centralParts.push(join([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }
  const central = join(centralParts);
  return join([
    ...localParts,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(offset), u16(0),
  ]);
}

function ownerLabel(value) {
  if (value === "partner" || value === "spouse") return "Partner";
  if (value === "household") return "Household";
  return "Mine";
}

function cardLabel(vault, cardId) {
  const card = vault.creditCards.find((item) => item.id === cardId);
  return card ? `${card.bank || ""} ${card.last4 ? `...${card.last4}` : card.name || ""}`.trim() : "";
}

function linkedRefundTotal(vault, expenseId) {
  return (vault.refunds || []).filter((item) => item.originalExpenseId === expenseId).reduce((sum, item) => sum + number(item.amount), 0);
}

function splitTotal(vault, expenseId) {
  return (vault.splitReimbursements || []).filter((item) => item.expenseId === expenseId).reduce((sum, item) => sum + number(item.amount), 0);
}

function workbookSheets(vault) {
  const expenses = [["Date", "Owner", "Merchant", "Category", "Items", "Payment method", "Card", "Gross", "Split repaid", "Refunded", "Net", "Source", "Notes"]];
  for (const item of [...vault.expenses].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const split = splitTotal(vault, item.id);
    const refunded = linkedRefundTotal(vault, item.id);
    expenses.push([item.date, ownerLabel(item.owner), item.store, item.category, (item.items || []).map((entry) => entry.name).filter(Boolean).join("; "), item.paymentMethod, cardLabel(vault, item.cardId), number(item.total), split, refunded, Math.max(0, number(item.total) - split - refunded), item.source, item.notes || ""]);
  }
  const refunds = [["Refund date", "Category date", "Owner", "Merchant", "Category", "Destination", "Card", "Original expense", "Amount", "Source"]];
  for (const item of [...(vault.refunds || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const original = vault.expenses.find((expense) => expense.id === item.originalExpenseId);
    refunds.push([item.date, item.effectiveDate || item.date, ownerLabel(item.owner), item.store, item.category, item.refundMethod, cardLabel(vault, item.cardId), original ? `${original.date} ${original.store}` : "", number(item.amount), item.source]);
  }
  const income = [["Date", "Owner", "Description", "Amount", "To savings", "Source"]];
  for (const item of [...vault.incomeTransactions].sort((a, b) => String(a.date).localeCompare(String(b.date)))) income.push([item.date, ownerLabel(item.owner), item.name, number(item.amount), number(item.savings), item.source]);
  const statements = [["Statement date", "Due date", "Owner", "Card", "Statement balance", "Minimum payment", "Transactions", "Unmatched"]];
  for (const item of [...vault.cardStatements].sort((a, b) => String(a.statementDate).localeCompare(String(b.statementDate)))) statements.push([item.statementDate, item.dueDate, ownerLabel(item.owner || vault.creditCards.find((card) => card.id === item.cardId)?.owner), cardLabel(vault, item.cardId), number(item.statementBalance), number(item.minimumPayment), (item.transactions || []).length, (item.transactions || []).filter((entry) => entry.status === "unmatched").length]);
  const payments = [["Date", "Owner", "Card", "Amount", "Statement ID"]];
  for (const item of [...vault.cardPayments].sort((a, b) => String(a.date).localeCompare(String(b.date)))) payments.push([item.date, ownerLabel(item.owner || vault.creditCards.find((card) => card.id === item.cardId)?.owner), cardLabel(vault, item.cardId), number(item.amount), item.statementId]);
  const fuel = [["Date", "Station", "Octane", "Odometer km", "Litres", "Price per litre", "Total cost"]];
  for (const item of [...vault.fuelEntries].sort((a, b) => String(a.date).localeCompare(String(b.date)))) fuel.push([item.date, item.station, item.octane, number(item.odometer), number(item.litres), number(item.litres) ? number(item.cost) / number(item.litres) : 0, number(item.cost)]);
  const budgets = [["Parent category", "Detail", "Monthly amount", "Scheduled", "Frequency"]];
  const budgetCategories = new Set([...Object.keys(vault.budgets || {}), ...(vault.budgetItems || []).map((item) => item.category)]);
  for (const category of budgetCategories) {
    const details = (vault.budgetItems || []).filter((item) => item.category === category);
    if (!details.length) budgets.push([category, "Direct category amount", number(vault.budgets?.[category]), "No", "Monthly"]);
    else for (const item of details) budgets.push([item.category, item.name, number(item.amount), item.scheduled ? "Yes" : "No", item.frequency || "Monthly"]);
  }
  const splits = [["Date", "Original expense", "Paid by", "Amount"]];
  for (const item of [...(vault.splitReimbursements || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const original = vault.expenses.find((expense) => expense.id === item.expenseId);
    splits.push([item.date, original ? `${original.date} ${original.store}` : item.expenseId, item.person, number(item.amount)]);
  }
  const goals = [["Goal", "Type", "Target", "Allocated", "Target date"]];
  for (const item of vault.savingsGoals || []) goals.push([item.name, item.type, number(item.target), number(item.allocated), item.targetDate || ""]);
  const joint = [["Date", "Contributor", "Direction", "Amount", "Note", "Adjusts personal balance"]];
  for (const item of [...(vault.jointTransfers || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))) joint.push([item.date, item.actorName || ownerLabel(item.owner), item.direction, number(item.amount), item.note || "", item.adjustsPersonalBalance ? "Yes" : "No"]);
  return [
    ["Expenses", expenses], ["Refunds", refunds], ["Income", income], ["Card statements", statements],
    ["Card payments", payments], ["Fuel", fuel], ["Budgets", budgets], ["Split repayments", splits],
    ["Savings goals", goals], ["Joint account", joint],
  ];
}

export function buildExpenseWorkbook(vault) {
  const sheets = workbookSheets(vault);
  const contentOverrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const workbookSheetsXml = sheets.map(([name], index) => `<sheet name="${xml(name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const workbookRelationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const styleId = sheets.length + 1;
  const entries = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${contentOverrides}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheetsXml}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRelationships}<Relationship Id="rId${styleId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>` },
    ...sheets.map(([, rows], index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: worksheet(rows) })),
  ];
  const bytes = zip(entries);
  return new File([bytes], `lakshmi-expenses-${todayISO()}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
