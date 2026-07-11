import { CATEGORY_COLORS } from "../data/defaults.js";
import { addDays, currentMonth, monthKey, number, pad, shiftMonth, todayISO, uid } from "./format.js";

export const PAY_PERIODS = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  yearly: 1,
};

export const FREQUENCY_LABELS = {
  once: "One time",
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  semimonthly: "Semi-monthly",
  monthly: "Monthly",
  yearly: "Yearly",
};

const PROVINCES = {
  AB: { name: "Alberta", bpa: 22769, brackets: [[61200, 0.08], [154259, 0.1], [185111, 0.12], [246813, 0.13], [370220, 0.14], [Infinity, 0.15]] },
  BC: { name: "British Columbia", bpa: 13216, brackets: [[50363, 0.056], [100728, 0.077], [115648, 0.105], [140430, 0.1229], [190405, 0.147], [265545, 0.168], [Infinity, 0.205]] },
  MB: { name: "Manitoba", bpa: 15780, brackets: [[47000, 0.108], [100000, 0.1275], [Infinity, 0.174]] },
  NB: { name: "New Brunswick", bpa: 13664, brackets: [[52333, 0.094], [104666, 0.14], [193861, 0.16], [Infinity, 0.195]] },
  NL: { name: "Newfoundland and Labrador", bpa: 13094, brackets: [[44678, 0.087], [89354, 0.145], [159528, 0.158], [223340, 0.178], [285319, 0.198], [570638, 0.208], [1141275, 0.213], [Infinity, 0.218]] },
  NS: { name: "Nova Scotia", bpa: 11967, brackets: [[30995, 0.0879], [61991, 0.1495], [97417, 0.1667], [157124, 0.175], [Infinity, 0.21]] },
  NT: { name: "Northwest Territories", bpa: 18198, brackets: [[53003, 0.059], [106009, 0.086], [172346, 0.122], [Infinity, 0.1405]] },
  NU: { name: "Nunavut", bpa: 19659, brackets: [[55801, 0.04], [111602, 0.07], [181439, 0.09], [Infinity, 0.115]] },
  ON: { name: "Ontario", bpa: 12989, brackets: [[53891, 0.0505], [107785, 0.0915], [150000, 0.1116], [220000, 0.1216], [Infinity, 0.1316]], surtax: [5818, 7446], healthPremium: true },
  PE: { name: "Prince Edward Island", bpa: 14650, brackets: [[33928, 0.095], [65820, 0.1347], [106890, 0.166], [142520, 0.1762], [200000, 0.19], [Infinity, 0.2]] },
  QC: { name: "Quebec", bpa: 18942, brackets: [[54345, 0.14], [108680, 0.19], [132245, 0.24], [Infinity, 0.2575]], quebec: true },
  SK: { name: "Saskatchewan", bpa: 20381, brackets: [[54532, 0.105], [155805, 0.125], [Infinity, 0.145]] },
  YT: { name: "Yukon", bpa: 16452, brackets: [[58523, 0.064], [117045, 0.09], [181440, 0.109], [500000, 0.128], [Infinity, 0.15]] },
};

export const PROVINCE_OPTIONS = Object.entries(PROVINCES).map(([code, value]) => ({ code, name: value.name }));

function bracketTax(income, brackets) {
  let tax = 0;
  let previous = 0;
  for (const [cap, rate] of brackets) {
    if (income <= previous) break;
    tax += (Math.min(income, cap) - previous) * rate;
    previous = cap;
  }
  return tax;
}

