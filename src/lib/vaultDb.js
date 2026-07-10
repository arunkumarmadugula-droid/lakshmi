import { createEmptyVault, normalizeVault, SCHEMA_VERSION } from "../data/defaults.js";
import { number, todayISO, uid } from "./format.js";

const DB_NAME = "lakshmi-secure-vault";
const DB_VERSION = 1;
const KDF_ITERATIONS = 600000;
const AAD = new TextEncoder().encode("lakshmi-encrypted-vault-v1");
const LAST_PROFILE_KEY = "lakshmi-last-profile";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Database request failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Database transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Database transaction was cancelled."));
  });
}

async function openDatabase() {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains("profiles")) database.createObjectStore("profiles", { keyPath: "id" });
    if (!database.objectStoreNames.contains("vaults")) database.createObjectStore("vaults", { keyPath: "profileId" });
    if (!database.objectStoreNames.contains("snapshots")) {
      const snapshots = database.createObjectStore("snapshots", { keyPath: "id" });
      snapshots.createIndex("profileId", "profileId", { unique: false });
    }
  };
  return requestResult(request);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveKey(passphrase, salt, iterations = KDF_ITERATIONS) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptJson(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: AAD, tagLength: 128 },
    key,
    plaintext,
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) };
}

async function decryptJson(record, key) {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(record.iv), additionalData: AAD, tagLength: 128 },
      key,
      base64ToBytes(record.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    throw new Error("The passcode is incorrect or this vault is damaged.");
  }
}

export async function listProfiles() {
  const database = await openDatabase();
  const transaction = database.transaction("profiles", "readonly");
  const profiles = await requestResult(transaction.objectStore("profiles").getAll());
  await transactionDone(transaction);
  database.close();
  return profiles.sort((a, b) => String(b.lastOpenedAt || b.createdAt).localeCompare(String(a.lastOpenedAt || a.createdAt)));
}

export async function createProfile(name, passphrase, initialVault) {
  if (!crypto?.subtle || !indexedDB) throw new Error("This browser does not support the encryption required by Lakshmi.");
  if (String(passphrase).length < 8) throw new Error("Use at least 8 characters for the local passphrase.");
  const profileId = uid("profile");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const vault = normalizeVault(initialVault || createEmptyVault(name), name);
  vault.profile.name = name.trim() || "My household";
  vault.profile.updatedAt = new Date().toISOString();
  const encrypted = await encryptJson(vault, key);
  const now = new Date().toISOString();
  const profile = {
    id: profileId,
    name: vault.profile.name,
    salt: bytesToBase64(salt),
    iterations: KDF_ITERATIONS,
    createdAt: now,
    lastOpenedAt: now,
    lastSavedAt: now,
    schemaVersion: SCHEMA_VERSION,
  };
  const database = await openDatabase();
  const transaction = database.transaction(["profiles", "vaults"], "readwrite");
  transaction.objectStore("profiles").put(profile);
  transaction.objectStore("vaults").put({ profileId, ...encrypted, schemaVersion: SCHEMA_VERSION, updatedAt: now });
  await transactionDone(transaction);
  database.close();
  localStorage.setItem(LAST_PROFILE_KEY, profileId);
  return { profile, key, vault };
}

export async function unlockProfile(profileId, passphrase) {
  const database = await openDatabase();
  const transaction = database.transaction(["profiles", "vaults"], "readonly");
  const profilePromise = requestResult(transaction.objectStore("profiles").get(profileId));
  const recordPromise = requestResult(transaction.objectStore("vaults").get(profileId));
  const [profile, record] = await Promise.all([profilePromise, recordPromise]);
  await transactionDone(transaction);
  database.close();
  if (!profile || !record) throw new Error("This local profile is unavailable.");
  const key = await deriveKey(passphrase, base64ToBytes(profile.salt), profile.iterations);
  const vault = normalizeVault(await decryptJson(record, key), profile.name);
  profile.lastOpenedAt = new Date().toISOString();
  const updateDatabase = await openDatabase();
  const updateTransaction = updateDatabase.transaction("profiles", "readwrite");
  updateTransaction.objectStore("profiles").put(profile);
  await transactionDone(updateTransaction);
  updateDatabase.close();
  localStorage.setItem(LAST_PROFILE_KEY, profileId);
  return { profile, key, vault };
}

