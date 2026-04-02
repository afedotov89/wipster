import { create } from "zustand";
import * as api from "@/utils/tauri";
import type { Task, TaskStatus, MoveTaskResult } from "@/utils/tauri";

interface TaskState {
  tasks: Task[];
  doingTasks: Task[];
  loading: boolean;
  load: (projectId?: string) => Promise<void>;
  loadDoing: () => Promise<void>;
  add: (title: string, projectId?: string) => Promise<Task>;
  update: (id: string, input: Partial<Task>) => Promise<Task>;
  remove: (id: string) => Promise<void>;
  move: (taskId: string, newStatus: TaskStatus, swapTaskId?: string) => Promise<MoveTaskResult>;
  getByStatus: (status: TaskStatus) => Task[];
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  doingTasks: [],
  loading: false,

  load: async (projectId) => {
    set({ loading: true });
    try {
      const tasks = await api.listTasks(projectId);
      set({ tasks, loading: false });
    } catch (e) {
      console.error("Failed to load tasks:", e);
      set({ loading: false });
    }
  },

  loadDoing: async () => {
    try {
      const doingTasks = await api.getDoingTasks();
      set({ doingTasks });
    } catch (e) {
      console.error("Failed to load doing tasks:", e);
    }
  },

  add: async (title, projectId) => {
    const task = await api.createTask(title, projectId);
    set((s) => ({
      tasks: [...s.tasks, task],
    }));
    return task;
  },

  update: async (id, input) => {
    const updated = await api.updateTask(id, input);
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? updated : t)),
      doingTasks: s.doingTasks.map((t) => (t.id === id ? updated : t)),
    }));
    return updated;
  },

  remove: async (id) => {
    await api.deleteTask(id);
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      doingTasks: s.doingTasks.filter((t) => t.id !== id),
    }));
  },

  move: async (taskId, newStatus, swapTaskId) => {
    const result = await api.moveTask(taskId, newStatus, swapTaskId);
    if (!result.wip_blocked) {
      // Reload tasks to reflect changes
      const state = get();
      const tasks = state.tasks.map((t) =>
        t.id === taskId ? result.task : t
      );
      // If a swap happened, update the swapped task too
      const updated = swapTaskId
        ? tasks.map((t) => (t.id === swapTaskId ? { ...t, status: "queue" as TaskStatus } : t))
        : tasks;
      set({ tasks: updated });
      // Reload doing tasks
      const doingTasks = await api.getDoingTasks();
      set({ doingTasks });
    }
    return result;
  },

  getByStatus: (status) => get().tasks.filter((t) => t.status === status),
}));
