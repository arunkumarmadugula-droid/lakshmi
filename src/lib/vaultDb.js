import { createEmptyVault, normalizeVault, SCHEMA_VERSION } from "../data/defaults.js";
import { number, todayISO, uid } from "./format.js";
import { authenticateDeviceUnlock, registerDeviceUnlock } from "./deviceAuth.js";

const DB_NAME = "lakshmi-secure-vault";
const DB_VERSION = 2;
const ENCRYPTION_VERSION = 2;
const KDF_ITERATIONS = 600000;
const PIN_ITERATIONS = 900000;
const AAD = new TextEncoder().encode("lakshmi-encrypted-vault-v1");
const WRAP_AAD = new TextEncoder().encode("lakshmi-master-key-wrap-v2");
const QUICK_AAD = new TextEncoder().encode("lakshmi-quick-unlock-wrap-v1");
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
    if (!database.objectStoreNames.contains("documents")) {
      const documents = database.createObjectStore("documents", { keyPath: "storageId" });
      documents.createIndex("profileId", "profileId", { unique: false });
    }
    if (!database.objectStoreNames.contains("documentBlobs")) database.createObjectStore("documentBlobs", { keyPath: "storageId" });
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
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(secret, salt, iterations = KDF_ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function importMasterKey(bytes) {
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptBytes(value, key, additionalData) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData, tagLength: 128 },
    key,
    value,
  );
  return { iv: bytesToBase64(iv), ciphertext: new Uint8Array(encrypted) };
}

async function decryptBytes(record, key, additionalData) {
  const ciphertext = typeof record.ciphertext === "string" ? base64ToBytes(record.ciphertext) : new Uint8Array(record.ciphertext);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(record.iv), additionalData, tagLength: 128 },
    key,
    ciphertext,
  ));
}

async function encryptJson(value, key) {
  const encrypted = await encryptBytes(new TextEncoder().encode(JSON.stringify(value)), key, AAD);
  return { iv: encrypted.iv, ciphertext: bytesToBase64(encrypted.ciphertext) };
}

async function decryptJson(record, key) {
  try {
    return JSON.parse(new TextDecoder().decode(await decryptBytes(record, key, AAD)));
  } catch {
    throw new Error("The passphrase is incorrect or this vault is damaged.");
  }
}

async function createPassphraseWrapper(rawMasterKey, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrappingKey = await deriveKey(passphrase, salt);
  const wrapped = await encryptBytes(rawMasterKey, wrappingKey, WRAP_AAD);
  return { salt: bytesToBase64(salt), iterations: KDF_ITERATIONS, iv: wrapped.iv, ciphertext: bytesToBase64(wrapped.ciphertext) };
}

async function unwrapProfileKey(profile, passphrase) {
  if (profile.encryptionVersion !== ENCRYPTION_VERSION || !profile.passphrase?.ciphertext) {
    throw new Error("This profile must be upgraded with its original passphrase.");
  }
  try {
    const wrappingKey = await deriveKey(passphrase, base64ToBytes(profile.passphrase.salt), profile.passphrase.iterations);
    const raw = await decryptBytes(profile.passphrase, wrappingKey, WRAP_AAD);
    return { raw, key: await importMasterKey(raw) };
  } catch {
    throw new Error("The passphrase is incorrect or this vault is damaged.");
  }
}

function publicProfile(profile) {
  const { passphrase, quickUnlock, ...safe } = profile;
  return {
    ...safe,
    encryptionVersion: profile.encryptionVersion || 1,
    quickUnlock: quickUnlock ? { type: quickUnlock.type, createdAt: quickUnlock.createdAt } : null,
  };
}

async function profileAndVault(profileId) {
  const database = await openDatabase();
  const transaction = database.transaction(["profiles", "vaults"], "readonly");
  const profilePromise = requestResult(transaction.objectStore("profiles").get(profileId));
  const recordPromise = requestResult(transaction.objectStore("vaults").get(profileId));
  const [profile, record] = await Promise.all([profilePromise, recordPromise]);
  await transactionDone(transaction);
  database.close();
  if (!profile || !record) throw new Error("This local profile is unavailable.");
  return { profile, record };
}

