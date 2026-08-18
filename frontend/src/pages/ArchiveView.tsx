import { useEffect, useState } from "react";
import { Box, Chip, IconButton, Paper, Typography } from "@mui/material";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import UnarchiveOutlinedIcon from "@mui/icons-material/UnarchiveOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useTaskStore } from "@/stores/taskStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { useHistoryStore } from "@/stores/historyStore";
import { PRIORITY_COLORS } from "@/utils/constants";
import { useI18n } from "@/i18n";
import type { Priority } from "@/utils/tauri";
import { getProjectIcon } from "@/components/layout/ProjectAppearancePicker";

export default function ArchiveView() {
  const { archivedTasks, loadArchived, setArchived, remove } = useTaskStore();
  const { projects } = useProjectStore();
  const { openDetail, selectedTaskId, detailOpen, closeDetail } = useUiStore();
  const { refresh } = useHistoryStore();
  const { t, locale } = useI18n();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    loadArchived();
  }, [loadArchived]);

  const act = async (id: string, fn: () => Promise<void>) => {
    if (busyId) return;
    setBusyId(id);
    try {
      if (detailOpen && selectedTaskId === id) closeDetail();
      await fn();
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
        <Inventory2OutlinedIcon sx={{ fontSize: 24, opacity: 0.6 }} />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {t.archive}
        </Typography>
        {archivedTasks.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {archivedTasks.length}
          </Typography>
        )}
      </Box>

      {archivedTasks.length === 0 ? (
        <Typography color="text.secondary" sx={{ fontSize: 13, mt: 3 }}>
          {t.archiveEmpty}
        </Typography>
      ) : (
        <>
          <Typography color="text.secondary" sx={{ fontSize: 12, mb: 2 }}>
            {t.archiveHint}
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {archivedTasks.map((task) => {
              const project = projects.find((p) => p.id === task.project_id);
              const isSelected = detailOpen && selectedTaskId === task.id;
              return (
                <Paper
                  key={task.id}
                  elevation={0}
                  data-task-card
                  onClick={() => openDetail(task.id)}
                  sx={{
                    p: 1.5,
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    cursor: "pointer",
                    opacity: busyId === task.id ? 0.4 : 0.75,
                    transition: "opacity 0.15s",
                    "&:hover": {
                      opacity: 1,
                      bgcolor: "action.hover",
                      "& .archive-delete": { opacity: 0.5 },
                    },
                    boxShadow: [
                      "var(--card-shadow)",
                      task.priority
                        ? `inset 3px 0 0 ${PRIORITY_COLORS[task.priority as Priority] || "#95a5a6"}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(", "),
                    ...(isSelected && { outline: "2px solid", outlineColor: "primary.main" }),
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, wordBreak: "break-word" }}>
                      {task.title}
                    </Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.5, flexWrap: "wrap" }}>
                      {project && (
                        <Chip
                          icon={(() => {
                            const Icon = getProjectIcon(project.icon);
                            return <Icon sx={{ fontSize: 12, color: project.color || undefined }} />;
                          })()}
                          label={project.name}
                          size="small"
                          variant="outlined"
                          sx={{ height: 20, fontSize: 10 }}
                        />
                      )}
                      <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.5 }}>
                        {t.archivedOn} {(task.archived_at ?? "").slice(0, 10)}
                      </Typography>
                    </Box>
                  </Box>
                  <IconButton
                    size="small"
                    title={t.restoreFromArchive}
                    onClick={(e) => {
                      e.stopPropagation();
                      act(task.id, () => setArchived(task.id, false));
                    }}
                  >
                    <UnarchiveOutlinedIcon fontSize="small" />
                  </IconButton>
                  {/* Permanent delete stays low-key until hovered — restoring is
                      the primary action here, deleting is the deliberate one. */}
                  <IconButton
                    size="small"
                    className="archive-delete"
                    title={locale === "ru" ? "Удалить навсегда" : "Delete permanently"}
                    onClick={(e) => {
                      e.stopPropagation();
                      act(task.id, () => remove(task.id));
                    }}
                    sx={{
                      opacity: 0,
                      transition: "opacity 0.15s, color 0.15s",
                      color: "text.secondary",
                      "&:hover": { opacity: 1, color: "error.main" },
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Paper>
              );
            })}
          </Box>
        </>
      )}
    </Box>
  );
}