export function estimatePayroll({ annualSalary = 0, province = "ON", frequency = "biweekly", rrspAnnual = 0, benefitsPerPay = 0 } = {}) {
  const gross = Math.max(0, number(annualSalary));
  const rrsp = Math.max(0, number(rrspAnnual));
  const periods = PAY_PERIODS[frequency] || 26;
  const region = PROVINCES[province] || PROVINCES.ON;
  const isQuebec = !!region.quebec;
  const pensionBase = Math.max(0, Math.min(gross, 74600) - 3500);
  const pensionRate = isQuebec ? 0.064 : 0.0595;
  const cpp1 = pensionBase * pensionRate;
  const cpp2 = Math.max(0, Math.min(gross, 85000) - 74600) * 0.04;
  const enhancedDeduction = pensionBase * 0.01 + cpp2;
  const creditEligiblePension = cpp1 - pensionBase * 0.01;
  const ei = Math.min(gross, 68900) * (isQuebec ? 0.0131 : 0.0163);
  const qpip = isQuebec ? Math.min(gross, 100250) * 0.00494 : 0;
  const taxable = Math.max(0, gross - rrsp - enhancedDeduction);
  let federalBpa = 16452;
  if (taxable > 258482) federalBpa = 14829;
  else if (taxable > 181440) federalBpa = 16452 - 1623 * ((taxable - 181440) / 77042);
  let federal = Math.max(
    0,
    bracketTax(taxable, [[58523, 0.14], [117045, 0.205], [181440, 0.26], [258482, 0.29], [Infinity, 0.33]])
      - (federalBpa + Math.min(1501, gross) + creditEligiblePension + ei + qpip) * 0.14,
  );
  if (isQuebec) federal *= 0.835;
  const lowRate = region.brackets[0][1];
  const provincialBase = Math.max(
    0,
    bracketTax(taxable, region.brackets)
      - (region.bpa + creditEligiblePension + ei + (isQuebec ? qpip : 0)) * lowRate,
  );
  let surtax = 0;
  if (region.surtax) {
    surtax = Math.max(0, provincialBase - region.surtax[0]) * 0.2
      + Math.max(0, provincialBase - region.surtax[1]) * 0.36;
  }
  let healthPremium = 0;
  if (region.healthPremium) {
    if (taxable > 200000) healthPremium = Math.min(900, 750 + (taxable - 200000) * 0.25);
    else if (taxable > 72000) healthPremium = Math.min(750, 600 + (taxable - 72000) * 0.25);
    else if (taxable > 48000) healthPremium = Math.min(600, 450 + (taxable - 48000) * 0.25);
    else if (taxable > 36000) healthPremium = Math.min(450, 300 + (taxable - 36000) * 0.06);
    else if (taxable > 20000) healthPremium = Math.min(300, (taxable - 20000) * 0.06);
  }
  const provincial = provincialBase + surtax + healthPremium;
  const benefitsAnnual = Math.max(0, number(benefitsPerPay)) * periods;
  const netAnnual = Math.max(0, gross - rrsp - federal - provincial - cpp1 - cpp2 - ei - qpip - benefitsAnnual);
  return {
    periods,
    grossAnnual: gross,
    grossPay: gross / periods,
    federal,
    provincial,
    cpp: cpp1 + cpp2,
    ei,
    qpip,
    rrsp,
    benefitsAnnual,
    benefitsPerPay: benefitsAnnual / periods,
    netAnnual,
    netPay: netAnnual / periods,
    netMonth: netAnnual / 12,
    effectiveRate: gross ? (gross - netAnnual) / gross : 0,
    provinceName: region.name,
  };
}

function daysInMonth(month) {
  const [year, value] = month.split("-").map(Number);
  return new Date(year, value, 0).getDate();
}

