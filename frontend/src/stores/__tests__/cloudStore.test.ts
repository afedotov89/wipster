import { beforeEach, describe, expect, it, vi } from 'vitest';
const { invoke, isTauri } = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri }));
vi.mock('@/stores/projectStore', () => ({ useProjectStore: Object.assign(() => {}, { getState: () => ({ selectedProjectId: null }), setState: vi.fn() }) }));
vi.mock('@/stores/taskStore', () => ({ useTaskStore: { setState: vi.fn() } }));
vi.mock('@/stores/taskFieldStore', () => ({ useTaskFieldStore: { getState: () => ({ load: vi.fn().mockResolvedValue(undefined) }) } }));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ hydrate: vi.fn().mockResolvedValue(undefined) }) } }));
import { useCloudStore } from '../cloudStore';

const status = { account: { origin: 'https://example.com', account_id: 'a', phone: '+14155552671' }, pending: 1, conflict: false, error: null, last_sync: null };
describe('cloud delivery opportunities', () => {
  beforeEach(() => { invoke.mockReset(); isTauri.mockReturnValue(true); useCloudStore.setState({ busy: false, status }); });
  it('keeps an offline error and retries on the next opportunity', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'cloud_sync') throw new Error('offline');
      if (command === 'cloud_status') return { ...status, error: 'offline' };
    });
    await useCloudStore.getState().sync();
    expect(useCloudStore.getState().status.error).toBe('offline');
    expect(useCloudStore.getState().busy).toBe(false);
    invoke.mockImplementation(async (command: string) => command === 'cloud_status' ? { ...status, pending: 0, error: null } : false);
    await useCloudStore.getState().sync();
    expect(useCloudStore.getState().status.pending).toBe(0);
    expect(useCloudStore.getState().status.error).toBeNull();
  });
  it('coalesces concurrent focus and polling triggers', async () => {
    let finish!: (value: boolean) => void;
    invoke.mockImplementation((command: string) => command === 'cloud_sync' ? new Promise<boolean>(r => { finish = r; }) : Promise.resolve(status));
    const first = useCloudStore.getState().sync();
    await useCloudStore.getState().sync();
    expect(invoke.mock.calls.filter(c => c[0] === 'cloud_sync')).toHaveLength(1);
    finish(false); await first;
  });
  it('does not attempt browser cloud authentication or token persistence', async () => {
    isTauri.mockReturnValue(false);
    await useCloudStore.getState().sync();
    await useCloudStore.getState().refresh();
    expect(invoke).not.toHaveBeenCalled();
  });
});
