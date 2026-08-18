import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useTaskStore } from "../taskStore";

const mockedInvoke = vi.mocked(invoke);

describe("taskStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTaskStore.setState({
      tasks: [],
      doingTasks: [],
      archivedTasks: [],
      pinnedTaskId: null,
      loading: false,
    });
  });

  it("loads tasks from backend", async () => {
    const mockTasks = [
      {
        id: "t1",
        title: "Test Task",
        project_id: "p1",
        status: "queue",
        priority: null,
        due: null,
        estimate: null,
        tags: "[]",
        dod: null,
        checklist: "[]",
        next_step: null,
        return_ref: null,
        created_at: "",
        updated_at: "",
      },
    ];
    mockedInvoke.mockResolvedValue(mockTasks);

    await useTaskStore.getState().load("p1");

    expect(mockedInvoke).toHaveBeenCalledWith("list_tasks", {
      projectId: "p1",
      status: undefined,
    });
    expect(useTaskStore.getState().tasks).toEqual(mockTasks);
  });

  it("adds a task", async () => {
    const mockTask = {
      id: "t2",
      title: "New Task",
      project_id: "p1",
      status: "queue",
      priority: null,
      due: null,
      estimate: null,
      tags: "[]",
      dod: null,
      checklist: "[]",
      next_step: null,
      return_ref: null,
      created_at: "",
      updated_at: "",
    };
    mockedInvoke.mockResolvedValue(mockTask);

    const task = await useTaskStore.getState().add("New Task", "p1");

    expect(task.title).toBe("New Task");
    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });

  it("pins a newly added task to the top of the list", async () => {
    useTaskStore.setState({
      tasks: [{ id: "t1", title: "Old", status: "queue" }] as any[],
    });
    mockedInvoke.mockResolvedValue({ id: "t2", title: "New Task", status: "queue" });

    await useTaskStore.getState().add("New Task", "p1");

    expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(useTaskStore.getState().pinnedTaskId).toBe("t2");
  });

  it("releases the pin on reload, letting the backend order settle", async () => {
    useTaskStore.setState({ pinnedTaskId: "t2" });
    mockedInvoke.mockResolvedValue([
      { id: "t1", title: "Old", status: "queue" },
      { id: "t2", title: "New Task", status: "queue" },
    ]);

    await useTaskStore.getState().load("p1");

    expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(useTaskStore.getState().pinnedTaskId).toBeNull();
  });

  it("archiving removes the task from the board and lists it in the archive", async () => {
    useTaskStore.setState({
      tasks: [{ id: "t1", title: "Stale", status: "queue" }] as any[],
      doingTasks: [],
      archivedTasks: [],
    });
    mockedInvoke.mockResolvedValue({
      id: "t1",
      title: "Stale",
      status: "queue",
      archived_at: "2026-08-17 10:00:00",
    });

    await useTaskStore.getState().setArchived("t1", true);

    expect(mockedInvoke).toHaveBeenCalledWith("set_task_archived", {
      id: "t1",
      archived: true,
    });
    expect(useTaskStore.getState().tasks).toHaveLength(0);
    expect(useTaskStore.getState().archivedTasks.map((t) => t.id)).toEqual(["t1"]);
  });

  it("restoring drops the task from the archive list", async () => {
    useTaskStore.setState({
      tasks: [],
      archivedTasks: [{ id: "t1", title: "Stale", status: "queue" }] as any[],
    });
    mockedInvoke.mockResolvedValue({ id: "t1", title: "Stale", status: "queue", archived_at: null });

    await useTaskStore.getState().setArchived("t1", false);

    expect(useTaskStore.getState().archivedTasks).toHaveLength(0);
  });

  it("getByStatus filters correctly", () => {
    useTaskStore.setState({
      tasks: [
        { id: "t1", title: "A", status: "queue" },
        { id: "t2", title: "B", status: "doing" },
        { id: "t3", title: "C", status: "queue" },
      ] as any[],
    });

    const queue = useTaskStore.getState().getByStatus("queue");
    expect(queue).toHaveLength(2);
  });
});
