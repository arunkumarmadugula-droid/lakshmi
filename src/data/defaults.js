import { normalizeTheme } from "../lib/theme.js";

export const SCHEMA_VERSION = 6;

export const REGIONS = {
  CA: { country: "CA", name: "Canada", currency: "CAD", locale: "en-CA" },
  IN: { country: "IN", name: "India", currency: "INR", locale: "en-IN" },
};

export function normalizeCountry(value) {
  return value === "IN" ? "IN" : "CA";
}

export const DRIVE_THROUGH_BUCKETS = ["Coffee", "Breakfast", "Quick meal", "Snacks", "Other"];

export const CATEGORY_DEFINITIONS = [
  ["Housing", "#9bc7ea"],
  ["Groceries", "#a9d6c1"],
  ["Dining", "#e7b8a9"],
  ["Fuel", "#d7c48f"],
  ["Transport", "#aebfdd"],
  ["Utilities", "#c5b8db"],
  ["Telecom", "#9fcfd0"],
  ["Internet", "#b8c9e8"],
  ["Insurance", "#d0b8c9"],
  ["Health", "#b7d1b0"],
  ["Kids", "#e0c1d2"],
  ["Subscriptions", "#c8c0e1"],
  ["Shopping", "#d7bea4"],
  ["Education", "#adc9ba"],
  ["Entertainment", "#d6b6b6"],
  ["Travel", "#b1cad2"],
  ["Debt & EMI", "#c4b7a6"],
  ["Gifts", "#d9c4a5"],
  ["Other", "#b9b9b9"],
];

export const CATEGORIES = CATEGORY_DEFINITIONS.map(([name]) => name);
export const CATEGORY_COLORS = Object.fromEntries(CATEGORY_DEFINITIONS);

export const BUDGET_SUBCATEGORIES = {
  Housing: ["Rent", "Mortgage", "Property tax", "Maintenance", "Condo fees", "Other"],
  Groceries: ["Food", "Household supplies", "Baby food", "Bulk purchases", "Other"],
  Dining: ["Restaurants", "Takeout", "Coffee", "Work meals", "Other"],
  Fuel: ["Regular", "Mid-grade", "Premium", "Car wash", "Other"],
  Transport: ["Transit", "Parking", "Tolls", "Repairs", "Other"],
  Utilities: ["Electricity", "Gas", "Water", "Waste", "Other"],
  Telecom: ["Mobile phone", "Device payment", "Long distance", "Other"],
  Internet: ["Home internet", "Equipment rental", "Other"],
  Insurance: ["Auto", "Home", "Life", "Travel", "Other"],
  Health: ["Pharmacy", "Dental", "Vision", "Therapy", "Other"],
  Kids: ["Diapers", "Food", "Toys", "Clothes", "Childcare", "School", "Other"],
  Subscriptions: ["Amazon Prime", "Netflix", "Spotify", "Uber", "Cloud storage", "Other"],
  Shopping: ["Clothing", "Electronics", "Home", "Personal care", "Other"],
  Education: ["Tuition", "Books", "Courses", "School supplies", "Other"],
  Entertainment: ["Movies", "Events", "Games", "Hobbies", "Other"],
  Travel: ["Flights", "Hotels", "Local travel", "Food", "Other"],
  "Debt & EMI": ["Auto loan", "Personal loan", "Student loan", "Buy now pay later", "Other"],
  Gifts: ["Family", "Friends", "Charity", "Other"],
  Other: ["Other"],
};

export function createEmptyVault(profileName = "My household", country = "CA") {
  const now = new Date().toISOString();
  const region = REGIONS[normalizeCountry(country)];
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: {
      name: profileName,
      currency: region.currency,
      locale: region.locale,
      createdAt: now,
      updatedAt: now,
    },
    settings: {
      theme: "default",
      country: region.country,
      province: "ON",
      bankBalance: 0,
      savingsBalance: 0,
      balancesConfigured: false,
      autoLockMinutes: 5,
      backupReminderDays: 14,
      lastExternalBackupAt: null,
      lastLocalSnapshotAt: null,
      storagePersistent: false,
      backupMode: "device",
      aiMode: "direct-api",
      chartStartMonth: now.slice(0, 7),
      onboardingComplete: false,
      onboardingVersion: 1,
    },
    ai: {
      apiKey: "",
      model: "gpt-5.4-mini",
      consentAt: null,
      usage: [],
    },
    expenses: [],
    refunds: [],
    incomeSources: [],
    incomeTransactions: [],
    recurringExpenses: [],
    budgets: {},
    budgetItems: [],
    payslips: [],
    creditCards: [],
    cardStatements: [],
    cardPayments: [],
    savingsTransfers: [],
    savingsGoals: [],
    jointAccount: {
      enabled: false,
      name: "Joint account",
      openingBalance: 0,
      createdAt: null,
    },
    jointTransfers: [],
    vehicles: [],
    fuelEntries: [],
    splitReimbursements: [],
    quickFavorites: [{
      id: "favorite-tim-hortons",
      name: "Tim Hortons",
      bucket: "Coffee",
      category: "Dining",
      paymentMethod: "credit",
      cardId: "",
    }],
    householdLink: {
      enabled: false,
      role: "primary",
      householdId: "",
      syncKey: "",
      primaryName: profileName,
      partnerName: "Partner",
      linkedAt: null,
    },
    partnerSync: {
      deviceId: "",
      nextSequence: 1,
      lastSentSequence: 0,
      lastSentAt: null,
      changeLog: [],
      importedDevices: {},
    },
  };
}

