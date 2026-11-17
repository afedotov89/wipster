import { create } from 'zustand';
import { sessionLock, type SessionGuard } from './sessionLock';
import { control, workspace, keyOf, type Account, type Control, type Change } from './db';

export interface WebState {
  ready: boolean; account: Account | null; blocked: boolean; pendingLogin: boolean;
  busy: boolean; pending: number; conflict: boolean; error: string | null; lastSync: string | null; storageError: boolean;
}
export const useWeb = create<WebState>(() => ({ ready: false, account: null, blocked: false, pendingLogin: false, busy: false, pending: 0, conflict: false, error: null, lastSync: null, storageError: false }));
let csrf = '';
let epoch = -1;
const owner = crypto.randomUUID();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('wipster-session-v1') : null;
export function announce() { channel?.postMessage('change'); window.dispatchEvent(new Event('wipster-web-change')); }
export function failure(error: unknown, storage = false) {
  useWeb.setState({ error: storage ? 'Не удалось сохранить изменения на устройстве. Проверьте свободное место и повторите сохранение; оставьте редактор открытым.' : error instanceof TypeError || (error instanceof Error && ['Load failed','Failed to fetch'].includes(error.message)) ? 'Нет связи с сервером. Изменения на устройстве сохранены; отправим их при подключении.' : error instanceof Error ? error.message : String(error), storageError: storage || useWeb.getState().storageError });
}
export async function current(): Promise<Control & { account: Account }> {
  const c = await control(s => ({ ...s }), false);
  if (c.blocked || !c.account || c.epoch !== epoch) throw new Error('Аккаунт изменился. Откройте Wipster заново.');
  return c as Control & { account: Account };
}
export async function assertCurrent(expected: Control) {
  const c = await current();
  if (c.epoch !== expected.epoch || c.account.account_id !== expected.account?.account_id) throw new Error('Аккаунт изменился. Старая операция остановлена.');
  return c;
}
export class ApiError extends Error { constructor(public status: number, public body: any) { super(({ unauthorized: 'Войдите снова. Локальные изменения сохранены.', conflict: 'Изменения пересеклись с другим устройством.', wip_limit: 'Превышен лимит задач в работе.', account_changed: 'Аккаунт изменился. Синхронизация остановлена.' } as Record<string, string>)[body.error] ?? 'Не удалось связаться с Wipster. Повторите попытку.'); } }
type SendGuard = (()=>Promise<void>) | SessionGuard;
const authPaths=new Set(['claim','yandex/start','yandex/status','yandex/finish','yandex/cancel','logout']);
export async function request(path: string, body?: object | string, account?: string, retryCsrf = true, guard?:SendGuard): Promise<any> {
  const authGuard=guard && 'fence' in guard ? guard as SessionGuard : undefined;
  if(body!==undefined&&authPaths.has(path)){
    if(!authGuard)throw new Error('Для входа требуется защищённая операция.');
    if(path!=='claim'&&!authGuard.claimed){await request('claim',{},undefined,true,authGuard);authGuard.claimed=true;}
  }
  const bindingId=authGuard?.browserId??await control(c=>c.browserId,false);
  // Last await before dispatch validates ownership and epoch, including every
  // hidden CSRF bootstrap/retry. Never dispatch an unguarded auth mutation.
  await guard?.();
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),12000);
  const cancelled=()=>abort.abort();authGuard?.signal.addEventListener('abort',cancelled,{once:true});
  try {
    const response=await fetch('/api/v1/web/'+path,{
      method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:abort.signal,
      headers:{...(body!==undefined?{'Content-Type':'application/json','X-CSRFToken':csrf}:{}),...(account?{'X-Wipster-Account':account}:{}),...(bindingId?{'X-Wipster-Browser':bindingId}:{}),...(authGuard?{'X-Wipster-Auth-Generation':String(authGuard.fence)}:{})},
      body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),
    });
    await guard?.();
    const reader=response.body?.getReader();let raw='',bytes=0;const decoder=new TextDecoder();
    if(!reader)throw new Error('Пустой ответ сервера.');
    while(true){const part=await reader.read();await guard?.();if(part.done)break;bytes+=part.value.byteLength;if(bytes>16*1024*1024){await reader.cancel();throw new Error('Ответ сервера слишком большой.');}raw+=decoder.decode(part.value,{stream:true});}
    raw+=decoder.decode();
    if(response.status===403&&body!==undefined&&retryCsrf&&!response.headers.get('Content-Type')?.includes('application/json')){
      await request('session',undefined,undefined,true,guard);await guard?.();return request(path,body,account,false,guard);
    }
    let result:any;try{result=JSON.parse(raw);}catch{throw new Error('Сервер вернул неожиданный ответ. Повторите попытку.');}
    if(!response.ok)throw new ApiError(response.status,result);
    if(path==='session'&&authGuard)await authGuard.observe(result.browser_id,result.auth_generation);
    await guard?.();if(result.csrf)csrf=result.csrf;return result;
  }finally{clearTimeout(timer);authGuard?.signal.removeEventListener('abort',cancelled);}
}
async function adopt(c: Control) {
  if (c.epoch < epoch) return;
  const changed = epoch !== c.epoch;
  epoch = c.epoch;
  useWeb.setState({ ready: true, account: c.blocked ? null : c.account, blocked: c.blocked, ...((changed || c.blocked) ? {pending:0,conflict:false,lastSync:null} : {}) });
  if (changed) window.dispatchEvent(new Event('wipster-account-change'));
  if (!c.blocked && c.account) await status();
}
export async function status() {
  const c = await current();
  const result = await workspace(c.account.account_id, s => ({ pending: Object.values(s.entities).filter(e => e.dirty).length, conflict: s.conflicts }), false);
  await assertCurrent(c); useWeb.setState(result);
}
export async function initialize() {
  try {
    await sessionLock(async (assertHeld) => {
      const before = await control(s => ({ ...s }), false);
      try {
        const remote = await request('session',undefined,undefined,true,assertHeld); await assertHeld();
        if ((await control(s => s.epoch, false)) !== before.epoch) { await adopt(await control(s => ({...s}), false)); return; }
        if (before.revoke) {
          await request('logout', {}, before.revoke,true,assertHeld); await assertHeld();
          await control(s => {
            if (s.epoch !== before.epoch || s.revoke !== before.revoke) return;
            delete s.revoke; s.blocked = true; s.account = null; s.epoch++; assertHeld.epoch=s.epoch;
          });
          useWeb.setState({ pendingLogin: false, error: null }); announce();
        } else {
          await control(s => {
            if (s.epoch !== before.epoch) return;
            if (remote.account && s.account && s.account.account_id !== remote.account.account_id) {
              s.blocked = true; s.epoch++; assertHeld.epoch=s.epoch;
            } else if (remote.account && !s.blocked) {
              s.account = remote.account; if (!before.account) s.epoch++; assertHeld.epoch=s.epoch;
            }
          });
          const latest = await control(s => ({ ...s }), false);
          useWeb.setState({ pendingLogin: !!remote.pending && !remote.account && !latest.revoke });
          if (remote.account && latest.blocked && latest.account) failure(new Error('Аккаунт в другом окне изменился. Локальная работа сохранена. Выйдите и войдите в нужный аккаунт.'));
          else if (!remote.account && latest.account && navigator.onLine) failure(new Error('Для отправки изменений войдите снова. Данные на устройстве сохранены.'));
        }
      } catch (e) { failure(e); }
      await adopt(await control(s => ({ ...s }), false));
    });
  } catch (e) { useWeb.setState({ ready: true }); failure(e, e instanceof DOMException); }
}
channel?.addEventListener('message', () => { void control(s => ({ ...s }), false).then(c => { if (c.epoch > epoch || c.revoke) useWeb.setState({pendingLogin:false}); return adopt(c); }).then(() => window.dispatchEvent(new Event('wipster-web-change'))).catch(e => failure(e, true)); });
export async function startLogin() {
  const target = await sessionLock(async (assertHeld) => {
    const before = await control(s => ({ ...s }), false);
    if (before.revoke) throw new Error('Для завершения выхода подключитесь к сети. Изменения сохранены.');
    await request('session',undefined,undefined,true,assertHeld);
    const result = await request('yandex/start', { device_name: 'Wipster Web' },undefined,true,assertHeld); await assertHeld();
    return { url: result.authorization_url as string, epoch: before.epoch };
  });
  // Release the durable fallback lease before navigating away. Page teardown
  // must not strand the originating PWA behind its own auth-operation lease.
  const latest = await control(s => ({ ...s }), false);
  if (latest.epoch !== target.epoch || latest.revoke) return;
  useWeb.setState({ pendingLogin: true, error: null });
  window.location.assign(target.url);
}
export async function completeLogin() {
  await sessionLock(async (assertHeld) => {
    const before = await control(c => ({ ...c }), false);
    if (before.revoke || !useWeb.getState().pendingLogin) return;
    const s = await request('yandex/status', {},undefined,true,assertHeld); await assertHeld();
    if (['cancelled', 'denied', 'failed'].includes(s.status)) { useWeb.setState({pendingLogin:false}); throw new Error('Вход отменён. Начните снова.'); }
    if (s.status !== 'ready' && s.status !== 'finished') return;
    const result = await request('yandex/finish', {},undefined,true,assertHeld); await assertHeld();
    const accepted = await control(c => {
      if (c.epoch !== before.epoch || c.revoke) return false;
      c.account = result.account; c.blocked = false; c.epoch++; assertHeld.epoch=c.epoch; return true;
    });
    if (!accepted) return;
    await adopt(await control(c => ({ ...c }), false));
    useWeb.setState({ pendingLogin: false, error: null }); announce();
  });
}
export async function cancelLogin() {
  await control(c => { c.epoch++; });
  useWeb.setState({ pendingLogin: false });
  await sessionLock(async (assertHeld) => { await request('yandex/cancel', {},undefined,true,assertHeld); await assertHeld(); });
}
export async function logout() {
  const before = await control(s => { const id = s.account?.account_id; if (id) s.revoke = id; s.blocked = true; s.epoch++; return { ...s }; });
  useWeb.setState({pendingLogin:false}); await adopt(before); announce();
  try {
    await sessionLock(async (assertHeld) => {
      await request('session',undefined,undefined,true,assertHeld);
      await request('logout', {}, before.revoke,true,assertHeld); await assertHeld();
      await control(s => { if (s.epoch === before.epoch) { delete s.revoke; s.account = null; } });
    });
    useWeb.setState({ error: null, pendingLogin:false }); announce();
  } catch { useWeb.setState({ error: 'Вы вышли на этом устройстве. Подключитесь к сети, чтобы завершить отзыв доступа. Неотправленные изменения сохранены.' }); }
}

