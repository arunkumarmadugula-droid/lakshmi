import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddTab from "../tabs/AddTab.jsx";
import BoardTab from "../tabs/BoardTab.jsx";
import BudgetTab from "../tabs/BudgetTab.jsx";
import FuelTab from "../tabs/FuelTab.jsx";
import LedgerTab from "../tabs/LedgerTab.jsx";
import PricesTab from "../tabs/PricesTab.jsx";
import { applyDueSchedules, calendarEvents } from "../lib/finance.js";
import { currentMonth, downloadBlob, monthLabel, shiftMonth, todayISO } from "../lib/format.js";
import {
  buildEncryptedBackup,
  configureQuickUnlock,
  deleteProfile,
  importEncryptedBackup,
  listLocalSnapshots,
  listDocuments,
  readEncryptedDocument,
  requestPersistentStorage,
  restoreLocalSnapshot,
  saveVault,
  storageEstimate,
  verifyPassphrase,
} from "../lib/vaultDb.js";
import { deviceUnlockAvailable, deviceUnlockLabel } from "../lib/deviceAuth.js";
import { validateApiKey } from "../lib/openai.js";
import { Button, CardHeader, Field, FileButton, Icon, IconButton, Input, LotusLogo, Modal, Segmented, Select } from "./ui.jsx";

const TABS = [
  ["add", "Add", "camera"],
  ["board", "Board", "board"],
  ["ledger", "Ledger", "ledger"],
  ["prices", "Prices", "prices"],
  ["budget", "Budget", "budget"],
  ["fuel", "Fuel", "fuel"],
];

