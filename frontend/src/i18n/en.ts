/// Wording for the agent's activity line, per tool: `active` while the step is
/// running, `done` once it is behind us. A tool with two user-visible meanings
/// gets a `tool:variant` entry.
const AGENT_STEPS: Record<string, { active: string; done: string }> = {
  create_task: { active: "Creating task", done: "Created task" },
  update_task: { active: "Updating task", done: "Updated task" },
  move_task: { active: "Moving task", done: "Moved task" },
  delete_task: { active: "Deleting task", done: "Deleted task" },
  set_task_archived: { active: "Archiving task", done: "Archived task" },
  "set_task_archived:restore": { active: "Restoring task", done: "Restored task" },
  search_tasks: { active: "Searching tasks", done: "Searched tasks" },
  list_tasks: { active: "Reading the task list", done: "Read the task list" },
  list_projects: { active: "Reading projects", done: "Read projects" },
  get_task: { active: "Reading task", done: "Read task" },
  read_tracker_issue: { active: "Reading the tracker", done: "Read the tracker" },
  create_tracker_issue: { active: "Creating a tracker issue", done: "Created a tracker issue" },
  remember: { active: "Saving to memory", done: "Saved to memory" },
};

const en = {
  // App
  appName: "WIPSTER",

  // Navigation
  allDoing: "All Doing",
  archive: "Archive",
  projects: "PROJECTS",
  uploadIcon: "Upload your own icon — or paste one with ⌘V",
  monoIcon: "Single-colour icon — paint it in the project colour",
  iconTooLarge: "The file is too big — up to 4 MB, or 64 KB for SVG",
  iconNotAnImage: "That is not an image Wipster can read",
  addSubProject: "Add sub-project",
  subProjectName: "Sub-project name",
  deleteProjectTitle: (name: string) => `Delete "${name}"?`,
  deleteProjectSubProjects: (n: number) =>
    `${n} sub-project${n === 1 ? "" : "s"} will be deleted with it.`,
  deleteProjectTasks: (n: number) =>
    `${n} task${n === 1 ? "" : "s"} will move to the Archive, where they can be restored.`,
  settings: "Settings",
  language: "Language",

  // Project
  projectName: "Project name",
  selectProject: "Select a project or create one to get started",
  rename: "Rename",
  delete: "Delete",
  none: "None",
  icon: "Icon",
  color: "Color",
  appearance: "Appearance",

  // Task statuses
  statusInbox: "Inbox",
  statusQueue: "Queue",
  statusDoing: "Doing",
  statusDone: "Done",

  // Priority
  priorityCritical: "Critical",
  priorityHigh: "High",
  priorityMedium: "Medium",
  priorityLow: "Low",

  // Energy
  energy: "Energy",

  // Estimates
  estimateS: "S",
  estimateM: "M",
  estimateL: "L",
  timeEstimate: "Time estimate",
  timeEstimatePlaceholder: "e.g. 2h, 3d",
  promisedTo: "Promised to",
  comment: "Comment",
  trackerUrl: "Tracker link",

  // Quick Add
  addTaskPlaceholder: "Add task... (⌘N)",

  // Task Detail
  noTaskSelected: "No task selected",
  project: "Project",
  priority: "Priority",
  estimate: "Estimate",
  dueDate: "Due date",
  definitionOfDone: "Definition of Done",
  nextStep: "Next Step",
  steps: "Steps",
  firstStep: "First step",
  addStep: "Add step...",
  returnContext: "Return Context",

  // WIP / Swap
  wipLimitReached: "WIP Limit Reached",
  wipLimitDescription: (inProgress: number) =>
    `You already have ${inProgress} task${inProgress === 1 ? "" : "s"} in progress. ` +
    "Choose one to move back to Queue:",
  keepInQueue: "Keep in Queue",

  // All Doing
  inProgress: "In Progress",
  pause: "Pause",
  done: "Done",
  nextPrefix: "Next:",
  contextSaved: "Context saved",
  noTasksInProgress: "No tasks in progress. Start a task from a project.",

  // Archive
  moveToArchive: "Move to archive",
  restoreFromArchive: "Restore",
  archiveEmpty: "The archive is empty. Tasks you park here stay out of the way until someone remembers them.",
  archiveHint: "Tasks parked here are hidden from the board — restore any of them at any time.",
  archivedOn: "Archived",

  // Settings - Appearance
  themeSection: "Theme",
  themeSectionHint: "Pick a mood for your work session",

  // Settings - AI
  aiConnector: "AI Assistant",
  provider: "Provider",
  model: "Model",
  save: "Save",
  saved: "Saved",
  testConnection: "Test",
  testRunning: "Testing…",
  testOk: "Connection works",
  testFailed: "Failed",
  testToolOk: (name: string) => `Tool call ${name} went through`,
  testToolMissing: "The model replied but called no tool — tool use is not working",
  testKeyMissing: "Set an API key first",
  testProjectsInDb: (n: number) => `projects in the database: ${n}`,

  // Settings - WIP limit
  wipLimitSetting: "Tasks in progress at once",
  wipLimitSettingHint: "The hard cap on the Doing column. Fewer means finishing more.",

  // Settings - Integrations
  integrations: "Integrations",
  yandexTracker: "Yandex Tracker",
  trackerToken: "OAuth Token",
  trackerOrgId: "Organization ID",
  trackerHelp: "Tracker issue links in any task field will auto-enrich AI context",

  // Agent
  agent: "Agent",
  agentThinking: "Thinking\u2026",
  aiFillHint: "Complete this task with AI \u2014 from its tracker issue and similar tasks",
  aiFilling: "AI is filling this task in\u2026",
  agentStop: "Stop",
  agentStopped: "Stopped.",
  agentElapsed: (seconds: number) => `${seconds}s`,
  agentNoApiKey: "API key not set. Go to **Settings** \u2192 **AI Assistant**.",
  agentInternalError: "The agent crashed mid-request. Details are in the log.",
  /// How the current step is worded; falls back to the raw tool name.
  agentStep: (tool: string, variant: string | null, done: boolean) => {
    const wording = (variant && AGENT_STEPS[`${tool}:${variant}`]) || AGENT_STEPS[tool];
    if (!wording) return tool;
    return done ? wording.done : wording.active;
  },
  apply: "Apply",
  cancel: "Cancel",
  applied: "Applied",
  typeCommand: "Type a command...",
  unknownCommand:
    'I don\'t understand that command. Try: "close all done", "move all inbox to queue", "set priority p1 on all doing"',
  noDoneTasks: "No done tasks to close.",
  deleteCompleted: (n: number) => `Delete ${n} completed task(s)`,
  deleteTask: (title: string) => `Delete "${title}"`,
  setPriorityOn: (prio: string, n: number, status: string) =>
    `Set priority ${prio} on ${n} ${status} task(s)`,
  moveTasks: (n: number, from: string, to: string) =>
    `Move ${n} task(s) from ${from} to ${to}`,
  moveTaskTo: (title: string, to: string) => `"${title}" → ${to}`,
  andMore: (n: number) => `...and ${n} more`,
} as const;

export default en;