async function snapshotsFor(database, profileId) {
  const transaction = database.transaction("snapshots", "readonly");
  const records = await requestResult(transaction.objectStore("snapshots").index("profileId").getAll(profileId));
  await transactionDone(transaction);
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveVault(profileId, key, input, { forceSnapshot = false } = {}) {
  const vault = normalizeVault(input, input?.profile?.name);
  vault.profile.updatedAt = new Date().toISOString();
  const encrypted = await encryptJson(vault, key);
  const database = await openDatabase();
  const readTransaction = database.transaction(["profiles", "vaults"], "readonly");
  const profilePromise = requestResult(readTransaction.objectStore("profiles").get(profileId));
  const previousPromise = requestResult(readTransaction.objectStore("vaults").get(profileId));
  const [profile, previous] = await Promise.all([profilePromise, previousPromise]);
  await transactionDone(readTransaction);
  if (!profile) {
    database.close();
    throw new Error("The local profile could not be saved.");
  }
  const existingSnapshots = await snapshotsFor(database, profileId);
  const latestAge = existingSnapshots[0] ? Date.now() - new Date(existingSnapshots[0].createdAt).getTime() : Infinity;
  const shouldSnapshot = previous && (forceSnapshot || latestAge >= 20 * 60 * 60 * 1000);
  const now = new Date().toISOString();
  const writeTransaction = database.transaction(["profiles", "vaults", "snapshots"], "readwrite");
  if (shouldSnapshot) {
    writeTransaction.objectStore("snapshots").put({ id: uid("snapshot"), profileId, createdAt: now, record: previous });
  }
  writeTransaction.objectStore("vaults").put({ profileId, ...encrypted, schemaVersion: SCHEMA_VERSION, updatedAt: now });
  writeTransaction.objectStore("profiles").put({ ...profile, name: vault.profile.name, lastSavedAt: now, schemaVersion: SCHEMA_VERSION });
  await transactionDone(writeTransaction);
  const allSnapshots = await snapshotsFor(database, profileId);
  if (allSnapshots.length > 7) {
    const cleanup = database.transaction("snapshots", "readwrite");
    for (const snapshot of allSnapshots.slice(7)) cleanup.objectStore("snapshots").delete(snapshot.id);
    await transactionDone(cleanup);
  }
  database.close();
  return vault;
}

export async function listLocalSnapshots(profileId) {
  const database = await openDatabase();
  const records = await snapshotsFor(database, profileId);
  database.close();
  return records.map(({ id, createdAt, record }) => ({ id, createdAt, size: Math.round((record?.ciphertext?.length || 0) * 0.75) }));
}

export async function restoreLocalSnapshot(profileId, snapshotId, key) {
  const database = await openDatabase();
  const transaction = database.transaction("snapshots", "readonly");
  const snapshot = await requestResult(transaction.objectStore("snapshots").get(snapshotId));
  await transactionDone(transaction);
  database.close();
  if (!snapshot || snapshot.profileId !== profileId) throw new Error("The selected snapshot no longer exists.");
  const vault = normalizeVault(await decryptJson(snapshot.record, key));
  await saveVault(profileId, key, vault, { forceSnapshot: true });
  return vault;
}

export async function buildEncryptedBackup(profileId) {
  const database = await openDatabase();
  const transaction = database.transaction(["profiles", "vaults"], "readonly");
  const profilePromise = requestResult(transaction.objectStore("profiles").get(profileId));
  const vaultPromise = requestResult(transaction.objectStore("vaults").get(profileId));
  const [profile, vault] = await Promise.all([profilePromise, vaultPromise]);
  await transactionDone(transaction);
  database.close();
  if (!profile || !vault) throw new Error("There is no vault to back up.");
  const backup = {
    format: "lakshmi-encrypted-backup",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    profile: {
      name: profile.name,
      salt: profile.salt,
      iterations: profile.iterations,
      schemaVersion: profile.schemaVersion,
    },
    vault: {
      iv: vault.iv,
      ciphertext: vault.ciphertext,
      schemaVersion: vault.schemaVersion,
      updatedAt: vault.updatedAt,
    },
  };
  const filename = `lakshmi-${profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "backup"}-${todayISO()}.lakshmi`;
  return { backup, file: new File([JSON.stringify(backup)], filename, { type: "application/vnd.lakshmi.backup+json" }) };
}

export async function importEncryptedBackup(file) {
  if (file.size > 50 * 1024 * 1024) throw new Error("That backup is larger than the 50 MB safety limit.");
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error("That file is not a readable Lakshmi backup.");
  }
  if (backup?.format !== "lakshmi-encrypted-backup" || backup?.formatVersion !== 1 || !backup?.profile?.salt || !backup?.vault?.ciphertext || !backup?.vault?.iv) {
    throw new Error("That file is not a supported encrypted Lakshmi backup.");
  }
  const iterations = Number(backup.profile.iterations || KDF_ITERATIONS);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 2000000) {
    throw new Error("That backup uses unsupported encryption settings.");
  }
  const profileId = uid("profile");
  const now = new Date().toISOString();
  const profile = {
    id: profileId,
    name: `${backup.profile.name || "Restored household"}`,
    salt: backup.profile.salt,
    iterations,
    createdAt: now,
    lastOpenedAt: null,
    lastSavedAt: backup.vault.updatedAt || now,
    schemaVersion: backup.profile.schemaVersion || SCHEMA_VERSION,
    restoredAt: now,
  };
  const database = await openDatabase();
  const transaction = database.transaction(["profiles", "vaults"], "readwrite");
  transaction.objectStore("profiles").put(profile);
  transaction.objectStore("vaults").put({ profileId, ...backup.vault });
  await transactionDone(transaction);
  database.close();
  return profile;
}

