import type { Task, Project, TaskStatus } from "@/utils/tauri";
import type { Translations } from "@/i18n";

/** One ready-to-send command: a short chip, and the sentence the agent receives. */
export interface PromptSuggestion {
  id: string;
  label: string;
  prompt: string;
}

/** Everything the suggestions are allowed to look at. */
export interface SuggestionContext {
  view: "project" | "all-doing" | "archive";
  /** The task whose detail panel is open, if any — the strongest context there is. */
  task: Task | null;
  project: Project | null;
  /** Tasks of the current project (the board's own list). */
  tasks: Task[];
  doingTasks: Task[];
  archivedCount: number;
  wipLimit: number;
  /** Today as YYYY-MM-DD, so "overdue" is decided by the caller's clock. */
  today: string;
  /** Whether the tracker is connected — half the useful commands need it. */
  trackerReady: boolean;
  /** Commands this user types most often, most-repeated first. */
  recentPrompts: string[];
  /**
   * Which of the "the app can do this too" tips to show. Rotated by the caller
   * so the panel does not repeat the same one every morning.
   */
  appTipIndex: number;
}

/** How many chips a 420px panel can carry without becoming a menu. */
const MAX_SUGGESTIONS = 4;

/**
 * What is worth asking the agent right now.
 *
 * Three rules kept this list honest:
 *
 * - Every suggestion must be something the agent can actually carry out with the
 *   tools it has. It can read a tracker issue by key, but it cannot *search* the
 *   tracker, so "find the ticket for this task" is not offered however useful it
 *   sounds — a suggestion that fails is worse than no suggestion.
 * - Nothing that a single click already does. Starting or finishing a task is a
 *   button on the card; spending a chip and an LLM round-trip on it is theatre.
 * - Every suggestion must be true of what is on screen: a field that is really
 *   empty, tasks that are really overdue, a limit that is really reached.
 */
export function suggestPrompts(ctx: SuggestionContext, t: Translations): PromptSuggestion[] {
  const suggestions: PromptSuggestion[] = [];
  const add = (id: string, label: string, prompt: string) =>
    suggestions.push({ id, label, prompt });

  // --- The open task comes first: it is the most specific thing on screen.
  if (ctx.task) {
    const task = ctx.task;
    const checklist = parseChecklist(task.checklist);
    const hasTracker = !!task.tracker_url?.trim();
    const missing =
      !task.time_estimate?.trim() ||
      !task.dod?.trim() ||
      !task.priority ||
      checklist.length === 0;

    if (hasTracker && missing) {
      add("fill-from-tracker", t.hintFillTracker, t.hintFillTrackerCmd);
    }
    if (!hasTracker && ctx.trackerReady) {
      add("find-ticket", t.hintFindTicket, t.hintFindTicketCmd);
    }
    if (checklist.length === 0) {
      add("break-down", t.hintBreakDown, t.hintBreakDownCmd);
    }
    if (!task.time_estimate?.trim()) {
      add("estimate", t.hintEstimate, t.hintEstimateCmd);
    }
    if (!task.dod?.trim()) {
      add("definition-of-done", t.hintDod, t.hintDodCmd);
    }
  }

  // --- Then the board the user is looking at.
  if (ctx.view === "all-doing" || (ctx.view === "project" && ctx.doingTasks.length > 0)) {
    if (ctx.doingTasks.length >= ctx.wipLimit) {
      add("unload-wip", t.hintUnloadWip, t.hintUnloadWipCmd(ctx.doingTasks.length, ctx.wipLimit));
    }
  }
  if (ctx.view === "all-doing") {
    add("doing-summary", t.hintDoingSummary, t.hintDoingSummaryCmd);
  }

  if (ctx.view === "project" && ctx.project) {
    const live = ctx.tasks.filter((task) => !task.archived_at);
    const overdue = live.filter((task) => isOverdue(task, ctx.today));
    if (overdue.length > 0) {
      add("overdue", t.hintOverdue, t.hintOverdueCmd);
    }
    if (live.length === 0) {
      add("seed-project", t.hintSeedProject, t.hintSeedProjectCmd(ctx.project.name));
    } else {
      const queued = live.filter((task) => task.status === "queue");
      const bare = queued.filter((task) => !task.time_estimate?.trim() || !task.dod?.trim());
      if (bare.length >= 2) {
        add("fill-queue", t.hintFillQueue, t.hintFillQueueCmd);
      }
      add("what-next", t.hintWhatNext, t.hintWhatNextCmd);
    }
  }

  if (ctx.view === "archive" && ctx.archivedCount > 0) {
    add("review-archive", t.hintReviewArchive, t.hintReviewArchiveCmd);
  }

  // One tip about the app itself, when there is no task to talk about — the
  // point of these is that a user would never guess they exist, so one is kept
  // in view and rotated rather than shown once and forgotten.
  if (!ctx.task) {
    const tips = APP_TIPS;
    const index = ((ctx.appTipIndex % tips.length) + tips.length) % tips.length;
    const tip = tips[index];
    suggestions.splice(MAX_SUGGESTIONS - 1);
    suggestions.push({
      id: `tip:${tip}`,
      label: t.appTipLabel(tip),
      prompt: t.appTipCommand(tip),
    });
  }

  // Then what this user actually asks for. Rules know the screen; history knows
  // the person, and the two rarely say the same thing — where they do, the rule
  // wins, because it is phrased for what is open right now.
  const known = new Set(suggestions.map((s) => normalise(s.prompt)));
  // History arrives from the backend, so it is treated as data of unknown shape
  // rather than a promise: a panel with no hints is a small loss, a window that
  // renders nothing is not.
  const history = Array.isArray(ctx.recentPrompts) ? ctx.recentPrompts : [];
  for (const prompt of history) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    const text = typeof prompt === "string" ? prompt.trim() : "";
    if (!text || known.has(normalise(text)) || isOneOff(text)) continue;
    known.add(normalise(text));
    add(`recent:${normalise(text)}`, shorten(text), text);
  }

  return suggestions.slice(0, MAX_SUGGESTIONS);
}

/** Longest chip label before it stops being a chip. */
const LABEL_MAX = 28;

/**
 * The abilities a user would never guess the assistant has: the app's own
 * controls. Shown one at a time so the panel stays a hint, not a menu.
 */
export const APP_TIPS = ["theme", "language", "wip", "archive", "undo", "history"] as const;
export type AppTip = (typeof APP_TIPS)[number];

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function shorten(text: string): string {
  const single = text.trim().replace(/\s+/g, " ");
  const cut = single.length <= LABEL_MAX ? single : `${single.slice(0, LABEL_MAX - 1).trimEnd()}…`;
  // A chip is a label, not a sentence the user once typed in a hurry.
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

/**
 * Was this command about one particular thing?
 *
 * "Move RAGSERVIS-221 to IdChess" was useful once and is noise forever after,
 * while "what should I do next" is worth a button. Issue keys, ids and quoted
 * titles are what tell the two apart.
 */
function isOneOff(text: string): boolean {
  return (
    /\b[A-ZА-Я][A-ZА-Я0-9]+-\d+\b/.test(text) ||
    /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(text) ||
    /[«"'][^«»"']{4,}[»"']/.test(text)
  );
}

function parseChecklist(raw: string): unknown[] {
  try {
    const items = JSON.parse(raw || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

const CLOSED: TaskStatus[] = ["done"];

function isOverdue(task: Task, today: string): boolean {
  return !!task.due && task.due < today && !CLOSED.includes(task.status);
}
