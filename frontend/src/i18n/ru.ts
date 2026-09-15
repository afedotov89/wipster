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
  read_issue: { active: "Читаю тикет", done: "Тикет прочитан" },
  search_issues: { active: "Ищу в трекере", done: "Поиск в трекере" },
  create_issue: { active: "Создаю тикет", done: "Тикет создан" },
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
  settingsGeneral: "Основное",
  settingsCaption: "НАСТРОЙКИ",
  backToProjects: "Проекты",
  settingsAppearance: "Оформление",
  settingsLogs: "Журнал",
  logsClear: "Очистить",
  logsEmpty: "Пока пусто",
  logsCount: (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "запись" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "записи" : "записей"}`,

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
  trackerUrl: "Ссылка на тикет",
  issueUrlPlaceholder: "Трекер или GitLab",

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
  apiKey: "API-ключ",
  baseUrl: "Адрес API",
  baseUrlHint: "Базовый URL OpenAI-совместимого API, например https://api.example.com/v1",
  providerCustom: "Другой (OpenAI-совместимый)",
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

  openLink: "Открыть",
  remove: "Убрать",
  addLink: "Добавить ссылку…",
  addLine: "Добавить строку…",
  dropFilesHint: "или перетащите сюда",
  chooseFiles: "Выбрать файлы",
  showInFolder: "Показать папку",

  taskDetailMode: "Как открывать задачу",
  taskDetailModePanel: "В панели",
  taskDetailModeWide: "На всё окно",
  taskDetailModeHint: "Любую задачу всё равно можно развернуть и свернуть кнопкой ⤢ в её шапке.",
  edit: "Изменить",
  markdownEmpty: "Пусто — нажмите, чтобы написать",
  markdownHint: "Markdown: **жирный**, # заголовок, - список, [ссылка](адрес). ⌘↩ — сохранить",
  markdownPlaceholder: "# Заголовок\n\nТекст с **разметкой**",
  expandTask: "Развернуть на всё окно",
  collapseTask: "Свернуть в панель",
  // Task fields
  taskFields: "Поля задачи",
  taskFieldsHint: "Что показывать в карточке задачи и в каком порядке. Выключенное поле только скрывается — всё, что в нём записано, остаётся.",
  taskFieldsColumnHint: "Когда задача раскрыта на всё окно, она делится на две колонки: широкую — для содержимого, и узкую — для коротких ответов. Значок в строке переносит поле между ними.",
  moveFieldToSide: "Перенести в узкую колонку",
  moveFieldToMain: "Перенести в широкую колонку",
  addField: "Добавить поле",
  fieldName: "Название",
  fieldType: "Тип",
  fieldOptions: "Варианты",
  fieldOptionsHint: "По одному в строке",
  builtinField: "Встроенное",
  removedFields: "Убранные поля",
  removedFieldsHint: "Данные по ним сохранены — верните поле, и всё вернётся с ним.",
  restoreField: "Вернуть",
  removeFieldConfirm: (name: string) => `Убрать поле «${name}»? Данные останутся и вернутся вместе с полем.`,
  fieldKinds: {
    text: "Текст",
    markdown: "Текст с разметкой",
    long_text: "Многострочный текст",
    number: "Число",
    date: "Дата",
    checkbox: "Галочка",
    select: "Выбор из списка",
    url: "Ссылка",
    url_list: "Список ссылок",
    file_list: "Список файлов",
    text_list: "Список строк",
    checklist: "Шаги",
  } as Record<string, string>,

  // Updates
  whatsNew: "Что нового",
  updateAvailable: (v: string) => `Доступно обновление ${v}`,
  updateNow: "Обновить",
  updateDownloading: "Загрузка...",
  updateReady: (v: string) => `Обновление ${v} готово`,
  updateRestart: "Перезапустить",
  updatedTo: (v: string) => `Обновлено до ${v}`,
  about: "О программе",
  version: "Версия",
  releaseHistory: "История версий",
  currentVersion: "Текущая",
  noReleaseNotes: "Для этой версии заметок нет",
  updatePending: (v: string) => `Версия ${v} — доступна для установки`,

  // Settings - Integrations
  integrations: "Интеграции",
  yandexTracker: "Яндекс Трекер",
  trackerToken: "OAuth-токен",
  trackerOrgId: "ID организации",
  gitlabUrl: "Адрес GitLab",
  gitlabToken: "Токен доступа",
  gitlabConnect: "Подключить",
  gitlabRecheck: "Проверить заново",
  gitlabChecking: "Проверяем...",
  gitlabTokenKept: "Оставить прежний",
  gitlabConnected: (who: string) => `Подключено: ${who}`,
  gitlabHelp:
    "Personal access token со скоупом read_api — для чтения и поиска; api — если нужно ещё и заводить задачи. Ссылки на задачи GitLab работают так же, как ссылки на трекер.",
  trackerHelp: "Ссылки на тикеты в любом поле задачи автоматически обогатят контекст ИИ",

  // Agent prompt hints — label on the chip, command sent to the agent
  /// Подсказки «приложением тоже можно управлять» — чип и команда.
  appTipLabel: (tip: string) =>
    ({
      theme: "Поменяй тему",
      language: "Английский интерфейс",
      wip: "Лимит в работе",
      archive: "Открой архив",
      undo: "Отмени последнее",
      history: "Что менялось?",
    })[tip] ?? tip,
  appTipCommand: (tip: string) =>
    ({
      theme: "Покажи, какие есть темы оформления, и включи ту, что поспокойнее",
      language: "Переключи интерфейс на английский",
      wip: "Какой сейчас лимит задач в работе? Скажи, стоит ли его менять",
      archive: "Открой архив и скажи, что там накопилось",
      undo: "Отмени моё последнее изменение",
      history: "Покажи, что менялось за последнее время",
    })[tip] ?? tip,
  hintFindTicket: "Найти тикет",
  hintFindTicketCmd:
    "Найди в трекере тикет под эту задачу по её названию и привяжи ссылку к задаче",
  hintFillTracker: "По трекеру",
  hintFillTrackerCmd: "Заполни пустые поля этой задачи по данным из её тикета в трекере",
  hintBreakDown: "Разбить на шаги",
  hintBreakDownCmd: "Разбей эту задачу на 3–4 коротких шага и запиши их в чек-лист",
  hintEstimate: "Оценить",
  hintEstimateCmd:
    "Оцени эту задачу по времени, опираясь на похожие завершённые задачи, и запиши оценку",
  hintDod: "Критерий готовности",
  hintDodCmd: "Сформулируй одной фразой критерий готовности этой задачи и запиши его",
  hintUnloadWip: "Разгрузить",
  hintUnloadWipCmd: (inProgress: number, limit: number) =>
    `В работе ${inProgress} задач при лимите ${limit}. Посмотри их и предложи, что вернуть в очередь`,
  hintDoingSummary: "Итог по работе",
  hintDoingSummaryCmd:
    "Подведи короткий итог: что у меня сейчас в работе и что мешает это закрыть",
  hintOverdue: "Просроченные",
  hintOverdueCmd:
    "Покажи просроченные задачи этого проекта и предложи, что перенести, а что сделать сегодня",
  hintSeedProject: "Наполнить",
  hintSeedProjectCmd: (project: string) =>
    `Проект «${project}» пустой. Предложи 5 первых задач и создай их`,
  hintFillQueue: "Дозаполнить очередь",
  hintFillQueueCmd:
    "Возьми 5 верхних задач в очереди без оценки или критерия готовности и заполни эти поля",
  hintWhatNext: "Что дальше?",
  hintWhatNextCmd:
    "Посмотри задачи этого проекта и предложи, что взять в работу следующим и почему",
  hintReviewArchive: "Разобрать архив",
  hintReviewArchiveCmd:
    "Посмотри архив и скажи, что стоит вернуть в очередь, а что уже неактуально",

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
  close: "Закрыть",
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
