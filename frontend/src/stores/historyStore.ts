import { create } from "zustand";
import * as api from "@/utils/tauri";

interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  canUndo: false,
  canRedo: false,

  undo: async () => {
    const entry = await api.undoLast();
    if (entry) {
      set({ canRedo: true });
    }
    // Refresh undo state
    const changelog = await api.getChangelog(1);
    set({ canUndo: changelog.some((e) => !e.undone) });
  },

  redo: async () => {
    const entry = await api.redoLast();
    if (entry) {
      set({ canUndo: true });
    }
    const changelog = await api.getChangelog(50);
    set({ canRedo: changelog.some((e) => e.undone) });
  },

  refresh: async () => {
    try {
      const changelog = await api.getChangelog(50);
      set({
        canUndo: changelog.some((e) => !e.undone),
        canRedo: changelog.some((e) => e.undone),
      });
    } catch (e) {
      console.error("Failed to refresh history:", e);
    }
  },
}));
