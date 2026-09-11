import { useEffect } from "react";
import { useUiStore } from "@/stores/uiStore";

/**
 * ⌘, — the settings shortcut every mac app has, and this one is no exception.
 *
 * It works wherever the user is, including inside a text field: on macOS this
 * combination belongs to the app, not to the control with focus.
 */
export function useSettingsShortcut(): void {
  const openSettings = useUiStore((s) => s.openSettings);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== ",") return;
      e.preventDefault();
      openSettings();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSettings]);
}
