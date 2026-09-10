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

/**
 * Cap on tasks in Doing before the user changes it in Settings. The live value
 * lives in the settings store; this is only the value shown until it loads and
 * the fallback when the backend cannot be reached. Keep both in step with
 * `wip_guard::DEFAULT_WIP_LIMIT`.
 */
export const DEFAULT_WIP_LIMIT = 3;

/** Guard rails the settings control obeys, mirroring `wip_guard`. */
export const MIN_WIP_LIMIT = 1;
export const MAX_WIP_LIMIT = 20;

/** Height of the macOS titlebar the webview draws under in "Overlay" mode. */
export const TITLEBAR_HEIGHT = 28;

/**
 * Horizontal space the traffic lights occupy. Anything drawn in the titlebar
 * band — which in "Overlay" mode means anything at the top of the window — has
 * to start after this or it ends up underneath the close/minimise/zoom buttons.
 */
export const TRAFFIC_LIGHTS_WIDTH = 80;

/**
 * Height of the band each column puts its title in.
 *
 * It *is* the titlebar band: the window buttons float over its left end, the
 * titles sit beside them, and both columns centre their heading in it — so the
 * two titles share a line and the strip beside the window buttons is not left
 * empty. Anything under the buttons has to start after
 * {@link TRAFFIC_LIGHTS_WIDTH}, and its height has to leave a project's 28px
 * icon room to breathe — the window buttons are positioned to match in
 * `tauri.conf.json`, so the two move together.
 */
export const HEADER_BAND_HEIGHT = 52;
