import type { TaskField } from "@/utils/tauri";

/**
 * Which column a field sits in when a task fills the window.
 *
 * Two kinds of thing live on a task. What it *is* — project, priority, dates,
 * an estimate, a choice — is a short answer, and a column of short answers
 * reads best narrow. What it *carries* — the criterion, the steps, texts,
 * links, files — wants the width.
 *
 * The type decides by default, which is why a custom field lands somewhere
 * sensible without being told; `column_side` is the user overruling that for
 * one particular field.
 */
const NARROW_BY_NATURE = ["select", "date", "number", "checkbox", "text"];

export type FieldColumn = "main" | "side";

export function columnOf(field: TaskField): FieldColumn {
  if (field.column_side === "main" || field.column_side === "side") return field.column_side;
  return NARROW_BY_NATURE.includes(field.kind) ? "side" : "main";
}
