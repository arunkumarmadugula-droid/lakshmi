import { number } from "./format.js";

export const SCENARIO_DEFAULTS = Object.freeze({
  savingsRate: 20,
  annualReturn: 6,
  inflation: 2.5,
  horizonYears: 15,
  discretionaryTrim: 10,
});

export const SCENARIO_EVENT_DEFAULTS = Object.freeze({
  downturn: false,
  promotion: false,
  downPayment: false,
  emergency: false,
});

const round = (value, digits = 2) => {
  const scale = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * scale) / scale;
};

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, number(value)));

export function normalizeScenarioSettings(input = {}) {
  return {
    savingsRate: clamp(input.savingsRate ?? SCENARIO_DEFAULTS.savingsRate, 5, 50),
    annualReturn: clamp(input.annualReturn ?? SCENARIO_DEFAULTS.annualReturn, 3, 12),
    inflation: clamp(input.inflation ?? SCENARIO_DEFAULTS.inflation, 2, 6),
    horizonYears: clamp(input.horizonYears ?? SCENARIO_DEFAULTS.horizonYears, 1, 40),
    discretionaryTrim: clamp(input.discretionaryTrim ?? SCENARIO_DEFAULTS.discretionaryTrim, 0, 50),
  };
}

export function normalizeScenarioEvents(input = {}) {
  return Object.fromEntries(Object.keys(SCENARIO_EVENT_DEFAULTS).map((key) => [key, !!input[key]]));
}

function grossMonthlyIncome(vault, plan) {
  const normalizedById = new Map((plan?.income?.sources || []).map((source) => [source.id, source]));
  const gross = (vault?.incomeSources || []).filter((source) => source.active !== false && source.frequency !== "once").reduce((sum, source) => {
    const normalized = normalizedById.get(source.id);
    if (number(source.annualSalary) > 0) return sum + number(source.annualSalary) / 12;
    return sum + number(normalized?.exactMonthly);
  }, 0);
  return Math.max(number(plan?.income?.exactMonthly), gross);
}

function eventAmounts(currency, monthlyIncome) {
  const india = currency === "INR";
  return {
    emergency: Math.max(india ? 500000 : 10000, monthlyIncome * 2),
    downPayment: Math.max(india ? 2500000 : 50000, monthlyIncome * 6),
  };
}

function compoundMonthly(value, annualRate) {
  return value * (1 + annualRate / 1200);
}

