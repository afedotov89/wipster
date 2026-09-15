import { create } from "zustand";
import * as api from "@/utils/tauri";
import { DEFAULT_WIP_LIMIT } from "@/utils/constants";

/**
 * App-wide preferences that the UI has to render, not just the settings screen.
 * The backend owns the validation, so this store never invents a value of its
 * own: it starts on the documented default and takes whatever the backend says.
 */
/** How a task opens when it is clicked: in its strip, or filling the window. */
export type TaskDetailMode = "panel" | "wide";

interface SettingsState {
  wipLimit: number;
  taskDetailMode: TaskDetailMode;
  hydrate: () => Promise<void>;
  setWipLimit: (limit: number) => Promise<void>;
  setTaskDetailMode: (mode: TaskDetailMode) => Promise<void>;
}

const TASK_DETAIL_MODE = "task_detail_mode";

export const useSettingsStore = create<SettingsState>((set) => ({
  wipLimit: DEFAULT_WIP_LIMIT,
  // A task opens in its strip unless the user said otherwise: that is what the
  // app has always done.
  taskDetailMode: "panel",

  hydrate: async () => {
    try {
      set({ wipLimit: await api.getWipLimit() });
    } catch {
      // Unreadable settings must not take the board down — the default holds.
    }
    try {
      const stored = await api.getSetting(TASK_DETAIL_MODE);
      if (stored === "wide" || stored === "panel") set({ taskDetailMode: stored });
    } catch {
      // Same: the default holds.
    }
  },

  setTaskDetailMode: async (mode) => {
    set({ taskDetailMode: mode });
    await api.setSetting(TASK_DETAIL_MODE, mode);
  },

  setWipLimit: async (limit) => {
    // The backend clamps; show what it actually stored, not what we asked for.
    set({ wipLimit: await api.setWipLimit(limit) });
  },
}));
