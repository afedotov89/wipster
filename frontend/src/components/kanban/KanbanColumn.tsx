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
  const { t, locale } = useI18n();
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE_SIZE);

  // Sort done tasks: newest (by completed_at) first
  const sorted = status === "done"
    ? [...tasks].sort((a, b) => (b.completed_at || b.updated_at).localeCompare(a.completed_at || a.updated_at))
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
          {visible.map((task, i) => {
            const dateLabel = status === "done" ? (() => {
              const d = (task.completed_at || task.updated_at).slice(0, 10);
              const prev = i > 0 ? (visible[i - 1].completed_at || visible[i - 1].updated_at).slice(0, 10) : null;
              if (prev === d) return null;
              const today = new Date().toISOString().slice(0, 10);
              const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
              if (d === today) return locale === "ru" ? "Сегодня" : "Today";
              if (d === yesterday) return locale === "ru" ? "Вчера" : "Yesterday";
              return d;
            })() : null;
            return (
              <Box key={task.id}>
                {dateLabel && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5, px: 0.5, mt: i > 0 ? 0.5 : 0 }}>
                    <Box sx={{ flex: 1, height: "1px", bgcolor: "divider" }} />
                    <Typography sx={{ fontSize: 10, color: "text.secondary", whiteSpace: "nowrap" }}>
                      {dateLabel}
                    </Typography>
                    <Box sx={{ flex: 1, height: "1px", bgcolor: "divider" }} />
                  </Box>
                )}
                <TaskCard task={task} onMove={onMove} />
              </Box>
            );
          })}
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
