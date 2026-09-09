/// Формулировки строки активности агента по инструментам: `active` — пока шаг
/// идёт, `done` — когда он позади. Инструменту с двумя смыслами для
/// пользователя добавляется запись `tool:variant`.
const AGENT_STEPS: Record<string, { active: string; done: string }> = {
  create_task: { active: "Создаю задачу", done: "Создана задача" },
  update_task: { active: "Обновляю задачу", done: "Обновлена задача" },
  move_task: { active: "Переношу задачу", done: "Задача перенесена" },
  delete_task: { active: "Удаляю задачу", done: "Задача удалена" },
  set_task_archived: { active: "Убираю в архив", done: "Убрано в архив" },
  "set_task_archived:restore": { active: "Возвращаю из архива", done: "Возвращено из архива" },
  search_tasks: { active: "Ищу задачи", done: "Поиск задач" },
  list_tasks: { active: "Смотрю список задач", done: "Список задач прочитан" },
  list_projects: { active: "Смотрю проекты", done: "Проекты прочитаны" },
  get_task: { active: "Читаю задачу", done: "Задача прочитана" },
  read_tracker_issue: { active: "Читаю трекер", done: "Трекер прочитан" },
  create_tracker_issue: { active: "Создаю тикет", done: "Тикет создан" },
  remember: { active: "Запоминаю", done: "Запомнено" },
};

