import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyVault } from "../src/data/defaults.js";
import {
  applyDueSchedules,
  estimatePayroll,
  fuelMetrics,
  monthStats,
  occurrencesInMonth,
  priceComparisons,
} from "../src/lib/finance.js";

test("credit-card payments reduce cash separately and never inflate Spent", () => {
  const vault = createEmptyVault();
  vault.expenses.push({ id: "purchase", date: "2026-07-04", store: "Market", category: "Groceries", total: 125, paymentMethod: "credit" });
  vault.cardStatements.push({ id: "statement", cardId: "card", dueDate: "2026-07-20", statementBalance: 125 });
  vault.cardPayments.push({ id: "payment", cardId: "card", statementId: "statement", date: "2026-07-20", amount: 125 });
  const stats = monthStats(vault, "2026-07");
  assert.equal(stats.spent, 125);
  assert.equal(stats.payments, 125);
});

test("scheduled income posts once and respects the savings split", () => {
  const vault = createEmptyVault();
  vault.settings.bankBalance = 100;
  vault.incomeSources.push({ id: "salary", name: "Salary", amount: 1000, frequency: "biweekly", nextDate: "2026-07-03", autoPost: true, active: true, savingsPercent: 20 });
  const first = applyDueSchedules(vault, "2026-07-17");
  assert.equal(first.vault.incomeTransactions.length, 2);
  assert.equal(first.vault.settings.bankBalance, 1700);
  assert.equal(first.vault.settings.savingsBalance, 400);
  const second = applyDueSchedules(first.vault, "2026-07-17");
  assert.equal(second.changed, false);
  assert.equal(second.vault.incomeTransactions.length, 2);
});

test("recurring expenses catch up from their own start date without an income schedule", () => {
  const vault = createEmptyVault();
  vault.settings.bankBalance = 500;
  vault.recurringExpenses.push({
    id: "internet",
    name: "Internet",
    amount: 80,
    category: "Internet",
    frequency: "monthly",
    nextDate: "2026-05-10",
    paymentMethod: "bank",
    autoPost: true,
    active: true,
  });
  const result = applyDueSchedules(vault, "2026-07-10");
  assert.deepEqual(result.vault.expenses.map((item) => item.date).sort(), ["2026-05-10", "2026-06-10", "2026-07-10"]);
  assert.equal(result.vault.settings.bankBalance, 260);
});

test("semi-monthly schedules use two stable dates per month", () => {
  const result = occurrencesInMonth({ nextDate: "2026-01-05", frequency: "semimonthly" }, "2026-02");
  assert.deepEqual(result, ["2026-02-05", "2026-02-20"]);
});

test("payroll frequency changes per-pay values but not annual net", () => {
  const biweekly = estimatePayroll({ annualSalary: 100000, province: "ON", frequency: "biweekly" });
  const monthly = estimatePayroll({ annualSalary: 100000, province: "ON", frequency: "monthly" });
  assert.ok(biweekly.netPay > 0);
  assert.ok(monthly.netPay > biweekly.netPay);
  assert.ok(Math.abs(monthly.netAnnual - biweekly.netAnnual) < 0.01);
});

test("fuel economy is calculated from consecutive odometer readings", () => {
  const vault = createEmptyVault();
  vault.fuelEntries.push(
    { id: "a", vehicleId: "car", date: "2026-07-01", odometer: 10000, litres: 40, cost: 60, station: "A" },
    { id: "b", vehicleId: "car", date: "2026-07-10", odometer: 10500, litres: 40, cost: 62, station: "A" },
  );
  const result = fuelMetrics(vault, "car");
  assert.equal(result.kmTracked, 500);
  assert.equal(result.average, 8);
});

test("price comparisons normalize grams to per-kilogram prices", () => {
  const vault = createEmptyVault();
  vault.expenses.push(
    { id: "a", store: "Store A", date: "2026-07-01", category: "Groceries", items: [{ name: "Rice", qty: 500, unit: "g", lineTotal: 4 }] },
    { id: "b", store: "Store B", date: "2026-07-02", category: "Groceries", items: [{ name: "Rice", qty: 1, unit: "kg", lineTotal: 9 }] },
  );
  const [rice] = priceComparisons(vault, "Groceries");
  assert.equal(rice.unit, "kg");
  assert.equal(rice.stores[0].price, 8);
  assert.equal(rice.savings, 1);
});
