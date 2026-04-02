import { Box } from "@mui/material";
import Sidebar from "./Sidebar";
import ProjectView from "@/pages/ProjectView";
import AllDoingPage from "@/pages/AllDoingView";
import SettingsView from "@/pages/SettingsView";
import TaskDetailPanel from "@/components/task/TaskDetailPanel";
import SwapDialog from "@/components/task/SwapDialog";
import AgentPanel from "@/components/agent/AgentPanel";
import { useUiStore } from "@/stores/uiStore";

export default function AppShell() {
  const { view, detailOpen } = useUiStore();

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar />
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Box sx={{ flex: 1, overflow: "auto" }}>
          {view === "settings" ? (
            <SettingsView />
          ) : view === "project" ? (
            <ProjectView />
          ) : (
            <AllDoingPage />
          )}
        </Box>
        {detailOpen && view !== "settings" && (
          <Box
            sx={{
              width: 380,
              borderLeft: 1,
              borderColor: "divider",
              overflow: "auto",
            }}
          >
            <TaskDetailPanel />
          </Box>
        )}
      </Box>
      <SwapDialog />
      <AgentPanel />
    </Box>
  );
}
