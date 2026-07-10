import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
import { createEmptyVault } from "../src/data/defaults.js";

test("all six tabs render from a populated encrypted-vault shape", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const modules = await Promise.all([
      "/src/tabs/AddTab.jsx",
      "/src/tabs/BoardTab.jsx",
      "/src/tabs/LedgerTab.jsx",
      "/src/tabs/PricesTab.jsx",
      "/src/tabs/BudgetTab.jsx",
      "/src/tabs/FuelTab.jsx",
    ].map((path) => server.ssrLoadModule(path)));
    const vault = createEmptyVault("Test household");
    vault.settings.bankBalance = 5000;
    vault.settings.savingsBalance = 2000;
    vault.settings.balancesConfigured = true;
    vault.incomeSources.push({ id: "salary", kind: "salary", owner: "me", name: "Employer", company: "Employer", annualSalary: 100000, amount: 2800, frequency: "biweekly", province: "ON", nextDate: "2026-07-03", active: true, autoPost: true });
    vault.incomeTransactions.push({ id: "income", sourceId: "salary", name: "Employer", date: "2026-07-03", amount: 2800, savings: 0 });
    vault.expenses.push(
      { id: "expense-a", store: "Store A", date: "2026-07-04", category: "Groceries", total: 100, tax: 10, subtotal: 90, paymentMethod: "bank", items: [{ id: "rice-a", name: "Rice", qty: 1, unit: "kg", lineTotal: 8 }] },
      { id: "expense-b", store: "Store B", date: "2026-07-05", category: "Groceries", total: 120, tax: 12, subtotal: 108, paymentMethod: "credit", cardId: "card", items: [{ id: "rice-b", name: "Rice", qty: 1, unit: "kg", lineTotal: 9 }] },
    );
    vault.budgets.Groceries = 600;
    vault.creditCards.push({ id: "card", bank: "TD", name: "Visa", last4: "4218", dueDay: 27, statementDay: 5, active: true });
    vault.cardStatements.push({ id: "statement", cardId: "card", statementDate: "2026-07-05", dueDate: "2026-07-27", statementBalance: 812 });
    vault.vehicles.push({ id: "vehicle", year: 2024, make: "Toyota", model: "RAV4", combinedRating: 7.8, tankCapacity: 55, active: true });
    vault.fuelEntries.push({ id: "fuel-a", vehicleId: "vehicle", date: "2026-07-01", odometer: 10000, litres: 40, cost: 65, station: "Costco" });
    const props = { vault, persist() {}, notify() {}, openModal() {} };
    const html = modules.map((module) => renderToString(React.createElement(module.default, props)));
    assert.equal(html.length, 6);
    assert.match(html[0], /Add a bill/i);
    assert.match(html[1], /Card bills due/i);
    assert.match(html[2], /Credit card payments/i);
    assert.match(html[3], /Rice/i);
    assert.match(html[4], /Household income/i);
    assert.match(html[5], /Current vehicle/i);
  } finally {
    await server.close();
  }
});