async function markOpened(profile) {
  const updated = { ...profile, lastOpenedAt: new Date().toISOString() };
  const database = await openDatabase();
  const transaction = database.transaction("profiles", "readwrite");
  transaction.objectStore("profiles").put(updated);
  await transactionDone(transaction);
  database.close();
  localStorage.setItem(LAST_PROFILE_KEY, profile.id);
  return updated;
}

export async function listProfiles() {
  const database = await openDatabase();
  const transaction = database.transaction("profiles", "readonly");
  const profiles = await requestResult(transaction.objectStore("profiles").getAll());
  await transactionDone(transaction);
  database.close();
  return profiles
    .sort((a, b) => String(b.lastOpenedAt || b.createdAt).localeCompare(String(a.lastOpenedAt || a.createdAt)))
    .map(publicProfile);
}

export async function createProfile(name, passphrase, initialVault) {
  if (!crypto?.subtle || !indexedDB) throw new Error("This browser does not support the encryption required by Lakshmi.");
  if (String(passphrase).length < 8) throw new Error("Use at least 8 characters for the recovery passphrase.");
  const profileId = uid("profile");
  const rawMasterKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await importMasterKey(rawMasterKey);
  const vault = normalizeVault(initialVault || createEmptyVault(name), name);
  vault.profile.name = name.trim() || "My household";
  vault.profile.updatedAt = new Date().toISOString();
  const encrypted = await encryptJson(vault, key);
  const now = new Date().toISOString();
  const profile = {
    id: profileId,
    name: vault.profile.name,
    encryptionVersion: ENCRYPTION_VERSION,
    passphrase: await createPassphraseWrapper(rawMasterKey, passphrase),
    quickUnlock: null,
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
  return { profile: publicProfile(profile), key, vault };
}

async function migrateVersionOne(profile, record, passphrase) {
  const legacyKey = await deriveKey(passphrase, base64ToBytes(profile.salt), profile.iterations);
  const vault = normalizeVault(await decryptJson(record, legacyKey), profile.name);
  const rawMasterKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await importMasterKey(rawMasterKey);
  const migratedProfile = {
    ...profile,
    encryptionVersion: ENCRYPTION_VERSION,
    passphrase: await createPassphraseWrapper(rawMasterKey, passphrase),
    quickUnlock: null,
    schemaVersion: SCHEMA_VERSION,
  };
  delete migratedProfile.salt;
  delete migratedProfile.iterations;
  const encrypted = await encryptJson(vault, key);
  const database = await openDatabase();
  const transaction = database.transaction(["profiles", "vaults"], "readwrite");
  transaction.objectStore("profiles").put(migratedProfile);
  transaction.objectStore("vaults").put({ profileId: profile.id, ...encrypted, schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString() });
  await transactionDone(transaction);
  database.close();
  return { profile: migratedProfile, key, vault };
}

export async function unlockProfile(profileId, passphrase) {
  const { profile, record } = await profileAndVault(profileId);
  const unlocked = profile.encryptionVersion === ENCRYPTION_VERSION
    ? { profile, ...(await unwrapProfileKey(profile, passphrase)) }
    : await migrateVersionOne(profile, record, passphrase);
  const vault = unlocked.vault || normalizeVault(await decryptJson(record, unlocked.key), profile.name);
  const opened = await markOpened(unlocked.profile);
  return { profile: publicProfile(opened), key: unlocked.key, vault };
}

export async function verifyPassphrase(profileId, passphrase) {
  const { profile, record } = await profileAndVault(profileId);
  if (profile.encryptionVersion === ENCRYPTION_VERSION) {
    const { key } = await unwrapProfileKey(profile, passphrase);
    await decryptJson(record, key);
    return true;
  }
  const key = await deriveKey(passphrase, base64ToBytes(profile.salt), profile.iterations);
  await decryptJson(record, key);
  return true;
}

export async function configureQuickUnlock(profileId, passphrase, method, pin = "") {
  const { profile, record } = await profileAndVault(profileId);
  const { raw, key } = await unwrapProfileKey(profile, passphrase);
  await decryptJson(record, key);
  let quickUnlock = null;
  if (method === "device") {
    const registration = await registerDeviceUnlock(profile);
    const wrappingKey = await importMasterKey(registration.prfOutput);
    const wrapped = await encryptBytes(raw, wrappingKey, QUICK_AAD);
    quickUnlock = {
      type: "device",
      credentialId: registration.credentialId,
      prfSalt: registration.prfSalt,
      iv: wrapped.iv,
      ciphertext: bytesToBase64(wrapped.ciphertext),
      createdAt: new Date().toISOString(),
    };
  } else if (method === "pin") {
    if (!/^\d{4}$/.test(pin)) throw new Error("Enter exactly four digits for the quick PIN.");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const wrappingKey = await deriveKey(pin, salt, PIN_ITERATIONS);
    const wrapped = await encryptBytes(raw, wrappingKey, QUICK_AAD);
    quickUnlock = {
      type: "pin",
      salt: bytesToBase64(salt),
      iterations: PIN_ITERATIONS,
      iv: wrapped.iv,
      ciphertext: bytesToBase64(wrapped.ciphertext),
      createdAt: new Date().toISOString(),
    };
  } else if (method !== "passphrase") {
    throw new Error("Choose device unlock, PIN, or passphrase.");
  }
  const updated = { ...profile, quickUnlock };
  const database = await openDatabase();
  const transaction = database.transaction("profiles", "readwrite");
  transaction.objectStore("profiles").put(updated);
  await transactionDone(transaction);
  database.close();
  return publicProfile(updated);
}

export async function quickUnlockProfile(profileId, pin = "") {
  const { profile, record } = await profileAndVault(profileId);
  if (!profile.quickUnlock) throw new Error("Quick unlock has not been configured. Use the recovery passphrase.");
  try {
    let wrappingKey;
    if (profile.quickUnlock.type === "device") {
      wrappingKey = await importMasterKey(await authenticateDeviceUnlock(profile.quickUnlock));
    } else {
      if (!/^\d{4}$/.test(pin)) throw new Error("Enter your four-digit PIN.");
      wrappingKey = await deriveKey(pin, base64ToBytes(profile.quickUnlock.salt), profile.quickUnlock.iterations);
    }
    const raw = await decryptBytes(profile.quickUnlock, wrappingKey, QUICK_AAD);
    const key = await importMasterKey(raw);
    const vault = normalizeVault(await decryptJson(record, key), profile.name);
    const opened = await markOpened(profile);
    return { profile: publicProfile(opened), key, vault };
  } catch (reason) {
    if (reason?.name === "NotAllowedError" || reason?.name === "AbortError") throw reason;
    throw new Error(profile.quickUnlock.type === "pin" ? "That PIN is incorrect." : "Device unlock failed. Use the recovery passphrase.");
  }
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
  if (shouldSnapshot) writeTransaction.objectStore("snapshots").put({ id: uid("snapshot"), profileId, createdAt: now, record: previous });
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

async function compressBytes(bytes) {
  if (!globalThis.CompressionStream) return { bytes, compression: "none" };
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return compressed.length < bytes.length ? { bytes: compressed, compression: "gzip" } : { bytes, compression: "none" };
  } catch {
    return { bytes, compression: "none" };
  }
}

async function decompressBytes(bytes, compression) {
  if (compression !== "gzip") return bytes;
  if (!globalThis.DecompressionStream) throw new Error("This browser cannot open the compressed document.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function documentAad(id) {
  return new TextEncoder().encode(`lakshmi-document-v1:${id}`);
}

async function opfsDirectory(profileId, parts = [], create = true) {
  if (!navigator.storage?.getDirectory) return null;
  let directory = await navigator.storage.getDirectory();
  for (const name of ["lakshmi", profileId, ...parts]) directory = await directory.getDirectoryHandle(name, { create });
  return directory;
}

async function writeOpfs(profileId, path, bytes) {
  try {
    const parts = path.split("/");
    const fileName = parts.pop();
    const directory = await opfsDirectory(profileId, parts, true);
    if (!directory) return false;
    const handle = await directory.getFileHandle(fileName, { create: true });
    if (!handle.createWritable) return false;
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

async function readOpfs(profileId, path) {
  const parts = path.split("/");
  const fileName = parts.pop();
  const directory = await opfsDirectory(profileId, parts, false);
  const handle = await directory.getFileHandle(fileName);
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

export async function storeEncryptedDocument(profileId, key, file, { kind = "receipt", date = todayISO(), recordId = "" } = {}) {
  if (!file) return null;
  const id = uid("document");
  const storageId = `${profileId}:${id}`;
  const original = new Uint8Array(await file.arrayBuffer());
  const compressed = await compressBytes(original);
  const encrypted = await encryptBytes(compressed.bytes, key, documentAad(id));
  const [year = "unknown", month = "00"] = String(date || todayISO()).split("-");
  const path = `${year}/${month}/${kind}/${id}.bin`;
  const inOpfs = await writeOpfs(profileId, path, encrypted.ciphertext);
  const metadata = {
    storageId,
    id,
    profileId,
    recordId,
    kind,
    date,
    fileName: file.name || `${kind}-${date}`,
    mimeType: file.type || "application/octet-stream",
    originalBytes: original.length,
    storedBytes: encrypted.ciphertext.length,
    compression: compressed.compression,
    iv: encrypted.iv,
    storage: inOpfs ? "opfs" : "idb",
    path,
    createdAt: new Date().toISOString(),
  };
  const database = await openDatabase();
  const stores = inOpfs ? ["documents"] : ["documents", "documentBlobs"];
  const transaction = database.transaction(stores, "readwrite");
  transaction.objectStore("documents").put(metadata);
  if (!inOpfs) transaction.objectStore("documentBlobs").put({ storageId, ciphertext: encrypted.ciphertext });
  await transactionDone(transaction);
  database.close();
  return metadata;
}

async function documentsFor(database, profileId) {
  const transaction = database.transaction("documents", "readonly");
  const records = await requestResult(transaction.objectStore("documents").index("profileId").getAll(profileId));
  await transactionDone(transaction);
  return records.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function listDocuments(profileId) {
  const database = await openDatabase();
  const records = await documentsFor(database, profileId);
  database.close();
  return records;
}

async function encryptedDocumentBytes(database, metadata) {
  if (metadata.storage === "opfs") return readOpfs(metadata.profileId, metadata.path);
  const transaction = database.transaction("documentBlobs", "readonly");
  const record = await requestResult(transaction.objectStore("documentBlobs").get(metadata.storageId));
  await transactionDone(transaction);
  if (!record?.ciphertext) throw new Error(`${metadata.fileName} is missing from local storage.`);
  return new Uint8Array(record.ciphertext);
}

export async function readEncryptedDocument(profileId, key, id) {
  const database = await openDatabase();
  const transaction = database.transaction("documents", "readonly");
  const metadata = await requestResult(transaction.objectStore("documents").get(`${profileId}:${id}`));
  await transactionDone(transaction);
  if (!metadata) {
    database.close();
    throw new Error("That stored document could not be found.");
  }
  const ciphertext = await encryptedDocumentBytes(database, metadata);
  database.close();
  const decrypted = await decryptBytes({ iv: metadata.iv, ciphertext }, key, documentAad(metadata.id));
  const bytes = await decompressBytes(decrypted, metadata.compression);
  return new File([bytes], metadata.fileName, { type: metadata.mimeType, lastModified: new Date(metadata.createdAt).getTime() });
}

async function backupDocuments(profileId) {
  const database = await openDatabase();
  const records = await documentsFor(database, profileId);
  const output = [];
  for (const metadata of records) {
    const ciphertext = await encryptedDocumentBytes(database, metadata);
    const { storageId, profileId: ignoredProfile, storage, ...portable } = metadata;
    output.push({ metadata: portable, ciphertext: bytesToBase64(ciphertext) });
  }
  database.close();
  return output;
}

export async function buildEncryptedBackup(profileId) {
  const { profile, record: vault } = await profileAndVault(profileId);
  const backup = {
    format: "lakshmi-encrypted-backup",
    formatVersion: profile.encryptionVersion === ENCRYPTION_VERSION ? 2 : 1,
    exportedAt: new Date().toISOString(),
    profile: profile.encryptionVersion === ENCRYPTION_VERSION
      ? { name: profile.name, encryptionVersion: ENCRYPTION_VERSION, passphrase: profile.passphrase, schemaVersion: profile.schemaVersion }
      : { name: profile.name, salt: profile.salt, iterations: profile.iterations, schemaVersion: profile.schemaVersion },
    vault: { iv: vault.iv, ciphertext: vault.ciphertext, schemaVersion: vault.schemaVersion, updatedAt: vault.updatedAt },
    documents: await backupDocuments(profileId),
  };
  const filename = `lakshmi-${profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "backup"}-${todayISO()}.lakshmi`;
  return { backup, file: new File([JSON.stringify(backup)], filename, { type: "application/vnd.lakshmi.backup+json" }) };
}

function validateIterations(iterations) {
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 2000000) throw new Error("That backup uses unsupported encryption settings.");
}

export async function importEncryptedBackup(file) {
  if (file.size > 200 * 1024 * 1024) throw new Error("That backup is larger than the 200 MB safety limit.");
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error("That file is not a readable Lakshmi backup.");
  }
  if (backup?.format !== "lakshmi-encrypted-backup" || ![1, 2].includes(backup?.formatVersion) || !backup?.vault?.ciphertext || !backup?.vault?.iv) {
    throw new Error("That file is not a supported encrypted Lakshmi backup.");
  }
  const profileId = uid("profile");
  const now = new Date().toISOString();
  let profile;
  if (backup.formatVersion === 2) {
    const passphrase = backup.profile?.passphrase;
    validateIterations(Number(passphrase?.iterations));
    if (!passphrase?.salt || !passphrase?.iv || !passphrase?.ciphertext) throw new Error("That backup is missing its encrypted recovery information.");
    profile = {
      id: profileId,
      name: `${backup.profile.name || "Restored household"}`,
      encryptionVersion: ENCRYPTION_VERSION,
      passphrase,
      quickUnlock: null,
      createdAt: now,
      lastOpenedAt: null,
      lastSavedAt: backup.vault.updatedAt || now,
      schemaVersion: backup.profile.schemaVersion || SCHEMA_VERSION,
      restoredAt: now,
    };
  } else {
    const iterations = Number(backup.profile?.iterations || KDF_ITERATIONS);
    validateIterations(iterations);
    if (!backup.profile?.salt) throw new Error("That backup is missing its recovery salt.");
    profile = {
      id: profileId,
      name: `${backup.profile.name || "Restored household"}`,
      salt: backup.profile.salt,
      iterations,
      createdAt: now,
      lastOpenedAt: null,
      lastSavedAt: backup.vault.updatedAt || now,
      schemaVersion: backup.profile.schemaVersion || 1,
      restoredAt: now,
    };
  }
  const documents = Array.isArray(backup.documents) ? backup.documents : [];
  const database = await openDatabase();
  const transaction = database.transaction(["profiles", "vaults", "documents", "documentBlobs"], "readwrite");
  transaction.objectStore("profiles").put(profile);
  transaction.objectStore("vaults").put({ profileId, ...backup.vault });
  for (const document of documents) {
    if (!document?.metadata?.id || !document?.ciphertext) continue;
    const storageId = `${profileId}:${document.metadata.id}`;
    transaction.objectStore("documents").put({ ...document.metadata, storageId, profileId, storage: "idb" });
    transaction.objectStore("documentBlobs").put({ storageId, ciphertext: base64ToBytes(document.ciphertext) });
  }
  await transactionDone(transaction);
  database.close();
  return publicProfile(profile);
}

export async function deleteProfile(profileId) {
  const database = await openDatabase();
  const existingSnapshots = await snapshotsFor(database, profileId);
  const documents = await documentsFor(database, profileId);
  const transaction = database.transaction(["profiles", "vaults", "snapshots", "documents", "documentBlobs"], "readwrite");
  transaction.objectStore("profiles").delete(profileId);
  transaction.objectStore("vaults").delete(profileId);
  for (const snapshot of existingSnapshots) transaction.objectStore("snapshots").delete(snapshot.id);
  for (const document of documents) {
    transaction.objectStore("documents").delete(document.storageId);
    transaction.objectStore("documentBlobs").delete(document.storageId);
  }
  await transactionDone(transaction);
  database.close();
  try {
    const root = await navigator.storage?.getDirectory?.();
    const appDirectory = await root?.getDirectoryHandle("lakshmi");
    await appDirectory?.removeEntry(profileId, { recursive: true });
  } catch {}
  if (localStorage.getItem(LAST_PROFILE_KEY) === profileId) localStorage.removeItem(LAST_PROFILE_KEY);
}

export function lastProfileId() {
  return localStorage.getItem(LAST_PROFILE_KEY);
}

export async function requestPersistentStorage() {
  if (!globalThis.navigator?.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}

export async function storageEstimate() {
  if (!globalThis.navigator?.storage?.estimate) return null;
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

