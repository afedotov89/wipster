import { useEffect } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  IconButton,
  Chip,
  LinearProgress,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PauseIcon from "@mui/icons-material/Pause";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useTaskStore } from "@/stores/taskStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { useHistoryStore } from "@/stores/historyStore";
import { HEADER_BAND_HEIGHT, PRIORITY_COLORS } from "@/utils/constants";
import { useSettingsStore } from "@/stores/settingsStore";
import { useI18n } from "@/i18n";
import type { Priority } from "@/utils/tauri";

export default function AllDoingView() {
  const { doingTasks, loadDoing, move: moveTask } = useTaskStore();
  const { projects } = useProjectStore();
  const { openDetail } = useUiStore();
  const { refresh } = useHistoryStore();
  const wipLimit = useSettingsStore((s) => s.wipLimit);
  const { t } = useI18n();

  useEffect(() => {
    loadDoing();
  }, [loadDoing]);

  const getProjectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? t.none;

  const handleDone = async (taskId: string) => {
    await moveTask(taskId, "done");
    await loadDoing();
    await refresh();
  };

  const handlePause = async (taskId: string) => {
    await moveTask(taskId, "queue");
    await loadDoing();
    await refresh();
  };

  return (
    <Box sx={{ px: 3, pb: 3 }}>
      <Box data-tauri-drag-region sx={{ height: HEADER_BAND_HEIGHT, display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {t.inProgress}
        </Typography>
        <Chip
          label={`${doingTasks.length} / ${wipLimit}`}
          size="small"
          color={doingTasks.length >= wipLimit ? "warning" : "default"}
        />
      </Box>

      <LinearProgress
        variant="determinate"
        value={(doingTasks.length / wipLimit) * 100}
        sx={{ mb: 3, height: 4, borderRadius: 2 }}
        color={doingTasks.length >= wipLimit ? "warning" : "primary"}
      />

      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
        {doingTasks.map((task) => (
          <Card
            key={task.id}
            sx={{
              flex: "1 1 300px",
              maxWidth: 400,
              borderLeft: task.priority
                ? `4px solid ${PRIORITY_COLORS[task.priority as Priority]}`
                : "4px solid transparent",
              cursor: "pointer",
            }}
            onClick={() => openDetail(task.id)}
          >
            <CardContent>
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                <Chip
                  label={getProjectName(task.project_id)}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: 11 }}
                />
                <Box>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePause(task.id);
                    }}
                    title={t.pause}
                  >
                    <PauseIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDone(task.id);
                    }}
                    title={t.done}
                  >
                    <CheckCircleIcon fontSize="small" color="success" />
                  </IconButton>
                </Box>
              </Box>
              <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }}>
                {task.title}
              </Typography>
              {task.next_step && (
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                  {t.nextPrefix} {task.next_step}
                </Typography>
              )}
              {task.return_ref && (
                <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 0.5 }}>
                  <OpenInNewIcon sx={{ fontSize: 12, opacity: 0.5 }} />
                  <Typography variant="caption" color="text.secondary">
                    {t.contextSaved}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        ))}

        {doingTasks.length === 0 && (
          <Box sx={{ textAlign: "center", py: 6, width: "100%" }}>
            <Typography color="text.secondary">
              {t.noTasksInProgress}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
