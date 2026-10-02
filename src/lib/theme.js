const THEME_CLASSES = ["theme-default", "theme-lotus", "theme-bright"];
const REMEMBERED_THEME_KEY = "lakshmi-ui-theme";

const THEME_CHROME = {
  default: { app: "#0a0a0c", frame: "#101013", surface: "#16161a", statusBar: "black-translucent" },
  lotus: { app: "#fbfbfd", frame: "#f5f5f7", surface: "#fbfbfd", statusBar: "default" },
  bright: { app: "#edf6ff", frame: "#fbfbfd", surface: "#ffffff", statusBar: "default" },
};

export function normalizeTheme(value) {
  return Object.hasOwn(THEME_CHROME, value) ? value : "default";
}

export function rememberedTheme() {
  try {
    return normalizeTheme(localStorage.getItem(REMEMBERED_THEME_KEY));
  } catch {
    return "default";
  }
}

export function applyDocumentTheme(value, mode = "app") {
  if (typeof document === "undefined") return normalizeTheme(value);
  const theme = normalizeTheme(value);
  const className = `theme-${theme}`;
  const chrome = THEME_CHROME[theme];

  for (const target of [document.documentElement, document.body]) {
    target.classList.remove(...THEME_CLASSES);
    target.classList.add(className);
  }
  document.documentElement.style.setProperty("--viewport-bg", mode === "app" ? chrome.surface : chrome.app);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "app" ? chrome.surface : chrome.app);
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute("content", chrome.statusBar);

  try {
    localStorage.setItem(REMEMBERED_THEME_KEY, theme);
  } catch {}
  return theme;
}
