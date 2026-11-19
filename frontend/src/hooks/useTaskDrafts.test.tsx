import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
import { useTaskDrafts } from './useTaskDrafts';
import { useTaskStore } from '@/stores/taskStore';
import type { Task } from '@/utils/tauri';
let db: Task;
let release: () => void;
let hold: boolean;
const list = (...names: string[]) => JSON.stringify(names.map(text => ({ text, done: false })));
function editor() { return useTaskDrafts(useTaskStore(s => s.tasks[0])); }
beforeEach(() => {
 db = { id: 'native-draft', title: 'Original', checklist: list('Materials','Send','Check') } as Task;
 useTaskStore.setState({ tasks: [db], doingTasks: [], archivedTasks: [] });
 hold = true; invoke.mockReset();
 invoke.mockImplementation(async (command: string, args: any) => {
  if (command !== 'save_task_draft') throw Error(command);
  const applied = db[args.field as keyof Task] === args.expected;
  if (applied) db = { ...db, [args.field]: args.value };
  const result = { applied, task: { ...db } };
  if (hold) { hold = false; await new Promise<void>(resolve => { release = resolve; }); }
  return result;
 });
});
afterEach(cleanup);
it('serializes rapid ABA reorder and deletion against acknowledged native CAS baselines', async () => {
 const { result } = renderHook(editor);
 let a!: Promise<void>, b!: Promise<void>, c!: Promise<void>;
 act(() => { result.current.change('checklist',list('Send','Materials','Check')); a=result.current.commit('checklist'); });
 await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
 act(() => { result.current.change('checklist',list('Materials','Send','Check')); b=result.current.commit('checklist'); });
 act(() => { result.current.change('checklist',list('Materials','Send')); c=result.current.commit('checklist'); });
 expect(result.current.value('checklist')).toBe(list('Materials','Send'));
 expect(invoke).toHaveBeenCalledTimes(1); // never send overlapping stale CAS writes
 await act(async () => { release(); await Promise.all([a,b,c]); });
 expect(db.checklist).toBe(list('Materials','Send'));
 expect(result.current.value('checklist')).toBe(db.checklist);
 expect(result.current.conflicts).toEqual([]);
 expect(invoke.mock.calls.map(([,a]) => [a.expected,a.value])).toEqual([
  [list('Materials','Send','Check'),list('Send','Materials','Check')],
  [list('Send','Materials','Check'),list('Materials','Send','Check')],
  [list('Materials','Send','Check'),list('Materials','Send')],
 ]);
});
it('does not replace a newer equal-valued generation with a late trimmed acknowledgement', async () => {
 const { result } = renderHook(editor);let saved!: Promise<void>;
 act(() => { result.current.change('title',' First '); saved=result.current.commit('title'); });
 await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
 act(() => { result.current.change('title','Other'); result.current.change('title',' First '); });
 await act(async () => { release(); await saved; });
 expect(db.title).toBe('First');
 expect(result.current.value('title')).toBe(' First ');
});
it('keeps an intervening remote update and latest queued draft separate until explicit resolution', async () => {
 const { result } = renderHook(editor);let a!:Promise<void>,b!:Promise<void>;
 act(() => { result.current.change('checklist',list('Send','Materials','Check'));a=result.current.commit('checklist'); });
 await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
 act(() => { result.current.change('checklist',list('Materials','Send'));b=result.current.commit('checklist'); });
 db={...db,checklist:list('Remote')};
 await act(async () => { release(); await Promise.all([a,b]); });
 expect(db.checklist).toBe(list('Remote'));expect(result.current.value('checklist')).toBe(list('Materials','Send'));
 expect(result.current.conflicts).toContain('checklist');
 await act(async () => { await result.current.commit('checklist',true); });
 expect(db.checklist).toBe(list('Materials','Send'));
});
it('does not apply a late save or queued operation to another selected task', async () => {
 const { result } = renderHook(editor);let a!:Promise<void>,b!:Promise<void>;
 act(() => {result.current.change('title','First task');a=result.current.commit('title');});
 await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
 act(() => {result.current.change('title','Queued first task');b=result.current.commit('title');});
 act(() => {useTaskStore.setState({tasks:[{...db,id:'second-task',title:'Second task'}]});});
 await act(async()=>{release();await Promise.all([a,b]);});
 expect(result.current.value('title')).toBe('Second task');expect(invoke).toHaveBeenCalledTimes(1);
});
it('cancels queued older intent when the user explicitly chooses the remote value', async () => {
 const { result } = renderHook(editor);let a!:Promise<void>,b!:Promise<void>;
 act(()=>{result.current.change('title','First local');a=result.current.commit('title');});
 await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(1));
 act(()=>{result.current.change('title','Queued older local');b=result.current.commit('title');});
 db={...db,title:'Remote chosen'};
 act(()=>{useTaskStore.setState({tasks:[db]});});
 act(()=>{result.current.discard('title');});
 await act(async()=>{release();await Promise.all([a,b]);});
 expect(db.title).toBe('Remote chosen');expect(result.current.value('title')).toBe('Remote chosen');expect(result.current.conflicts).toEqual([]);
 expect(invoke).toHaveBeenCalledTimes(1);
});
