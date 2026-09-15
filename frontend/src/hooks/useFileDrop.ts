import { useEffect, useState, type RefObject } from "react";

/**
 * Files dragged from Finder onto one particular element.
 *
 * The browser's own drag events are useless here: inside a webview they hand
 * over a name and no path, and a task remembers files by path. Tauri reports
 * the drop itself, with the paths and where the pointer was — so the work is
 * deciding whether "where" was over this element, which is why every field can
 * have its own drop target without fighting the others.
 */
export function useFileDrop(
  ref: RefObject<HTMLElement | null>,
  onDrop: (paths: string[]) => void,
): boolean {
  const [over, setOver] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const contains = (physical: { x: number; y: number }) => {
      const element = ref.current;
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      // Tauri reports physical pixels; the DOM thinks in CSS ones.
      const scale = window.devicePixelRatio || 1;
      const x = physical.x / scale;
      const y = physical.y / scale;
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const stop = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "over") {
          setOver(contains(payload.position));
          return;
        }
        if (payload.type === "drop") {
          const inside = contains(payload.position);
          setOver(false);
          if (inside && payload.paths.length > 0) onDrop(payload.paths);
          return;
        }
        setOver(false);
      });
      if (cancelled) stop();
      else unlisten = stop;
    })().catch(() => {
      // Outside Tauri (tests, the visual harness) there is nothing to listen to.
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ref, onDrop]);

  return over;
}
