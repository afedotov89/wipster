import { isTauri } from "@tauri-apps/api/core";
import { readDraft, retainDraft } from "@/browser/drafts";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTaskStore } from '@/stores/taskStore';
import type { Task } from '@/utils/tauri';

export const DRAFT_FIELDS = ['title', 'dod', 'due', 'time_estimate', 'promised_to', 'comment', 'tracker_url', 'checklist'] as const;
export type DraftField = typeof DRAFT_FIELDS[number];
const text = (value: string | null) => value ?? '';
type Entry = { base: string | null; value: string; error?: string };
type Entries = Record<DraftField, Entry>;
const initial = (task?: Task) => Object.fromEntries(DRAFT_FIELDS.map(field => [field, { base: task?.[field] ?? null, value: text(task?.[field] ?? null) }])) as Entries;

/** Field baselines outlive object refreshes. A blur uses a native atomic compare
 * and set; a refresh that has not reached React yet cannot be overwritten either. */
export function useTaskDrafts(task?: Task) {
  const current = useRef(task);
  current.current = task;
  const selected = useRef(task?.id);
  const entries = useRef(initial(task));
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
        if (e.value === text(e.base) || e.value === text(latest)) {
          entries.current[field] = { base: latest, value: text(latest) };
        }
      }
    }
    publish();
  }, [task, publish]);

  useEffect(() => {
    if (isTauri() || !task?.id) return;
    const id=task.id; let cancelled=false;
    for (const field of DRAFT_FIELDS) void readDraft(id+':'+field).then(saved => {
      if (!cancelled && saved && entries.current[field].value===text(entries.current[field].base)) { entries.current[field]=saved; publish(); }
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
    entries.current[field] = { ...e, value, error: undefined };
    if (!isTauri() && current.current?.id) void retainDraft(current.current.id+":"+field, entries.current[field]);
    publish();
  }, [publish]);

  const discard = useCallback((field: DraftField) => {
    const latest = current.current?.[field] ?? null;
    entries.current[field] = { base: latest, value: text(latest) };
    if (!isTauri() && current.current?.id) void retainDraft(current.current.id+":"+field, undefined);
    publish();
  }, [publish]);

  const commit = useCallback(async (field: DraftField, overwrite = false) => {
    const task = current.current;
    if (!task) return;
    const e = { ...entries.current[field] };
    if (e.value === text(e.base)) return; // Focusing/blurring a clean field is never a write.
    if (!overwrite && text(task[field]) !== text(e.base)) { publish(); return; }
    const value = field === 'title' ? e.value.trim() : e.value;
    if (field === 'title' && !value) return;
    try {
      const result = await update(task.id, field, overwrite ? task[field] : e.base, value || null);
      if (current.current?.id !== task.id) return;
      const now = entries.current[field];
      if (result.applied || now.value === text(result.task[field])) {
        entries.current[field] = { base: result.task[field], value: now.value === e.value ? text(result.task[field]) : now.value };
        if (!isTauri()) void retainDraft(task.id+':'+field, entries.current[field].value===text(entries.current[field].base)?undefined:entries.current[field]);
      } else {
        entries.current[field] = { ...now, error: 'changed' };
      }
    } catch {
      if (current.current?.id === task.id) entries.current[field] = { ...entries.current[field], error: 'save_failed' };
    }
    publish();
  }, [update, publish]);

  const conflicts = task ? DRAFT_FIELDS.filter(field => {
    const e = entries.current[field];
    return e.error || (e.value !== text(e.base) && text(task[field]) !== text(e.base) && e.value !== text(task[field]));
  }) : [];
  return { value: (field: DraftField) => entries.current[field].value, change, commit, discard, conflicts };
}
