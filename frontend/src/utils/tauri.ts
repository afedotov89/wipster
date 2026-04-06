import { invoke } from "@tauri-apps/api/core";

// ---- Types ----

export interface Project {
  id: string;
  name: string;
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
  position: number | null;
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

export const createProject = (name: string) =>
  invoke<Project>("create_project", { input: { name } });

export const updateProject = (id: string, input: { name?: string; icon?: string; color?: string; order?: number }) =>
  invoke<Project>("update_project", { id, input });

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

export const getSetting = (key: string) =>
  invoke<string | null>("get_setting", { key });

export const setSetting = (key: string, value: string) =>
  invoke<void>("set_setting", { key, value });

// ---- Agent commands ----

export interface AgentAction {
  action: string;
  task_id: string | null;
  field: string | null;
  value: string | null;
  description: string;
  project_id?: string;
  priority?: string;
  due?: string;
  status?: string;
  dod?: string;
  time_estimate?: string;
  promised_to?: string;
}

export interface AgentResponse {
  summary: string;
  actions: AgentAction[];
}

export const agentChat = (message: string, focusedTaskId?: string) =>
  invoke<AgentResponse>("agent_chat", { message, focusedTaskId });

// ---- Chat session commands ----

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
}

export interface ChatMessageRecord {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  text: string;
  actions: AgentAction[] | null;
  executed: boolean;
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
) => invoke<ChatMessageRecord>("add_chat_message", { sessionId, role, text, actionsJson, executed });

export const updateChatMessage = (id: string, executed: boolean) =>
  invoke<void>("update_chat_message", { id, executed });

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

export const reorderTasks = (taskIds: string[]) =>
  invoke<void>("reorder_tasks", { taskIds });

// ---- AI Fill ----

export interface AiFillResult {
  time_estimate: string | null;
  dod: string | null;
  priority: string | null;
  promised_to: string | null;
  checklist: string | null;
}

export const aiFillTask = (taskId: string) =>
  invoke<AiFillResult>("ai_fill_task", { taskId });
