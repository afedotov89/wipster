import { useEffect } from "react";
import { registerFileDrop, useFileDropStore } from "@/stores/fileDropStore";

/**
 * Files dragged from Finder onto one field.
 *
 * The browser's own drag events are useless inside a webview: they hand over a
 * name and no path, and a task remembers files by path. The window reports the
 * real thing, and the field marks itself with `data-file-drop={id}` so the drop
 * finds its way to the right one.
 */
export function useFileDrop(id: string, onDrop: (paths: string[]) => void): boolean {
  useEffect(() => registerFileDrop(id, onDrop), [id, onDrop]);
  return useFileDropStore((s) => s.overId === id);
}
