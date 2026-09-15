import { create } from "zustand";
import { appLog } from "@/stores/logStore";

type DropHandler = (paths: string[]) => void;

/** Every field on screen that takes files, by the id it registered with. */
const handlers = new Map<string, DropHandler>();
let subscription: Promise<void> | null = null;

interface FileDropState {
  /** The zone the pointer is over while files are being dragged. */
  overId: string | null;
}

export const useFileDropStore = create<FileDropState>(() => ({ overId: null }));

/**
 * Which registered zone is under this point.
 *
 * Asking the DOM rather than measuring rectangles: fields scroll, overlap and
 * move, and `elementFromPoint` already knows what is on top. Tauri reports the
 * pointer in physical pixels, so the retina scale comes off first — and if that
 * lands nowhere, the raw value is tried too, because a platform that already
 * reports logical pixels should not break the feature.
 */
function zoneAt(position: { x: number; y: number }): string | null {
  const scale = window.devicePixelRatio || 1;
  const candidates = [{ x: position.x / scale, y: position.y / scale }, position];

  for (const point of candidates) {
    const element = document.elementFromPoint(point.x, point.y);
    const zone = element?.closest<HTMLElement>("[data-file-drop]");
    const id = zone?.dataset.fileDrop;
    if (id && handlers.has(id)) return id;
  }
  return null;
}

/**
 * One subscription for the whole app.
 *
 * The window reports drags once; splitting that into a listener per field only
 * multiplied the work and the ways to get it wrong.
 */
function subscribe(): Promise<void> {
  if (subscription) return subscription;

  subscription = (async () => {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;

      if (payload.type === "enter" || payload.type === "over") {
        useFileDropStore.setState({ overId: zoneAt(payload.position) });
        return;
      }

      if (payload.type === "drop") {
        const id = zoneAt(payload.position);
        useFileDropStore.setState({ overId: null });
        appLog.info(`[files] dropped ${payload.paths.length} onto ${id ?? "nothing"}`);
        if (id) handlers.get(id)?.(payload.paths);
        return;
      }

      useFileDropStore.setState({ overId: null });
    });
  })();

  subscription.catch((e) => {
    // Silence here is what made this look like a feature that simply did not
    // work, so it goes into the log the settings can show.
    appLog.warn(`[files] drag and drop is unavailable: ${String(e)}`);
    subscription = null;
  });

  return subscription;
}

/** Take files dropped on the element marked with `data-file-drop={id}`. */
export function registerFileDrop(id: string, handler: DropHandler): () => void {
  handlers.set(id, handler);
  void subscribe();
  return () => {
    handlers.delete(id);
    if (useFileDropStore.getState().overId === id) useFileDropStore.setState({ overId: null });
  };
}