export function buildScenarioProjection({ vault, plan, settings: rawSettings, events: rawEvents } = {}) {
  const settings = normalizeScenarioSettings(rawSettings);
  const events = normalizeScenarioEvents(rawEvents);
  const months = Math.max(12, Math.round(settings.horizonYears * 12));
  const currency = vault?.profile?.currency || "CAD";
  const initialLiquid = Math.max(0, number(vault?.settings?.bankBalance) + number(vault?.settings?.savingsBalance));
  const monthlyIncome = Math.max(0, number(plan?.income?.exactMonthly));
  const totalBudget = Math.max(0, number(plan?.totalBudget));
  const essential = Math.max(0, number(plan?.essentialSurvivalBurn));
  const discretionary = Math.max(0, number(plan?.discretionarySpend));
  const grossMonthly = grossMonthlyIncome(vault, plan);
  const tax = Math.max(0, grossMonthly - monthlyIncome);
  const eventValue = eventAmounts(currency, monthlyIncome);
  const downturnMonth = Math.min(12, months);
  const downPaymentMonth = Math.min(24, Math.max(1, Math.round(months / 2)));
  const promotionMultiplier = events.promotion ? 1.15 : 1;
  const baselineReturn = 6;
  const lowReturn = Math.max(0, settings.annualReturn - 2.5);
  const highReturn = settings.annualReturn + 2.5;

  let baselineLiquid = initialLiquid;
  let scenarioLiquid = initialLiquid;
  let lowLiquid = initialLiquid;
  let highLiquid = initialLiquid;
  let scenarioRealEstate = 0;
  let lowRealEstate = 0;
  let highRealEstate = 0;
  let goalMonth = null;
  const points = [];
  let latestContribution = 0;
  let latestExpenses = totalBudget;
  let latestIncome = monthlyIncome * promotionMultiplier;
  let latestTax = tax * promotionMultiplier;
  let latestEssential = essential;
  let latestDiscretionary = discretionary;

  for (let month = 0; month <= months; month += 1) {
    const inflationFactor = (1 + settings.inflation / 100) ** (month / 12);
    const inflatedEssential = essential * inflationFactor;
    const inflatedDiscretionary = discretionary * inflationFactor;
    const trimSaving = inflatedDiscretionary * settings.discretionaryTrim / 100;
    const scenarioIncome = monthlyIncome * promotionMultiplier * inflationFactor;
    const scenarioExpenses = Math.max(0, totalBudget * inflationFactor - trimSaving);
    const contributionCapacity = Math.max(0, scenarioIncome - scenarioExpenses);
    const scenarioContribution = Math.min(scenarioIncome * settings.savingsRate / 100, contributionCapacity);
    const baselineExpenses = totalBudget * inflationFactor;
    const baselineIncome = monthlyIncome * inflationFactor;
    const baselineContribution = Math.min(Math.max(0, number(plan?.averageCadSurplus) * inflationFactor), Math.max(0, baselineIncome - baselineExpenses));
    const fiTarget = inflatedEssential * 12 * 25;

    if (month > 0) {
      baselineLiquid = compoundMonthly(baselineLiquid, baselineReturn) + baselineContribution;
      scenarioLiquid = compoundMonthly(scenarioLiquid, settings.annualReturn) + scenarioContribution;
      lowLiquid = compoundMonthly(lowLiquid, lowReturn) + scenarioContribution;
      highLiquid = compoundMonthly(highLiquid, highReturn) + scenarioContribution;
      const propertyGrowth = Math.max(2, settings.inflation - 1);
      scenarioRealEstate = compoundMonthly(scenarioRealEstate, propertyGrowth);
      lowRealEstate = compoundMonthly(lowRealEstate, propertyGrowth);
      highRealEstate = compoundMonthly(highRealEstate, propertyGrowth);

      if (events.emergency && month === 1) {
        scenarioLiquid = Math.max(0, scenarioLiquid - eventValue.emergency);
        lowLiquid = Math.max(0, lowLiquid - eventValue.emergency);
        highLiquid = Math.max(0, highLiquid - eventValue.emergency);
      }
      if (events.downturn && month === downturnMonth) {
        scenarioLiquid *= 0.82;
        lowLiquid *= 0.82;
        highLiquid *= 0.82;
      }
      if (events.downPayment && month === downPaymentMonth) {
        const scenarioTransfer = Math.min(scenarioLiquid, eventValue.downPayment);
        const lowTransfer = Math.min(lowLiquid, eventValue.downPayment);
        const highTransfer = Math.min(highLiquid, eventValue.downPayment);
        scenarioLiquid -= scenarioTransfer;
        lowLiquid -= lowTransfer;
        highLiquid -= highTransfer;
        scenarioRealEstate += scenarioTransfer;
        lowRealEstate += lowTransfer;
        highRealEstate += highTransfer;
      }
    }

    const baselineNetWorth = baselineLiquid;
    const scenarioNetWorth = scenarioLiquid + scenarioRealEstate;
    const low = lowLiquid + lowRealEstate;
    const high = highLiquid + highRealEstate;
    if (goalMonth == null && fiTarget > 0 && scenarioNetWorth >= fiTarget) goalMonth = month;
    points.push({
      month,
      year: round(month / 12, 1),
      baseline: round(baselineNetWorth),
      scenario: round(scenarioNetWorth),
      low: round(low),
      high: round(high),
      fiTarget: round(fiTarget),
      liquid: round(scenarioLiquid),
      realEstate: round(scenarioRealEstate),
    });
    latestContribution = scenarioContribution;
    latestExpenses = scenarioExpenses;
    latestIncome = scenarioIncome;
    latestTax = tax * promotionMultiplier * inflationFactor;
    latestEssential = inflatedEssential;
    latestDiscretionary = inflatedDiscretionary - trimSaving;
  }

  const last = points.at(-1);
  const allocation = [
    { key: "equities", label: "Equities", value: round(last.liquid * 0.65), color: "var(--scenario-blue)" },
    { key: "fixed", label: "Fixed income", value: round(last.liquid * 0.25), color: "var(--scenario-gold)" },
    { key: "real-estate", label: "Real estate", value: round(last.realEstate), color: "var(--scenario-emerald)" },
    { key: "cash", label: "Liquid cash", value: round(last.liquid * 0.10), color: "var(--scenario-titanium)" },
  ];
  const finalGross = grossMonthly * promotionMultiplier * ((1 + settings.inflation / 100) ** settings.horizonYears);
  const remaining = Math.max(0, finalGross - latestTax - latestEssential - latestDiscretionary - latestContribution);
  const waterfall = [
    { key: "tax", label: "Taxes", value: round(latestTax), color: "var(--scenario-titanium)" },
    { key: "essential", label: "Fixed essentials", value: round(latestEssential), color: "var(--scenario-blue)" },
    { key: "discretionary", label: "Discretionary", value: round(latestDiscretionary), color: "var(--scenario-rose)" },
    { key: "investments", label: "Investments", value: round(latestContribution), color: "var(--scenario-emerald)" },
    { key: "available", label: "Available", value: round(remaining), color: "var(--scenario-gold)" },
  ];

  return {
    currency,
    settings,
    events,
    points,
    allocation,
    waterfall,
    monthlyIncome: round(latestIncome),
    monthlyExpenses: round(latestExpenses),
    monthlyContribution: round(latestContribution),
    initialNetWorth: round(initialLiquid),
    baselineAtHorizon: round(last.baseline),
    netWorthAtHorizon: round(last.scenario),
    financialIndependenceNumber: round(last.fiTarget),
    monthlyPassiveIncome: round(last.scenario * 0.04 / 12),
    yearsToGoal: goalMonth == null ? null : round(goalMonth / 12, 1),
    eventAmounts: { emergency: round(eventValue.emergency), downPayment: round(eventValue.downPayment) },
  };
}
