import { useState } from "react";
import { Box, Chip, IconButton, LinearProgress, Menu, MenuItem, ListItemIcon, Paper, Typography } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type { Task, TaskStatus } from "@/utils/tauri";
import { PRIORITY_COLORS } from "@/utils/constants";
import type { Priority } from "@/utils/tauri";
import { useUiStore } from "@/stores/uiStore";
import { useTaskStore } from "@/stores/taskStore";
import { useI18n } from "@/i18n";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Props {
  task: Task;
  onMove: (taskId: string, newStatus: TaskStatus) => void;
}

export default function TaskCard({ task, onMove }: Props) {
  const { openDetail, selectedTaskId, detailOpen, closeDetail } = useUiStore();
  const { remove } = useTaskStore();
  const { t } = useI18n();
  const isSelected = detailOpen && selectedTaskId === task.id;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

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
      elevation={0}
      data-task-card
      sx={{
        cursor: "grab",
        "&:hover": { bgcolor: "action.hover" },
        boxShadow: [
          isDragging ? "0 4px 8px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.2)",
          task.priority ? `inset 3px 0 0 ${PRIORITY_COLORS[task.priority as Priority] || "#95a5a6"}` : null,
          task.energy ? `inset -3px 0 0 ${{ low: "#5b7fa6", medium: "#6da87a", high: "#d4a843" }[task.energy]}` : null,
        ].filter(Boolean).join(", "),
        mb: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        ...(isSelected && {
          outline: "2px solid",
          outlineColor: "primary.main",
        }),
      }}
      onClick={(e) => {
        if (contextMenu) return;
        if (!(e.target as HTMLElement).closest("button")) {
          openDetail(task.id);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY });
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
            {task.tracker_url && (() => {
              const url = task.tracker_url;
              // Extract last path component: "QUEUE-123" from "https://tracker.yandex.ru/QUEUE-123"
              const key = url.replace(/\/+$/, "").split("/").pop() || url;
              return (
                <Chip
                  label={key}
                  size="small"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 10, cursor: "pointer", color: "rgb(78,129,238)", borderColor: "rgb(78,129,238)" }}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const href = url.startsWith("http") ? url : `https://${url}`;
                    try {
                      const { open } = await import("@tauri-apps/plugin-shell");
                      await open(href);
                    } catch {
                      window.open(href, "_blank");
                    }
                  }}
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
      <Menu
        open={contextMenu !== null}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.y, left: contextMenu.x } : undefined}
        slotProps={{ paper: { sx: { minWidth: 140 } } }}
      >
        <MenuItem
          onClick={() => {
            if (isSelected) closeDetail();
            remove(task.id);
            setContextMenu(null);
          }}
          sx={{ fontSize: 13, color: "error.main" }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <DeleteOutlineIcon fontSize="small" color="error" />
          </ListItemIcon>
          {t.delete}
        </MenuItem>
      </Menu>
    </Paper>
  );
}
