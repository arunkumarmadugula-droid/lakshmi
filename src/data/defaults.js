export const SCHEMA_VERSION = 1;

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
  Gifts: ["Family", "Friends", "Charity", "Other"],
  Other: ["Other"],
};

export function createEmptyVault(profileName = "My household") {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: {
      name: profileName,
      currency: "CAD",
      locale: "en-CA",
      createdAt: now,
      updatedAt: now,
    },
    settings: {
      theme: "default",
      province: "ON",
      bankBalance: 0,
      savingsBalance: 0,
      balancesConfigured: false,
      savingsGoal: 1000,
      autoLockMinutes: 5,
      backupReminderDays: 14,
      lastExternalBackupAt: null,
      lastLocalSnapshotAt: null,
      storagePersistent: false,
      aiMode: "chatgpt-share",
    },
    expenses: [],
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
    vehicles: [],
    fuelEntries: [],
  };
}

export function normalizeVault(input, profileName) {
  const base = createEmptyVault(profileName);
  const source = input && typeof input === "object" ? input : {};
  return {
    ...base,
    ...source,
    schemaVersion: SCHEMA_VERSION,
    profile: { ...base.profile, ...(source.profile || {}) },
    settings: { ...base.settings, ...(source.settings || {}) },
    expenses: Array.isArray(source.expenses) ? source.expenses : [],
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
    vehicles: Array.isArray(source.vehicles) ? source.vehicles : [],
    fuelEntries: Array.isArray(source.fuelEntries) ? source.fuelEntries : [],
  };
}
