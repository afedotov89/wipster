import { useCallback, useState } from "react";
import { Box } from "@mui/material";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import KanbanColumn from "./KanbanColumn";
import TaskCard from "./TaskCard";
import { useTaskStore } from "@/stores/taskStore";
import { useProjectStore } from "@/stores/projectStore";
import { useWipGuard } from "@/hooks/useWipGuard";
import { STATUS_COLUMNS } from "@/utils/constants";
import { reorderTasks } from "@/utils/tauri";
import type { Task, TaskStatus } from "@/utils/tauri";

export default function KanbanBoard() {
  const { tasks, load } = useTaskStore();
  const { selectedProjectId } = useProjectStore();
  const { safeMove } = useWipGuard();
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleMove = useCallback(
    async (taskId: string, newStatus: TaskStatus) => {
      await safeMove(taskId, newStatus);
    },
    [safeMove]
  );

  const tasksByStatus = useCallback(
    (status: TaskStatus) => tasks.filter((t) => t.status === status),
    [tasks]
  );

  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task | undefined;
    setActiveTask(task ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const draggedId = active.id as string;
    const draggedTask = tasks.find((t) => t.id === draggedId);
    if (!draggedTask) return;

    const overId = over.id as string;

    // Dropped on a column header (empty area) — cross-column move
    if (STATUS_COLUMNS.includes(overId as TaskStatus)) {
      if (draggedTask.status !== overId) {
        await handleMove(draggedId, overId as TaskStatus);
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
      await handleMove(draggedId, targetStatus);

      const columnTasks = tasksByStatus(targetStatus).filter((t) => t.id !== draggedId);
      const overIndex = columnTasks.findIndex((t) => t.id === overId);
      const newOrder = [...columnTasks];
      newOrder.splice(overIndex >= 0 ? overIndex : newOrder.length, 0, draggedTask);
      await reorderTasks(newOrder.map((t) => t.id));
    }

    if (selectedProjectId) await load(selectedProjectId);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <Box sx={{ display: "flex", gap: 2, height: "100%", p: 2 }}>
        {STATUS_COLUMNS.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={tasksByStatus(status)}
            onMove={handleMove}
          />
        ))}
      </Box>
      <DragOverlay>
        {activeTask ? (
          <TaskCard task={activeTask} onMove={() => {}} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
