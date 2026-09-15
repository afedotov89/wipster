import type { FieldKind, TaskField } from "@/utils/tauri";
import type { Translations } from "@/i18n";

/**
 * What to call a field on screen.
 *
 * Built-in fields are named by the app, in the interface language — they are
 * the same field for everyone. A custom one is called whatever its author
 * called it, and is never translated.
 */
export function fieldLabel(field: TaskField, t: Translations): string {
  if (!field.builtin) return field.label ?? field.key;

  const names: Record<string, string> = {
    project_id: t.project,
    priority: t.priority,
    energy: t.energy,
    time_estimate: t.estimate,
    due: t.dueDate,
    promised_to: t.promisedTo,
    dod: t.definitionOfDone,
    checklist: t.steps,
    tracker_url: t.trackerUrl,
    comment: t.comment,
  };
  return names[field.key] ?? field.key;
}

/** The name of a type, as the picker and the field list show it. */
export function kindLabel(kind: FieldKind, t: Translations): string {
  return t.fieldKinds[kind] ?? kind;
}
