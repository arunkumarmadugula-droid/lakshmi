import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
import { createEmptyVault, normalizeVault, SCHEMA_VERSION } from "../src/data/defaults.js";
import { buildAIPayload, buildFinancialPlan, loanPayoffMonths, normalizeIncome, payCycleStatus } from "../src/lib/finance.js";
import { detectDiscretionaryLeaks } from "../src/lib/importers.js";
import { postRingFencedForeignMonth } from "../src/lib/vaultDb.js";

function weeklyPlanningVault() {
  const vault = createEmptyVault("Planning household");
  vault.incomeSources.push({ id: "weekly", kind: "salary", owner: "me", name: "Weekly pay", amount: 1300, frequency: "weekly", nextDate: "2026-07-03", active: true });
  return vault;
}

test("weekly income exposes exact, tight, and windfall calendar baselines", () => {
  const vault = weeklyPlanningVault();
  const normalized = normalizeIncome(vault, "2026-07-01");
  assert.equal(normalized.exactMonthly, 5633.33);
  assert.equal(normalized.tightMonthly, 5200);
  assert.equal(normalized.surplusMonthly, 6500);
  assert.deepEqual(payCycleStatus(vault, "2026-07").dates, ["2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24", "2026-07-31"]);
  assert.equal(payCycleStatus(vault, "2026-07").label, "Surplus Windfall");
});

test("financial plan separates contractual, survival, and discretionary burn", () => {
  const vault = weeklyPlanningVault();
  vault.budgets = { Housing: 3000, Utilities: 400, Insurance: 382.1, Groceries: 900, Dining: 250 };
  const plan = buildFinancialPlan(vault, "2026-07-01");
  assert.equal(plan.fixedContractualBurn, 3782.1);
  assert.equal(plan.essentialVariableBurn, 900);
  assert.equal(plan.essentialSurvivalBurn, 4682.1);
  assert.equal(plan.discretionarySpend, 250);
  assert.equal(plan.emergencyReserve3, 14046.3);
  assert.equal(plan.emergencyReserve6, 28092.6);
  assert.equal(Math.round(plan.emergencyReserve3), 14046);
  assert.equal(Math.round(plan.emergencyReserve6), 28093);
});

test("pay-cycle smoothing and INR offset remain deterministic", () => {
  const vault = weeklyPlanningVault();
  vault.budgets = { Housing: 4500, Utilities: 313.33, Insurance: 300, Groceries: 500 };
  vault.planning.crossBorder.enabled = true;
  const plan = buildFinancialPlan(vault, "2026-07-01");
  assert.equal(plan.fixedContractualBurn, 5113.33);
  assert.equal(plan.fixedBillsTransferPerPay, 1180);
  assert.equal(plan.crossBorder.incomeCadEquivalent, 264);
  assert.equal(plan.crossBorder.debtOffsetCad, 264);
  assert.equal(plan.crossBorder.netVarianceCad, -36);
  assert.equal(plan.combinedSurplus, Math.round((plan.baselineCadSurplus + 264) * 100) / 100);
});

test("loan payoff horizon uses balance, APR, and monthly payment", () => {
  assert.equal(loanPayoffMonths({ balance: 10000, annualRate: 0, monthlyPayment: 500 }), 20);
  assert.equal(loanPayoffMonths({ balance: 10000, annualRate: 6, monthlyPayment: 500 }), 22);
  assert.equal(loanPayoffMonths({ balance: 10000, annualRate: 12, monthlyPayment: 50 }), Infinity);
});

test("AI payload contains precomputed facts instead of raw ledger rows", () => {
  const vault = weeklyPlanningVault();
  vault.expenses.push({ id: "private-row", date: "2026-07-05", store: "Private Merchant Name", category: "Groceries", total: 72 });
  const payload = buildAIPayload(vault, "2026-07");
  assert.equal(payload.contractVersion, 1);
  assert.equal(payload.deterministicFacts.normalizedIncome.exactMonthly, 5633.33);
  assert.doesNotMatch(JSON.stringify(payload), /Private Merchant Name/);
  assert.equal("expenses" in payload, false);
});

test("discretionary scanner flags cumulative sub-$50 leaks by category", () => {
  const vault = createEmptyVault();
  for (let index = 0; index < 13; index += 1) vault.expenses.push({ id: `coffee-${index}`, date: `2026-07-${String(index + 1).padStart(2, "0")}`, store: "Coffee Shop", category: "Dining", total: 25 });
  const [leak] = detectDiscretionaryLeaks(vault, "2026-07");
  assert.equal(leak.category, "Dining");
  assert.equal(leak.total, 325);
  assert.equal(leak.count, 13);
  assert.deepEqual(leak.recurringMerchants, [{ name: "Coffee Shop", count: 13 }]);
});

test("foreign monthly posting changes only the encrypted ring-fenced account", () => {
  const vault = weeklyPlanningVault();
  vault.settings.bankBalance = 4000;
  vault.planning.crossBorder.enabled = true;
  const first = postRingFencedForeignMonth(vault, { date: "2026-07-31" });
  assert.equal(first.applied, true);
  assert.equal(first.vault.settings.bankBalance, 4000);
  assert.equal(first.balanceForeign, -2181.82);
  assert.equal(first.vault.foreignTransactions.length, 2);
  const duplicate = postRingFencedForeignMonth(first.vault, { date: "2026-07-15" });
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.vault.foreignTransactions.length, 2);
});

test("schema migration adds isolated planning data without changing legacy cash", () => {
  const restored = normalizeVault({ schemaVersion: 6, settings: { bankBalance: 700 }, profile: { currency: "CAD" } }, "Legacy");
  assert.equal(restored.schemaVersion, SCHEMA_VERSION);
  assert.equal(restored.settings.bankBalance, 700);
  assert.equal(restored.planning.crossBorder.monthlyIncomeForeign, 16000);
  assert.deepEqual(restored.foreignAccounts, []);
});

test("planning simulators render responsive SVG and touch sliders", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const [runwayModule, relocationModule] = await Promise.all([
      server.ssrLoadModule("/src/components/SavingsRunwaySimulator.jsx"),
      server.ssrLoadModule("/src/components/RelocationAffordabilitySimulator.jsx"),
    ]);
    const vault = weeklyPlanningVault();
    vault.budgets = { Housing: 3000, Groceries: 900 };
    const plan = buildFinancialPlan(vault, "2026-07-01");
    const runway = renderToString(React.createElement(runwayModule.default, { plan, startingSavings: 5000 }));
    const relocation = renderToString(React.createElement(relocationModule.default, { config: vault.planning.relocation, vehicle: { combinedRating: 10 }, onSave() {} }));
    assert.match(runway, /Emergency fund trajectory/);
    assert.equal((runway.match(/type="range"/g) || []).length, 4);
    assert.match(runway, /class="trajectory cad"/);
    assert.match(runway, /class="trajectory combined"/);
    assert.match(relocation, /55 Creekwood Drive/);
    assert.match(relocation, /20 Deans Drive/);
    assert.equal((relocation.match(/type="range"/g) || []).length, 4);
  } finally {
    await server.close();
  }
});
