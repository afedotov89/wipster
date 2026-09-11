import { describe, it, expect } from "vitest";
import { suggestPrompts, type SuggestionContext } from "@/utils/promptSuggestions";
import ru from "@/i18n/ru";
import type { Translations } from "@/i18n";
import type { Task, Project } from "@/utils/tauri";

const t = ru as unknown as Translations;

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Задача",
  project_id: "p1",
  status: "queue",
  priority: "p1",
  energy: null,
  due: null,
  estimate: null,
  time_estimate: "2ч",
  tags: "",
  dod: "Готово, когда смержено",
  checklist: '[{"text":"шаг","done":false}]',
  next_step: null,
  return_ref: null,
  promised_to: null,
  comment: null,
  tracker_url: null,
  position: 1,
  completed_at: null,
  archived_at: null,
  created_at: "",
  updated_at: "",
  ...over,
});

const project: Project = {
  id: "p1",
  name: "Flexar",
  parent_id: null,
  icon: null,
  icon_image: null,
  icon_mono: false,
  color: null,
  order: 0,
  created_at: "",
  updated_at: "",
};

const context = (over: Partial<SuggestionContext> = {}): SuggestionContext => ({
  view: "project",
  task: null,
  project,
  tasks: [],
  doingTasks: [],
  archivedCount: 0,
  wipLimit: 3,
  today: "2026-09-09",
  trackerReady: false,
  recentPrompts: [],
  appTipIndex: 0,
  ...over,
});

const ids = (ctx: SuggestionContext) => suggestPrompts(ctx, t).map((s) => s.id);

