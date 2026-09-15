import { create } from "zustand";
import * as api from "@/utils/tauri";

interface TaskFieldState {
  fields: api.TaskField[];
  /** Custom fields taken out of the list that still hold values. */
  removed: api.TaskField[];
  loaded: boolean;

  load: () => Promise<void>;
  create: (label: string, kind: api.FieldKind, options?: string[]) => Promise<void>;
  update: (id: string, patch: { label?: string; enabled?: boolean; options?: string[] }) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
}

/**
 * The fields a task has.
 *
 * One list, read by the detail panel (what to draw, in what order) and by the
 * settings (what to offer). The assistant changes the same rows through the
 * backend, so a field it adds appears here as soon as the list is reloaded.
 */
export const useTaskFieldStore = create<TaskFieldState>((set, get) => ({
  fields: [],
  removed: [],
  loaded: false,

  load: async () => {
    const [fields, removed] = await Promise.all([
      api.listTaskFields(),
      api.removedTaskFields().catch(() => []),
    ]);
    set({ fields, removed, loaded: true });
  },

  create: async (label, kind, options) => {
    await api.createTaskField(label, kind, options);
    await get().load();
  },

  update: async (id, patch) => {
    await api.updateTaskField(id, patch);
    await get().load();
  },

  reorder: async (ids) => {
    // Optimistic: dragging must not wait for a round trip to look like it worked.
    const byId = new Map(get().fields.map((f) => [f.id, f]));
    set({ fields: ids.map((id) => byId.get(id)!).filter(Boolean) });
    await api.reorderTaskFields(ids);
    await get().load();
  },

  remove: async (id) => {
    await api.removeTaskField(id);
    await get().load();
  },

  restore: async (id) => {
    await api.restoreTaskField(id);
    await get().load();
  },
}));

/** The fields that should be drawn on a task, in order. */
export const visibleFields = (fields: api.TaskField[]) => fields.filter((f) => f.enabled);
