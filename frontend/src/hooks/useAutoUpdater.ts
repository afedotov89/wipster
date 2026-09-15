import { useEffect } from "react";
import { useUpdateStore } from "@/stores/updateStore";

/**
 * Keeps the update store fed: what this build is, and whether a newer one is out.
 *
 * The state itself lives in the store, because the banner is not the only thing
 * that shows it — the settings show the notes in full.
 */
export function useAutoUpdater(): void {
  const load = useUpdateStore((s) => s.load);
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate);

  useEffect(() => {
    void load().catch(() => {
      // Without this the banner simply never says "updated"; nothing breaks.
    });
  }, [load]);

  useEffect(() => {
    // Not at the first paint: starting up matters more than checking GitHub.
    const timeout = setTimeout(checkForUpdate, 5000);
    const interval = setInterval(checkForUpdate, 30 * 60 * 1000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [checkForUpdate]);
}
