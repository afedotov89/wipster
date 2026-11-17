import { isTauri } from "@tauri-apps/api/core";
import { readDraft, retainDraft } from "@/browser/drafts";
import { useEffect, useRef, useState } from 'react';
const equal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Draft buffer for custom values; native checks its exact persisted baseline. */
export function useValueDraft(value: unknown, save: (next: unknown, expected: unknown) => Promise<{ applied: boolean; value: unknown }>, draftKey?: string) {
  const entry = useRef({ base: value, draft: value, error: false });
  const current = useRef(value); current.current = value;
  const [, render] = useState(0);
  const publish = () => render(n => n + 1);
  useEffect(() => {
    const e = entry.current;
    if (equal(e.draft, e.base) || equal(e.draft, value)) entry.current = { base: value, draft: value, error: false };
    render(n => n + 1);
  }, [value]);
  useEffect(() => {
    if (isTauri() || !draftKey) return;
    let cancelled=false; void readDraft(draftKey).then(saved=>{if(!cancelled&&saved&&equal(entry.current.draft,entry.current.base)){entry.current=saved;publish();}});
    return()=>{cancelled=true;};
  }, [draftKey]);
  useEffect(() => {
    if(isTauri())return;
    const guard=(e:BeforeUnloadEvent)=>{if(!equal(entry.current.draft,entry.current.base)){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);
  }, []);
  const change = (next: unknown) => { entry.current = { ...entry.current, draft: next, error: false }; if(!isTauri()&&draftKey)void retainDraft(draftKey,entry.current); publish(); };
  const discard = () => { entry.current = { base: current.current, draft: current.current, error: false }; if(!isTauri()&&draftKey)void retainDraft(draftKey,undefined); publish(); };
  const commit = async (next = entry.current.draft, overwrite = false) => {
    const e = { ...entry.current }; entry.current.draft = next;
    if (equal(e.base, next)) return;
    if (!overwrite && !equal(current.current, e.base)) { publish(); return; }
    try {
      const result = await save(next, overwrite ? current.current : e.base);
      const now = entry.current;
      if (result.applied || equal(now.draft, result.value)) {
        entry.current = { base: result.value, draft: equal(now.draft, next) ? result.value : now.draft, error: false };
        if(!isTauri()&&draftKey)void retainDraft(draftKey,equal(entry.current.draft,entry.current.base)?undefined:entry.current);
      } else entry.current = { ...now, error: true };
    } catch { entry.current.error = true; }
    publish();
  };
  const e = entry.current;
  return { value: e.draft, change, discard, commit,
    conflict: e.error || (!equal(e.draft, e.base) && !equal(value, e.base) && !equal(e.draft, value)) };
}
