import assert from "node:assert/strict";
import test from "node:test";
import { dateDMY, normalizeDateResult } from "../src/lib/format.js";
import { parseAiResult } from "../src/lib/importers.js";

const reference = "2026-07-20";

test("Canadian receipt dates normalize to ISO without losing day or year", () => {
  assert.equal(normalizeDateResult("20/07/2026", { reference }).date, reference);
  assert.equal(normalizeDateResult("20-07-26", { reference }).date, reference);
  assert.equal(normalizeDateResult("July 20, 2026", { reference }).date, reference);
  assert.equal(normalizeDateResult("2026-07-20", { reference }).date, reference);
  assert.equal(dateDMY(reference), "20/07/2026");
});

test("OCR date transpositions are repaired against the scan date", () => {
  const ordinal = normalizeDateResult("2020 26th 07", { reference });
  assert.equal(ordinal.date, reference);
  assert.equal(ordinal.corrected, true);

  const misplacedYear = normalizeDateResult("2020-07-26", { reference });
  assert.equal(misplacedYear.date, reference);
  assert.equal(misplacedYear.corrected, true);
});

test("AI receipt review receives a valid date and a visible correction warning", () => {
  const draft = parseAiResult({
    transactionType: "expense",
    store: "Test market",
    date: "2020-07-26",
    category: "Groceries",
    subtotal: 10,
    tax: 1.3,
    tip: 0,
    discount: 0,
    total: 11.3,
    paymentMethod: "bank",
    originalReceiptNumber: "",
    litres: 0,
    octane: "",
    items: [],
    warnings: [],
  }, "receipt", { referenceDate: reference });

  assert.equal(draft.date, reference);
  assert.match(draft.warnings.join(" "), /corrected.*20\/07\/2026/i);
});
