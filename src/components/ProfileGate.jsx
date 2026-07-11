import { useEffect, useMemo, useState } from "react";
import { deviceUnlockAvailable, deviceUnlockLabel } from "../lib/deviceAuth.js";
import { Button, Field, FileButton, Icon, Input, LotusLogo, Segmented } from "./ui.jsx";

export default function ProfileGate({
  profiles,
  preferredProfileId,
  busy,
  error,
  legacyAvailable,
  legacyApiKey,
  onUnlock,
  onQuickUnlock,
  onCreate,
  onImport,
}) {
  const [mode, setMode] = useState(profiles.length ? "unlock" : "create");
  const [selectedId, setSelectedId] = useState(preferredProfileId || profiles[0]?.id || "");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [name, setName] = useState("My household");
  const [confirm, setConfirm] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [unlockMethod, setUnlockMethod] = useState("device");
  const [storageMode, setStorageMode] = useState("device");
  const [apiKey, setApiKey] = useState("");
  const [deviceAvailable, setDeviceAvailable] = useState(true);
  const [availabilityChecked, setAvailabilityChecked] = useState(false);
  const [importLegacy, setImportLegacy] = useState(legacyAvailable);
  const [removeLegacyKey, setRemoveLegacyKey] = useState(legacyApiKey);

  useEffect(() => {
    if (!selectedId && profiles[0]) setSelectedId(profiles[0].id);
  }, [profiles, selectedId]);

  useEffect(() => {
    deviceUnlockAvailable().then((available) => {
      setDeviceAvailable(available);
      setAvailabilityChecked(true);
      if (!available) setUnlockMethod("pin");
    });
  }, []);

  const selected = useMemo(() => profiles.find((profile) => profile.id === selectedId), [profiles, selectedId]);
  const deviceLabel = deviceUnlockLabel();

  async function submitRecovery(event) {
    event.preventDefault();
    if (selected) await onUnlock(selected.id, passphrase);
  }

  async function submitPin(event) {
    event.preventDefault();
    if (selected) await onQuickUnlock(selected.id, pin);
  }

  async function submitCreate(event) {
    event.preventDefault();
    if (passphrase !== confirm || (unlockMethod === "pin" && pin !== confirmPin)) return;
    await onCreate({ name, passphrase, importLegacy, removeLegacyKey, unlockMethod, pin, storageMode, apiKey });
  }

  function chooseProfile(profileId) {
    setSelectedId(profileId);
    setUseRecovery(false);
    setPassphrase("");
    setPin("");
  }

  const createDisabled = busy
    || name.trim().length < 2
    || passphrase.length < 8
    || passphrase !== confirm
    || (unlockMethod === "pin" && (!/^\d{4}$/.test(pin) || pin !== confirmPin));

  return (
    <main className="profile-stage">
      <section className="profile-panel" aria-label="Lakshmi encrypted profile">
        <div className="profile-brand">
          <LotusLogo />
          <div className="profile-title">Lakshmi</div>
          <div className="helper">Private household vault</div>
        </div>

        {mode === "unlock" && profiles.length > 0 && (
          <>
            <div className="profile-list">
              {profiles.map((profile) => (
                <button className="profile-row" type="button" key={profile.id} onClick={() => chooseProfile(profile.id)} aria-pressed={profile.id === selectedId}>
                  <span className="icon-box"><Icon name={profile.id === selectedId ? "lock" : "user"} /></span>
                  <span className="truncate"><strong>{profile.name}</strong><br /><span className="helper">Encrypted on this device</span></span>
                  {profile.id === selectedId && <Icon name="check" />}
                </button>
              ))}
            </div>

            {!useRecovery && selected?.quickUnlock?.type === "device" && (
              <div className="profile-form">
                <div className="security-banner"><span className="icon-box"><Icon name="fingerprint" /></span><div><strong>{deviceLabel}</strong><div className="helper">Your device verifies you before releasing the local encryption key.</div></div></div>
                {error && <div className="error-text">{error}</div>}
                <Button kind="primary" disabled={busy} onClick={() => onQuickUnlock(selected.id, "")}><Icon name="fingerprint" />{busy ? "Verifying..." : `Unlock with ${deviceLabel}`}</Button>
                <Button kind="ghost" compact onClick={() => setUseRecovery(true)}><Icon name="key" />Use recovery passphrase</Button>
              </div>
            )}

            {!useRecovery && selected?.quickUnlock?.type === "pin" && (
              <form className="profile-form" onSubmit={submitPin}>
                <Field label="Quick PIN"><Input autoFocus type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} autoComplete="off" placeholder="4 digits" /></Field>
                {error && <div className="error-text">{error}</div>}
                <Button kind="primary" disabled={busy || !/^\d{4}$/.test(pin)} type="submit"><Icon name="lock" />{busy ? "Unlocking..." : "Unlock"}</Button>
                <Button kind="ghost" compact onClick={() => setUseRecovery(true)}><Icon name="key" />Use recovery passphrase</Button>
              </form>
            )}

            {(useRecovery || !selected?.quickUnlock) && (
              <form className="profile-form" onSubmit={submitRecovery}>
                <Field label={`Recovery passphrase for ${selected?.name || "profile"}`}>
                  <div style={{ position: "relative" }}>
                    <Input autoFocus type={showPassphrase ? "text" : "password"} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="current-password" placeholder="Passphrase" style={{ paddingRight: 42 }} />
                    <button type="button" className="icon-button" aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"} onClick={() => setShowPassphrase((value) => !value)} style={{ position: "absolute", right: 1, top: 1 }}><Icon name={showPassphrase ? "eye-off" : "eye"} /></button>
                  </div>
                </Field>
                {error && <div className="error-text">{error}</div>}
                <Button kind="primary" disabled={busy || !passphrase} type="submit"><Icon name="key" />{busy ? "Unlocking..." : "Unlock with passphrase"}</Button>
                {selected?.quickUnlock && <Button kind="ghost" compact onClick={() => setUseRecovery(false)}><Icon name="left" />Back to quick unlock</Button>}
              </form>
            )}

            <div className="profile-switch"><Button kind="ghost" compact onClick={() => { setMode("create"); setPassphrase(""); setPin(""); }}><Icon name="plus" />New private profile</Button></div>
          </>
        )}

        {mode === "create" && (
          <form className="profile-form setup-form" onSubmit={submitCreate}>
            <Field label="Profile name"><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="My household" /></Field>
            <Field label="Recovery passphrase"><Input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} minLength={8} autoComplete="new-password" placeholder="At least 8 characters" /></Field>
            <Field label="Confirm passphrase"><Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" /></Field>
            {confirm && passphrase !== confirm && <div className="error-text">The two passphrases do not match.</div>}

            <div>
              <div className="label" style={{ marginBottom: 7 }}>Everyday unlock</div>
              <Segmented columns={2} label="Everyday unlock" value={unlockMethod} onChange={setUnlockMethod} options={[
                ...(deviceAvailable ? [{ value: "device", label: deviceLabel }] : []),
                { value: "pin", label: "4-digit PIN" },
              ]} />
              {!availabilityChecked && <div className="helper">Checking secure device unlock...</div>}
              {availabilityChecked && deviceAvailable && <div className="helper">Device unlock is recommended. Your recovery passphrase still protects backups and sensitive changes.</div>}
              {availabilityChecked && !deviceAvailable && <div className="helper">This browser does not expose secure device authentication. PIN remains available.</div>}
            </div>
            {unlockMethod === "pin" && <div className="field-grid"><Field label="Quick PIN"><Input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4 digits" /></Field><Field label="Confirm PIN"><Input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 4))} /></Field></div>}
            {unlockMethod === "pin" && confirmPin && pin !== confirmPin && <div className="error-text">The two PINs do not match.</div>}

            <div>
              <div className="label" style={{ marginBottom: 7 }}>Backup preference</div>
              <Segmented columns={2} label="Backup preference" value={storageMode} onChange={setStorageMode} options={[{ value: "device", label: "This device" }, { value: "cloud", label: "Files / cloud" }]} />
              <div className="helper">The encrypted vault remains local. Files / cloud uses the iPhone or Android share sheet for confirmed backups.</div>
            </div>

            <Field label="OpenAI API key (optional)"><Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value.trim())} autoComplete="off" placeholder="sk-..." /></Field>
            <div className="privacy-note">A key entered here is encrypted inside this profile. It is never committed to GitHub. Direct browser use is a personal-use security tradeoff.</div>

            {legacyAvailable && <label className="check-row"><input type="checkbox" checked={importLegacy} onChange={(event) => setImportLegacy(event.target.checked)} /><span>Move existing Lakshmi records into this encrypted vault</span></label>}
            {legacyApiKey && <label className="check-row"><input type="checkbox" checked={removeLegacyKey} onChange={(event) => setRemoveLegacyKey(event.target.checked)} /><span>Remove the old unencrypted API key from browser storage</span></label>}
            {error && <div className="error-text">{error}</div>}
            <Button kind="primary" disabled={createDisabled} type="submit"><Icon name="shield" />{busy ? "Creating..." : "Create encrypted profile"}</Button>
            {profiles.length > 0 && <Button kind="ghost" compact onClick={() => setMode("unlock")}><Icon name="left" />Back to unlock</Button>}
          </form>
        )}

        <div className="restore-box">
          <div><div className="label">Restore encrypted backup</div><div className="helper">The original recovery passphrase is required.</div></div>
          <FileButton accept=".lakshmi,application/json,application/vnd.lakshmi.backup+json" onFile={onImport} kind="primary" disabled={busy}><Icon name="upload" />Choose backup</FileButton>
        </div>
        <div className="privacy-note">Each browser profile has an isolated encrypted database. Device unlock and PIN settings stay on this device and are not included in backups.</div>
      </section>
    </main>
  );
}
