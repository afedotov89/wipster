import { openPath } from "@/utils/tauri";

/**
 * Open whatever a piece of text points at.
 *
 * The shell plugin only accepts web addresses — a plain path went to it and
 * silently did nothing, which is how "Show folder" came to be a button that
 * looked fine and did not work. Anything that looks like a path goes to the
 * app's own opener instead, and a bare domain still gets its https://.
 */
export async function openTarget(target: string): Promise<void> {
  const text = target.trim();
  if (!text) return;

  const looksLikeAPath = text.startsWith("/") || text.startsWith("~") || text.startsWith("file://");
  if (looksLikeAPath) {
    await openPath(decodeURI(text.replace(/^file:\/\//, "")));
    return;
  }

  const href = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(href);
  } catch {
    window.open(href, "_blank");
  }
}
