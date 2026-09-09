import { useCallback, useState } from "react";
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useTaskStore } from "@/stores/taskStore";
import { useProjectStore } from "@/stores/projectStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useWipGuard } from "@/hooks/useWipGuard";
import { STATUS_COLUMNS } from "@/utils/constants";
import { reorderTasks } from "@/utils/tauri";
import type { Task, TaskStatus } from "@/utils/tauri";

/** Droppable id of a project row in the sidebar. */
export const projectDropId = (projectId: string) => `project:${projectId}`;

/**
 * Dragging for the whole window, not just the board.
 *
 * A task can be dropped on a column (change status), on another task (reorder),
 * or on a project in the sidebar (change project) — and the last one only works
 * if the board and the sidebar sit under one `DndContext`, which is why this
 * lives in a hook the shell can own instead of inside the board.
 */
export function useBoardDnd() {
  const { tasks, load, update, loadDoing } = useTaskStore();
  const { selectedProjectId } = useProjectStore();
  const { refresh } = useHistoryStore();
  const { safeMove } = useWipGuard();
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const move = useCallback(
    async (taskId: string, newStatus: TaskStatus) => {
      await safeMove(taskId, newStatus);
    },
    [safeMove]
  );

  const tasksByStatus = useCallback(
    (status: TaskStatus) => tasks.filter((t) => t.status === status),
    [tasks]
  );

  const onDragStart = (event: DragStartEvent) => {
    setActiveTask((event.active.data.current?.task as Task | undefined) ?? null);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const draggedId = active.id as string;
    const draggedTask = tasks.find((t) => t.id === draggedId);
    if (!draggedTask) return;

    const overId = over.id as string;

    // Dropped on a project in the sidebar — hand the task over to that project.
    if (overId.startsWith("project:")) {
      const projectId = overId.slice("project:".length);
      if (draggedTask.project_id === projectId) return;
      await update(draggedId, { project_id: projectId });
      if (selectedProjectId) await load(selectedProjectId);
      await loadDoing();
      await refresh();
      return;
    }

    // Dropped on a column header (empty area) — cross-column move
    if (STATUS_COLUMNS.includes(overId as TaskStatus)) {
      if (draggedTask.status !== overId) {
        await move(draggedId, overId as TaskStatus);
      }
      return;
    }

    // Dropped on another task
    const overTask = tasks.find((t) => t.id === overId);
    if (!overTask) return;

    const targetStatus = overTask.status as TaskStatus;
    const sameColumn = draggedTask.status === targetStatus;

    if (sameColumn) {
      // Reorder within column
      const columnTasks = tasksByStatus(targetStatus);
      const oldIndex = columnTasks.findIndex((t) => t.id === draggedId);
      const newIndex = columnTasks.findIndex((t) => t.id === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const newOrder = arrayMove(columnTasks, oldIndex, newIndex);
      await reorderTasks(newOrder.map((t) => t.id));
    } else {
      // Cross-column: change status, then insert at target position
      await move(draggedId, targetStatus);

      const columnTasks = tasksByStatus(targetStatus).filter((t) => t.id !== draggedId);
      const overIndex = columnTasks.findIndex((t) => t.id === overId);
      const newOrder = [...columnTasks];
      newOrder.splice(overIndex >= 0 ? overIndex : newOrder.length, 0, draggedTask);
      await reorderTasks(newOrder.map((t) => t.id));
    }

    if (selectedProjectId) await load(selectedProjectId);
  };

  return { sensors, activeTask, onDragStart, onDragEnd };
}
