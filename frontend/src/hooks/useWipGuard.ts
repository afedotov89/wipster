import { useCallback } from "react";
import { useTaskStore } from "@/stores/taskStore";
import { useUiStore } from "@/stores/uiStore";
import { useHistoryStore } from "@/stores/historyStore";
import { captureContext } from "@/utils/tauri";
import type { TaskStatus } from "@/utils/tauri";

export function useWipGuard() {
  const { move: moveTask, loadDoing } = useTaskStore();
  const { openSwapDialog } = useUiStore();
  const { refresh } = useHistoryStore();

  const safeMove = useCallback(
    async (taskId: string, newStatus: TaskStatus) => {
      // On pause (moving from doing to queue), capture context first
      if (newStatus === "queue") {
        try {
          await captureContext(taskId);
        } catch {
          // Context capture may fail without accessibility permissions — that's ok
        }
      }

      const result = await moveTask(taskId, newStatus);

      if (result.wip_blocked) {
        openSwapDialog(taskId);
        return false;
      }

      await loadDoing();
      await refresh();
      return true;
    },
    [moveTask, openSwapDialog, loadDoing, refresh]
  );

  return { safeMove };
}
