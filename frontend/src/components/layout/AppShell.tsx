import { Box } from "@mui/material";
import Sidebar from "./Sidebar";
import ProjectView from "@/pages/ProjectView";
import AllDoingPage from "@/pages/AllDoingView";
import ArchiveView from "@/pages/ArchiveView";
import SettingsView from "@/pages/SettingsView";
import TaskDetailPanel from "@/components/task/TaskDetailPanel";
import SwapDialog from "@/components/task/SwapDialog";
import AgentPanel from "@/components/agent/AgentPanel";
import { useUiStore } from "@/stores/uiStore";

interface Props {
  /**
   * Space to leave for the macOS titlebar. Zero when something else already
   * fills that band (the update banner), so it is not reserved twice.
   */
  titlebarInset: number;
}

export default function AppShell({ titlebarInset }: Props) {
  const { view, detailOpen, closeDetail } = useUiStore();

  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (!detailOpen) return;
    const target = e.target as HTMLElement;
    // Only close if clicking on genuine empty space (column bg, board bg)
    // Don't close if clicking on cards, buttons, inputs, menus, etc.
    if (target.closest("[data-task-card]") || target.closest("button") || target.closest("input") || target.closest("textarea") || target.closest('[role="menu"]') || target.closest('[role="dialog"]')) return;
    closeDetail();
  };

  return (
    <Box sx={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/*
        `titleBarStyle: "Overlay"` lets the webview fill the whole window, so the
        band behind the traffic lights is painted by the app instead of the system
        grey. The sidebar keeps running to the top edge (no colour seam under the
        lights) and carries its own spacer; the content column gets a matching
        drag strip over the theme background.
      */}
      <Sidebar titlebarInset={titlebarInset} />
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {titlebarInset > 0 && (
          <Box data-tauri-drag-region sx={{ height: titlebarInset, flexShrink: 0 }} />
        )}
        <Box sx={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
          <Box sx={{ flex: 1, overflow: "auto" }} onClick={handleBackgroundClick}>
            {view === "settings" ? (
              <SettingsView />
            ) : view === "project" ? (
              <ProjectView />
            ) : view === "archive" ? (
              <ArchiveView />
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
      </Box>
      <SwapDialog />
      <AgentPanel />
    </Box>
  );
}
