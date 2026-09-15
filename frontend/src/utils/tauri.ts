import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ---- Types ----

export interface Project {
  id: string;
  name: string;
  /// Parent project, or null for a top-level one. The data model allows any
  /// depth; the sidebar shows one level of nesting.
  parent_id: string | null;
  /// A user's own icon as a data URL; when set it replaces the built-in one.
  icon_image: string | null;
  /// That icon is a single-colour glyph and takes the project's colour.
  icon_mono: boolean;
  icon: string | null;
  color: string | null;
  order: number;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = "inbox" | "queue" | "doing" | "done";
export type Priority = "p0" | "p1" | "p2" | "p3";
export type Estimate = "s" | "m" | "l";

export interface Task {
  id: string;
  title: string;
  project_id: string | null;
  status: TaskStatus;
  priority: string | null;
  energy: string | null;
  due: string | null;
  estimate: string | null;
  time_estimate: string | null;
  tags: string;
  dod: string | null;
  checklist: string;
  next_step: string | null;
  return_ref: string | null;
  promised_to: string | null;
  comment: string | null;
  tracker_url: string | null;
  position: number | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContextSnapshot {
  id: string;
  task_id: string | null;
  captured_at: string;
  app: string | null;
  window_title: string | null;
  url: string | null;
  repo: string | null;
  branch: string | null;
  file_path: string | null;
  note: string | null;
}

export interface ChangeLogEntry {
  id: string;
  created_at: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value: string | null;
  new_value: string | null;
  undone: boolean;
  batch_id: string | null;
}

export interface MoveTaskResult {
  task: Task;
  wip_blocked: boolean;
  doing_tasks: Task[];
}

// ---- Project commands ----

export const listProjects = () => invoke<Project[]>("list_projects");

export const createProject = (name: string, parentId?: string) =>
  invoke<Project>("create_project", { input: { name, parent_id: parentId ?? null } });

export interface UpdateProjectInput {
  name?: string;
  icon?: string;
  /// null drops the custom icon and falls back to the built-in one.
  icon_image?: string | null;
  icon_mono?: boolean;
  color?: string;
  order?: number;
  /// null promotes the project to the top level; omit to leave the parent alone.
  parent_id?: string | null;
}

export const updateProject = (id: string, input: UpdateProjectInput) =>
  invoke<Project>("update_project", { id, input });

/** What deleting a project would take with it. */
export interface ProjectDeleteImpact {
  sub_projects: number;
  tasks: number;
}

export const projectDeleteImpact = (id: string) =>
  invoke<ProjectDeleteImpact>("project_delete_impact", { id });

export const deleteProject = (id: string) =>
  invoke<void>("delete_project", { id });

// ---- Task commands ----

export const listTasks = (projectId?: string, status?: string) =>
  invoke<Task[]>("list_tasks", { projectId, status });

export const createTask = (title: string, projectId?: string, status?: string) =>
  invoke<Task>("create_task", {
    input: { title, project_id: projectId, status },
  });

export const getTask = (id: string) => invoke<Task>("get_task", { id });

export const updateTask = (id: string, input: Partial<Omit<Task, "id" | "created_at" | "updated_at">>) =>
  invoke<Task>("update_task", { id, input });

export const deleteTask = (id: string) => invoke<void>("delete_task", { id });

export const moveTask = (taskId: string, newStatus: TaskStatus, swapTaskId?: string) =>
  invoke<MoveTaskResult>("move_task", {
    input: { task_id: taskId, new_status: newStatus, swap_task_id: swapTaskId },
  });

export const getDoingTasks = () => invoke<Task[]>("get_doing_tasks");

export const listArchivedTasks = () => invoke<Task[]>("list_archived_tasks");

export const setTaskArchived = (id: string, archived: boolean) =>
  invoke<Task>("set_task_archived", { id, archived });

export interface ProjectTaskCounts {
  project_id: string;
  queue: number;
  doing: number;
  done: number;
}

export const getProjectTaskCounts = () => invoke<ProjectTaskCounts[]>("get_project_task_counts");

export const getPromisedToOptions = () => invoke<string[]>("get_promised_to_options");

export const getEstimateOptions = () => invoke<string[]>("get_estimate_options");

// ---- Changelog commands ----

export const undoLast = () => invoke<ChangeLogEntry | null>("undo_last");
export const redoLast = () => invoke<ChangeLogEntry | null>("redo_last");
export const getChangelog = (limit?: number) =>
  invoke<ChangeLogEntry[]>("get_changelog", { limit });

// ---- Context commands ----

export const captureContext = (taskId?: string) =>
  invoke<ContextSnapshot>("capture_context", { taskId });

export const getTaskContexts = (taskId: string) =>
  invoke<ContextSnapshot[]>("get_task_contexts", { taskId });

// ---- Settings commands ----

/** How many tasks may sit in Doing at once. */
export const getWipLimit = () => invoke<number>("get_wip_limit");

/** Store a new limit; resolves to the value the backend actually kept. */
export const setWipLimit = (limit: number) => invoke<number>("set_wip_limit", { limit });


export const getSetting = (key: string) =>
  invoke<string | null>("get_setting", { key });

export const setSetting = (key: string, value: string) =>
  invoke<void>("set_setting", { key, value });

// ---- Agent commands ----

export interface ToolCallLog {
  tool_name: string;
  arguments: Record<string, unknown>;
  result: string;
}

export interface PendingToolCall {
  tool_name: string;
  arguments: Record<string, unknown>;
  description: string;
}
export interface AgentResponse {
  text: string;
  tool_calls: ToolCallLog[];
  pending_confirmations: PendingToolCall[];
  continuation: string | null;
}

/// A step the agent is taking right now, streamed while `agentChat` is in flight.
export interface AgentProgress {
  run_id: string;
  seq: number;
  phase: "thinking" | "tool";
  tool: string | null;
  variant: string | null;
  detail: string | null;
}

/// Error text a stopped run rejects with - not a failure, so it is never shown.
export const AGENT_CANCELLED = "AGENT_CANCELLED";

export const agentChat = (
  runId: string,
  message: string,
  focusedTaskId?: string,
  history?: [string, string][],
) => invoke<AgentResponse>("agent_chat", { runId, message, focusedTaskId, history });

/// Stop a run started with the same id. Resolves to false if it already finished.
export const agentCancel = (runId: string) => invoke<boolean>("agent_cancel", { runId });

export const onAgentProgress = (handler: (step: AgentProgress) => void) =>
  listen<AgentProgress>("agent-progress", (e) => handler(e.payload));

export interface LlmTestResult {
  provider: string;
  model: string;
  latency_ms: number;
  tools_called: string[];
  answer: string;
  projects_in_db: number;
}

/** What a field holds, and therefore how it is edited. */
export type FieldKind =
  | "text"
  | "long_text"
  | "number"
  | "date"
  | "checkbox"
  | "select"
  | "url"
  | "url_list"
  | "file_list"
  | "text_list"
  | "checklist";

/** One field of a task, as configured. */
export interface TaskField {
  id: string;
  /** The column for a built-in field, a slug for a custom one. */
  key: string;
  /** What the user called it; built-in fields are named by the app. */
  label: string | null;
  kind: FieldKind;
  options: string[];
  builtin: boolean;
  enabled: boolean;
  position: number;
  removed_at: string | null;
}

/** Whatever a custom field holds, keyed by field id. */
export type TaskFieldValues = Record<string, unknown>;

export const listTaskFields = () => invoke<TaskField[]>("list_task_fields");

export const removedTaskFields = () => invoke<TaskField[]>("removed_task_fields");

export const createTaskField = (label: string, kind: FieldKind, options?: string[]) =>
  invoke<TaskField>("create_task_field", { label, kind, options });

export const updateTaskField = (
  id: string,
  patch: { label?: string; enabled?: boolean; options?: string[] },
) => invoke<TaskField>("update_task_field", { id, ...patch });

export const reorderTaskFields = (ids: string[]) =>
  invoke<void>("reorder_task_fields", { ids });

export const removeTaskField = (id: string) => invoke<void>("remove_task_field", { id });

export const restoreTaskField = (id: string) => invoke<TaskField>("restore_task_field", { id });

export const taskFieldValues = (taskId: string) =>
  invoke<TaskFieldValues>("task_field_values", { taskId });

export const setTaskFieldValue = (taskId: string, fieldId: string, value: unknown) =>
  invoke<void>("set_task_field_value", { taskId, fieldId, value });

/** One released version, as written in CHANGELOG.md. */
export interface Release {
  version: string;
  date: string;
  /** Markdown — the bullets of that section. */
  notes: string;
}

/** What this build is, and what every version of it brought. */
export interface AppInfo {
  version: string;
  releases: Release[];
}

export const appInfo = () => invoke<AppInfo>("app_info");

/** A service the app can be pointed at, as the backend describes it. */
export interface LlmProvider {
  id: string;
  label: string;
  api: "anthropic" | "openai";
  /** Empty when the address is the user's to supply. */
  base_url: string;
  default_model: string;
  key_hint: string;
  model_hint: string;
}

/** Everything the app can talk to — the list lives in Rust, next to the callers. */
export const llmProviders = () => invoke<LlmProvider[]>("llm_providers");

export const testLlmConnection = () => invoke<LlmTestResult>("test_llm_connection");

// ---- Chat session commands ----

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
}

export type ConfirmationStatus = "pending" | "confirmed" | "cancelled";

export interface ChatMessageRecord {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  text: string;
  tool_calls: ToolCallLog[] | null;
  executed: boolean;
  pending_confirmations: PendingToolCall[] | null;
  confirmation_status: ConfirmationStatus | null;
  created_at: string;
}

export const createChatSession = () =>
  invoke<ChatSession>("create_chat_session");

export const listChatSessions = () =>
  invoke<ChatSession[]>("list_chat_sessions");

export const getChatMessages = (sessionId: string) =>
  invoke<ChatMessageRecord[]>("get_chat_messages", { sessionId });

export const addChatMessage = (
  sessionId: string,
  role: string,
  text: string,
  actionsJson: string | null,
  executed: boolean,
  pendingConfirmationsJson: string | null = null,
  confirmationStatus: ConfirmationStatus | null = null,
) => invoke<ChatMessageRecord>("add_chat_message", {
  sessionId, role, text, actionsJson, executed,
  pendingConfirmationsJson, confirmationStatus,
});

export const updateChatMessage = (id: string, executed: boolean) =>
  invoke<void>("update_chat_message", { id, executed });

export const updateChatConfirmation = (id: string, status: ConfirmationStatus) =>
  invoke<void>("update_chat_confirmation", { id, status });

export const deleteChatSession = (sessionId: string) =>
  invoke<void>("delete_chat_session", { sessionId });

// ---- Autocomplete ----

export const aiAutocomplete = (taskId: string, fieldName: string, currentValue: string) =>
  invoke<string>("ai_autocomplete", { taskId, fieldName, currentValue });

// ---- Tracker ----

export interface DeviceAuthStart {
  user_code: string;
  verification_url: string;
}

export const trackerStartAuth = () => invoke<DeviceAuthStart>("tracker_start_auth");
export const trackerPollToken = () => invoke<string>("tracker_poll_token");
export const trackerStatus = () => invoke<boolean>("tracker_status");

/** Is this text nothing but a link to an issue, in any connected tracker? */
export const isBareIssueReference = (text: string) =>
  invoke<boolean>("is_bare_issue_reference", { text });

/** The configured GitLab address, or null when it is not set up. */
export const gitlabStatus = () => invoke<string | null>("gitlab_status");

export const gitlabConfigure = (url: string, token: string) =>
  invoke<void>("gitlab_configure", { url, token });

/** Check the GitLab token against the server; resolves to the user's name. */
export const gitlabTest = () => invoke<string>("gitlab_test");

export const reorderTasks = (taskIds: string[]) =>
  invoke<void>("reorder_tasks", { taskIds });

// ---- AI Fill ----

export interface AiFillResult {
  /// Set only when the title was a bare tracker link and the ticket named the work.
  title: string | null;
  time_estimate: string | null;
  dod: string | null;
  priority: string | null;
  promised_to: string | null;
  checklist: string | null;
  tracker_url: string | null;
}

export const aiFillTask = (taskId: string) =>
  invoke<AiFillResult>("ai_fill_task", { taskId });

/** Commands the user types most often, for the agent panel's hints. */
export const recentUserPrompts = (limit?: number) =>
  invoke<string[]>("recent_user_prompts", { limit });

export const getBackendLogs = () => invoke<string[]>("get_backend_logs");

export const agentConfirm = (toolCalls: PendingToolCall[]) =>
  invoke<ToolCallLog[]>("agent_confirm", { toolCalls });
