import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../projectStore";

const mockedInvoke = vi.mocked(invoke);

describe("projectStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({
      projects: [],
      selectedProjectId: null,
      loading: false,
    });
  });

  it("loads projects", async () => {
    const mockProjects = [
      { id: "p1", name: "Project A", order: 0, created_at: "", updated_at: "" },
    ];
    mockedInvoke.mockResolvedValue(mockProjects);

    await useProjectStore.getState().load();

    expect(mockedInvoke).toHaveBeenCalledWith("list_projects");
    expect(useProjectStore.getState().projects).toEqual(mockProjects);
  });

  it("selects a project", () => {
    useProjectStore.getState().select("p1");
    expect(useProjectStore.getState().selectedProjectId).toBe("p1");
  });

  it("adds a project", async () => {
    const mockProject = { id: "p2", name: "New", order: 0, created_at: "", updated_at: "" };
    mockedInvoke.mockResolvedValue(mockProject);

    const project = await useProjectStore.getState().add("New");

    expect(project.name).toBe("New");
    expect(useProjectStore.getState().projects).toHaveLength(1);
  });

  it("removes a project and deselects if selected", async () => {
    useProjectStore.setState({
      projects: [{ id: "p1", name: "A", icon: null, color: null, order: 0, created_at: "", updated_at: "" }],
      selectedProjectId: "p1",
    });
    mockedInvoke.mockResolvedValue(undefined);

    await useProjectStore.getState().remove("p1");

    expect(useProjectStore.getState().projects).toHaveLength(0);
    expect(useProjectStore.getState().selectedProjectId).toBeNull();
  });
});
