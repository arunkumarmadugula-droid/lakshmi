const THEME_CLASSES = ["theme-default", "theme-lotus", "theme-bright"];
const REMEMBERED_THEME_KEY = "lakshmi-ui-theme";

const THEME_CHROME = {
  default: { app: "#121212", frame: "#202020", surface: "#2d2d2d", statusBar: "black-translucent" },
  lotus: { app: "#edebe6", frame: "#f6f5f1", surface: "#ffffff", statusBar: "default" },
  bright: { app: "#eaf5ff", frame: "#fffdf8", surface: "#ffffff", statusBar: "default" },
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
