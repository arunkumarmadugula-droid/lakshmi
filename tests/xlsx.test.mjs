import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyVault } from "../src/data/defaults.js";
import { buildExpenseWorkbook } from "../src/lib/xlsx.js";

test("portable Excel export is a valid OOXML zip and excludes protected credentials", async () => {
  const vault = createEmptyVault();
  vault.ai.apiKey = "credential-test-secret-never-export";
  vault.expenses.push({ id: "expense", date: "2026-07-01", owner: "me", store: "Cafe", category: "Dining", total: 12.5, items: [{ name: "Coffee" }] });
  const file = buildExpenseWorkbook(vault);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
  assert.match(text, /\[Content_Types\]\.xml/);
  assert.match(text, /xl\/workbook\.xml/);
  assert.match(text, /Expenses/);
  assert.doesNotMatch(text, /credential-test-secret-never-export/);
  assert.match(file.name, /\.xlsx$/);
});
