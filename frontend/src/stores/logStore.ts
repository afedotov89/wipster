import { create } from "zustand";
import { getBackendLogs } from "@/utils/tauri";

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

function parseLevel(msg: string): "info" | "error" | "warn" {
  if (msg.includes("[error]") || msg.toLowerCase().includes("error")) return "error";
  if (msg.includes("[warn]")) return "warn";
  return "info";
}

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  log: (level, message) => {
    const entry: LogEntry = {
      time: new Date().toLocaleTimeString(),
      level,
      message,
    };
    set((s) => ({ entries: [...s.entries.slice(-199), entry] }));
  },
  clear: () => set({ entries: [] }),
}));

// Poll backend logs every 2 seconds
setInterval(async () => {
  try {
    const logs = await getBackendLogs();
    if (logs.length > 0) {
      const store = useLogStore.getState();
      for (const msg of logs) {
        store.log(parseLevel(msg), msg);
      }
    }
  } catch {
    // Not in Tauri context
  }
}, 2000);

// Global helper
export const appLog = {
  info: (msg: string) => useLogStore.getState().log("info", msg),
  error: (msg: string) => useLogStore.getState().log("error", msg),
  warn: (msg: string) => useLogStore.getState().log("warn", msg),
};
