import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { startInstallCapture } from "./lib/pwaInstall.js";
import { applyDocumentTheme, rememberedTheme } from "./lib/theme.js";
import "./styles.css";

applyDocumentTheme(rememberedTheme(), "lock");
startInstallCapture();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const controlledAtLaunch = !!navigator.serviceWorker.controller;
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlledAtLaunch || reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then((registration) => {
      registration.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) registration.update().catch(() => {});
      });
    }).catch(() => {});
  });
}
