import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSettingsShortcut } from "../useSettingsShortcut";
import { useUiStore } from "@/stores/uiStore";

const press = (key: string, meta = true) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: meta, cancelable: true }));

describe("useSettingsShortcut", () => {
  beforeEach(() => useUiStore.setState({ settingsOpen: false }));

  it("opens the settings on ⌘,", () => {
    renderHook(() => useSettingsShortcut());

    press(",");

    expect(useUiStore.getState().settingsOpen).toBe(true);
  });

  it("leaves a bare comma alone", () => {
    renderHook(() => useSettingsShortcut());

    press(",", false);

    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it("stops listening once the shell is gone", () => {
    const { unmount } = renderHook(() => useSettingsShortcut());
    unmount();

    press(",");

    expect(useUiStore.getState().settingsOpen).toBe(false);
  });
});
