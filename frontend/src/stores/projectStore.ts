import { create } from "zustand";
import * as api from "@/utils/tauri";
import type { Project } from "@/utils/tauri";

interface ProjectState {
  projects: Project[];
  selectedProjectId: string | null;
  loading: boolean;
  load: () => Promise<void>;
  select: (id: string | null) => void;
  add: (name: string) => Promise<Project>;
  update: (id: string, input: { name?: string; icon?: string; color?: string; order?: number }) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const projects = await api.listProjects();
      set({ projects, loading: false });
    } catch (e) {
      console.error("Failed to load projects:", e);
      set({ loading: false });
    }
  },

  select: (id) => set({ selectedProjectId: id }),

  add: async (name) => {
    const project = await api.createProject(name);
    set((s) => ({ projects: [...s.projects, project] }));
    return project;
  },

  update: async (id, input) => {
    const updated = await api.updateProject(id, input);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? updated : p)),
    }));
  },

  remove: async (id) => {
    await api.deleteProject(id);
    const state = get();
    set({
      projects: state.projects.filter((p) => p.id !== id),
      selectedProjectId:
        state.selectedProjectId === id ? null : state.selectedProjectId,
    });
  },
}));
