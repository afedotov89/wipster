const ru = {
  // App
  appName: "WIPSTER",

  // Navigation
  allDoing: "В работе",
  projects: "ПРОЕКТЫ",
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

  // Estimates
  estimateS: "Малая",
  estimateM: "Средняя",
  estimateL: "Большая",
  timeEstimate: "Оценка времени",
  timeEstimatePlaceholder: "напр. 2ч, 3д",
  promisedTo: "Кому обещано",
  comment: "Комментарий",

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
  wipLimitDescription:
    "У вас уже 3 задачи в работе. Выберите одну, чтобы вернуть в очередь:",
  keepInQueue: "Оставить в очереди",

  // All Doing
  inProgress: "В работе",
  pause: "Пауза",
  done: "Готово",
  nextPrefix: "Далее:",
  contextSaved: "Контекст сохранён",
  noTasksInProgress: "Нет задач в работе. Начните задачу из проекта.",

  // Settings - AI
  aiConnector: "ИИ-ассистент",
  provider: "Провайдер",
  model: "Модель",
  save: "Сохранить",
  saved: "Сохранено",

  // Settings - Integrations
  integrations: "Интеграции",
  yandexTracker: "Яндекс Трекер",
  trackerToken: "OAuth-токен",
  trackerOrgId: "ID организации",
  trackerHelp: "Ссылки на тикеты в любом поле задачи автоматически обогатят контекст ИИ",

  // Agent
  agent: "Агент",
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
