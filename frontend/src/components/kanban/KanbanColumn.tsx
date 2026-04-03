import { useState } from "react";
import { Box, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import TaskCard from "./TaskCard";
import type { Task, TaskStatus } from "@/utils/tauri";
import { statusLabel, STATUS_COLORS } from "@/utils/constants";
import { useI18n } from "@/i18n";

const DONE_PAGE_SIZE = 5;

interface Props {
  status: TaskStatus;
  tasks: Task[];
  onMove: (taskId: string, newStatus: TaskStatus) => void;
}

export default function KanbanColumn({ status, tasks, onMove }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const { t } = useI18n();
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE_SIZE);

  // Sort done tasks: newest (by updated_at) first
  const sorted = status === "done"
    ? [...tasks].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    : tasks;

  const visible = status === "done" ? sorted.slice(0, doneLimit) : sorted;
  const hasMore = status === "done" && sorted.length > doneLimit;

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
          items={visible.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {visible.map((task) => (
            <TaskCard key={task.id} task={task} onMove={onMove} />
          ))}
        </SortableContext>
        {hasMore && (
          <Box
            onClick={() => setDoneLimit((l) => l + DONE_PAGE_SIZE)}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              py: 0.5,
              cursor: "pointer",
              opacity: 0.3,
              "&:hover": { opacity: 0.6 },
              transition: "opacity 0.2s",
            }}
          >
            <ExpandMoreIcon sx={{ fontSize: 16 }} />
            <Typography variant="caption" sx={{ fontSize: 10 }}>
              +{sorted.length - doneLimit}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
