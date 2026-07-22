import { useEffect, useState } from "react";
import ProfileGate from "./components/ProfileGate.jsx";
import Shell from "./components/Shell.jsx";
import { createEmptyVault } from "./data/defaults.js";
import { applyDueSchedules } from "./lib/finance.js";
import { applyFormattingPreferences } from "./lib/format.js";
import { acceptHouseholdInvite, readHouseholdInvite } from "./lib/partnerSync.js";
import { applyDocumentTheme, normalizeTheme, rememberedTheme } from "./lib/theme.js";
import {
  clearLegacyApiKey,
  configureQuickUnlock,
  createProfile,
  importEncryptedBackup,
  lastProfileId,
  legacyApiKeyAvailable,
  legacyDataAvailable,
  listProfiles,
  readLegacyVault,
  saveVault,
  unlockProfile,
  quickUnlockProfile,
} from "./lib/vaultDb.js";

export default function App() {
  const [householdInvite, setHouseholdInvite] = useState(() => readHouseholdInvite());
  const [profiles, setProfiles] = useState([]);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refreshProfiles() {
    const result = await listProfiles();
    setProfiles(result);
    return result;
  }

  useEffect(() => {
    refreshProfiles().catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  async function openSession(result, notice = "") {
    const scheduled = applyDueSchedules(result.vault);
    let vault = scheduled.vault;
    if (scheduled.changed) vault = await saveVault(result.profile.id, result.key, vault);
    applyFormattingPreferences(vault.profile);
    setSession({ ...result, vault, notice });
    setError("");
  }

  async function handleQuickUnlock(profileId, pin) {
    setBusy(true);
    setError("");
    try {
      await openSession(await quickUnlockProfile(profileId, pin));
    } catch (reason) {
      if (reason?.name !== "NotAllowedError" && reason?.name !== "AbortError") setError(reason.message || "Quick unlock failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock(profileId, passphrase) {
    setBusy(true);
    setError("");
    try {
      await openSession(await unlockProfile(profileId, passphrase));
    } catch (reason) {
      setError(reason.message || "Unable to unlock this profile.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate({ name, country, passphrase, importLegacy, removeLegacyKey, unlockMethod, pin, storageMode, apiKey }) {
    setBusy(true);
    setError("");
    try {
      const selectedCountry = householdInvite?.country || country || "CA";
      let initialVault = importLegacy && !householdInvite ? readLegacyVault(name) : createEmptyVault(name, selectedCountry);
      if (householdInvite) initialVault = acceptHouseholdInvite(initialVault, householdInvite);
      initialVault.settings.backupMode = storageMode || "device";
      initialVault.ai.apiKey = String(apiKey || "").trim();
      initialVault.ai.consentAt = initialVault.ai.apiKey ? new Date().toISOString() : null;
      const result = await createProfile(name, passphrase, initialVault);
      let notice = "";
      try {
        result.profile = await configureQuickUnlock(result.profile.id, passphrase, unlockMethod || "device", pin);
      } catch (reason) {
        notice = `${reason.message || "Quick unlock could not be configured."} The recovery passphrase still works.`;
      }
      if (removeLegacyKey) clearLegacyApiKey();
      await refreshProfiles();
      await openSession(result, notice);
      if (householdInvite) {
        if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        setHouseholdInvite(null);
      }
    } catch (reason) {
      setError(reason.message || "Unable to create the encrypted profile.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(file) {
    setBusy(true);
    setError("");
    try {
      await importEncryptedBackup(file);
      await refreshProfiles();
      setError("Backup restored. Select the restored profile and unlock it with its original passphrase.");
    } catch (reason) {
      setError(reason.message || "Unable to restore this backup.");
    } finally {
      setBusy(false);
    }
  }

  function handleLock(theme) {
    const lockTheme = normalizeTheme(theme || session?.vault?.settings?.theme || rememberedTheme());
    if (session?.profile?.id) {
      setProfiles((current) => current.map((profile) => profile.id === session.profile.id ? { ...profile, theme: lockTheme } : profile));
    }
    applyDocumentTheme(lockTheme, "lock");
    setSession(null);
    refreshProfiles().catch((reason) => setError(reason.message || "Unable to refresh local profiles."));
  }

  if (loading) {
    return <main className={`profile-stage theme-${rememberedTheme()}`}><section className="profile-panel"><div className="profile-brand"><div className="profile-title">Lakshmi</div><div className="helper">Opening local vault...</div></div></section></main>;
  }

  if (!session) {
    return (
      <ProfileGate
        profiles={profiles}
        preferredProfileId={lastProfileId()}
        busy={busy}
        error={error}
        legacyAvailable={legacyDataAvailable()}
        legacyApiKey={legacyApiKeyAvailable()}
        householdInvite={householdInvite}
        onUnlock={handleUnlock}
        onQuickUnlock={handleQuickUnlock}
        onCreate={handleCreate}
        onImport={handleImport}
      />
    );
  }

  return (
    <Shell
      session={session}
      onLock={handleLock}
      onProfileChange={async () => {
        await refreshProfiles();
        setSession(null);
      }}
    />
  );
}
