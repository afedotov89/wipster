import type { TaskStatus, Priority, Estimate } from "./tauri";
import type { Translations } from "@/i18n";

export const STATUS_COLUMNS: TaskStatus[] = ["queue", "doing", "done"];

export const statusLabel = (t: Translations, s: TaskStatus): string =>
  ({ inbox: t.statusInbox, queue: t.statusQueue, doing: t.statusDoing, done: t.statusDone })[s];

export const STATUS_COLORS: Record<TaskStatus, string> = {
  inbox: "#95a5a6",
  queue: "#3498db",
  doing: "#e67e22",
  done: "#27ae60",
};

export const priorityLabel = (t: Translations, p: Priority): string =>
  ({ p0: t.priorityCritical, p1: t.priorityHigh, p2: t.priorityMedium, p3: t.priorityLow })[p];

export const PRIORITY_COLORS: Record<Priority, string> = {
  p0: "#e74c3c",
  p1: "#e67e22",
  p2: "#f1c40f",
  p3: "#95a5a6",
};

export const estimateLabel = (t: Translations, e: Estimate): string =>
  ({ s: t.estimateS, m: t.estimateM, l: t.estimateL })[e];

export const PRIORITIES: Priority[] = ["p0", "p1", "p2", "p3"];
export const ESTIMATES: Estimate[] = ["s", "m", "l"];

export const WIP_LIMIT = 3;
