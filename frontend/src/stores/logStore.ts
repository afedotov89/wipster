import { create } from "zustand";

interface LogEntry {
  time: string;
  level: "info" | "error" | "warn";
  message: string;
}

interface LogState {
  entries: LogEntry[];
  log: (level: "info" | "error" | "warn", message: string) => void;
  clear: () => void;
}

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  log: (level, message) => {
    const entry: LogEntry = {
      time: new Date().toLocaleTimeString(),
      level,
      message,
    };
    set((s) => ({ entries: [...s.entries.slice(-99), entry] }));
  },
  clear: () => set({ entries: [] }),
}));

// Global helper for logging from anywhere
export const appLog = {
  info: (msg: string) => useLogStore.getState().log("info", msg),
  error: (msg: string) => useLogStore.getState().log("error", msg),
  warn: (msg: string) => useLogStore.getState().log("warn", msg),
};
