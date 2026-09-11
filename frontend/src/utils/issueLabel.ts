/**
 * The short name a person uses for a linked issue.
 *
 * Yandex Tracker keys are globally unique and sit in the last path segment, so
 * "QUEUE-123" is both the label and the address. GitLab numbers issues per
 * project, so the last segment is a bare "42" that identifies nothing on a
 * board of tasks from several repositories — the project has to come with it.
 */
export function issueLabel(url: string): string {
  const text = url.trim();
  if (!text) return text;

  const gitlab = parseGitLab(text);
  if (gitlab) return gitlab;

  // Anything else: the last path segment, which is the tracker key.
  const path = text.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return path.split("/").pop() || text;
}

/** `…/group/project/-/issues/42` and `group/project#42` — both say `project#42`. */
function parseGitLab(text: string): string | null {
  const link = text.match(/^[a-z]+:\/\/[^/]+\/(.+?)\/-\/(?:issues|work_items)\/(\d+)/i);
  if (link) return `${lastSegment(link[1])}#${link[2]}`;

  const mention = text.match(/^([\w.\-/]+\/[\w.\-]+)#(\d+)$/);
  if (mention) return `${lastSegment(mention[1])}#${mention[2]}`;

  return null;
}

function lastSegment(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
