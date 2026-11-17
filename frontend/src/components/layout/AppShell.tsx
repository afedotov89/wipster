import { isTauri } from "@tauri-apps/api/core";
import BrowserNavigation from "@/browser/BrowserNavigation";
import { Button, Box } from "@mui/material";
import { DndContext, DragOverlay, closestCenter } from "@dnd-kit/core";
import Sidebar from "./Sidebar";
import TaskCard from "@/components/kanban/TaskCard";
import { useBoardDnd } from "@/hooks/useBoardDnd";
import ProjectView from "@/pages/ProjectView";
import AllDoingPage from "@/pages/AllDoingView";
import ArchiveView from "@/pages/ArchiveView";
import { settingsTabId } from "@/pages/settings/SettingsNav";
import SettingsSidebar from "@/pages/settings/SettingsSidebar";
import SettingsPage from "@/pages/settings/SettingsPage";
import TaskDetailPanel from "@/components/task/TaskDetailPanel";
import SwapDialog from "@/components/task/SwapDialog";
import AgentPanel from "@/components/agent/AgentPanel";
import { useUiStore } from "@/stores/uiStore";
import { useSettingsShortcut } from "@/hooks/useSettingsShortcut";

interface Props {
  /**
   * Whether the macOS window buttons float over the sidebar's title band. They
   * do unless something else has taken the top of the window — the update
   * banner — in which case the band starts at its own left edge.
   */
  windowButtonsOverlap: boolean;
}

export default function AppShell({ windowButtonsOverlap }: Props) {
  const web = !isTauri();
  const { view, detailOpen, detailExpanded, closeDetail, settingsOpen, settingsSection } = useUiStore();
  useSettingsShortcut();
  // One drag context around the sidebar and the board, so a task can be dragged
  // out of a column and onto any project.
  const { sensors, activeTask, onDragStart, onDragEnd } = useBoardDnd();

  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (!detailOpen) return;
    const target = e.target as HTMLElement;
    // Only close if clicking on genuine empty space (column bg, board bg)
    // Don't close if clicking on cards, buttons, inputs, menus, etc. The title
    // band counts as window chrome, not board background: dragging the window
    // by it ends in a click here, and the open task used to close on every move.
    if (
      target.closest("[data-task-card]") ||
      target.closest("[data-tauri-drag-region]") ||
      target.closest("button") ||
      target.closest("input") ||
      target.closest("textarea") ||
      target.closest('[role="menu"]') ||
      target.closest('[role="dialog"]')
    )
      return;
    closeDetail();
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
    <Box sx={{ display: "flex", flexDirection: web ? "column" : "row", height: "100%", overflow: "hidden", "--web-paper": (theme) => theme.palette.background.paper }}>
      {web && <BrowserNavigation />}
      {web && settingsOpen && <Box component="nav" aria-label="Разделы настроек" className="web-settings-nav">{(["general", "account", "appearance", "fields"] as const).map((section, i) => <Button key={section} id={settingsTabId(section)} aria-pressed={settingsSection===section} onClick={() => useUiStore.getState().setSettingsSection(section)}>{["Общие", "Аккаунт", "Оформление", "Поля"][i]}</Button>)}<Button onClick={() => useUiStore.getState().closeSettings()}>Закрыть настройки</Button></Box>}
      {/*
        `titleBarStyle: "Overlay"` lets the webview fill the whole window, so the
        band behind the traffic lights is painted by the app instead of the system
        grey. Both columns run to the top edge and put their title in that band —
        the sidebar's clears the buttons, the content column is far enough right
        that nothing floats over it.
      */}
      {!web && (settingsOpen ? (
        <SettingsSidebar windowButtonsOverlap={windowButtonsOverlap} />
      ) : (
        <Sidebar windowButtonsOverlap={windowButtonsOverlap} />
      ))}
      <Box className="web-content" sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        <Box sx={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
          <Box sx={{ flex: 1, overflow: "auto" }} onClick={handleBackgroundClick}>
            {settingsOpen ? (
              <SettingsPage />
            ) : view === "project" ? (
              <ProjectView />
            ) : view === "archive" ? (
              <ArchiveView />
            ) : (
              <AllDoingPage />
            )}
          </Box>
          {detailOpen && !settingsOpen && (
            <Box
              className={web ? "web-task-panel" : undefined}
              sx={{
                // The panel grows into the window rather than being replaced by
                // a bigger one: same element, same fields, same caret — only
                // wider. The board is squeezed out as it goes, which is why one
                // animated property is enough.
                width: detailExpanded ? "100%" : 380,
                flexShrink: 0,
                borderLeft: detailExpanded ? 0 : 1,
                borderColor: "divider",
                overflow: "auto",
                transition: "width 340ms cubic-bezier(0.32, 0.72, 0, 1)",
                "@media (prefers-reduced-motion: reduce)": { transition: "none" },
              }}
            >
              <TaskDetailPanel />
            </Box>
          )}
        </Box>
      </Box>
      <SwapDialog />
      {!web && <AgentPanel />}
    </Box>
    <DragOverlay>{activeTask ? <TaskCard task={activeTask} onMove={() => {}} /> : null}</DragOverlay>
    </DndContext>
  );
}
