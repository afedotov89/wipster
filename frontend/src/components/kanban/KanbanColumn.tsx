import { Box, Typography } from "@mui/material";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import TaskCard from "./TaskCard";
import type { Task, TaskStatus } from "@/utils/tauri";
import { statusLabel, STATUS_COLORS } from "@/utils/constants";
import { useI18n } from "@/i18n";

interface Props {
  status: TaskStatus;
  tasks: Task[];
  onMove: (taskId: string, newStatus: TaskStatus) => void;
}

export default function KanbanColumn({ status, tasks, onMove }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const { t } = useI18n();

  return (
    <Box
      ref={setNodeRef}
      sx={{
        flex: 1,
        minWidth: 250,
        display: "flex",
        flexDirection: "column",
        bgcolor: isOver ? "action.hover" : "transparent",
        borderRadius: 2,
        transition: "background-color 0.2s",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 1,
        }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            bgcolor: STATUS_COLORS[status],
          }}
        />
        <Typography variant="subtitle2" sx={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>
          {statusLabel(t, status)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {tasks.length}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, px: 1, pb: 1, minHeight: 100 }}>
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onMove={onMove} />
          ))}
        </SortableContext>
      </Box>
    </Box>
  );
}
