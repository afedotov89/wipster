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
import KanbanColumn from "./KanbanColumn";
import TaskCard from "./TaskCard";
import { useTaskStore } from "@/stores/taskStore";
import { useWipGuard } from "@/hooks/useWipGuard";
import { STATUS_COLUMNS } from "@/utils/constants";
import type { Task, TaskStatus } from "@/utils/tauri";

export default function KanbanBoard() {
  const { tasks } = useTaskStore();
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

  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task | undefined;
    setActiveTask(task ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const targetStatus = over.id as TaskStatus;

    if (STATUS_COLUMNS.includes(targetStatus)) {
      const currentTask = tasks.find((t) => t.id === taskId);
      if (currentTask && currentTask.status !== targetStatus) {
        await handleMove(taskId, targetStatus);
      }
    }
  };

  const tasksByStatus = (status: TaskStatus) =>
    tasks.filter((t) => t.status === status);

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
