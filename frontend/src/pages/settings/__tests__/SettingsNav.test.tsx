import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SettingsNav from "../SettingsNav";
import { SETTINGS_SECTIONS } from "../sections";

describe("SettingsNav", () => {
  it("lists every section as a tab", () => {
    render(<SettingsNav current="general" onSelect={() => {}} />);

    expect(screen.getAllByRole("tab")).toHaveLength(SETTINGS_SECTIONS.length);
    expect(screen.getByRole("tab", { selected: true })).toHaveAttribute(
      "id",
      "settings-tab-general",
    );
  });

  it("reports the section that was clicked", () => {
    const onSelect = vi.fn();
    render(<SettingsNav current="general" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("tab", { name: /Интеграции|Integrations/ }));

    expect(onSelect).toHaveBeenCalledWith("integrations");
  });

  // A sidebar you cannot walk with the arrow keys is not a macOS sidebar.
  it("walks the list with the arrow keys and wraps around", () => {
    const onSelect = vi.fn();
    render(<SettingsNav current="general" onSelect={onSelect} />);
    const first = screen.getByRole("tab", { selected: true });
    const last = SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id;

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenLastCalledWith(SETTINGS_SECTIONS[1].id);

    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(onSelect).toHaveBeenLastCalledWith(last);

    fireEvent.keyDown(first, { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith(last);
  });
});
