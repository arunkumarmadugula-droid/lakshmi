import { useEffect, useMemo, useState } from "react";
import { Button, Field, FileButton, Icon, Input, LotusLogo } from "./ui.jsx";

export default function ProfileGate({
  profiles,
  preferredProfileId,
  busy,
  error,
  legacyAvailable,
  legacyApiKey,
  onUnlock,
  onCreate,
  onImport,
}) {
  const [mode, setMode] = useState(profiles.length ? "unlock" : "create");
  const [selectedId, setSelectedId] = useState(preferredProfileId || profiles[0]?.id || "");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [name, setName] = useState("My household");
  const [confirm, setConfirm] = useState("");
  const [importLegacy, setImportLegacy] = useState(legacyAvailable);
  const [removeLegacyKey, setRemoveLegacyKey] = useState(legacyApiKey);

  useEffect(() => {
    if (!selectedId && profiles[0]) setSelectedId(profiles[0].id);
  }, [profiles, selectedId]);

  const selected = useMemo(() => profiles.find((profile) => profile.id === selectedId), [profiles, selectedId]);

  async function submitUnlock(event) {
    event.preventDefault();
    if (!selected) return;
    await onUnlock(selected.id, passphrase);
  }

  async function submitCreate(event) {
    event.preventDefault();
    if (passphrase !== confirm) return;
    await onCreate({ name, passphrase, importLegacy, removeLegacyKey });
  }

  return (
    <main className="profile-stage">
      <section className="profile-panel" aria-label="Lakshmi local profile">
        <div className="profile-brand">
          <LotusLogo />
          <div className="profile-title">Lakshmi</div>
          <div className="helper">Private household vault</div>
        </div>

        {mode === "unlock" && profiles.length > 0 && (
          <>
            <div className="profile-list">
              {profiles.map((profile) => (
                <button className="profile-row" type="button" key={profile.id} onClick={() => setSelectedId(profile.id)} aria-pressed={profile.id === selectedId}>
                  <span className="icon-box"><Icon name={profile.id === selectedId ? "lock" : "user"} /></span>
                  <span className="truncate"><strong>{profile.name}</strong><br /><span className="helper">Encrypted on this device</span></span>
                  {profile.id === selectedId && <Icon name="check" />}
                </button>
              ))}
            </div>
            <form className="profile-form" onSubmit={submitUnlock}>
              <Field label={`Unlock ${selected?.name || "profile"}`}>
                <div style={{ position: "relative" }}>
                  <Input autoFocus type={showPassphrase ? "text" : "password"} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="current-password" placeholder="Passcode or passphrase" style={{ paddingRight: 42 }} />
                  <button type="button" className="icon-button" aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"} onClick={() => setShowPassphrase((value) => !value)} style={{ position: "absolute", right: 1, top: 1 }}>
                    <Icon name={showPassphrase ? "eye-off" : "eye"} />
                  </button>
                </div>
              </Field>
              {error && <div className="error-text">{error}</div>}
              <Button kind="primary" disabled={busy || !passphrase} type="submit"><Icon name="lock" />{busy ? "Unlocking..." : "Unlock"}</Button>
            </form>
          </>
        )}

        {mode === "create" && (
          <form className="profile-form" onSubmit={submitCreate}>
            <div className="label">Create local profile</div>
            <Field label="Profile name"><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={50} autoComplete="name" /></Field>
            <Field label="Passphrase"><Input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} minLength={8} autoComplete="new-password" placeholder="At least 8 characters" /></Field>
            <Field label="Confirm"><Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={8} autoComplete="new-password" /></Field>
            {legacyAvailable && (
              <label className="check-row"><input type="checkbox" checked={importLegacy} onChange={(event) => setImportLegacy(event.target.checked)} /><span>Move existing Lakshmi records into this encrypted vault</span></label>
            )}
            {legacyApiKey && (
              <label className="check-row"><input type="checkbox" checked={removeLegacyKey} onChange={(event) => setRemoveLegacyKey(event.target.checked)} /><span>Remove the old browser-stored AI key after setup</span></label>
            )}
            {confirm && passphrase !== confirm && <div className="error-text">The two passphrases do not match.</div>}
            {error && <div className="error-text">{error}</div>}
            <Button kind="primary" disabled={busy || name.trim().length < 2 || passphrase.length < 8 || passphrase !== confirm} type="submit"><Icon name="shield" />{busy ? "Creating..." : "Create encrypted profile"}</Button>
          </form>
        )}

        {mode === "restore" && (
          <div className="profile-form">
            <div className="label">Restore encrypted backup</div>
            <FileButton accept=".lakshmi,application/json,application/vnd.lakshmi.backup+json" onFile={onImport} kind="primary" disabled={busy}><Icon name="upload" />Choose backup</FileButton>
            {error && <div className="error-text">{error}</div>}
          </div>
        )}

        <div className="divider-label">Profiles</div>
        <div className="button-row">
          {profiles.length > 0 && <Button kind="ghost" compact onClick={() => setMode("unlock")}><Icon name="lock" />Unlock</Button>}
          <Button kind="ghost" compact onClick={() => { setMode("create"); setPassphrase(""); setConfirm(""); }}><Icon name="plus" />New profile</Button>
          <Button kind="ghost" compact onClick={() => setMode("restore")}><Icon name="restore" />Restore</Button>
        </div>
        <div className="privacy-note">Financial records are encrypted inside this browser. A different person opening the same GitHub site on another device starts with an empty local database.</div>
      </section>
    </main>
  );
}
