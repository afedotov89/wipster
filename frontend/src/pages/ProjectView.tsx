import { useEffect } from "react";
import { Box, Typography } from "@mui/material";
import KanbanBoard from "@/components/kanban/KanbanBoard";
import QuickAddInput from "@/components/task/QuickAddInput";
import { useProjectStore } from "@/stores/projectStore";
import { useTaskStore } from "@/stores/taskStore";
import { useI18n } from "@/i18n";
import { getProjectIcon } from "@/components/layout/ProjectAppearancePicker";

export default function ProjectView() {
  const { projects, selectedProjectId } = useProjectStore();
  const { load, loadDoing } = useTaskStore();
  const { t } = useI18n();

  const project = projects.find((p) => p.id === selectedProjectId);

  useEffect(() => {
    if (selectedProjectId) {
      load(selectedProjectId);
      loadDoing();
    }
  }, [selectedProjectId, load, loadDoing]);

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
