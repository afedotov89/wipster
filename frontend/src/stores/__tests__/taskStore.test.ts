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
