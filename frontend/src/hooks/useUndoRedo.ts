import { useEffect } from "react";
import { useHistoryStore } from "@/stores/historyStore";
import { useTaskStore } from "@/stores/taskStore";
import { useProjectStore } from "@/stores/projectStore";

export function useUndoRedo() {
  const { undo, redo, refresh } = useHistoryStore();
  const { load: loadTasks, loadDoing } = useTaskStore();
  const { selectedProjectId, load: loadProjects } = useProjectStore();

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      // Don't intercept if user is typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      e.preventDefault();

      if (e.shiftKey) {
        await redo();
      } else {
        await undo();
      }

      // Reload data after undo/redo
      await loadProjects();
      if (selectedProjectId) await loadTasks(selectedProjectId);
      await loadDoing();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, loadTasks, loadDoing, loadProjects, selectedProjectId]);
}
