import { create } from "zustand";
import {
  DEFAULT_SETTINGS_SECTION,
  type SettingsSectionId,
} from "@/pages/settings/sections";
import { useSettingsStore } from "@/stores/settingsStore";

type View = "project" | "all-doing" | "archive";

interface UiState {
  view: View;
  selectedTaskId: string | null;
  detailOpen: boolean;
  /**
   * Whether the open task fills the window instead of sitting in its strip.
   * A way of looking, not a property of the task: it survives switching tasks
   * and is put away when the panel closes.
   */
  detailExpanded: boolean;
  swapDialogOpen: boolean;
  swapPendingTaskId: string | null;
  quickAddOpen: boolean;
  /**
   * The settings are a surface of their own, not a fourth board: they open over
   * whatever the user was looking at and leave it exactly as it was.
   */
  settingsOpen: boolean;
  /** Whether the assistant's panel is up — it sits over everything, Escape included. */
  agentPanelOpen: boolean;
  /** Which room of the settings is open — remembered while the app runs. */
  settingsSection: SettingsSectionId;
  setView: (view: View) => void;
  setAgentPanelOpen: (open: boolean) => void;
  openSettings: (section?: SettingsSectionId) => void;
  closeSettings: () => void;
  setSettingsSection: (section: SettingsSectionId) => void;
  selectTask: (id: string | null) => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  setDetailExpanded: (expanded: boolean) => void;
  toggleDetailExpanded: () => void;
  openSwapDialog: (taskId: string) => void;
  closeSwapDialog: () => void;
  toggleQuickAdd: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "project",
  selectedTaskId: null,
  detailOpen: false,
  detailExpanded: false,
  swapDialogOpen: false,
  swapPendingTaskId: null,
  quickAddOpen: false,
  settingsOpen: false,
  agentPanelOpen: false,
  settingsSection: DEFAULT_SETTINGS_SECTION,

  setView: (view) => set({ view, detailExpanded: false }),
  setAgentPanelOpen: (agentPanelOpen) => set({ agentPanelOpen }),
  openSettings: (section) =>
    set(section ? { settingsOpen: true, settingsSection: section } : { settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  selectTask: (id) => set({ selectedTaskId: id }),
  // How it opens is the user's standing preference, not the caller's business:
  // the board, the assistant and a keyboard shortcut all end up here.
  openDetail: (id) =>
    set({
      selectedTaskId: id,
      detailOpen: true,
      detailExpanded: useSettingsStore.getState().taskDetailMode === "wide",
    }),
  closeDetail: () => set({ detailOpen: false, selectedTaskId: null, detailExpanded: false }),
  setDetailExpanded: (detailExpanded) => set({ detailExpanded }),
  toggleDetailExpanded: () => set((s) => ({ detailExpanded: !s.detailExpanded })),
  openSwapDialog: (taskId) =>
    set({ swapDialogOpen: true, swapPendingTaskId: taskId }),
  closeSwapDialog: () =>
    set({ swapDialogOpen: false, swapPendingTaskId: null }),
  toggleQuickAdd: () => set((s) => ({ quickAddOpen: !s.quickAddOpen })),
}));
