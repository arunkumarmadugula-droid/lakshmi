import assert from "node:assert/strict";
import test from "node:test";
import { File } from "node:buffer";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
globalThis.File = File;
globalThis.localStorage = (() => {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
})();

test("encrypted profiles unlock, reject a wrong passphrase, and restore as isolated backups", async () => {
  const databaseName = "lakshmi-secure-vault";
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  const {
    buildEncryptedBackup,
    configureQuickUnlock,
    createProfile,
    importEncryptedBackup,
    listProfiles,
    saveVault,
    storeEncryptedDocument,
    readEncryptedDocument,
    unlockProfile,
  } = await import("../src/lib/vaultDb.js");

  const created = await createProfile("Secure household", "correct horse battery staple");
  created.vault.settings.theme = "bright";
  created.vault.expenses.push({ id: "private-expense", store: "Private store", date: "2026-07-09", category: "Other", total: 42 });
  await saveVault(created.profile.id, created.key, created.vault, { forceSnapshot: true });

  await assert.rejects(unlockProfile(created.profile.id, "wrong passphrase"), /incorrect|damaged/i);
  const unlocked = await unlockProfile(created.profile.id, "correct horse battery staple");
  assert.equal(unlocked.vault.expenses[0].store, "Private store");

  await configureQuickUnlock(created.profile.id, "correct horse battery staple", "pin", "2486");
  const sourceDocument = new File(["private receipt contents"], "receipt.txt", { type: "text/plain" });
  const documentRecord = await storeEncryptedDocument(created.profile.id, created.key, sourceDocument, { kind: "receipt", date: "2026-07-09", recordId: "private-expense" });
  const document = await readEncryptedDocument(created.profile.id, created.key, documentRecord.id);
  assert.equal(await document.text(), "private receipt contents");

  const rawVault = await new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(databaseName);
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const readRequest = database.transaction("vaults", "readonly").objectStore("vaults").get(created.profile.id);
      readRequest.onerror = () => reject(readRequest.error);
      readRequest.onsuccess = () => {
        database.close();
        resolve(readRequest.result);
      };
    };
  });
  assert.doesNotMatch(JSON.stringify(rawVault), /Private store/);

  const { file } = await buildEncryptedBackup(created.profile.id);
  const portableBackup = JSON.parse(await file.text());
  assert.equal(portableBackup.profile.quickUnlock, undefined);
  assert.equal(portableBackup.profile.theme, "bright");
  assert.equal(portableBackup.documents.length, 1);
  const restoredProfile = await importEncryptedBackup(file);
  const profiles = await listProfiles();
  assert.equal(profiles.length, 2);
  assert.notEqual(restoredProfile.id, created.profile.id);
  const restored = await unlockProfile(restoredProfile.id, "correct horse battery staple");
  assert.equal(restored.vault.expenses[0].id, "private-expense");
  assert.equal(restoredProfile.quickUnlock, null);
  assert.equal(restoredProfile.theme, "bright");

  const unsafeBackup = new File([JSON.stringify({
    format: "lakshmi-encrypted-backup",
    formatVersion: 1,
    profile: { name: "Unsafe", salt: "AA==", iterations: 999999999 },
    vault: { iv: "AA==", ciphertext: "AA==" },
  })], "unsafe.lakshmi");
  await assert.rejects(importEncryptedBackup(unsafeBackup), /unsupported encryption settings/i);
});
