/** IndexedDB transactions are the serialization boundary, including across tabs.
 * No HTTP or other external await is allowed inside a transaction callback.
 */
export type Kind = 'project' | 'task' | 'field' | 'value' | 'preference';
export type Data = Record<string, any>;
export interface Entity { key: string; kind: Kind; id: string; data: Data | null; version: number; revision: number; dirty: boolean; baseData?: Data | null }
export interface Change { kind: Kind; id: string; data: Data | null; version: number; sequence?: number }
export interface Batch { text: string; revisions: Record<string, number> }
export interface Workspace {
  entities: Record<string, Entity>;
  cursor: number;
  staged: Record<string, Change>;
  stagedCursor: number;
  batch?: Batch;
  conflicts: boolean;
  recovery: Array<{ at: string; entities: Record<string, Entity>; reason: string }>;
  settings: Record<string, string>;
  lease?: { owner: string; expires: number; fence: number };
}
export interface Account { account_id: string; email: string; name: string; expires_at: string }
export interface Control { epoch: number; account: Account | null; blocked: boolean; revoke?: string; authFence?: number; browserId?: string; sessionLease?: { owner: string; expires: number } }
const connections = new Map<string, Promise<IDBDatabase>>();
function database(name: string) {
  if (!connections.has(name)) connections.set(name, new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('state');
    r.onerror = () => { connections.delete(name); reject(r.error); };
    r.onblocked = () => { connections.delete(name); reject(new Error('Закройте другие окна Wipster для обновления хранилища.')); };
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); connections.delete(name); }; resolve(r.result); };
  }));
  return connections.get(name)!;
}
export async function transaction<T, R>(name: string, initial: () => T, fn: (state: T) => R, write = true): Promise<R> {
  const db = await database(name);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', write ? 'readwrite' : 'readonly');
    let result: R;
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Не удалось сохранить изменения на устройстве.'));
    const store = tx.objectStore('state');
    const request = store.get('current');
    request.onsuccess = () => {
      try { const state = (request.result ?? initial()) as T; result = fn(state); if (write) store.put(state, 'current'); }
      catch (e) { tx.abort(); reject(e); }
    };
  });
}
export const control = <R>(fn: (state: Control) => R, write = true) => transaction('wipster-control-v1', () => ({ epoch: 0, account: null, blocked: false }), fn, write);
export const workspace = <R>(id: string, fn: (state: Workspace) => R, write = true) => transaction('wipster-account-v1-' + id, () => ({ entities: {}, cursor: 0, staged: {}, stagedCursor: 0, conflicts: false, recovery: [], settings: {} }), fn, write);
export const keyOf = (kind: Kind, id: string) => kind + ':' + id;
export function put(s: Workspace, kind: Kind, id: string, data: Data | null) {
  const key = keyOf(kind, id), old = s.entities[key];
  if (!old && data === null) return;
  s.entities[key] = { key, kind, id, data, version: old?.version ?? 0, revision: (old?.revision ?? 0) + 1, dirty: true, baseData: old?.dirty ? old.baseData : (old?.data ?? null) };
}
export function live(s: Workspace, kind: Kind): Data[] { return Object.values(s.entities).filter(e => e.kind === kind && e.data).map(e => e.data!); }
export function requireData(s: Workspace, kind: Kind, id: string): Data {
  const data = s.entities[keyOf(kind, id)]?.data;
  if (!data) throw new Error('Объект удалён. Ваш черновик остаётся в редакторе.');
  return data;
}
