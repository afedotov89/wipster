import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useProjectStore } from './projectStore';
import { useTaskStore } from './taskStore';
import { useTaskFieldStore } from './taskFieldStore';
import { useSettingsStore } from './settingsStore';

export interface CloudStatus {
  account: { origin: string; account_id: string; phone?: string | null; email?: string; name?: string; google_linked?: boolean } | null;
  pending: number;
  pending_revocations?: number;
  conflict: boolean;
  error: string | null;
  last_sync: string | null;
}
interface CloudStore {
  status: CloudStatus;
  busy: boolean;
  refresh: () => Promise<void>;
  sync: () => Promise<void>;
}
const initial: CloudStatus = { account: null, pending: 0, conflict: false, error: null, last_sync: null };

// Refresh values without remounting the editor or clearing typed form state.
export async function refreshCloudData() {
  const [projects, tasks, doingTasks, archivedTasks] = await Promise.all([
    invoke<import('@/utils/tauri').Project[]>('list_projects'),
    invoke<import('@/utils/tauri').Task[]>('list_tasks', { projectId: useProjectStore.getState().selectedProjectId ?? undefined }),
    invoke<import('@/utils/tauri').Task[]>('get_doing_tasks'),
    invoke<import('@/utils/tauri').Task[]>('list_archived_tasks'),
  ]);
  useProjectStore.setState({ projects });
  useTaskStore.setState({ tasks, doingTasks, archivedTasks });
  await Promise.all([useTaskFieldStore.getState().load(), useSettingsStore.getState().hydrate()]);
  // Task field editors listen to this to refresh externally changed custom values.
  window.dispatchEvent(new Event('wipster-cloud-change'));
}
export const useCloudStore = create<CloudStore>((set, get) => ({
  status: initial,
  busy: false,
  refresh: async () => {
    if (!isTauri()) return;
    set({ status: await invoke<CloudStatus>('cloud_status') });
  },
  sync: async () => {
    if (!isTauri() || get().busy) return;
    set({ busy: true });
    try {
      const changed = await invoke<boolean>('cloud_sync');
      if (changed) await refreshCloudData();
    } catch (e) {
      set({ status: { ...get().status, error: String(e) } });
    } finally {
      try { await get().refresh(); } catch { /* A temporary IPC error keeps the last status. */ }
      set({ busy: false });
    }
  },
}));
