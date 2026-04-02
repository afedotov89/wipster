import { Box, Chip, IconButton, Paper, Typography } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import type { Task, TaskStatus } from "@/utils/tauri";
import { PRIORITY_COLORS } from "@/utils/constants";
import type { Priority } from "@/utils/tauri";
import { useUiStore } from "@/stores/uiStore";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Props {
  task: Task;
  onMove: (taskId: string, newStatus: TaskStatus) => void;
}

export default function TaskCard({ task, onMove }: Props) {
  const { openDetail } = useUiStore();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const nextStatus: Partial<Record<TaskStatus, TaskStatus>> = {
    queue: "doing",
    doing: "done",
  };

  const actionIcon: Partial<Record<TaskStatus, React.ReactNode>> = {
    queue: <PlayArrowIcon fontSize="small" />,
    doing: <CheckCircleIcon fontSize="small" />,
    done: undefined,
  };

  return (
    <Paper
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      elevation={isDragging ? 4 : 1}
      sx={{
        p: 1.5,
        mb: 1,
        cursor: "grab",
        "&:hover": { bgcolor: "action.hover" },
        borderLeft: task.priority
          ? `3px solid ${PRIORITY_COLORS[task.priority as Priority] || "#95a5a6"}`
          : "3px solid transparent",
      }}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button")) {
          openDetail(task.id);
        }
      }}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
        <Typography
          variant="body2"
          sx={{ flex: 1, fontWeight: 500, fontSize: 13 }}
        >
          {task.title}
        </Typography>
        {task.status !== "done" && actionIcon[task.status] && (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              const next = nextStatus[task.status];
              if (next) onMove(task.id, next);
            }}
          >
            {actionIcon[task.status]}
          </IconButton>
        )}
        {task.status === "doing" && (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onMove(task.id, "queue");
            }}
          >
            <PauseIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
      <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
        {task.estimate && (
          <Chip label={task.estimate.toUpperCase()} size="small" sx={{ height: 20, fontSize: 10 }} />
        )}
        {task.due && (
          <Chip label={task.due} size="small" variant="outlined" sx={{ height: 20, fontSize: 10 }} />
        )}
      </Box>
    </Paper>
  );
}
