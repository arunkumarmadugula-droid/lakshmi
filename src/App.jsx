import { useEffect, useState } from "react";
import ProfileGate from "./components/ProfileGate.jsx";
import Shell from "./components/Shell.jsx";
import { applyDueSchedules } from "./lib/finance.js";
import {
  clearLegacyApiKey,
  createProfile,
  importEncryptedBackup,
  lastProfileId,
  legacyApiKeyAvailable,
  legacyDataAvailable,
  listProfiles,
  readLegacyVault,
  saveVault,
  unlockProfile,
} from "./lib/vaultDb.js";

export default function App() {
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

  async function openSession(result) {
    const scheduled = applyDueSchedules(result.vault);
    let vault = scheduled.vault;
    if (scheduled.changed) vault = await saveVault(result.profile.id, result.key, vault);
    setSession({ ...result, vault });
    setError("");
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

  async function handleCreate({ name, passphrase, importLegacy, removeLegacyKey }) {
    setBusy(true);
    setError("");
    try {
      const initialVault = importLegacy ? readLegacyVault(name) : null;
      const result = await createProfile(name, passphrase, initialVault);
      if (removeLegacyKey) clearLegacyApiKey();
      await refreshProfiles();
      await openSession(result);
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

  if (loading) {
    return <main className="profile-stage"><section className="profile-panel"><div className="profile-brand"><div className="profile-title">Lakshmi</div><div className="helper">Opening local vault...</div></div></section></main>;
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
        onUnlock={handleUnlock}
        onCreate={handleCreate}
        onImport={handleImport}
      />
    );
  }

  return (
    <Shell
      session={session}
      onLock={() => setSession(null)}
      onProfileChange={async () => {
        await refreshProfiles();
        setSession(null);
      }}
    />
  );
}