export async function deleteProfile(profileId) {
  const database = await openDatabase();
  const existingSnapshots = await snapshotsFor(database, profileId);
  const transaction = database.transaction(["profiles", "vaults", "snapshots"], "readwrite");
  transaction.objectStore("profiles").delete(profileId);
  transaction.objectStore("vaults").delete(profileId);
  for (const snapshot of existingSnapshots) transaction.objectStore("snapshots").delete(snapshot.id);
  await transactionDone(transaction);
  database.close();
  if (localStorage.getItem(LAST_PROFILE_KEY) === profileId) localStorage.removeItem(LAST_PROFILE_KEY);
}

export function lastProfileId() {
  return localStorage.getItem(LAST_PROFILE_KEY);
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}

const LEGACY_KEYS = ["lakshmi-v6", "lakshmi-v2", "lakshmi-v1", "finledger-v2", "finledger-v1"];

export function legacyDataAvailable() {
  return LEGACY_KEYS.some((key) => localStorage.getItem(key));
}

export function legacyApiKeyAvailable() {
  try {
    return !!JSON.parse(localStorage.getItem("lakshmi-ai") || "{}").key;
  } catch {
    return false;
  }
}

export function clearLegacyApiKey() {
  localStorage.removeItem("lakshmi-ai");
}

export function readLegacyVault(profileName = "Imported household") {
  let source = null;
  for (const key of LEGACY_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) { source = JSON.parse(raw); break; }
    } catch {}
  }
  if (!source) return null;
  const vault = createEmptyVault(profileName);
  vault.settings.theme = source.settings?.theme === "lotus" ? "lotus" : source.settings?.theme === "forest" ? "forest" : "default";
  vault.settings.bankBalance = number(source.settings?.bankBalance);
  vault.settings.savingsBalance = number(source.settings?.savingsBalance);
  vault.settings.balancesConfigured = !!(vault.settings.bankBalance || vault.settings.savingsBalance);
  vault.expenses = (source.expenses || []).map((item) => ({
    ...item,
    id: item.id || uid("expense"),
    store: item.store || item.vendor || "Imported expense",
    total: number(item.total || item.cost),
    subtotal: number(item.subtotal || item.total || item.cost) - number(item.tax),
    tax: number(item.tax),
    category: item.category || "Other",
    paymentMethod: item.paymentMethod || "bank",
    source: item.source || "legacy-import",
  }));
  vault.incomeSources = (source.incomes || source.settings?.incomes || []).map((item) => ({
    ...item,
    id: item.id || uid("income-source"),
    name: item.name || "Imported income",
    amount: number(item.amount),
    frequency: item.frequency || item.freq || "monthly",
    nextDate: item.nextDate || item.nextPay || todayISO(),
    active: true,
    autoPost: true,
  }));
  vault.creditCards = (source.cards || source.creditCards || []).map((item) => ({
    ...item,
    id: item.id || uid("card"),
    bank: item.bank || item.issuer || "Bank",
    last4: String(item.last4 || "").slice(-4),
    statementDay: number(item.statementDay || item.generatedDay || 1),
    dueDay: number(item.dueDay || 21),
    active: true,
  }));
  vault.cardStatements = (source.cardBills || source.cardStatements || []).map((item) => ({
    ...item,
    id: item.id || uid("statement"),
    statementBalance: number(item.statementBalance || item.amount),
    statementDate: item.statementDate || item.generatedDate || todayISO(),
    dueDate: item.dueDate || todayISO(),
  }));
  vault.cardPayments = (source.cardPayments || []).map((item) => ({ ...item, id: item.id || uid("payment"), amount: number(item.amount) }));
  vault.budgets = source.budgets || {};
  vault.budgetItems = source.budgetItems || [];
  vault.payslips = source.settings?.payslips || source.payslips || [];
  const legacyVehicle = source.settings?.vehicle;
  if (legacyVehicle) vault.vehicles.push({ ...legacyVehicle, id: legacyVehicle.id || uid("vehicle"), active: true });
  vault.fuelEntries = (source.fuel || source.fuelEntries || []).map((item) => ({ ...item, id: item.id || uid("fuel"), vehicleId: item.vehicleId || vault.vehicles[0]?.id || "", station: item.station || item.vendor || "" }));
  vault.profile.updatedAt = new Date().toISOString();
  return vault;
}
