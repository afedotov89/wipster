import { create } from "zustand";
import * as api from "@/utils/tauri";
import { useTaskStore } from "@/stores/taskStore";
import { useHistoryStore } from "@/stores/historyStore";
import { appLog } from "@/stores/logStore";

/**
 * Which tasks the assistant is filling in right now.
 *
 * Keyed by task id rather than a single flag: a fill outlives the panel that
 * started it, so the user can open another task — or start a second fill —
 * while the first one is still running, and each task shows only its own
 * progress.
 */
interface AiFillState {
  filling: string[];
  isFilling: (taskId: string | null | undefined) => boolean;
  fill: (taskId: string) => Promise<void>;
}

export const useAiFillStore = create<AiFillState>((set, get) => ({
  filling: [],

  isFilling: (taskId) => !!taskId && get().filling.includes(taskId),

  fill: async (taskId) => {
    if (get().isFilling(taskId)) return;
    set((s) => ({ filling: [...s.filling, taskId] }));
    appLog.info(`[ai-fill] Starting for task ${taskId}`);

    try {
      const result = await api.aiFillTask(taskId);
      appLog.info(`[ai-fill] Result: ${JSON.stringify(result).substring(0, 200)}`);

      const updates: Record<string, string> = {};
      // A title arrives only when the old one was a bare tracker link — the link
      // itself is not lost, it moves into tracker_url in the same pass.
      if (result.title) updates.title = result.title;
      if (result.time_estimate) updates.time_estimate = result.time_estimate;
      if (result.dod) updates.dod = result.dod;
      if (result.priority) updates.priority = result.priority;
      if (result.tracker_url) updates.tracker_url = result.tracker_url;
      if (result.checklist) {
        try {
          const items = JSON.parse(result.checklist);
          if (Array.isArray(items) && items.length > 0) {
            const existing = useTaskStore.getState().findTask(taskId);
            const current = JSON.parse(existing?.checklist || "[]");
            updates.checklist = JSON.stringify([...current, ...items]);
          }
        } catch {
          /* ignore bad JSON */
        }
      }

      if (Object.keys(updates).length === 0) {
        appLog.warn("[ai-fill] No fields to update (all returned null or already filled)");
        return;
      }

      await useTaskStore.getState().update(taskId, updates);
      await useHistoryStore.getState().refresh();
      appLog.info(`[ai-fill] Updated fields: ${Object.keys(updates).join(", ")}`);
    } catch (e) {
      appLog.error(`[ai-fill] Failed: ${String(e)}`);
    } finally {
      set((s) => ({ filling: s.filling.filter((id) => id !== taskId) }));
    }
  },
}));
