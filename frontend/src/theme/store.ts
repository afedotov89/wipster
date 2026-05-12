import { create } from "zustand";
import {
  DEFAULT_DARK_ID, DEFAULT_LIGHT_ID, DEFAULT_MODE,
  darkThemes, lightThemes,
  resolveMode, resolveCurrentTheme,
  type ThemeDef, type Mode,
} from "./themes";
import * as api from "@/utils/tauri";

const DARK_KEY = "wipster-theme-dark";
const LIGHT_KEY = "wipster-theme-light";
const MODE_KEY = "wipster-theme-mode";

function readStoredDark(): string {
  try {
    const v = localStorage.getItem(DARK_KEY);
    if (v && darkThemes().some((t) => t.id === v)) return v;
  } catch {}
  return DEFAULT_DARK_ID;
}

function readStoredLight(): string {
  try {
    const v = localStorage.getItem(LIGHT_KEY);
    if (v && lightThemes().some((t) => t.id === v)) return v;
  } catch {}
  return DEFAULT_LIGHT_ID;
}

function readStoredMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {}
  return DEFAULT_MODE;
}

interface ThemeState {
  darkThemeId: string;
  lightThemeId: string;
  mode: Mode;
  resolvedMode: "light" | "dark";
  current: ThemeDef;
  setDarkTheme: (id: string) => void;
  setLightTheme: (id: string) => void;
  setMode: (mode: Mode) => void;
  hydrateFromDb: () => Promise<void>;
}

function recompute(darkId: string, lightId: string, mode: Mode) {
  return {
    resolvedMode: resolveMode(mode),
    current: resolveCurrentTheme(darkId, lightId, mode),
  };
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const darkThemeId = readStoredDark();
  const lightThemeId = readStoredLight();
  const mode = readStoredMode();

  if (typeof window !== "undefined" && window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const listener = () => {
      if (get().mode === "auto") {
        const s = get();
        set(recompute(s.darkThemeId, s.lightThemeId, s.mode));
      }
    };
    mq.addEventListener?.("change", listener);
  }

  return {
    darkThemeId, lightThemeId, mode,
    ...recompute(darkThemeId, lightThemeId, mode),
    setDarkTheme: (id) => {
      try { localStorage.setItem(DARK_KEY, id); } catch {}
      api.setSetting("theme_dark_id", id).catch(() => {});
      const s = get();
      set({ darkThemeId: id, ...recompute(id, s.lightThemeId, s.mode) });
    },
    setLightTheme: (id) => {
      try { localStorage.setItem(LIGHT_KEY, id); } catch {}
      api.setSetting("theme_light_id", id).catch(() => {});
      const s = get();
      set({ lightThemeId: id, ...recompute(s.darkThemeId, id, s.mode) });
    },
    setMode: (m) => {
      try { localStorage.setItem(MODE_KEY, m); } catch {}
      api.setSetting("theme_mode", m).catch(() => {});
      const s = get();
      set({ mode: m, ...recompute(s.darkThemeId, s.lightThemeId, m) });
    },
    hydrateFromDb: async () => {
      try {
        const [dDark, dLight, dMode] = await Promise.all([
          api.getSetting("theme_dark_id"),
          api.getSetting("theme_light_id"),
          api.getSetting("theme_mode"),
        ]);
        const s = get();
        const newDark = dDark && darkThemes().some((t) => t.id === dDark) ? dDark : s.darkThemeId;
        const newLight = dLight && lightThemes().some((t) => t.id === dLight) ? dLight : s.lightThemeId;
        const newMode: Mode = dMode === "light" || dMode === "dark" || dMode === "auto" ? dMode : s.mode;
        try {
          localStorage.setItem(DARK_KEY, newDark);
          localStorage.setItem(LIGHT_KEY, newLight);
          localStorage.setItem(MODE_KEY, newMode);
        } catch {}
        set({
          darkThemeId: newDark, lightThemeId: newLight, mode: newMode,
          ...recompute(newDark, newLight, newMode),
        });
      } catch {}
    },
  };
});