const leaseMs = 30000;
export async function synchronize() {
  if (useWeb.getState().busy || !useWeb.getState().account || useWeb.getState().blocked) return;
  useWeb.setState({ busy: true });
  let id = '', fence = 0;
  try {
    const c = await current(); id = c.account.account_id;
    const acquired = await workspace(id, s => {
      if (s.lease && s.lease.expires > Date.now() && s.lease.owner !== owner) return 0;
      fence = (s.lease?.fence ?? 0) + 1; s.lease = { owner, fence, expires: Date.now() + leaseMs }; return fence;
    });
    if (!acquired) return;
    const assertLease = (s: import('./db').Workspace) => {
      if (s.lease?.owner !== owner || s.lease.fence !== fence || s.lease.expires < Date.now()) throw new Error('Другая вкладка продолжает синхронизацию. Повторите попытку.');
      s.lease.expires = Date.now() + leaseMs;
    };
    // Every network call bounded < lease TTL. Every post-network write fences.
    const boot = await request('session',undefined,undefined,true,()=>assertCurrent(c).then(()=>{}));
    if (boot.account?.account_id !== id) throw new ApiError(401, { error: 'unauthorized' });
    await assertCurrent(c);
    const batch = await workspace(id, s => {
      assertLease(s);
      if (s.conflicts) return null;
      if (s.batch) return s.batch;
      const dirty = Object.values(s.entities).filter(e => e.dirty);
      if (!dirty.length) return null;
      const text = JSON.stringify({ batch_id: crypto.randomUUID(), operations: dirty.map(e => ({ kind: e.kind, id: e.id, base_version: e.version, data: e.data })) });
      if (dirty.length > 5000 || new TextEncoder().encode(text).length > 7 * 1024 * 1024) throw new Error('Очередь слишком велика для одной отправки. Сохраните копию и обратитесь за помощью. Данные не удалены.');
      return s.batch = { text, revisions: Object.fromEntries(dirty.map(e => [e.key, e.revision])) };
    });
    if (batch) {
      try {
        const ack = await request('sync/push', batch.text, id,true,()=>assertCurrent(c).then(()=>{}));
        await assertCurrent(c);
        await workspace(id, s => { assertLease(s); if (s.batch?.text !== batch.text) throw new Error('Очередь изменилась.');
          for (const change of ack.changes as Change[]) { const key = keyOf(change.kind, change.id), e = s.entities[key]; if (e) { e.version = change.version; if (e.revision === batch.revisions[key]) { e.dirty = false; delete e.baseData; } else { e.baseData = JSON.parse(batch.text).operations.find((o: any) => keyOf(o.kind,o.id) === key)?.data; } } }
          delete s.batch;
        });
      } catch (e) {
        if (e instanceof ApiError && (e.status === 409 || e.status === 422)) {
          await assertCurrent(c); await workspace(id, s => { assertLease(s); s.conflicts = true; });
        } else throw e;
      }
    }
    let more = true;
    while (more) {
      const cursor = await workspace(id, s => { assertLease(s); return Math.max(s.cursor, s.stagedCursor); });
      const page = await request('sync/pull?cursor=' + cursor + '&limit=200', undefined, id,true,()=>assertCurrent(c).then(()=>{}));
      await assertCurrent(c);
      if (page.cursor < cursor || (page.has_more && page.cursor <= cursor)) throw new Error('Некорректный курсор синхронизации.');
      await workspace(id, s => { assertLease(s); for (const item of page.changes as Change[]) s.staged[keyOf(item.kind, item.id)] = item; s.stagedCursor = page.cursor; });
      more = page.has_more;
    }
    await assertCurrent(c);
    await workspace(id, s => {
      assertLease(s);
      // A dirty reference can depend on an otherwise clean remote deletion.
      // If any local work intersects a newer feed, retain the whole graph until
      // explicit resolution. No partial graph/cursor advance on conflict.
      const dirty = Object.values(s.entities).some(e => e.dirty);
      const newer = Object.entries(s.staged).some(([key, e]) => e.version > (s.entities[key]?.version ?? 0));
      if (dirty && newer) s.conflicts = true;
      if (s.conflicts) return;
      for (const [key, remote] of Object.entries(s.staged)) {
        const old = s.entities[key]; if (old && remote.version <= old.version) continue;
        s.entities[key] = { ...remote, key, revision: (old?.revision ?? 0) + 1, dirty: false };
      }
      s.cursor = s.stagedCursor; s.staged = {};
    });
    useWeb.setState({ error: null, lastSync: new Date().toISOString() }); announce();
  } catch (e) { failure(e, e instanceof DOMException && ['QuotaExceededError', 'InvalidStateError', 'UnknownError'].includes(e.name)); }
  finally {
    if (id && fence) await workspace(id, s => { if (s.lease?.owner === owner && s.lease.fence === fence) s.lease.expires = 0; }).catch(e => failure(e, true));
    await status().catch(() => {}); useWeb.setState({ busy: false });
  }
}
export async function resolveConflict(choice: 'cloud' | 'local') {
  const c = await current();
  await workspace(c.account.account_id, s => {
    if (!s.conflicts) return;
    s.recovery.push({ at: new Date().toISOString(), entities: structuredClone(s.entities), reason: 'Explicit ' + choice });
    for (const [key, remote] of Object.entries(s.staged)) {
      const old = s.entities[key];
      if (choice === 'local' && old?.dirty) {
        if (remote.data === null) throw new Error('Объект удалён на другом устройстве. Сохраните копию, затем выберите данные из облака.');
        old.version = remote.version; old.baseData = remote.data;
      } else s.entities[key] = { ...remote, key, revision: (old?.revision ?? 0) + 1, dirty: false };
    }
    if (choice === 'cloud') for (const e of Object.values(s.entities)) if (e.dirty) {
      // Unsynced entities absent from the feed are kept in recovery only.
      if (!s.staged[e.key]) { if (e.version === 0) delete s.entities[e.key]; else { e.data = e.baseData ?? null; e.dirty = false; delete e.baseData; } }
    }
    delete s.batch; s.cursor = s.stagedCursor; s.staged = {}; s.conflicts = false;
  });
  announce(); await status(); await synchronize();
}
export async function exportWork() {
  const c = await control(s => ({ ...s }), false);
  if (!c.account) return;
  const data = await workspace(c.account.account_id, s => s, false);
  const blob = new Blob([JSON.stringify({ account: c.account.account_id, saved_at: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'wipster-recovery.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
