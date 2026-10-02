import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { buildScenarioProjection, normalizeScenarioSettings } from "../src/lib/scenario.js";

const vault = {
  profile: { currency: "CAD" },
  settings: { bankBalance: 10000, savingsBalance: 5000 },
  incomeSources: [{ id: "salary", kind: "salary", annualSalary: 90000, active: true, frequency: "weekly" }],
  planning: { scenario: { settings: {}, events: {} } },
};

const plan = {
  income: { exactMonthly: 5633.33, sources: [{ id: "salary", exactMonthly: 5633.33 }] },
  totalBudget: 4000,
  essentialSurvivalBurn: 3500,
  discretionarySpend: 500,
  averageCadSurplus: 1633.33,
};

const baseSettings = { savingsRate: 20, annualReturn: 6, inflation: 2.5, horizonYears: 10, discretionaryTrim: 10 };

test("scenario controls clamp to their supported financial ranges", () => {
  assert.deepEqual(normalizeScenarioSettings({ savingsRate: 1, annualReturn: 30, inflation: 0, horizonYears: 90, discretionaryTrim: 75 }), {
    savingsRate: 5,
    annualReturn: 12,
    inflation: 2,
    horizonYears: 40,
    discretionaryTrim: 50,
  });
});

test("higher savings rates increase the deterministic horizon projection", () => {
  const low = buildScenarioProjection({ vault, plan, settings: { ...baseSettings, savingsRate: 10 }, events: {} });
  const high = buildScenarioProjection({ vault, plan, settings: { ...baseSettings, savingsRate: 35 }, events: {} });
  assert.ok(high.netWorthAtHorizon > low.netWorthAtHorizon);
  assert.equal(high.points.length, 121);
  assert.equal(high.financialIndependenceNumber, high.points.at(-1).fiTarget);
});

test("scenario shocks preserve accounting meaning", () => {
  const baseline = buildScenarioProjection({ vault, plan, settings: { ...baseSettings, horizonYears: 2 }, events: {} });
  const downturn = buildScenarioProjection({ vault, plan, settings: { ...baseSettings, horizonYears: 2 }, events: { downturn: true } });
  const emergency = buildScenarioProjection({ vault, plan, settings: { ...baseSettings, horizonYears: 2 }, events: { emergency: true } });
  const home = buildScenarioProjection({ vault, plan, settings: { ...baseSettings, horizonYears: 2 }, events: { downPayment: true } });
  assert.ok(downturn.netWorthAtHorizon < baseline.netWorthAtHorizon);
  assert.ok(emergency.netWorthAtHorizon < baseline.netWorthAtHorizon);
  assert.equal(home.points[12].scenario, baseline.points[12].scenario);
  assert.ok(home.allocation.find((item) => item.key === "real-estate").value > 0);
  assert.equal(Math.round(home.allocation.reduce((sum, item) => sum + item.value, 0)), Math.round(home.netWorthAtHorizon));
});

test("Scenario Studio renders complete interactive controls and charts", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { default: ScenarioStudio } = await server.ssrLoadModule("/src/components/ScenarioStudio.jsx");
    const html = renderToStaticMarkup(React.createElement(ScenarioStudio, { vault, plan, persist() {}, notify() {} }));
    assert.match(html, /Scenario Studio/);
    assert.match(html, /Trajectory forecast/);
    assert.match(html, /Savings and investment rate/);
    assert.match(html, /Market downturn/);
    assert.match(html, /Projected asset allocation/);
    assert.match(html, /Cash-flow distribution/);
    assert.match(html, /<svg/);
  } finally {
    await server.close();
  }
});
