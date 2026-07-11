function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomBytes(length = 32) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export async function deviceUnlockAvailable() {
  if (!globalThis.PublicKeyCredential || !navigator.credentials?.create || !navigator.credentials?.get) return false;
  try {
    const platform = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!platform) return false;
    if (typeof PublicKeyCredential.getClientCapabilities === "function") {
      const capabilities = await PublicKeyCredential.getClientCapabilities();
      if (capabilities?.["extension:prf"] === false) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function deviceUnlockLabel() {
  const agent = navigator.userAgent || "";
  if (/iPhone|iPad|Macintosh/i.test(agent)) return "Face ID / Touch ID";
  if (/Android/i.test(agent)) return "Fingerprint / device unlock";
  return "Device unlock";
}

async function evaluatePrf(credentialId, prfSalt) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(),
      allowCredentials: [{ id: credentialId, type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });
  const first = assertion?.getClientExtensionResults?.().prf?.results?.first;
  if (!first) throw new Error("This browser can verify the device, but cannot derive the encryption key required for Lakshmi.");
  return new Uint8Array(first);
}

export async function registerDeviceUnlock(profile) {
  if (!(await deviceUnlockAvailable())) throw new Error("Device unlock is unavailable. Choose a PIN or continue with the passphrase.");
  const prfSalt = randomBytes();
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(),
      rp: { name: "Lakshmi" },
      user: {
        id: randomBytes(),
        name: profile.id,
        displayName: profile.name || "Lakshmi profile",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      attestation: "none",
      timeout: 60000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });
  if (!credential) throw new Error("Device unlock setup was cancelled.");
  const extension = credential.getClientExtensionResults?.().prf;
  if (extension && extension.enabled === false) throw new Error("Encrypted device unlock is not supported by this authenticator.");
  const prfOutput = extension?.results?.first
    ? new Uint8Array(extension.results.first)
    : await evaluatePrf(new Uint8Array(credential.rawId), prfSalt);
  return {
    credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
    prfSalt: bytesToBase64Url(prfSalt),
    prfOutput,
  };
}

export async function authenticateDeviceUnlock(config) {
  if (!(await deviceUnlockAvailable())) throw new Error("Device unlock is unavailable. Use the recovery passphrase.");
  return evaluatePrf(base64UrlToBytes(config.credentialId), base64UrlToBytes(config.prfSalt));
}
