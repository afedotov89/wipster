import { useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import KanbanBoard from "@/components/kanban/KanbanBoard";
import QuickAddInput from "@/components/task/QuickAddInput";
import { useProjectStore } from "@/stores/projectStore";
import { useTaskStore } from "@/stores/taskStore";
import { useUiStore } from "@/stores/uiStore";
import { useI18n } from "@/i18n";
import { getProjectIcon } from "@/components/layout/ProjectAppearancePicker";

export default function ProjectView() {
  const { projects, selectedProjectId } = useProjectStore();
  const { load, loadDoing, pinnedTaskId } = useTaskStore();
  const { selectedTaskId, detailOpen } = useUiStore();
  const { t } = useI18n();

  const project = projects.find((p) => p.id === selectedProjectId);

  useEffect(() => {
    if (selectedProjectId) {
      load(selectedProjectId);
      loadDoing();
    }
  }, [selectedProjectId, load, loadDoing]);

  // A newly created task stays on top only while it is open. Closing it (or
  // switching to another task) is the moment it drops into its sorted place.
  const openedPinRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pinnedTaskId || !selectedProjectId) return;
    if (detailOpen && selectedTaskId === pinnedTaskId) {
      openedPinRef.current = pinnedTaskId;
      return;
    }
    // Wait until the task has actually been opened — creating it and opening it
    // are two separate renders, and settling in between would defeat the pin.
    if (openedPinRef.current !== pinnedTaskId) return;
    openedPinRef.current = null;
    load(selectedProjectId);
  }, [pinnedTaskId, selectedTaskId, detailOpen, selectedProjectId, load]);

  if (!selectedProjectId || !project) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <Typography color="text.secondary">
          {t.selectProject}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box sx={{ px: 2, pt: 2, pb: 0, display: "flex", alignItems: "center", gap: 1 }}>
        {(() => { const Icon = getProjectIcon(project.icon); return <Icon sx={{ color: project.color || undefined, fontSize: 28 }} />; })()}
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {project.name}
        </Typography>
      </Box>
      <QuickAddInput />
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <KanbanBoard />
      </Box>
    </Box>
  );
}
