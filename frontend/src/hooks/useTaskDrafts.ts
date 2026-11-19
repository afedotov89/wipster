import { isTauri } from "@tauri-apps/api/core";
import { readDraft, retainDraft } from "@/browser/drafts";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTaskStore } from '@/stores/taskStore';
import type { Task } from '@/utils/tauri';

export const DRAFT_FIELDS = ['title', 'dod', 'due', 'time_estimate', 'promised_to', 'comment', 'tracker_url', 'checklist'] as const;
export type DraftField = typeof DRAFT_FIELDS[number];
const text = (value: string | null) => value ?? '';
type Entry = { base: string | null; value: string; error?: string; generation?: number; discardedGeneration?: number };
type Entries = Record<DraftField, Entry>;
const initial = (task?: Task) => Object.fromEntries(DRAFT_FIELDS.map(field => [field, { base: task?.[field] ?? null, value: text(task?.[field] ?? null) }])) as Entries;

/** Field baselines outlive object refreshes. A blur uses a native atomic compare
 * and set; a refresh that has not reached React yet cannot be overwritten either. */
export function useTaskDrafts(task?: Task) {
  const current = useRef(task);
  current.current = task;
  const selected = useRef(task?.id);
  const entries = useRef(initial(task));
  // Each field has one save chain. A second local intent must compare against
  // our acknowledged predecessor, not race it with the same old CAS baseline.
  const pending = useRef(new Map<DraftField, { owner: Entries; promise: Promise<void> }>());
  const saving = (field: DraftField) => pending.current.get(field)?.owner === entries.current;
  const [, render] = useState(0);
  const publish = useCallback(() => render(n => n + 1), []);
  const update = useTaskStore(s => s.updateIfCurrent);

  useEffect(() => {
    if (selected.current !== task?.id) {
      selected.current = task?.id;
      entries.current = initial(task);
    } else if (task) {
      for (const field of DRAFT_FIELDS) {
        const e = entries.current[field];
        const latest = task[field];
        if (!saving(field) && (e.value === text(e.base) || e.value === text(latest))) {
          entries.current[field] = { base: latest, value: text(latest), generation: e.generation };
        }
      }
    }
    publish();
  }, [task, publish]);

  useEffect(() => {
    if (isTauri() || !task?.id) return;
    const id=task.id; let cancelled=false;
    for (const field of DRAFT_FIELDS) void readDraft(id+':'+field).then(saved => {
      if (!cancelled && saved && !saving(field) && !entries.current[field].generation && entries.current[field].value===text(entries.current[field].base)) { entries.current[field]=saved; publish(); }
    });
    return () => { cancelled=true; };
  }, [task?.id, publish]);
  useEffect(() => {
    if (isTauri()) return;
    const guard=(event:BeforeUnloadEvent)=>{ if (DRAFT_FIELDS.some(f=>entries.current[f].value!==text(entries.current[f].base))) { event.preventDefault();event.returnValue=''; } };
    window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);
  }, []);

  const change = useCallback((field: DraftField, value: string) => {
    const e = entries.current[field];
    entries.current[field] = { ...e, value, error: undefined, generation: (e.generation ?? 0) + 1 };
    if (!isTauri() && current.current?.id) void retainDraft(current.current.id+":"+field, entries.current[field]);
    publish();
  }, [publish]);

  const discard = useCallback((field: DraftField) => {
    const latest = current.current?.[field] ?? null;
    const generation = (entries.current[field].generation ?? 0) + 1;
    entries.current[field] = { base: latest, value: text(latest), generation, discardedGeneration: generation };
    if (!isTauri() && current.current?.id) void retainDraft(current.current.id+":"+field, undefined);
    publish();
  }, [publish]);

  const commit = useCallback((field: DraftField, overwrite = false): Promise<void> => {
    const task = current.current;
    if (!task) return Promise.resolve();
    const owner = entries.current;
    const requested = { ...owner[field] };
    const previous = pending.current.get(field);
    const predecessor = previous?.owner === owner ? previous.promise : undefined;
    if (!predecessor && requested.value === text(requested.base)) return Promise.resolve();
    if (!predecessor && !overwrite && text(task[field]) !== text(requested.base)) { publish(); return Promise.resolve(); }
    const value = field === 'title' ? requested.value.trim() : requested.value;
    if (field === 'title' && !value) return Promise.resolve();
    const operation = (async () => {
      // Later saves wait for the preceding CAS acknowledgement. The first
      // starts immediately, preserving blur semantics for the native editor.
      if (predecessor) await predecessor;
      if (entries.current !== owner || current.current?.id !== task.id) return;
      const baseline = owner[field];
      // A remote CAS rejection still needs an explicit user choice. A queued
      // local intent may only advance a baseline acknowledged as our own save.
      if ((baseline.discardedGeneration ?? 0) > (requested.generation ?? 0)) return;
      if (!overwrite && baseline.error === 'changed') return;
      if (value === text(baseline.base)) return;
      try {
        const result = await update(task.id, field, overwrite ? current.current[field] : baseline.base, value || null);
        if (entries.current !== owner || current.current?.id !== task.id) return;
        const now = owner[field];
        if ((now.discardedGeneration ?? 0) > (requested.generation ?? 0)) return;
        if (result.applied || now.value === text(result.task[field])) {
          owner[field] = { ...now, base: result.task[field], value: now.generation === requested.generation ? text(result.task[field]) : now.value, error: undefined };
          if (!isTauri()) void retainDraft(task.id+':'+field, owner[field].value===text(owner[field].base)?undefined:owner[field]);
        } else {
          owner[field] = { ...now, error: 'changed' };
        }
      } catch {
        if (entries.current === owner && current.current?.id === task.id && (owner[field].discardedGeneration ?? 0) <= (requested.generation ?? 0)) owner[field] = { ...owner[field], error: 'save_failed' };
      }
    })();
    const completed = operation.finally(() => {
      if (pending.current.get(field)?.promise === completed) pending.current.delete(field);
      publish();
    });
    pending.current.set(field, { owner, promise: completed });
    return completed;
  }, [update, publish]);

  const conflicts = task ? DRAFT_FIELDS.filter(field => {
    const e = entries.current[field];
    return e.error || (e.value !== text(e.base) && text(task[field]) !== text(e.base) && e.value !== text(task[field]));
  }) : [];
  return { value: (field: DraftField) => entries.current[field].value, change, commit, discard, conflicts };
}