export function occurrencesInMonth(source, month) {
  const start = source?.nextDate || source?.startDate;
  const frequency = source?.frequency || "monthly";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "")) return [];
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${pad(daysInMonth(month))}`;
  if (start > monthEnd) return [];
  if (frequency === "once") return monthKey(start) === month ? [start] : [];
  if (frequency === "monthly") {
    const day = Math.min(Number(start.slice(8, 10)), daysInMonth(month));
    const candidate = `${month}-${pad(day)}`;
    return candidate >= start ? [candidate] : [];
  }
  if (frequency === "yearly") {
    const candidate = `${month.slice(0, 4)}-${start.slice(5)}`;
    return monthKey(candidate) === month && candidate >= start ? [candidate] : [];
  }
  if (frequency === "semimonthly") {
    const anchor = Math.min(Number(start.slice(8, 10)), 15);
    const second = Math.min(anchor + 15, daysInMonth(month));
    return [anchor, second]
      .map((day) => `${month}-${pad(day)}`)
      .filter((candidate, index, all) => candidate >= start && all.indexOf(candidate) === index);
  }
  const step = frequency === "weekly" ? 7 : 14;
  let cursor = start;
  let guard = 0;
  while (cursor < monthStart && guard < 1000) {
    cursor = addDays(cursor, step);
    guard += 1;
  }
  const result = [];
  while (cursor <= monthEnd && guard < 1100) {
    if (cursor >= monthStart) result.push(cursor);
    cursor = addDays(cursor, step);
    guard += 1;
  }
  return result;
}

export function monthlyEquivalent(amount, frequency) {
  const periods = frequency === "once" ? 0 : PAY_PERIODS[frequency] || 12;
  return periods ? (number(amount) * periods) / 12 : 0;
}

export function applyDueSchedules(input, throughDate = todayISO()) {
  const vault = structuredClone(input);
  let changed = false;
  const finalMonth = throughDate.slice(0, 7);
  const scheduledItems = [...vault.incomeSources, ...vault.recurringExpenses];
  let cursorMonth = scheduledItems.reduce(
    (oldest, item) => (item.nextDate && item.nextDate.slice(0, 7) < oldest ? item.nextDate.slice(0, 7) : oldest),
    finalMonth,
  );
  let guard = 0;
  while (cursorMonth <= finalMonth && guard < 240) {
    for (const source of vault.incomeSources.filter((item) => item.active !== false && item.autoPost !== false)) {
      for (const date of occurrencesInMonth(source, cursorMonth).filter((value) => value <= throughDate)) {
        const exists = vault.incomeTransactions.some((item) => item.sourceId === source.id && item.date === date);
        if (exists) continue;
        const amount = number(source.amount);
        const savings = Math.max(0, Math.min(amount, amount * (number(source.savingsPercent) / 100)));
        vault.incomeTransactions.unshift({
          id: uid("income"), sourceId: source.id, name: source.name || "Income", owner: source.owner || "household",
          amount, savings, date, source: "schedule", createdAt: new Date().toISOString(),
        });
        vault.settings.bankBalance += amount - savings;
        vault.settings.savingsBalance += savings;
        changed = true;
      }
    }
    for (const recurring of vault.recurringExpenses.filter((item) => item.active !== false && item.autoPost)) {
      for (const date of occurrencesInMonth(recurring, cursorMonth).filter((value) => value <= throughDate)) {
        const exists = vault.expenses.some((item) => item.recurringId === recurring.id && item.date === date);
        if (exists) continue;
        const total = number(recurring.amount);
        vault.expenses.unshift({
          id: uid("expense"), recurringId: recurring.id, store: recurring.name || "Recurring expense",
          date, category: recurring.category || "Other", subtotal: total, tax: 0, total, items: [],
          paymentMethod: recurring.paymentMethod || "bank", cardId: recurring.cardId || "", source: "recurring",
          createdAt: new Date().toISOString(),
        });
        if ((recurring.paymentMethod || "bank") !== "credit") vault.settings.bankBalance -= total;
        changed = true;
      }
    }
    cursorMonth = shiftMonth(cursorMonth, 1);
    guard += 1;
  }
  return { vault, changed };
}

export function monthStats(vault, month) {
  const expenses = vault.expenses.filter((item) => monthKey(item.date) === month && !item.excludeFromSpent);
  const incomeTransactions = vault.incomeTransactions.filter((item) => monthKey(item.date) === month);
  const cardPayments = vault.cardPayments.filter((item) => monthKey(item.date) === month);
  const income = incomeTransactions.reduce((sum, item) => sum + number(item.amount), 0);
  const spent = expenses.reduce((sum, item) => sum + expenseNetAmount(vault, item), 0);
  const payments = cardPayments.reduce((sum, item) => sum + number(item.amount), 0);
  const saved = income - spent;
  const categoryMap = {};
  for (const item of expenses) categoryMap[item.category || "Other"] = (categoryMap[item.category || "Other"] || 0) + expenseNetAmount(vault, item);
  const categories = Object.entries(categoryMap)
    .map(([name, value]) => ({ name, value, color: CATEGORY_COLORS[name] || CATEGORY_COLORS.Other, percent: spent ? (value / spent) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
  return { expenses, incomeTransactions, cardPayments, income, spent, saved, payments, categories };
}

export function splitReceived(vault, expenseId) {
  return (vault.splitReimbursements || [])
    .filter((item) => item.expenseId === expenseId)
    .reduce((sum, item) => sum + number(item.amount), 0);
}

export function expenseNetAmount(vault, expense) {
  return Math.max(0, number(expense.total) - splitReceived(vault, expense.id));
}

export function expenseSplitStatus(vault, expense) {
  const count = Math.max(0, Math.round(number(expense.split?.count || expense.splitCount)));
  const expected = number(expense.split?.expectedReimbursement) || (count > 1 ? number(expense.total) - number(expense.total) / count : 0);
  const received = splitReceived(vault, expense.id);
  return { count, expected, received, remaining: Math.max(0, expected - received) };
}

export function history(vault, endMonth = currentMonth(), count = 6) {
  return Array.from({ length: count }, (_, index) => {
    const month = shiftMonth(endMonth, index - count + 1);
    return { month, ...monthStats(vault, month) };
  });
}

export function dueCards(vault, month) {
  return vault.creditCards.filter((card) => card.active !== false).map((card) => {
    const statements = vault.cardStatements.filter((item) => item.cardId === card.id).sort((a, b) => b.statementDate.localeCompare(a.statementDate));
    const statement = statements.find((item) => monthKey(item.dueDate) === month);
    const latest = statements[0];
    const day = Math.min(number(card.dueDay) || 1, daysInMonth(month));
    const dueDate = statement?.dueDate || `${month}-${pad(day)}`;
    const amount = statement ? number(statement.statementBalance) : card.useLastAmountEstimate ? number(latest?.statementBalance) : null;
    const payments = vault.cardPayments.filter((item) =>
      (statement?.id && item.statementId === statement.id) ||
      (item.cardId === card.id && item.dueMonth === month),
    );
    const paidAmount = payments.reduce((sum, item) => sum + number(item.amount), 0);
    const paid = amount == null ? paidAmount > 0 : paidAmount >= amount - 0.005;
    return { card, statement, latest, dueDate, amount, payments, payment: payments[0], paidAmount, paid };
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function calendarEvents(vault, month) {
  const events = [];
  for (const source of vault.incomeSources.filter((item) => item.active !== false)) {
    for (const date of occurrencesInMonth(source, month)) {
      events.push({ id: `income-${source.id}-${date}`, date, type: "in", name: source.name || "Income", amount: number(source.amount), projected: !vault.incomeTransactions.some((item) => item.sourceId === source.id && item.date === date) });
    }
  }
  for (const item of vault.recurringExpenses.filter((entry) => entry.active !== false)) {
    for (const date of occurrencesInMonth(item, month)) events.push({ id: `out-${item.id}-${date}`, date, type: "out", name: item.name, amount: number(item.amount), projected: !vault.expenses.some((entry) => entry.recurringId === item.id && entry.date === date) });
  }
  for (const item of dueCards(vault, month)) events.push({ id: `card-${item.card.id}-${item.dueDate}`, date: item.dueDate, type: "card", name: `${item.card.bank} ${item.card.name || "card"} due`, amount: item.amount, paid: item.paid });
  for (const card of vault.creditCards.filter((item) => item.active !== false && item.statementDay)) {
    const day = Math.min(number(card.statementDay), daysInMonth(month));
    events.push({ id: `generated-${card.id}-${month}`, date: `${month}-${pad(day)}`, type: "statement", name: `${card.bank} statement generated`, amount: null });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export function budgetActuals(vault, month) {
  const stats = monthStats(vault, month);
  return Object.entries(vault.budgets).map(([category, budget]) => ({
    category,
    budget: number(budget),
    actual: stats.categories.find((entry) => entry.name === category)?.value || 0,
  })).sort((a, b) => b.budget - a.budget);
}

export function fuelMetrics(vault, vehicleId) {
  const entries = vault.fuelEntries.filter((item) => !vehicleId || item.vehicleId === vehicleId).sort((a, b) => a.odometer - b.odometer || a.date.localeCompare(b.date));
  const trips = [];
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    const distance = number(current.odometer) - number(previous.odometer);
    const litres = number(current.litres);
    if (distance > 0 && litres > 0) {
      const priorPricePerLitre = number(previous.litres) > 0 ? number(previous.cost) / number(previous.litres) : number(current.cost) / litres;
      trips.push({
        ...current,
        distance,
        economy: (litres / distance) * 100,
        costPer100: litres * priorPricePerLitre / distance * 100,
        sourceStation: previous.station || "Unknown",
        sourceOctane: previous.octane || "Regular",
      });
    }
  }
  const average = trips.length ? trips.reduce((sum, item) => sum + item.economy, 0) / trips.length : 0;
  const costPer100 = trips.length ? trips.reduce((sum, item) => sum + item.costPer100, 0) / trips.length : 0;
  const kmTracked = trips.reduce((sum, item) => sum + item.distance, 0);
  const stationMap = {};
  for (const trip of trips) {
    const key = `${trip.sourceStation || "Unknown"}|${trip.sourceOctane || "Regular"}`;
    (stationMap[key] ||= []).push(trip.economy);
  }
  const stations = Object.entries(stationMap).map(([name, values]) => ({ name, average: values.reduce((a, b) => a + b, 0) / values.length, fills: values.length })).sort((a, b) => a.average - b.average);
  return { entries, trips, average, costPer100, kmTracked, bestStation: stations.find((item) => item.fills >= 2) || stations[0] || null };
}

export function priceComparisons(vault, category = "All") {
  const products = {};
  for (const expense of vault.expenses) {
    if (category !== "All" && expense.category !== category) continue;
    for (const item of expense.items || []) {
      const key = String(item.name || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
      if (!key || !number(item.lineTotal)) continue;
      const quantity = number(item.qty) || 1;
      let unitPrice = number(item.lineTotal) / quantity;
      let unit = item.unit || "ea";
      if (unit === "g") { unitPrice *= 1000; unit = "kg"; }
      if (unit === "lb") { unitPrice /= 0.453592; unit = "kg"; }
      if (unit === "ml") { unitPrice *= 1000; unit = "L"; }
      const product = products[key] ||= { name: item.name, unit, category: expense.category, stores: {} };
      const store = expense.store || "Unknown store";
      const current = product.stores[store];
      if (!current || expense.date > current.date) product.stores[store] = { store, price: unitPrice, date: expense.date };
    }
  }
  return Object.values(products).map((product) => {
    const stores = Object.values(product.stores).sort((a, b) => a.price - b.price);
    return { ...product, stores, savings: stores.length > 1 ? stores.at(-1).price - stores[0].price : 0 };
  }).filter((item) => item.stores.length > 1).sort((a, b) => b.savings - a.savings);
}

export function localInsights(vault, month) {
  const current = monthStats(vault, month);
  const previous = monthStats(vault, shiftMonth(month, -1));
  const output = [];
  const top = current.categories[0];
  if (top) output.push(`${top.name} is your largest category at ${Math.round(top.percent)}% of recorded spending.`);
  if (previous.spent > 0) {
    const delta = ((current.spent - previous.spent) / previous.spent) * 100;
    output.push(`Spending is ${Math.abs(Math.round(delta))}% ${delta >= 0 ? "higher" : "lower"} than last month.`);
  }
  if (current.income > 0) output.push(`Your current pace leaves ${Math.round((current.saved / current.income) * 100)}% of income after expenses.`);
  const backupAge = vault.settings.lastExternalBackupAt ? (Date.now() - new Date(vault.settings.lastExternalBackupAt).getTime()) / 86400000 : Infinity;
  if (backupAge >= (number(vault.settings.backupReminderDays) || 14)) output.push("An encrypted external backup is due. Save one to Files from Settings.");
  if (!output.length) output.push("Add income and expenses to build private on-device insights.");
  return output.slice(0, 3);
}