export function normalizeVault(input, profileName) {
  const source = input && typeof input === "object" ? input : {};
  const country = normalizeCountry(source.settings?.country || (source.profile?.currency === "INR" ? "IN" : "CA"));
  const region = REGIONS[country];
  const base = createEmptyVault(profileName, country);
  const profile = { ...base.profile, ...(source.profile || {}) };
  const settings = { ...base.settings, ...(source.settings || {}) };
  settings.country = country;
  profile.currency = region.currency;
  profile.locale = region.locale;
  settings.theme = normalizeTheme(settings.theme);
  const activationMonth = String(profile.createdAt || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(settings.chartStartMonth || "")) settings.chartStartMonth = /^\d{4}-\d{2}$/.test(activationMonth) ? activationMonth : base.settings.chartStartMonth;
  if (source.schemaVersion && source.schemaVersion < 3 && source.settings?.onboardingComplete == null) settings.onboardingComplete = true;
  const legacyGoal = Number(source.settings?.savingsGoal) || 0;
  const savingsGoals = Array.isArray(source.savingsGoals)
    ? source.savingsGoals
    : legacyGoal > 0
      ? [{ id: "legacy-emergency-fund", type: "emergency", name: "Emergency fund", target: legacyGoal, allocated: 0, targetDate: "", createdAt: source.profile?.createdAt || new Date().toISOString() }]
      : [];
  return {
    ...base,
    ...source,
    schemaVersion: SCHEMA_VERSION,
    profile,
    settings,
    ai: { ...base.ai, ...(source.ai || {}) },
    expenses: Array.isArray(source.expenses) ? source.expenses : [],
    refunds: Array.isArray(source.refunds) ? source.refunds : [],
    incomeSources: Array.isArray(source.incomeSources) ? source.incomeSources : [],
    incomeTransactions: Array.isArray(source.incomeTransactions) ? source.incomeTransactions : [],
    recurringExpenses: Array.isArray(source.recurringExpenses) ? source.recurringExpenses : [],
    budgets: source.budgets && typeof source.budgets === "object" ? source.budgets : {},
    budgetItems: Array.isArray(source.budgetItems) ? source.budgetItems : [],
    payslips: Array.isArray(source.payslips) ? source.payslips : [],
    creditCards: Array.isArray(source.creditCards) ? source.creditCards : [],
    cardStatements: Array.isArray(source.cardStatements) ? source.cardStatements : [],
    cardPayments: Array.isArray(source.cardPayments) ? source.cardPayments : [],
    savingsTransfers: Array.isArray(source.savingsTransfers) ? source.savingsTransfers : [],
    savingsGoals,
    jointAccount: { ...base.jointAccount, ...(source.jointAccount || {}) },
    jointTransfers: Array.isArray(source.jointTransfers) ? source.jointTransfers : [],
    vehicles: Array.isArray(source.vehicles) ? source.vehicles : [],
    fuelEntries: Array.isArray(source.fuelEntries) ? source.fuelEntries : [],
    splitReimbursements: Array.isArray(source.splitReimbursements) ? source.splitReimbursements : [],
    quickFavorites: Array.isArray(source.quickFavorites) ? source.quickFavorites : base.quickFavorites,
    householdLink: { ...base.householdLink, ...(source.householdLink || {}) },
    partnerSync: {
      ...base.partnerSync,
      ...(source.partnerSync || {}),
      changeLog: Array.isArray(source.partnerSync?.changeLog) ? source.partnerSync.changeLog : [],
      importedDevices: source.partnerSync?.importedDevices && typeof source.partnerSync.importedDevices === "object" ? source.partnerSync.importedDevices : {},
    },
  };
}
