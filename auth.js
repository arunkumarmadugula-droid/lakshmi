(() => {
  "use strict";

  const AUTH_KEY = "vidya:vault:auth:v1";
  const DATA_KEY = "vidya:vault:data:v1";
  const LEGACY_KEY = "vidya:os:v1";
  const DEFAULT_ITERATIONS = 310000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let rawKey = null;
  let vaultKey = null;
  let stateCache = null;
  let writeQueue = Promise.resolve();
  let hiddenAt = 0;
  let lastActivity = Date.now();
  let resolveUnlocked;
  const unlocked = new Promise(resolve => { resolveUnlocked = resolve; });

  const $ = selector => document.querySelector(selector);
  const randomBytes = length => crypto.getRandomValues(new Uint8Array(length));
  const toBase64 = value => {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };
  const fromBase64 = value => {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  };
  const normalizeRecovery = value => String(value || "").toUpperCase().replace(/[^A-Z2-9]/g, "");

  function readAuth() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); }
    catch { return null; }
  }

  function writeAuth(auth) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  }

  async function importVaultKey(bytes) {
    rawKey = new Uint8Array(bytes);
    vaultKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  async function deriveKey(secret, salt, iterations = DEFAULT_ITERATIONS) {
    const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function wrapRawKey(secret, bytes, iterations = DEFAULT_ITERATIONS) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await deriveKey(secret, salt, iterations);
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
    return { salt: toBase64(salt), iv: toBase64(iv), cipher: toBase64(cipher), iterations };
  }

  async function unwrapRawKey(secret, wrapper) {
    const iterations = Number(wrapper.iterations || DEFAULT_ITERATIONS);
    if (!Number.isFinite(iterations) || iterations < 100000 || iterations > 1000000) throw new Error("This backup uses unsupported password-protection settings");
    const key = await deriveKey(secret, fromBase64(wrapper.salt), iterations);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(wrapper.iv) }, key, fromBase64(wrapper.cipher));
    return new Uint8Array(plain);
  }

  async function encryptWithKey(value, key = vaultKey) {
    if (!key) throw new Error("The private vault is locked");
    const iv = randomBytes(12);
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(value)));
    return { version: 1, iv: toBase64(iv), cipher: toBase64(cipher) };
  }

  async function decryptWithKey(payload, key = vaultKey) {
    if (!key) throw new Error("The private vault is locked");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(payload.iv) }, key, fromBase64(payload.cipher));
    return JSON.parse(decoder.decode(plain));
  }

  async function hydrateState() {
    const stored = localStorage.getItem(DATA_KEY);
    stateCache = stored ? await decryptWithKey(JSON.parse(stored)) : null;
  }

  async function platformAuthenticatorAvailable() {
    if (!window.isSecureContext || !window.PublicKeyCredential) return false;
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return true;
    try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
    catch { return false; }
  }

  async function enrollDevice() {
    const auth = readAuth();
    if (!auth || !vaultKey || !rawKey) throw new Error("Unlock the vault with your password first");
    if (!(await platformAuthenticatorAvailable())) throw new Error("Device unlock needs Safari/Chrome on HTTPS and a supported device");
    const prfSalt = randomBytes(32);
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: "Vidya" },
        user: {
          id: auth.userId ? fromBase64(auth.userId) : randomBytes(32),
          name: `vidya-${String(auth.owner || "owner").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          displayName: auth.owner || "Vidya owner"
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
        timeout: 60000,
        attestation: "none",
        extensions: { prf: { eval: { first: prfSalt } } }
      }
    });
    const results = credential?.getClientExtensionResults?.().prf?.results?.first;
    if (!results) throw new Error("This browser verified the device but cannot yet use it to unlock encrypted data. Keep password unlock enabled.");
    const deviceKey = await crypto.subtle.importKey("raw", results, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    const iv = randomBytes(12);
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, deviceKey, rawKey);
    auth.userId ||= toBase64(randomBytes(32));
    auth.device = { credentialId: toBase64(credential.rawId), prfSalt: toBase64(prfSalt), iv: toBase64(iv), cipher: toBase64(cipher), enrolledAt: new Date().toISOString() };
    writeAuth(auth);
    return true;
  }

  async function unlockWithDevice() {
    const auth = readAuth();
    if (!auth?.device) throw new Error("Device unlock has not been set up");
    if (!(await platformAuthenticatorAvailable())) throw new Error("Device unlock is unavailable here. Use your password.");
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: "public-key", id: fromBase64(auth.device.credentialId) }],
        userVerification: "required",
        timeout: 60000,
        extensions: { prf: { eval: { first: fromBase64(auth.device.prfSalt) } } }
      }
    });
    const results = assertion?.getClientExtensionResults?.().prf?.results?.first;
    if (!results) throw new Error("This browser did not return the encrypted-vault unlock secret. Use your password.");
    const deviceKey = await crypto.subtle.importKey("raw", results, { name: "AES-GCM" }, false, ["decrypt"]);
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(auth.device.iv) }, deviceKey, fromBase64(auth.device.cipher));
    await importVaultKey(bytes);
    await hydrateState();
  }

  function readableRecoveryKey() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = randomBytes(24);
    const characters = [...bytes].map(byte => alphabet[byte % alphabet.length]).join("");
    return characters.match(/.{1,4}/g).join("-");
  }

  async function createVault(owner, password, requestDeviceUnlock) {
    const bytes = randomBytes(32);
    await importVaultKey(bytes);
    const recoveryKey = readableRecoveryKey();
    const auth = {
      version: 1,
      owner: owner.trim() || "Owner",
      userId: toBase64(randomBytes(32)),
      createdAt: new Date().toISOString(),
      autoLockMinutes: 5,
      password: await wrapRawKey(password, bytes),
      recovery: await wrapRawKey(normalizeRecovery(recoveryKey), bytes)
    };
    writeAuth(auth);
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      try { stateCache = JSON.parse(legacy); }
      catch { stateCache = null; }
      localStorage.removeItem(LEGACY_KEY);
    }
    if (stateCache) {
      const encrypted = await encryptWithKey(stateCache);
      localStorage.setItem(DATA_KEY, JSON.stringify(encrypted));
    }
    let deviceMessage = "";
    if (requestDeviceUnlock) {
      try { await enrollDevice(); deviceMessage = "Device unlock is ready."; }
      catch (error) { deviceMessage = error.message; }
    }
    return { recoveryKey, deviceMessage };
  }

  async function unlockWithPassword(password) {
    const auth = readAuth();
    if (!auth?.password) throw new Error("No local vault was found");
    const bytes = await unwrapRawKey(password, auth.password);
    await importVaultKey(bytes);
    await hydrateState();
  }

  async function unlockWithRecovery(recoveryKey) {
    const auth = readAuth();
    if (!auth?.recovery) throw new Error("No recovery key is available");
    const bytes = await unwrapRawKey(normalizeRecovery(recoveryKey), auth.recovery);
    await importVaultKey(bytes);
    await hydrateState();
  }

  async function changePassword(currentPassword, newPassword) {
    const auth = readAuth();
    const check = await unwrapRawKey(currentPassword, auth.password);
    if (toBase64(check) !== toBase64(rawKey)) throw new Error("Current password is incorrect");
    auth.password = await wrapRawKey(newPassword, rawKey);
    auth.passwordChangedAt = new Date().toISOString();
    writeAuth(auth);
  }

  function setState(value) {
    stateCache = structuredClone(value);
    writeQueue = writeQueue.then(async () => {
      if (!vaultKey) return;
      const encrypted = await encryptWithKey(stateCache);
      localStorage.setItem(DATA_KEY, JSON.stringify(encrypted));
    }).catch(error => console.error("Vault write failed", error));
  }

  async function createBackup(data) {
    const auth = readAuth();
    const payload = await encryptWithKey(data);
    return {
      kind: "vidya-encrypted-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      owner: auth.owner,
      password: auth.password,
      recovery: auth.recovery,
      payload
    };
  }

  async function openBackup(backup, password) {
    if (backup?.kind !== "vidya-encrypted-backup" || !backup.password || !backup.payload) throw new Error("This is not a Vidya encrypted backup");
    const bytes = await unwrapRawKey(password, backup.password);
    const key = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["decrypt"]);
    return decryptWithKey(backup.payload, key);
  }

  function getStatus() {
    const auth = readAuth();
    return {
      configured: Boolean(auth),
      owner: auth?.owner || "",
      deviceUnlock: Boolean(auth?.device),
      secureContext: window.isSecureContext,
      autoLockMinutes: auth?.autoLockMinutes || 5,
      encrypted: Boolean(auth && localStorage.getItem(DATA_KEY))
    };
  }

  function setAutoLock(minutes) {
    const auth = readAuth();
    if (!auth) return;
    auth.autoLockMinutes = Math.max(1, Math.min(60, Number(minutes) || 5));
    writeAuth(auth);
    lastActivity = Date.now();
  }

  async function lock() {
    await writeQueue;
    rawKey?.fill(0);
    rawKey = null;
    vaultKey = null;
    stateCache = null;
    location.reload();
  }

  function friendlyError(error) {
    if (error?.name === "NotAllowedError") return "Device verification was cancelled. Use your password whenever you prefer.";
    if (error?.name === "InvalidStateError") return "That device credential is already registered.";
    if (error?.name === "OperationError" || error?.name === "DataError") return "The password or recovery key did not match this vault.";
    return error?.message || "Vidya could not unlock the private vault.";
  }

  function revealApp() {
    document.documentElement.dataset.vault = "unlocked";
    $("#vaultGate").hidden = true;
    $("#appShell").hidden = false;
    lastActivity = Date.now();
    resolveUnlocked();
  }

  function showPanel(id) {
    ["vaultSetupPanel", "vaultUnlockPanel", "vaultRecoveryPanel", "vaultKeyPanel"].forEach(panelId => {
      const panel = document.getElementById(panelId);
      if (panel) panel.hidden = panelId !== id;
    });
  }

  function setGateMessage(message, type = "") {
    const target = $("#vaultMessage");
    target.textContent = message;
    target.dataset.type = type;
  }

  async function resetVault() {
    const confirmation = prompt("This permanently removes Vidya data stored in this browser. Type RESET to continue.");
    if (confirmation !== "RESET") return;
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(DATA_KEY);
    localStorage.removeItem(LEGACY_KEY);
    await new Promise(resolve => {
      const request = indexedDB.deleteDatabase("vidya-os");
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
    location.reload();
  }

  function setupGate() {
    document.documentElement.dataset.vault = "locked";
    const auth = readAuth();
    if (auth) {
      $("#vaultOwner").textContent = auth.owner || "Owner";
      showPanel("vaultUnlockPanel");
      platformAuthenticatorAvailable().then(available => {
        $("#deviceUnlockButton").hidden = !(available && auth.device);
        $("#deviceUnlockHint").hidden = !(available && auth.device);
      });
    } else showPanel("vaultSetupPanel");

    $("#vaultSetupForm").addEventListener("submit", async event => {
      event.preventDefault();
      const owner = $("#vaultNameInput").value.trim();
      const password = $("#vaultPasswordCreate").value;
      const confirmation = $("#vaultPasswordConfirm").value;
      if (password.length < 12) { setGateMessage("Use at least 12 characters for your vault password.", "error"); return; }
      if (password !== confirmation) { setGateMessage("The two passwords do not match.", "error"); return; }
      const button = $("#createVaultButton");
      button.disabled = true; button.textContent = "Encrypting your vault…";
      try {
        const result = await createVault(owner, password, $("#setupDeviceUnlock").checked);
        $("#recoveryKeyValue").textContent = result.recoveryKey;
        $("#deviceSetupResult").textContent = result.deviceMessage;
        showPanel("vaultKeyPanel");
        setGateMessage("Your private vault is ready.", "success");
      } catch (error) {
        setGateMessage(friendlyError(error), "error");
        button.disabled = false; button.textContent = "Create encrypted vault";
      }
    });

    $("#vaultUnlockForm").addEventListener("submit", async event => {
      event.preventDefault();
      const button = $("#passwordUnlockButton");
      button.disabled = true; button.textContent = "Unlocking…";
      try { await unlockWithPassword($("#vaultPasswordInput").value); revealApp(); }
      catch (error) { setGateMessage(friendlyError(error), "error"); button.disabled = false; button.textContent = "Unlock Vidya"; }
    });

    $("#deviceUnlockButton").addEventListener("click", async () => {
      const button = $("#deviceUnlockButton");
      button.disabled = true; button.textContent = "Check your device…";
      try { await unlockWithDevice(); revealApp(); }
      catch (error) { setGateMessage(friendlyError(error), "error"); button.disabled = false; button.textContent = "Unlock with this device"; }
    });

    $("#showRecoveryButton").addEventListener("click", () => { showPanel("vaultRecoveryPanel"); setGateMessage("Use the recovery key you saved during setup."); });
    $("#backToPasswordButton").addEventListener("click", () => { showPanel("vaultUnlockPanel"); setGateMessage(""); });
    $("#vaultRecoveryForm").addEventListener("submit", async event => {
      event.preventDefault();
      const button = $("#recoveryUnlockButton");
      button.disabled = true; button.textContent = "Recovering…";
      try { await unlockWithRecovery($("#vaultRecoveryInput").value); revealApp(); }
      catch (error) { setGateMessage(friendlyError(error), "error"); button.disabled = false; button.textContent = "Unlock with recovery key"; }
    });

    $("#copyRecoveryButton").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("#recoveryKeyValue").textContent); setGateMessage("Recovery key copied. Store it somewhere private.", "success"); }
      catch { setGateMessage("Copy the recovery key manually and keep it private."); }
    });
    $("#recoverySavedCheck").addEventListener("change", event => { $("#enterVidyaButton").disabled = !event.target.checked; });
    $("#enterVidyaButton").addEventListener("click", revealApp);
    $("#resetVaultButton").addEventListener("click", resetVault);
  }

  ["pointerdown", "keydown", "touchstart"].forEach(name => document.addEventListener(name, () => { lastActivity = Date.now(); }, { passive: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      document.documentElement.dataset.vaultBackground = "true";
    } else if (hiddenAt && Date.now() - hiddenAt > (readAuth()?.autoLockMinutes || 5) * 60000) lock();
    else delete document.documentElement.dataset.vaultBackground;
  });
  setInterval(() => {
    if (vaultKey && !document.hidden && Date.now() - lastActivity > (readAuth()?.autoLockMinutes || 5) * 60000) lock();
  }, 30000);

  window.VidyaVault = Object.freeze({
    whenUnlocked: () => unlocked,
    getState: () => stateCache,
    setState,
    encryptJSON: value => encryptWithKey(value),
    decryptJSON: value => decryptWithKey(value),
    enrollDevice,
    changePassword,
    createBackup,
    openBackup,
    getStatus,
    setAutoLock,
    lock
  });

  setupGate();
})();
