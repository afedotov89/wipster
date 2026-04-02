import { create } from "zustand";

type View = "project" | "all-doing" | "settings";

interface UiState {
  view: View;
  selectedTaskId: string | null;
  detailOpen: boolean;
  swapDialogOpen: boolean;
  swapPendingTaskId: string | null;
  quickAddOpen: boolean;
  setView: (view: View) => void;
  selectTask: (id: string | null) => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  openSwapDialog: (taskId: string) => void;
  closeSwapDialog: () => void;
  toggleQuickAdd: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "project",
  selectedTaskId: null,
  detailOpen: false,
  swapDialogOpen: false,
  swapPendingTaskId: null,
  quickAddOpen: false,

  setView: (view) => set({ view }),
  selectTask: (id) => set({ selectedTaskId: id }),
  openDetail: (id) => set({ selectedTaskId: id, detailOpen: true }),
  closeDetail: () => set({ detailOpen: false, selectedTaskId: null }),
  openSwapDialog: (taskId) =>
    set({ swapDialogOpen: true, swapPendingTaskId: taskId }),
  closeSwapDialog: () =>
    set({ swapDialogOpen: false, swapPendingTaskId: null }),
  toggleQuickAdd: () => set((s) => ({ quickAddOpen: !s.quickAddOpen })),
}));
