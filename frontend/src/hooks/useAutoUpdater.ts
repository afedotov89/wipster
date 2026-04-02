import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { appLog } from "@/stores/logStore";

export interface UpdateState {
  available: boolean;
  version: string | null;
  downloading: boolean;
  progress: number;
  ready: boolean;
}

export function useAutoUpdater() {
  const [state, setState] = useState<UpdateState>({
    available: false,
    version: null,
    downloading: false,
    progress: 0,
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;

    const checkForUpdate = async () => {
      try {
        const update = await check();
        if (cancelled || !update) return;

        appLog.info(`Update available: ${update.version}`);
        setState((s) => ({ ...s, available: true, version: update.version }));
      } catch (e) {
        appLog.warn(`Update check failed: ${e}`);
      }
    };

    // Check after 5 seconds, then every 30 minutes
    const timeout = setTimeout(checkForUpdate, 5000);
    const interval = setInterval(checkForUpdate, 30 * 60 * 1000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  const downloadAndInstall = async () => {
    try {
      const update = await check();
      if (!update) return;

      setState((s) => ({ ...s, downloading: true, progress: 0 }));
      appLog.info(`Downloading update ${update.version}...`);

      let totalBytes = 0;
      let downloadedBytes = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            totalBytes = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloadedBytes += event.data.chunkLength;
            const pct = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
            setState((s) => ({ ...s, progress: pct }));
            break;
          case "Finished":
            appLog.info("Update downloaded, ready to relaunch");
            setState((s) => ({ ...s, downloading: false, ready: true, progress: 100 }));
            break;
        }
      });
    } catch (e) {
      appLog.error(`Update failed: ${e}`);
      setState((s) => ({ ...s, downloading: false }));
    }
  };

  const installAndRelaunch = async () => {
    await relaunch();
  };

  return { ...state, downloadAndInstall, installAndRelaunch };
}
