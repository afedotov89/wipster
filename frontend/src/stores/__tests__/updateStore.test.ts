import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { useUpdateStore } from "../updateStore";

const mockedInvoke = vi.mocked(invoke);

/** Answers app_info with `version`, and get_setting with whatever was seen. */
function backend(version: string, seen: string | null) {
  const answer = async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "app_info") {
      return { version, releases: [{ version, date: "2026-09-16", notes: "- что-то" }] };
    }
    if (cmd === "get_setting") return args?.key === "seen_version" ? seen : null;
    return null;
  };
  // The real `invoke` is generic over its result; the test only cares which
  // command was asked and what came back.
  mockedInvoke.mockImplementation(answer as unknown as typeof invoke);
}

const setSettingCalls = () =>
  mockedInvoke.mock.calls
    .filter(([cmd]) => cmd === "set_setting")
    .map(([, args]) => args as Record<string, unknown>);

describe("updateStore.load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUpdateStore.setState({ currentVersion: "", releases: [], justUpdated: false });
  });

  it("says nothing on a first run — nobody updated to the version they just installed", async () => {
    backend("0.12.0", null);

    await useUpdateStore.getState().load();

    expect(useUpdateStore.getState().justUpdated).toBe(false);
    expect(setSettingCalls()).toContainEqual({ key: "seen_version", value: "0.12.0" });
  });

  it("says nothing when the version is the one already seen", async () => {
    backend("0.12.0", "0.12.0");

    await useUpdateStore.getState().load();

    expect(useUpdateStore.getState().justUpdated).toBe(false);
  });

  it("announces the update the first time the new version runs", async () => {
    backend("0.12.0", "0.11.0");

    await useUpdateStore.getState().load();

    expect(useUpdateStore.getState().justUpdated).toBe(true);
    expect(useUpdateStore.getState().currentVersion).toBe("0.12.0");
    // Recorded straight away, so the strip does not greet them again tomorrow.
    expect(setSettingCalls()).toContainEqual({ key: "seen_version", value: "0.12.0" });
  });

  it("carries the notes this build shipped with", async () => {
    backend("0.12.0", "0.12.0");

    await useUpdateStore.getState().load();

    expect(useUpdateStore.getState().releases[0].notes).toContain("что-то");
  });
});