/** Русская форма существительного по числу: 1 задача, 2 задачи, 5 задач. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const ru = {
  // App
  appName: "WIPSTER",

  // Navigation
  allDoing: "В работе",
  archive: "Архив",
  projects: "ПРОЕКТЫ",
  uploadIcon: "Загрузить свою иконку — или вставить из буфера (⌘V)",
  monoIcon: "Одноцветная иконка — красить в цвет проекта",
  iconTooLarge: "Файл слишком большой — до 4 МБ, для SVG до 64 КБ",
  iconNotAnImage: "Это не картинка, которую Wipster умеет читать",
  addSubProject: "Добавить подпроект",
  subProjectName: "Название подпроекта",
  deleteProjectTitle: (name: string) => `Удалить проект «${name}»?`,
  deleteProjectSubProjects: (n: number) =>
    `Вместе с ним ${plural(n, "удалится", "удалятся", "удалятся")} ${n} ${plural(n, "подпроект", "подпроекта", "подпроектов")}.`,
  deleteProjectTasks: (n: number) =>
    `${n} ${plural(n, "задача уйдёт", "задачи уйдут", "задач уйдут")} в архив — оттуда их можно вернуть.`,
  settings: "Настройки",
  language: "Язык",

  // Project
  projectName: "Название проекта",
  selectProject: "Выберите проект или создайте новый",
  rename: "Переименовать",
  delete: "Удалить",
  none: "Нет",
  icon: "Иконка",
  color: "Цвет",
  appearance: "Оформление",

  // Task statuses
  statusInbox: "Входящие",
  statusQueue: "Очередь",
  statusDoing: "В работе",
  statusDone: "Готово",

  // Priority
  priorityCritical: "Критичный",
  priorityHigh: "Высокий",
  priorityMedium: "Средний",
  priorityLow: "Низкий",

  // Energy
  energy: "Энергия",

  // Estimates
  estimateS: "Малая",
  estimateM: "Средняя",
  estimateL: "Большая",
  timeEstimate: "Оценка времени",
  timeEstimatePlaceholder: "напр. 2ч, 3д",
  promisedTo: "Кому обещано",
  comment: "Комментарий",
  trackerUrl: "Ссылка на трекер",

  // Quick Add
  addTaskPlaceholder: "Добавить задачу... (⌘N)",

  // Task Detail
  noTaskSelected: "Задача не выбрана",
  project: "Проект",
  priority: "Приоритет",
  estimate: "Оценка",
  dueDate: "Срок",
  definitionOfDone: "Критерий готовности",
  nextStep: "Следующий шаг",
  steps: "Шаги",
  firstStep: "Первый шаг",
  addStep: "Добавить шаг...",
  returnContext: "Контекст возврата",

  // WIP / Swap
  wipLimitReached: "Лимит WIP достигнут",
  wipLimitDescription: (inProgress: number) =>
    `У вас уже ${inProgress} ${plural(inProgress, "задача", "задачи", "задач")} в работе. ` +
    "Выберите одну, чтобы вернуть в очередь:",
  keepInQueue: "Оставить в очереди",

  // All Doing
  inProgress: "В работе",
  pause: "Пауза",
  done: "Готово",
  nextPrefix: "Далее:",
  contextSaved: "Контекст сохранён",
  noTasksInProgress: "Нет задач в работе. Начните задачу из проекта.",

  // Archive
  moveToArchive: "В архив",
  restoreFromArchive: "Вернуть",
  archiveEmpty: "Архив пуст. Сюда можно убрать задачи, которые делать не планируете, — но вдруг кто-то вспомнит.",
  archiveHint: "Эти задачи скрыты с доски. Любую можно вернуть обратно в любой момент.",
  archivedOn: "В архиве с",

  // Settings - Appearance
  themeSection: "Тема",
  themeSectionHint: "Выберите настроение для сессии",

  // Settings - AI
  aiConnector: "ИИ-ассистент",
  provider: "Провайдер",
  model: "Модель",
  save: "Сохранить",
  saved: "Сохранено",
  testConnection: "Протестировать",
  testRunning: "Проверяем…",
  testOk: "Связь есть",
  testFailed: "Не получилось",
  testToolOk: (name: string) => `Вызов инструмента ${name} прошёл`,
  testToolMissing: "Модель ответила, но инструмент не вызвала — tool use не работает",
  testKeyMissing: "Сначала укажите API-ключ",
  testProjectsInDb: (n: number) => `проектов в базе: ${n}`,

  // Settings - WIP limit
  wipLimitSetting: "Задач в работе одновременно",
  wipLimitSettingHint: "Жёсткий предел для колонки «В работе». Чем меньше, тем больше доводится до конца.",

  // Settings - Integrations
  integrations: "Интеграции",
  yandexTracker: "Яндекс Трекер",
  trackerToken: "OAuth-токен",
  trackerOrgId: "ID организации",
  trackerHelp: "Ссылки на тикеты в любом поле задачи автоматически обогатят контекст ИИ",

  // Agent
  agent: "Агент",
  agentThinking: "Думаю\u2026",
  aiFillHint: "Дополнить задачу с помощью ИИ — по тикету в трекере и похожим задачам",
  aiFilling: "ИИ заполняет задачу\u2026",
  agentStop: "Остановить",
  agentStopped: "Остановлено.",
  agentElapsed: (seconds: number) => `${seconds} с`,
  agentNoApiKey: "API-ключ не настроен. Перейдите в **Настройки** \u2192 **ИИ-ассистент**.",
  agentInternalError: "Агент упал на середине запроса. Подробности — в логе.",
  /// How the current step is worded; falls back to the raw tool name.
  agentStep: (tool: string, variant: string | null, done: boolean) => {
    const wording = (variant && AGENT_STEPS[`${tool}:${variant}`]) || AGENT_STEPS[tool];
    if (!wording) return tool;
    return done ? wording.done : wording.active;
  },
  apply: "Применить",
  cancel: "Отмена",
  applied: "Применено",
  typeCommand: "Введите команду...",
  unknownCommand:
    'Не понимаю команду. Попробуйте: "close all done", "move all inbox to queue", "set priority p1 on all doing"',
  noDoneTasks: "Нет завершённых задач.",
  deleteCompleted: (n: number) => `Удалить ${n} завершённых задач`,
  deleteTask: (title: string) => `Удалить «${title}»`,
  setPriorityOn: (prio: string, n: number, status: string) =>
    `Установить приоритет ${prio} на ${n} задач (${status})`,
  moveTasks: (n: number, from: string, to: string) =>
    `Переместить ${n} задач из ${from} в ${to}`,
  moveTaskTo: (title: string, to: string) => `«${title}» → ${to}`,
  andMore: (n: number) => `...и ещё ${n}`,
} as const;

export default ru;
