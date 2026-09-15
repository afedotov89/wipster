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
  read_issue: { active: "Reading the issue", done: "Read the issue" },
  search_issues: { active: "Searching the tracker", done: "Searched the tracker" },
  create_issue: { active: "Creating an issue", done: "Created an issue" },
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
  settingsGeneral: "General",
  settingsCaption: "SETTINGS",
  backToProjects: "Projects",
  settingsAppearance: "Appearance",
  settingsLogs: "Logs",
  logsClear: "Clear",
  logsEmpty: "Nothing yet",
  logsCount: (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`,

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
  trackerUrl: "Issue link",
  issueUrlPlaceholder: "Tracker or GitLab",

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
  apiKey: "API key",
  baseUrl: "API address",
  baseUrlHint: "Base URL of an OpenAI-compatible API, e.g. https://api.example.com/v1",
  providerCustom: "Other (OpenAI-compatible)",
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

  // Updates
  whatsNew: "What's new",
  updateAvailable: (v: string) => `Update ${v} available`,
  updateNow: "Update",
  updateDownloading: "Downloading...",
  updateReady: (v: string) => `Update ${v} ready`,
  updateRestart: "Restart",
  updatedTo: (v: string) => `Updated to ${v}`,
  about: "About",
  version: "Version",
  releaseHistory: "Version history",
  currentVersion: "Current",
  noReleaseNotes: "No notes for this version",
  updatePending: (v: string) => `Version ${v} — ready to install`,

  // Settings - Integrations
  integrations: "Integrations",
  yandexTracker: "Yandex Tracker",
  trackerToken: "OAuth Token",
  trackerOrgId: "Organization ID",
  gitlabUrl: "GitLab address",
  gitlabToken: "Access token",
  gitlabConnect: "Connect",
  gitlabRecheck: "Check again",
  gitlabChecking: "Checking...",
  gitlabTokenKept: "Keep the current one",
  gitlabConnected: (who: string) => `Connected as ${who}`,
  gitlabHelp:
    "A personal access token with read_api is enough to read and search; api is only needed to create issues. GitLab links work exactly like tracker links.",
  trackerHelp: "Tracker issue links in any task field will auto-enrich AI context",

  // Agent prompt hints — label on the chip, command sent to the agent
  /// The "the app itself is yours to ask" tips — chip and command.
  appTipLabel: (tip: string) =>
    ({
      theme: "Change the theme",
      language: "Switch to Russian",
      wip: "The WIP limit",
      archive: "Open the archive",
      undo: "Undo the last thing",
      history: "What changed?",
    })[tip] ?? tip,
  appTipCommand: (tip: string) =>
    ({
      theme: "Show me the themes and switch to a calmer one",
      language: "Switch the interface to Russian",
      wip: "What is the WIP limit right now? Tell me whether it is worth changing",
      archive: "Open the archive and tell me what has piled up there",
      undo: "Undo my last change",
      history: "Show me what changed recently",
    })[tip] ?? tip,
  hintFindTicket: "Find the ticket",
  hintFindTicketCmd:
    "Find the tracker issue behind this task by its title and attach the link to it",
  hintFillTracker: "From the tracker",
  hintFillTrackerCmd: "Fill this task's empty fields from its tracker issue",
  hintBreakDown: "Break down",
  hintBreakDownCmd: "Break this task into 3-4 short steps and put them in the checklist",
  hintEstimate: "Estimate",
  hintEstimateCmd:
    "Estimate how long this task takes, based on similar finished tasks, and save it",
  hintDod: "Definition of done",
  hintDodCmd: "Write a one-line definition of done for this task and save it",
  hintUnloadWip: "Unload",
  hintUnloadWipCmd: (inProgress: number, limit: number) =>
    `${inProgress} tasks in progress against a limit of ${limit}. Look at them and suggest what to put back in the queue`,
  hintDoingSummary: "Where I stand",
  hintDoingSummaryCmd: "Sum up briefly what I have in progress and what is blocking it",
  hintOverdue: "Overdue",
  hintOverdueCmd:
    "Show this project's overdue tasks and suggest what to reschedule and what to do today",
  hintSeedProject: "Seed it",
  hintSeedProjectCmd: (project: string) =>
    `The "${project}" project is empty. Suggest the first 5 tasks and create them`,
  hintFillQueue: "Fill in the queue",
  hintFillQueueCmd:
    "Take the top 5 queued tasks with no estimate or definition of done and fill those fields in",
  hintWhatNext: "What next?",
  hintWhatNextCmd: "Look at this project's tasks and suggest what to start next, and why",
  hintReviewArchive: "Review the archive",
  hintReviewArchiveCmd:
    "Look through the archive and say what is worth bringing back and what is dead",

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
  close: "Close",
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
