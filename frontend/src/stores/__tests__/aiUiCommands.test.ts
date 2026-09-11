import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { applyAiUiCommand } from "../aiUiCommands";
import { useUiStore } from "../uiStore";
import { SETTINGS_SECTIONS, DEFAULT_SETTINGS_SECTION } from "@/pages/settings/sections";

describe("open_view", () => {
  beforeEach(() => {
    useUiStore.setState({
      view: "project",
      settingsOpen: false,
      settingsSection: DEFAULT_SETTINGS_SECTION,
    });
  });

  // Every room of the settings has to be reachable by name, or the assistant
  // can open the settings and still leave the user hunting.
  it.each(SETTINGS_SECTIONS.map((s) => s.id))("opens the %s section", (section) => {
    applyAiUiCommand("open_view", { view: "settings", section });

    expect(useUiStore.getState().settingsOpen).toBe(true);
    expect(useUiStore.getState().settingsSection).toBe(section);
    // The board behind is left exactly as it was.
    expect(useUiStore.getState().view).toBe("project");
  });

  it("ignores a section it does not have", () => {
    applyAiUiCommand("open_view", { view: "settings", section: "nonsense" });

    expect(useUiStore.getState().settingsOpen).toBe(true);
    expect(useUiStore.getState().settingsSection).toBe(DEFAULT_SETTINGS_SECTION);
  });

  it("leaves the remembered section alone when none is named", () => {
    useUiStore.setState({ settingsSection: "integrations" });

    applyAiUiCommand("open_view", { view: "settings" });

    expect(useUiStore.getState().settingsSection).toBe("integrations");
  });
});