describe("prompt suggestions", () => {
  it("says nothing about a task that is already filled in", () => {
    const filled = context({ task: task(), tasks: [task()] });
    expect(ids(filled)).not.toContain("break-down");
    expect(ids(filled)).not.toContain("estimate");
    expect(ids(filled)).not.toContain("definition-of-done");
  });

  it("offers the tracker only when there is a ticket and something to fill", () => {
    const linked = task({ tracker_url: "https://tracker.yandex.ru/FLEX-1", dod: null });
    expect(ids(context({ task: linked }))).toContain("fill-from-tracker");

    const complete = task({ tracker_url: "https://tracker.yandex.ru/FLEX-1" });
    expect(ids(context({ task: complete }))).not.toContain("fill-from-tracker");

    expect(ids(context({ task: task({ dod: null }) }))).not.toContain("fill-from-tracker");
  });

  it("names the field that is actually empty", () => {
    expect(ids(context({ task: task({ checklist: "[]" }) }))).toContain("break-down");
    expect(ids(context({ task: task({ time_estimate: null }) }))).toContain("estimate");
    expect(ids(context({ task: task({ dod: "" }) }))).toContain("definition-of-done");
  });

  it("survives a checklist that is not valid JSON", () => {
    expect(ids(context({ task: task({ checklist: "not json" }) }))).toContain("break-down");
  });

  it("offers to unload only once the limit is really reached", () => {
    const doing = [task({ id: "a", status: "doing" }), task({ id: "b", status: "doing" })];
    expect(ids(context({ view: "all-doing", doingTasks: doing, wipLimit: 3 }))).not.toContain(
      "unload-wip",
    );
    expect(ids(context({ view: "all-doing", doingTasks: doing, wipLimit: 2 }))).toContain(
      "unload-wip",
    );
  });

  it("puts the real numbers in the command it sends", () => {
    const doing = [task({ id: "a", status: "doing" }), task({ id: "b", status: "doing" })];
    const unload = suggestPrompts(
      context({ view: "all-doing", doingTasks: doing, wipLimit: 2 }),
      t,
    ).find((s) => s.id === "unload-wip");
    expect(unload?.prompt).toContain("2");
  });

  it("spots overdue tasks and ignores the ones already done", () => {
    expect(ids(context({ tasks: [task({ id: "late", due: "2026-09-01" })] }))).toContain("overdue");
    expect(
      ids(context({ tasks: [task({ id: "done", due: "2026-09-01", status: "done" })] })),
    ).not.toContain("overdue");
    expect(ids(context({ tasks: [task({ id: "soon", due: "2026-09-30" })] }))).not.toContain(
      "overdue",
    );
  });

  it("offers to seed an empty project and to plan a full one", () => {
    expect(ids(context({ tasks: [] }))).toContain("seed-project");
    expect(ids(context({ tasks: [] }))).not.toContain("what-next");
    expect(ids(context({ tasks: [task()] }))).toContain("what-next");
  });

  it("offers to fill the queue only when several tasks are bare", () => {
    const bare = task({ id: "b1", time_estimate: null, dod: null });
    expect(ids(context({ tasks: [bare] }))).not.toContain("fill-queue");
    expect(ids(context({ tasks: [bare, { ...bare, id: "b2" }] }))).toContain("fill-queue");
  });

  it("offers the archive only where the archive is", () => {
    expect(ids(context({ view: "archive", archivedCount: 3 }))).toContain("review-archive");
    // An empty archive has nothing to review; only the app tip remains.
    expect(ids(context({ view: "archive", archivedCount: 0 }))).toEqual(["tip:theme"]);
    expect(ids(context({ tasks: [task()] }))).not.toContain("review-archive");
  });

  it("never floods the panel, and the open task wins the space", () => {
    const empty = task({
      tracker_url: "https://tracker.yandex.ru/FLEX-1",
      dod: null,
      time_estimate: null,
      checklist: "[]",
    });
    const late = task({ id: "late", due: "2026-09-01", time_estimate: null, dod: null });
    const suggestions = suggestPrompts(
      context({ task: empty, tasks: [late, { ...late, id: "late2" }] }),
      t,
    );
    expect(suggestions.length).toBeLessThanOrEqual(4);
    expect(suggestions[0].id).toBe("fill-from-tracker");
  });

  it("offers to find a ticket only for a task that has none, with a tracker to search", () => {
    const unlinked = context({ task: task(), trackerReady: true });
    expect(ids(unlinked)).toContain("find-ticket");

    // No tracker connected — nothing to search.
    expect(ids(context({ task: task() }))).not.toContain("find-ticket");

    // Already linked — the useful offer is filling from it, not finding it.
    const linked = context({
      task: task({ tracker_url: "https://tracker.yandex.ru/FLEX-1" }),
      trackerReady: true,
    });
    expect(ids(linked)).not.toContain("find-ticket");
  });

  it("offers the commands this user actually types", () => {
    const suggestions = suggestPrompts(
      context({ recentPrompts: ["Что у меня горит на этой неделе?"] }),
      t,
    );
    const fromHistory = suggestions.find((s) => s.id.startsWith("recent:"));
    expect(fromHistory?.prompt).toBe("Что у меня горит на этой неделе?");
  });

  it("skips history that was about one particular thing", () => {
    const oneOff = context({
      recentPrompts: [
        "Перенеси RAGSERVIS-221 в проект IdChess",
        "Открой задачу abd3f5f4-72c4-4296-9efc-10d50e25f428",
        'Переименуй «Агенты для демо» в что-то другое',
      ],
    });
    expect(suggestPrompts(oneOff, t).filter((s) => s.id.startsWith("recent:"))).toEqual([]);
  });

  it("never repeats a command the rules already offer", () => {
    const same = context({
      task: task({ checklist: "[]" }),
      recentPrompts: [` ${t.hintBreakDownCmd.toUpperCase()} `],
    });
    const suggestions = suggestPrompts(same, t);
    expect(suggestions.filter((s) => s.prompt.toLowerCase().includes("разбей")).length).toBe(1);
  });

  it("shortens a long command to fit a chip but sends it whole", () => {
    const long = "Посмотри все мои проекты и скажи, где я застрял сильнее всего и почему";
    const suggestion = suggestPrompts(context({ recentPrompts: [long] }), t).find((s) =>
      s.id.startsWith("recent:"),
    );
    expect(suggestion?.label.length).toBeLessThanOrEqual(28);
    expect(suggestion?.label.endsWith("…")).toBe(true);
    expect(suggestion?.prompt).toBe(long);
  });

  it("keeps one rotating tip about the app itself when no task is open", () => {
    const first = suggestPrompts(context({ appTipIndex: 0 }), t).find((s) =>
      s.id.startsWith("tip:"),
    );
    const second = suggestPrompts(context({ appTipIndex: 1 }), t).find((s) =>
      s.id.startsWith("tip:"),
    );
    expect(first?.id).not.toBe(second?.id);
    expect(first?.prompt.length).toBeGreaterThan(10);

    // Rotation wraps rather than running off the end.
    const wrapped = suggestPrompts(context({ appTipIndex: 99 }), t).find((s) =>
      s.id.startsWith("tip:"),
    );
    expect(wrapped).toBeTruthy();
  });

  it("keeps the tip out of the way while a task is open", () => {
    const withTask = suggestPrompts(context({ task: task({ checklist: "[]" }) }), t);
    expect(withTask.some((s) => s.id.startsWith("tip:"))).toBe(false);
  });

  it("survives history that is not a list at all", () => {
    // The backend answers this one; a bad answer must cost the hints, not the window.
    const broken = { ...context(), recentPrompts: null as unknown as string[] };
    expect(() => suggestPrompts(broken, t)).not.toThrow();
    const mixed = {
      ...context(),
      recentPrompts: [null, 42, "Что дальше по проекту?"] as unknown as string[],
    };
    expect(() => suggestPrompts(mixed, t)).not.toThrow();
  });

  it("gives every chip a capital letter", () => {
    const suggestions = suggestPrompts(
      context({ recentPrompts: ["поставь задачам у которых нет срока дедлайн"] }),
      t,
    );
    for (const suggestion of suggestions) {
      const first = suggestion.label.charAt(0);
      expect(first).toBe(first.toUpperCase());
    }
  });
});
