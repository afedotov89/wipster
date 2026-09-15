import { create } from "zustand";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import * as api from "@/utils/tauri";
import { appLog } from "@/stores/logStore";

/** Where the app records which version the user has already been shown. */
const SEEN_VERSION = "seen_version";

interface UpdateState {
  /** The version running right now, from the binary itself. */
  currentVersion: string;
  /** Everything this build knows it brought — newest first. */
  releases: api.Release[];

  available: boolean;
  /** The version being offered, when one is. */
  version: string | null;
  /**
   * What the offered version changed. Comes with the update rather than from
   * the file on disk: this build cannot know what a later one will say.
   */
  notes: string;
  downloading: boolean;
  progress: number;
  ready: boolean;

  /** The app started on a version newer than the one last seen. */
  justUpdated: boolean;

  load: () => Promise<void>;
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  installAndRelaunch: () => Promise<void>;
  dismissJustUpdated: () => void;
}

/**
 * Updates, and what is in them.
 *
 * A store rather than a hook's private state because two places ask the same
 * questions: the banner across the top of the window, and the "About" section
 * in the settings that shows the notes in full.
 */
export const useUpdateStore = create<UpdateState>((set) => ({
  currentVersion: "",
  releases: [],
  available: false,
  version: null,
  notes: "",
  downloading: false,
  progress: 0,
  ready: false,
  justUpdated: false,

  load: async () => {
    const info = await api.appInfo();
    set({ currentVersion: info.version, releases: info.releases });

    // Which version the user last saw. A first run records it quietly — nobody
    // wants release notes for an app they just installed.
    const seen = await api.getSetting(SEEN_VERSION).catch(() => null);
    if (seen !== info.version) {
      await api.setSetting(SEEN_VERSION, info.version).catch(() => {});
    }
    if (seen && seen !== info.version) {
      appLog.info(`[update] started on ${info.version}, last seen ${seen}`);
      set({ justUpdated: true });
    }
  },

  checkForUpdate: async () => {
    try {
      const update = await check();
      if (!update) return;

      appLog.info(`Update available: ${update.version}`);
      set({
        available: true,
        version: update.version,
        notes: (update.body ?? "").trim(),
      });
    } catch (e) {
      appLog.warn(`Update check failed: ${e}`);
    }
  },

  downloadAndInstall: async () => {
    try {
      const update = await check();
      if (!update) return;

      set({ downloading: true, progress: 0 });
      appLog.info(`Downloading update ${update.version}...`);

      let totalBytes = 0;
      let downloadedBytes = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            totalBytes = event.data.contentLength ?? 0;
            break;
          case "Progress": {
            downloadedBytes += event.data.chunkLength;
            const pct = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
            set({ progress: pct });
            break;
          }
          case "Finished":
            appLog.info("Update downloaded, ready to relaunch");
            set({ downloading: false, ready: true, progress: 100 });
            break;
        }
      });
    } catch (e) {
      appLog.error(`Update failed: ${e}`);
      set({ downloading: false });
    }
  },

  installAndRelaunch: async () => {
    await relaunch();
  },

  // Recorded as seen the moment the app started, so this only clears the strip
  // for the rest of the session.
  dismissJustUpdated: () => set({ justUpdated: false }),
}));
