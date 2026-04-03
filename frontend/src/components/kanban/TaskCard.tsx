import { Box, Chip, IconButton, LinearProgress, Paper, Typography } from "@mui/material";
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

  const hasActions = task.status !== "done" && (actionIcon[task.status] || task.status === "doing");

  const checklist = (() => {
    try {
      const items = JSON.parse(task.checklist || "[]") as { done?: boolean; checked?: boolean }[];
      if (items.length === 0) return null;
      const done = items.filter((i) => i.done || i.checked).length;
      return { done, total: items.length, pct: Math.round((done / items.length) * 100) };
    } catch { return null; }
  })();

  return (
    <Paper
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      elevation={isDragging ? 4 : 1}
      sx={{
        cursor: "grab",
        "&:hover": { bgcolor: "action.hover" },
        borderLeft: task.priority
          ? `3px solid ${PRIORITY_COLORS[task.priority as Priority] || "#95a5a6"}`
          : "3px solid transparent",
        mb: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button")) {
          openDetail(task.id);
        }
      }}
    >
      <Box sx={{ p: 1.5, pb: checklist ? 0.5 : 1.5, display: "flex", gap: 0.5 }}>
        {/* Content */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 500, fontSize: 13, wordBreak: "break-word" }}
          >
            {task.title}
          </Typography>
          <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
            {task.time_estimate && (
              <Chip label={task.time_estimate} size="small" sx={{ height: 20, fontSize: 10 }} />
            )}
            {task.due && (() => {
              if (task.status === "done") {
                return <Chip label={task.due} size="small" variant="outlined" sx={{ height: 20, fontSize: 10 }} />;
              }
              const today = new Date();
              today.setHours(0,0,0,0);
              const due = new Date(task.due + "T00:00:00");
              // Normalize: if due falls on weekend, treat as previous Friday
              const effDue = new Date(due);
              if (effDue.getDay() === 6) effDue.setDate(effDue.getDate() - 1);
              else if (effDue.getDay() === 0) effDue.setDate(effDue.getDate() - 2);
              const diff = Math.ceil((effDue.getTime() - today.getTime()) / 86400000);
              const overdue = diff < 0;
              const isToday = diff === 0;
              // "Tomorrow" = next working day (skip weekends)
              const nextWork = new Date(today);
              do { nextWork.setDate(nextWork.getDate() + 1); } while (nextWork.getDay() === 0 || nextWork.getDay() === 6);
              const isTomorrow = effDue.getTime() === nextWork.getTime();
              const icon = overdue ? "🔥" : isToday ? "🔥" : isTomorrow ? "🕐" : "";
              const color = overdue ? "error" : isToday ? "warning" : isTomorrow ? "info" : "default";
              return (
                <Chip
                  label={`${icon} ${task.due}`.trim()}
                  size="small"
                  variant="outlined"
                  color={color as "error" | "warning" | "info" | "default"}
                  sx={{ height: 20, fontSize: 10 }}
                />
              );
            })()}
          </Box>
        </Box>
        {/* Action buttons — vertical */}
        {hasActions && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, flexShrink: 0 }}>
            {actionIcon[task.status] && (
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
        )}
      </Box>
      {/* Progress bar — flush to bottom */}
      {checklist && (
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <LinearProgress
            variant="determinate"
            value={checklist.pct}
            sx={{ flex: 1, height: 3, borderRadius: 0, ml: 1.5 }}
            color={checklist.pct === 100 ? "success" : "primary"}
          />
          <Typography variant="caption" sx={{ fontSize: 9, opacity: 0.5, px: 0.5 }}>
            {checklist.done}/{checklist.total}
          </Typography>
        </Box>
      )}
    </Paper>
  );
}
