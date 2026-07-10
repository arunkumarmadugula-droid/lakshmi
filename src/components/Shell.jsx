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
  deleteProfile,
  importEncryptedBackup,
  listLocalSnapshots,
  requestPersistentStorage,
  restoreLocalSnapshot,
  saveVault,
  storageEstimate,
} from "../lib/vaultDb.js";
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
  const common = useMemo(() => ({ vault, persist, notify, openModal: setModal }), [vault, persist, notify]);
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

function SettingsModal({ vault, profileId, keyObject, persist, notify, onLock, onProfileChange, onClose }) {
  const [name, setName] = useState(vault.profile.name);
  const [snapshots, setSnapshots] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listLocalSnapshots(profileId).then(setSnapshots).catch(() => {});
    storageEstimate().then(setEstimate).catch(() => {});
  }, [profileId]);

  async function exportBackup() {
    setBusy(true);
    try {
      const updated = { ...vault, settings: { ...vault.settings, lastExternalBackupAt: new Date().toISOString() } };
      await persist(updated, { forceSnapshot: true });
      const { file } = await buildEncryptedBackup(profileId);
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: "Lakshmi encrypted backup", text: "Save this encrypted Lakshmi backup to Files, iCloud Drive, or Google Drive.", files: [file] });
      } else downloadBlob(file, file.name);
      notify("Encrypted backup created.");
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

  async function restoreSnapshot(id) {
    if (!window.confirm("Replace the current vault with this encrypted local snapshot?")) return;
    setBusy(true);
    try {
      const restored = await restoreLocalSnapshot(profileId, id, keyObject);
      await persist(restored, { forceSnapshot: true });
      notify("Local snapshot restored.");
      window.location.reload();
    } catch (reason) {
      notify(reason.message || "Snapshot restore failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeProfile() {
    const confirmation = window.prompt(`Type ${vault.profile.name} to permanently delete this local encrypted profile.`);
    if (confirmation !== vault.profile.name) return;
    await deleteProfile(profileId);
    await onProfileChange();
  }

  return (
    <Modal label="Settings" title="Appearance and privacy" onClose={onClose}>
      <div className="form-stack">
        <div>
          <div className="label" style={{ marginBottom: 8 }}>Theme</div>
          <div className="theme-options">
            {[
              ["default", "Black and white", ["#121212", "#2d2d2d", "#f4f2ec"]],
              ["lotus", "Lotus light", ["#f3f1ec", "#ffffff", "#d8a443"]],
              ["forest", "Forest wealth", ["#101513", "#25302b", "#83cfac"]],
            ].map(([value, label, colors]) => (
              <button type="button" key={value} className="theme-choice" aria-pressed={vault.settings.theme === value} onClick={() => persist({ ...vault, settings: { ...vault.settings, theme: value } })}>
                <span className="theme-preview">{colors.map((color) => <i key={color} style={{ background: color }} />)}</span>{label}
              </button>
            ))}
          </div>
        </div>

        <div className="security-banner"><span className="icon-box"><Icon name="shield" /></span><div><strong>Encrypted local vault</strong><div className="helper">AES-GCM encryption with a passphrase-derived key. The key exists only in memory while unlocked.</div></div></div>

        <Field label="Profile name"><Input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => name.trim() && name !== vault.profile.name && persist({ ...vault, profile: { ...vault.profile, name: name.trim() } })} /></Field>
        <Field label="Automatic lock">
          <Select value={vault.settings.autoLockMinutes} onChange={(event) => persist({ ...vault, settings: { ...vault.settings, autoLockMinutes: Number(event.target.value) } })}>
            <option value="1">After 1 minute</option><option value="5">After 5 minutes</option><option value="15">After 15 minutes</option><option value="30">After 30 minutes</option>
          </Select>
        </Field>

        <div className="row with-icon"><span className="icon-box"><Icon name="drive" /></span><span>Browser storage<br /><span className="helper">{vault.settings.storagePersistent ? "Persistent mode granted" : "Best-effort mode; keep external backups"}{estimate?.usage ? ` - ${(estimate.usage / 1048576).toFixed(1)} MB used` : ""}</span></span><span className={`status-pill ${vault.settings.storagePersistent ? "good" : "neutral"}`}>{vault.settings.storagePersistent ? "Protected" : "Local"}</span></div>

        <div className="card-header no-margin"><div><div className="label">Encrypted backups</div><div className="helper">Save through the iPhone share sheet to your own cloud drive</div></div></div>
        <div className="button-row">
          <Button kind="primary" disabled={busy} onClick={exportBackup}><Icon name="share" />Back up</Button>
          <FileButton accept=".lakshmi,application/json" onFile={importBackup} disabled={busy}><Icon name="restore" />Import</FileButton>
        </div>
        <div className="privacy-note">iOS does not allow a website to silently write into iCloud Drive. Local snapshots are automatic; cloud-file backup needs your confirmation in the share sheet.</div>

        {snapshots.length > 0 && <div><div className="label" style={{ marginBottom: 4 }}>Local snapshots</div>{snapshots.slice(0, 4).map((snapshot) => (
          <div className="row" key={snapshot.id}><span>{new Date(snapshot.createdAt).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}<br /><span className="helper">Encrypted on this device</span></span><Button kind="ghost" compact disabled={busy} onClick={() => restoreSnapshot(snapshot.id)}><Icon name="restore" />Restore</Button></div>
        ))}</div>}

        <div className="row with-icon"><span className="icon-box"><Icon name="ai" /></span><span>ChatGPT receipt reading<br /><span className="helper">Uses the iPhone share sheet; no API key is stored in Lakshmi</span></span><span className="status-pill good">No key</span></div>

        <div className="button-row">
          <Button kind="ghost" onClick={onLock}><Icon name="logout" />Lock now</Button>
          <Button kind="danger" onClick={removeProfile}><Icon name="trash" />Delete profile</Button>
        </div>
      </div>
    </Modal>
  );
}