export default function Shell({ session, onLock, onProfileChange }) {
  const [vault, setVault] = useState(session.vault);
  const vaultRef = useRef(session.vault);
  const saveChain = useRef(Promise.resolve());
  const [tab, setTab] = useState("add");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const [saveError, setSaveError] = useState("");
  const toastTimer = useRef(null);

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2800);
  }, []);

  useEffect(() => {
    if (session.notice) notify(session.notice);
  }, [notify, session.notice]);

  const persist = useCallback((nextOrUpdater, options = {}) => {
    const requested = typeof nextOrUpdater === "function" ? nextOrUpdater(vaultRef.current) : nextOrUpdater;
    const next = applyDueSchedules(requested).vault;
    vaultRef.current = next;
    setVault(next);
    setSaveError("");
    const pending = saveChain.current
      .catch(() => {})
      .then(() => saveVault(session.profile.id, session.key, next, options));
    saveChain.current = pending.catch((reason) => {
        setSaveError(reason.message || "Local save failed.");
        return vaultRef.current;
      });
    return pending;
  }, [session]);

  useEffect(() => {
    requestPersistentStorage().then((persistent) => {
      if (vaultRef.current.settings.storagePersistent === persistent) return;
      persist((current) => ({ ...current, settings: { ...current.settings, storagePersistent: persistent } }));
    }).catch(() => {});
  }, [persist]);

  useEffect(() => {
    const refreshSchedules = () => {
      const scheduled = applyDueSchedules(vaultRef.current);
      if (scheduled.changed) persist(scheduled.vault);
    };
    const handleVisibility = () => {
      if (!document.hidden) refreshSchedules();
    };
    const interval = window.setInterval(refreshSchedules, 15 * 60 * 1000);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", refreshSchedules);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", refreshSchedules);
    };
  }, [persist]);

  useEffect(() => {
    let timer;
    let hiddenAt = null;
    const timeout = Math.max(1, Number(vaultRef.current.settings.autoLockMinutes) || 5) * 60000;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onLock, timeout);
    };
    const activity = () => schedule();
    const visibility = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt >= timeout) onLock();
      else schedule();
    };
    for (const name of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(name, activity, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    schedule();
    return () => {
      window.clearTimeout(timer);
      for (const name of ["pointerdown", "keydown", "touchstart"]) window.removeEventListener(name, activity);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [onLock, vault.settings.autoLockMinutes]);

  const theme = vault.settings.theme || "default";
  const common = useMemo(() => ({ vault, persist, notify, openModal: setModal, profileId: session.profile.id, keyObject: session.key }), [vault, persist, notify, session]);
  const views = {
    add: <AddTab {...common} />,
    board: <BoardTab {...common} />,
    ledger: <LedgerTab {...common} />,
    prices: <PricesTab {...common} />,
    budget: <BudgetTab {...common} />,
    fuel: <FuelTab {...common} />,
  };

  return (
    <main className={`app-stage theme-${theme}`}>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <LotusLogo />
            <div className="brand-copy"><span className="brand-name">Lakshmi</span><span className="tagline">Bills to wealth</span></div>
          </div>
          <div className="top-actions">
            <IconButton icon="calendar" label="Cash-flow calendar" onClick={() => setModal("calendar")} />
            <IconButton icon="settings" label="Settings" onClick={() => setModal("settings")} />
          </div>
        </header>

        <section className="screen" aria-live="polite">
          {saveError && <div className="security-banner"><span className="icon-box"><Icon name="database" /></span><div><strong>Save needs attention</strong><div className="helper">{saveError}</div></div></div>}
          {views[tab]}
        </section>

        <nav className="bottom-nav" aria-label="Main navigation">
          {TABS.map(([value, label, icon]) => (
            <button type="button" key={value} aria-current={tab === value ? "page" : undefined} onClick={() => { setTab(value); setModal(null); }}>
              <span className="nav-icon"><Icon name={icon} /></span>
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>

        {modal === "calendar" && <CalendarModal vault={vault} onClose={() => setModal(null)} />}
        {modal === "settings" && (
          <SettingsModal
            vault={vault}
            profile={session.profile}
            profileId={session.profile.id}
            keyObject={session.key}
            persist={persist}
            notify={notify}
            onLock={onLock}
            onProfileChange={onProfileChange}
            onClose={() => setModal(null)}
          />
        )}
        {typeof modal === "object" && modal?.content}
        <div className="toast-host">{toast && <div className="toast">{toast}</div>}</div>
      </div>
    </main>
  );
}

function CalendarModal({ vault, onClose }) {
  const [month, setMonth] = useState(currentMonth());
  const [mode, setMode] = useState("month");
  const events = calendarEvents(vault, month);
  const [year, value] = month.split("-").map(Number);
  const firstDay = new Date(year, value - 1, 1).getDay();
  const dayCount = new Date(year, value, 0).getDate();
  const today = todayISO();
  return (
    <Modal label="Cash-flow calendar" title={monthLabel(month)} onClose={onClose}>
      <div className="form-stack">
        <div className="month-nav">
          <IconButton icon="left" label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} />
          <div />
          <IconButton icon="right" label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} />
          <span />
        </div>
        <Segmented columns={2} label="Calendar view" value={mode} onChange={setMode} options={[{ value: "month", label: "Month" }, { value: "list", label: "List" }]} />
        {mode === "month" ? (
          <>
            <div className="calendar-week">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
            <div className="calendar-grid">
              {Array.from({ length: firstDay }, (_, index) => <span key={`blank-${index}`} className="calendar-day" />)}
              {Array.from({ length: dayCount }, (_, index) => {
                const day = index + 1;
                const date = `${month}-${String(day).padStart(2, "0")}`;
                const types = [...new Set(events.filter((event) => event.date === date).map((event) => event.type === "statement" ? "card" : event.type))];
                const className = types.length > 1 ? "mixed" : types[0] || "";
                return <span key={date} className={`calendar-day ${className} ${today === date ? "today" : ""}`}>{day}</span>;
              })}
            </div>
            <div className="chart-key"><span><i className="swatch" style={{ background: "var(--inflow)" }} />Inflow</span><span><i className="swatch" style={{ background: "var(--outflow)" }} />Outflow / card</span></div>
          </>
        ) : (
          <div>{events.length ? events.map((event) => (
            <div className="row with-icon" key={event.id}>
              <span className="icon-box" style={{ color: event.type === "in" ? "var(--inflow)" : "var(--outflow)" }}><Icon name={event.type === "in" ? "arrow-down-left" : event.type === "card" || event.type === "statement" ? "card" : "calendar"} /></span>
              <span>{event.name}<br /><span className="helper">{event.date}{event.projected ? " - projected" : event.paid ? " - paid" : ""}</span></span>
              <strong className={`money ${event.type === "in" ? "text-in" : "text-out"}`}>{event.amount == null ? "--" : `$${Number(event.amount).toFixed(0)}`}</strong>
            </div>
          )) : <div className="helper">No scheduled events for this month.</div>}</div>
        )}
      </div>
    </Modal>
  );
}

function SettingsModal({ vault, profile, profileId, keyObject, persist, notify, onLock, onProfileChange, onClose }) {
  const [name, setName] = useState(vault.profile.name);
  const [snapshots, setSnapshots] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const [passphrase, setPassphrase] = useState("");
  const [protectedError, setProtectedError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [unlockMethod, setUnlockMethod] = useState(profile.quickUnlock?.type || "device");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [storageMode, setStorageMode] = useState(vault.settings.backupMode || "device");
  const [deleteName, setDeleteName] = useState("");
  const [deviceAvailable, setDeviceAvailable] = useState(false);

  useEffect(() => {
    listLocalSnapshots(profileId).then(setSnapshots).catch(() => {});
    listDocuments(profileId).then(setDocuments).catch(() => {});
    storageEstimate().then(setEstimate).catch(() => {});
    deviceUnlockAvailable().then(setDeviceAvailable);
  }, [profileId]);

  const usage = vault.ai?.usage || [];
  const currentMonth = todayISO().slice(0, 7);
  const monthUsage = usage.filter((item) => String(item.createdAt).slice(0, 7) === currentMonth);
  const sumUsage = (items, key) => items.reduce((sum, item) => sum + Number(item[key] || 0), 0);

  function openProtected(nextView) {
    setView(nextView);
    setPassphrase("");
    setProtectedError("");
    setApiKey("");
    setPin("");
    setConfirmPin("");
  }

  async function exportBackup() {
    setBusy(true);
    try {
      const updated = { ...vault, settings: { ...vault.settings, lastExternalBackupAt: new Date().toISOString() } };
      await persist(updated, { forceSnapshot: true });
      const { file } = await buildEncryptedBackup(profileId);
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: "Lakshmi encrypted backup", text: "Save this encrypted Lakshmi backup to Files, iCloud Drive, or Google Drive.", files: [file] });
      } else downloadBlob(file, file.name);
      notify("Encrypted backup created with stored documents.");
    } catch (reason) {
      if (reason?.name !== "AbortError") notify(reason.message || "Backup could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function importBackup(file) {
    setBusy(true);
    try {
      await importEncryptedBackup(file);
      notify("Backup imported as a separate local profile.");
      await onProfileChange();
    } catch (reason) {
      notify(reason.message || "Backup could not be imported.");
    } finally {
      setBusy(false);
    }
  }

  async function openDocument(document) {
    setBusy(true);
    try {
      const file = await readEncryptedDocument(profileId, keyObject, document.id);
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: document.fileName, files: [file] });
      } else downloadBlob(file, file.name);
    } catch (reason) {
      if (reason?.name !== "AbortError") notify(reason.message || "The stored document could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function saveApiKey(remove = false) {
    setBusy(true);
    setProtectedError("");
    try {
      await verifyPassphrase(profileId, passphrase);
      const nextKey = remove ? "" : apiKey.trim();
      if (!remove) await validateApiKey(nextKey, vault.ai?.model);
      await persist({ ...vault, ai: { ...vault.ai, apiKey: nextKey, consentAt: nextKey ? (vault.ai?.consentAt || new Date().toISOString()) : null } });
      notify(remove ? "OpenAI API key removed." : "OpenAI API key validated and protected.");
      setView(null);
    } catch (reason) {
      setProtectedError(reason.message || "The protected change failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveQuickUnlock() {
    setBusy(true);
    setProtectedError("");
    try {
      if (unlockMethod === "pin" && (pin !== confirmPin || !/^\d{4}$/.test(pin))) throw new Error("Enter and confirm the same four-digit PIN.");
      await configureQuickUnlock(profileId, passphrase, unlockMethod, pin);
      notify(unlockMethod === "device" ? "Device unlock configured." : unlockMethod === "pin" ? "Quick PIN configured." : "Quick unlock removed.");
      await onProfileChange();
    } catch (reason) {
      if (reason?.name !== "NotAllowedError" && reason?.name !== "AbortError") setProtectedError(reason.message || "Quick unlock could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveStorageMode() {
    setBusy(true);
    setProtectedError("");
    try {
      await verifyPassphrase(profileId, passphrase);
      await persist({ ...vault, settings: { ...vault.settings, backupMode: storageMode } });
      notify("Backup preference updated.");
      setView(null);
    } catch (reason) {
      setProtectedError(reason.message || "Backup preference could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreSnapshot(id) {
    setBusy(true);
    setProtectedError("");
    try {
      await verifyPassphrase(profileId, passphrase);
      const restored = await restoreLocalSnapshot(profileId, id, keyObject);
      await persist(restored, { forceSnapshot: true });
      notify("Local snapshot restored.");
      window.location.reload();
    } catch (reason) {
      setProtectedError(reason.message || "Snapshot restore failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeProfile() {
    setBusy(true);
    setProtectedError("");
    try {
      await verifyPassphrase(profileId, passphrase);
      if (deleteName !== vault.profile.name) throw new Error("Type the profile name exactly to confirm deletion.");
      await deleteProfile(profileId);
      await onProfileChange();
    } catch (reason) {
      setProtectedError(reason.message || "Profile deletion failed.");
    } finally {
      setBusy(false);
    }
  }

  if (view === "api") return (
    <Modal label="Protected settings" title="OpenAI API key" onClose={() => setView(null)}>
      <div className="form-stack">
        <div className="security-banner"><span className="icon-box"><Icon name="key" /></span><div><strong>{vault.ai?.apiKey ? `Saved key ending ${vault.ai.apiKey.slice(-4)}` : "No key saved"}</strong><div className="helper">The full key is never shown after saving.</div></div></div>
        <Field label="New API key"><Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value.trim())} autoComplete="off" placeholder="sk-..." /></Field>
        <Field label="Recovery passphrase"><Input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="current-password" /></Field>
        {protectedError && <div className="error-text">{protectedError}</div>}
        <div className="button-row"><Button kind="primary" disabled={busy || !apiKey || !passphrase} onClick={() => saveApiKey(false)}><Icon name="check" />Validate and save</Button>{vault.ai?.apiKey && <Button kind="danger" disabled={busy || !passphrase} onClick={() => saveApiKey(true)}><Icon name="trash" />Remove</Button>}</div>
      </div>
    </Modal>
  );

  if (view === "unlock") return (
    <Modal label="Protected settings" title="Everyday unlock" onClose={() => setView(null)}>
      <div className="form-stack">
        <Segmented label="Unlock method" value={unlockMethod} onChange={setUnlockMethod} options={[...(deviceAvailable ? [{ value: "device", label: deviceUnlockLabel() }] : []), { value: "pin", label: "4-digit PIN" }, { value: "passphrase", label: "Passphrase only" }]} />
        {unlockMethod === "pin" && <div className="field-grid"><Field label="New PIN"><Input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} /></Field><Field label="Confirm PIN"><Input type="password" inputMode="numeric" maxLength={4} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 4))} /></Field></div>}
        <Field label="Recovery passphrase"><Input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="current-password" /></Field>
        {protectedError && <div className="error-text">{protectedError}</div>}
        <Button kind="primary" disabled={busy || !passphrase} onClick={saveQuickUnlock}><Icon name={unlockMethod === "device" ? "fingerprint" : "lock"} />Save and verify</Button>
      </div>
    </Modal>
  );

  if (view === "storage") return (
    <Modal label="Protected settings" title="Backup preference" onClose={() => setView(null)}>
      <div className="form-stack">
        <Segmented columns={2} label="Backup preference" value={storageMode} onChange={setStorageMode} options={[{ value: "device", label: "This device" }, { value: "cloud", label: "Files / cloud" }]} />
        <div className="privacy-note">The encrypted live vault remains in private device storage. Files / cloud controls reminders and the destination offered by the system share sheet.</div>
        <Field label="Recovery passphrase"><Input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="current-password" /></Field>
        {protectedError && <div className="error-text">{protectedError}</div>}
        <Button kind="primary" disabled={busy || !passphrase} onClick={saveStorageMode}><Icon name="save" />Save preference</Button>
      </div>
    </Modal>
  );

  if (typeof view === "object" && view?.type === "restore") return (
    <Modal label="Protected restore" title="Restore local snapshot" onClose={() => setView(null)}>
      <div className="form-stack">
        <div className="security-banner"><span className="icon-box"><Icon name="restore" /></span><div><strong>Replace current records</strong><div className="helper">A safety snapshot is created before restoration.</div></div></div>
        <Field label="Recovery passphrase"><Input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="current-password" /></Field>
        {protectedError && <div className="error-text">{protectedError}</div>}
        <Button kind="primary" disabled={busy || !passphrase} onClick={() => restoreSnapshot(view.id)}><Icon name="restore" />Restore snapshot</Button>
      </div>
    </Modal>
  );

  if (view === "delete") return (
    <Modal label="Danger zone" title="Delete local profile" onClose={() => setView(null)}>
      <div className="form-stack">
        <div className="security-banner danger-banner"><span className="icon-box"><Icon name="trash" /></span><div><strong>This cannot be undone</strong><div className="helper">Delete removes records, encrypted documents, snapshots, and quick unlock from this device.</div></div></div>
        <Field label={`Type ${vault.profile.name}`}><Input value={deleteName} onChange={(event) => setDeleteName(event.target.value)} /></Field>
        <Field label="Recovery passphrase"><Input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="current-password" /></Field>
        {protectedError && <div className="error-text">{protectedError}</div>}
        <Button kind="danger" disabled={busy || !passphrase || deleteName !== vault.profile.name} onClick={removeProfile}><Icon name="trash" />Delete permanently</Button>
      </div>
    </Modal>
  );

  return (
    <Modal label="Settings" title="Appearance and privacy" onClose={onClose}>
      <div className="form-stack">
        <div><div className="label" style={{ marginBottom: 8 }}>Theme</div><div className="theme-options">{[
          ["default", "Black and white", ["#121212", "#2d2d2d", "#f4f2ec"]],
          ["lotus", "Lotus light", ["#f3f1ec", "#ffffff", "#d8a443"]],
          ["forest", "Forest wealth", ["#101513", "#25302b", "#83cfac"]],
        ].map(([value, label, colors]) => <button type="button" key={value} className="theme-choice" aria-pressed={vault.settings.theme === value} onClick={() => persist({ ...vault, settings: { ...vault.settings, theme: value } })}><span className="theme-preview">{colors.map((color) => <i key={color} style={{ background: color }} />)}</span>{label}</button>)}</div></div>

        <div className="security-banner"><span className="icon-box"><Icon name="shield" /></span><div><strong>Encrypted local vault</strong><div className="helper">AES-GCM with a random master key. Recovery and quick-unlock wrappers are stored separately.</div></div></div>
        <Field label="Profile name"><Input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => name.trim() && name !== vault.profile.name && persist({ ...vault, profile: { ...vault.profile, name: name.trim() } })} /></Field>
        <Field label="Automatic lock"><Select value={vault.settings.autoLockMinutes} onChange={(event) => persist({ ...vault, settings: { ...vault.settings, autoLockMinutes: Number(event.target.value) } })}><option value="1">After 1 minute</option><option value="5">After 5 minutes</option><option value="15">After 15 minutes</option><option value="30">After 30 minutes</option></Select></Field>

        <div className="row with-icon"><span className="icon-box"><Icon name="drive" /></span><span>Private device storage<br /><span className="helper">{vault.settings.storagePersistent ? "Persistent mode granted" : "Best-effort mode"}{estimate?.usage ? ` - ${(estimate.usage / 1048576).toFixed(1)} MB used` : ""} - {documents.length} document{documents.length === 1 ? "" : "s"}</span></span><span className={`status-pill ${vault.settings.storagePersistent ? "good" : "neutral"}`}>{vault.settings.storagePersistent ? "Protected" : "Local"}</span></div>

        <div className="card-header no-margin"><div><div className="label">Encrypted backups</div><div className="helper">Includes records and compressed document archive</div></div></div>
        <div className="button-row"><Button kind="primary" disabled={busy} onClick={exportBackup}><Icon name="share" />Back up</Button><FileButton accept=".lakshmi,application/json" onFile={importBackup} disabled={busy}><Icon name="restore" />Import</FileButton></div>
        <div className="privacy-note">iOS requires confirmation in the share sheet before writing to iCloud Drive, Google Drive, or Files.</div>

        <details className="settings-section"><summary><span><Icon name="archive" />Stored documents ({documents.length})</span><Icon name="chevron-down" /></summary><div className="settings-section-body">{documents.length ? documents.map((document) => <div className="row with-icon" key={document.id}><span className="icon-box"><Icon name="file" /></span><span className="truncate"><strong>{document.fileName}</strong><br /><span className="helper">{document.date} - {document.kind} - {(document.storedBytes / 1024).toFixed(0)} KB encrypted</span></span><Button compact disabled={busy} onClick={() => openDocument(document)}><Icon name="share" />Open</Button></div>) : <div className="helper">Saved photos and PDFs will appear here after they enter the ledger.</div>}</div></details>

        {snapshots.length > 0 && <div><div className="label" style={{ marginBottom: 4 }}>Local snapshots</div>{snapshots.slice(0, 4).map((snapshot) => <div className="row" key={snapshot.id}><span>{new Date(snapshot.createdAt).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}<br /><span className="helper">Encrypted on this device</span></span><Button kind="ghost" compact disabled={busy} onClick={() => openProtected({ type: "restore", id: snapshot.id })}><Icon name="restore" />Restore</Button></div>)}</div>}

        <details className="settings-section"><summary><span><Icon name="ai" />AI usage and estimated cost</span><Icon name="chevron-down" /></summary><div className="settings-section-body"><div className="row"><span>This month</span><strong className="money">${sumUsage(monthUsage, "estimatedUsd").toFixed(4)} USD</strong></div><div className="row"><span>Lifetime estimate</span><strong className="money">${sumUsage(usage, "estimatedUsd").toFixed(4)} USD</strong></div><div className="row"><span>Tokens processed</span><strong className="money">{(sumUsage(usage, "inputTokens") + sumUsage(usage, "outputTokens")).toLocaleString("en-CA")}</strong></div><div className="privacy-note">Estimates use the bundled model price table. The OpenAI billing dashboard remains the final source of truth.</div></div></details>

        <details className="settings-section protected-zone"><summary><span><Icon name="shield" />Protected settings</span><Icon name="chevron-down" /></summary><div className="settings-section-body"><div className="row with-icon"><span className="icon-box"><Icon name="fingerprint" /></span><span>Everyday unlock<br /><span className="helper">{profile.quickUnlock?.type === "device" ? deviceUnlockLabel() : profile.quickUnlock?.type === "pin" ? "4-digit PIN" : "Passphrase only"}</span></span><Button compact onClick={() => openProtected("unlock")}><Icon name="edit" />Change</Button></div><div className="row with-icon"><span className="icon-box"><Icon name="cloud" /></span><span>Backup preference<br /><span className="helper">{vault.settings.backupMode === "cloud" ? "Files / cloud" : "This device"}</span></span><Button compact onClick={() => openProtected("storage")}><Icon name="edit" />Change</Button></div><div className="row with-icon danger-row"><span className="icon-box"><Icon name="key" /></span><span>OpenAI API key<br /><span className="helper">{vault.ai?.apiKey ? `Protected - ends ${vault.ai.apiKey.slice(-4)}` : "Not configured"}</span></span><Button compact onClick={() => openProtected("api")}><Icon name="edit" />Manage</Button></div></div></details>

        <div className="button-row"><Button kind="ghost" onClick={onLock}><Icon name="logout" />Lock now</Button><Button kind="danger" onClick={() => openProtected("delete")}><Icon name="trash" />Delete profile</Button></div>
      </div>
    </Modal>
  );
}
