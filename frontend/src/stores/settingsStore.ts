import { create } from "zustand";
import * as api from "@/utils/tauri";
import { DEFAULT_WIP_LIMIT } from "@/utils/constants";

/**
 * App-wide preferences that the UI has to render, not just the settings screen.
 * The backend owns the validation, so this store never invents a value of its
 * own: it starts on the documented default and takes whatever the backend says.
 */
interface SettingsState {
  wipLimit: number;
  hydrate: () => Promise<void>;
  setWipLimit: (limit: number) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  wipLimit: DEFAULT_WIP_LIMIT,

  hydrate: async () => {
    try {
      set({ wipLimit: await api.getWipLimit() });
    } catch {
      // Unreadable settings must not take the board down — the default holds.
    }
  },

  setWipLimit: async (limit) => {
    // The backend clamps; show what it actually stored, not what we asked for.
    set({ wipLimit: await api.setWipLimit(limit) });
  },
}));
