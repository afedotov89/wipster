const en = {
  // App
  appName: "WIPSTER",

  // Navigation
  allDoing: "All Doing",
  archive: "Archive",
  projects: "PROJECTS",
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
  wipLimitDescription:
    "You already have 3 tasks in progress. Choose one to move back to Queue:",
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

  // Settings - Integrations
  integrations: "Integrations",
  yandexTracker: "Yandex Tracker",
  trackerToken: "OAuth Token",
  trackerOrgId: "Organization ID",
  trackerHelp: "Tracker issue links in any task field will auto-enrich AI context",

  // Agent
  agent: "Agent",
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
