let deferredPrompt = null;
let started = false;
const listeners = new Set();

function installed() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function platform() {
  if (typeof navigator === "undefined") return "browser";
  if (/android/i.test(navigator.userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return "ios";
  return "browser";
}

function emit() {
  const state = installState();
  for (const listener of listeners) listener(state);
}

export function startInstallCapture() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    emit();
  });
}

export function installState() {
  return { installed: installed(), available: !!deferredPrompt, platform: platform() };
}

export function subscribeInstall(listener) {
  listeners.add(listener);
  listener(installState());
  return () => listeners.delete(listener);
}

export async function promptInstall() {
  if (!deferredPrompt) return { outcome: "unavailable" };
  const prompt = deferredPrompt;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  deferredPrompt = null;
  emit();
  return choice;
}
