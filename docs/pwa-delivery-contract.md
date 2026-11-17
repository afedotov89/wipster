# Wipster PWA — контракт поставки

Статус: **LOCAL IMPLEMENTATION**, обновлено 2026-11-16. Выпуск ещё не разрешён.

## Новая явная передача ведущего (история WAIT ниже сохранена)

Ведущий сообщил ACCEPT backend и SOURCE HANDOFF в этой же задаче. Основание:
`docs/deployment-evidence/yandex-lead-finished-result-acceptance-20261114.json`.
Начальная точка `c0e286df90c4dad6e766ea28ec46fa8fd94f0a96`, tracked clean,
maintenance ops `5c227d8dad7623d18dc6735f59c5806f5ea44dab52e9522b68d1d5d7a34cf055`.
Актуально: ordinary acceptance `9f86227a-800d-4ff3-20e1-88b15ebf6050` CONFIRMED
14 Nov 02:30; backend task done по переданной ведущим inventory. Backend больше не prerequisite.
История handoff: в тот момент `0df15e8b-50f3-dd2c-7715-d35aae6189fa` был pending;
последующие failed `0df15`/`b855` не являются текущей приёмкой.
SOURCE HANDOFF `c9afdffa` CONFIRMED Started остаётся основанием локальных работ.
Разрешены локальные frontend/browser/backend-web изменения, изолированные проверки,
документация и CI/static/ops предложения. Запрещены SSH/prod probes/provider exchange,
push/dispatch/deploy и изменения msf/runtime/locks/gates/секретов. Не запускать старые
backend runners. Frozen release/evidence сохраняются; обе maintenance service lines
из c0e286 должны войти в будущий integrated source без пропуска. До отдельного review
ведущего ownership сервера и публикации не передан. Финальная цель остаётся live PWA,
сейчас готовим конкретный integrated candidate и доказательства для ведущего.
Цель: устанавливаемое приложение телефона на https://wipster.fedotovs.net/ с Яндекс ID,
данными того же аккаунта и безопасным восстановлением синхронизации после офлайна.

## Передача работ — обязательное условие

Историческое наблюдение до handoff: backend task `e2f2501d-562f-4e10-88d4-5231efe4cd07` ещё активна по
Prism project_status. Локальный receipt сообщает `deployed; acceptance incomplete`.
Прочитанный HEAD: `13c327e96be065614bbaf38b4629697d6d50a7a1`; это наблюдение,
не новое согласование и не утверждение о точной работающей версии сервера.

**wait_for:** lead confirms backend deployment task accepted / applicable explicit
source handoff. **recovery_owner:** lead. Истечение времени не снимает ожидание.
После пробуждения сначала прочитать новое решение ведущего, актуальные task/source/docs,
границы владения и принятую версию. Завершение worker само по себе не заменяет приёмку.
Явная ограниченная передача исходников допускает только перечисленные в ней изменения;
она не подразумевает передачу сервера/ops или разрешение вмешаться в проверку baseline.

До передачи разрешён только этот новый PWA-документ и чтение. Не занимать runtime lock,
не запускать приложение/тестовую инфраструктуру, не менять исходники, git index, сервер,
CI/CD, frozen approvals, evidence, credentials или пользовательские untracked-файлы.
Не запускать дополнительные workers. Ops/msf остаются у deployment worker до передачи.

## Наблюдения по исходникам

- `frontend/src/utils/tauri.ts`: операции проектов, задач, полей и настроек вызывают
  native IPC. Нужен общий доменный интерфейс с native/browser реализациями.
- `stores/cloudStore.ts` и `hooks/useCloudSync.ts`: браузер пропускает sync;
  refresh также напрямую вызывает IPC. Перевести весь основной путь на адаптер.
- `components/layout/AppShell.tsx`: desktop sidebar и панель задачи шириной 380 px;
  необходима мобильная компоновка существующих компонентов.
- `theme/builder.ts`, `themes.ts`: сохранить MUI, темы, семантические CSS-токены,
  системную типографику и идентичность Wipster. Проверить существующие размеры на телефоне.
- `backend/project/urls.py`: действующая v1-граница `csrf_exempt`, auth — Bearer.
  Cookie-auth к ней добавлять нельзя без отдельной полной защиты.
- `apps/accounts/models.py`: Account, ExternalIdentity, DeviceSession и YandexAttempt
  уже существуют. Старый cloud-sync-contract содержит исторический Google-текст;
  текущий Yandex-контракт и новая принятая версия имеют приоритет.
- Готовые W-иконки есть в `src-tauri/icons/`; подготовить web/maskable/Apple варианты
  из существующего бренда без генерации нового логотипа.

## Предлагаемые инварианты реализации

1. **Один продукт.** Использовать существующие React/MUI страницы, редакторы и защиту
   черновиков. Телефон: проекты/иерархия, переключение колонок, все в работе/архив,
   создание/редактирование/перемещение/удаление/архивирование/порядок задач, поля,
   настройки WIP и swap. Native-only интеграции и файловые пути не превращать
   в неработающие действия. Native IPC и OS credential store сохраняются.
2. **Отдельная web-граница.** Предлагаемый namespace `/api/v1/web/` вызывает те же
   доменные auth/sync-сервисы, но использует Secure HttpOnly host-only cookie,
   ограниченную и отзываемую device session, CSRF и проверки Origin/FetchMetadata
   для всех изменяющих cookie-запросов, включая login/cancel/finish/logout.
   Cookie не аутентифицирует старые Bearer endpoints; web boundary не принимает
   account ID от клиента как источник владения. Сессия вращается при входе.
3. **Yandex rendezvous.** Существующее приложение, только `login:email`, code + state
   + S256 PKCE, точный callback `/api/v1/auth/yandex/callback`. Web/native попытки
   различаются сервером, native finish не может забрать web session и наоборот.
   Pending proof живёт в bounded HttpOnly cookie исходного контекста; backend хранит
   hash/attempt. Callback завершает серверную попытку независимо от Safari-cookie.
   Исходная PWA после reload/focus опрашивает/завершает свою попытку, получает cookie
   только там. Отмена, expiry, lost finish response, replay и session fixation
   проверяются отдельно. Не полагаться на opener/postMessage или общие Safari cookies.
   Callback предлагает безопасный возврат без секретов в URL/DOM; нельзя автоматически
   выдавать Safari сессию исходной PWA по одному state. Провайдерские токены — только
   в памяти backend; никакой новой регистрации приложения без технической необходимости.
4. **Долговечные данные.** IndexedDB с разделением по origin/account: entities,
   versions/tombstones, outbox, cursor, staged feed, recovery/conflicts.
   UI подтверждает сохранение после атомарного commit entity + outbox. Замороженный
   batch сохраняет точные bytes/ID и локальные revisions; повтор после потерянного ack
   идемпотентен. Ack не стирает более поздние изменения. Страницы feed сохраняются
   до атомарного применения полного графа и cursor. Не использовать часы для выбора
   победителя и не заменять БД localStorage. Backend остаётся authority WIP/ownership/graph.
5. **Конкурентность и ошибки.** Между вкладками — доказанная сериализация через
   transactional lease/fencing и/или Web Locks с корректным fallback. Не удерживать
   IndexedDB transaction через HTTP. Dirty entities и редакторские drafts не затирать
   incoming feed; удалённая задача сохраняет доступный recovery. Конфликты разрешаются
   явно. Quota/denied/corrupt storage не дают ложного «сохранено»; предусмотреть повтор
   и безопасное извлечение доступной локальной работы.
6. **Жизненный цикл аккаунта.** До выбора аккаунта не рисовать старую workspace.
   Logout/switch сохраняют unsent work в исходном partition, предлагают явное решение
   и не удаляют его молча. Offline logout немедленно закрывает доступ в UI и сохраняет
   обязанность отзыва cookie session при reconnect до возобновления sync; без JS-токена.
   Межвкладочный account epoch блокирует старые async continuations и новую доставку
   под чужой сессией. Retained DB открывается только соответствующему аккаунту;
   политика локальной доступности/удаления явно документируется и тестируется.
7. **Офлайн и обновления.** Manifest с name/id/start_url/scope/display/theme/icons.
   SW кэширует только явно перечисленную версию shell/static, никогда auth/API,
   redirects, callback, health, token/code/proof. SPA fallback только для известных
   app navigation; неизвестные API URL остаются ошибками API. После успешной подготовки
   shell доступен offline reload. Обновление ожидает безопасного момента/действия:
   никакого безусловного skipWaiting или reload с черновиком/очередью. Сохранить старые
   assets для живых клиентов. Запрос persistent storage — best effort, не гарантия.
8. **Активная синхронизация.** Open/focus/foreground/online + backoff/coalescing.
   Background Sync необязателен. Текст для человека: изменения сохранены на устройстве,
   ожидают отправки, конфликт или ошибка/повтор. Не обещать работу закрытой iOS PWA.
9. **Мобильная геометрия.** 320–430 px, tablet/desktop, safe areas, dynamic viewport,
   экранная клавиатура, touch targets, zoom/200% text, focus/back/deep links,
   screen-reader labels/reduced motion. Без сжатой desktop sidebar и page overflow.
   Полные экраны и оси измеряются по geometry reference навыка, не только scrollWidth.

## Проверка и выпуск после передачи

| Gate | Необходимое доказательство |
| --- | --- |
| Browser + API | Chromium mobile и WebKit; реальные CRUD/поля/WIP/иерархия; две независимые browser sessions и native protocol совместимость |
| Offline/recovery | SW reload, edit offline → online → второе устройство; crash/lost ack, staging/pagination/large Unicode, explicit conflict/remote delete, multi-tab, quota failure |
| Auth/security | CSRF/Origin/cookies, expiry/revocation, state/PKCE/replay/cancel, cross-context finish/reload, account isolation/offline logout; отсутствие auth в CacheStorage/logs |
| Mobile/update | Keyboard/back/focus, drafts при incoming sync и update; 320/390/430/tablet/desktop, длинные/пустые/loading/error состояния |
| Визуальная приёмка | Реальные full-page PNG ≤12 MB: login, проекты/board, editor, account/sync/offline/conflict; измерения осей; исходная независимая AI-критика и исправления сохранены |
| Регрессии | Соразмерные frontend/build, PostgreSQL/backend, Rust проверки общих изменений; test provider изолирован и невозможен в prod |
| Поставка | Ведущий принимает конкретный integrated source/build до rollout; immutable same-origin CI/CD, точные digest/source/CI evidence, проверка API/callback/TLS/routes/headers/MIME и безопасности соседних сервисов |

Независимого критика запрашивать только через ведущего после освобождения deployment
слота; максимум два worker на этом Mac. Ops-план согласовать с владельцем deployment:
API/OAuth/health раньше static/fallback, hashed assets immutable, shell/SW/manifest
revalidate/no-cache, совместимый CSP, отдельный rollback frontend где применимо.
Не менять frozen artifacts, не публиковать mutable latest/rsync, не создавать app release/tag.

Все gate сейчас **не выполнены**. В production ничего не опубликовано этой задачей.
Playwright WebKit не является физическим iPhone. Реальный вход владельца с Яндексом
и установка на iPhone — отдельная финальная приёмка только после готового опубликованного
build; не заявлять её по provider mocks. Итог: live URL, результаты и изображения,
точная версия, ограничения и одна действительно необходимая просьба к владельцу.

## Прочитанные официальные источники (2026-11-14)

- [WebKit: Safari 17.2, Web Apps](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/):
  cookies копируются при добавлении на домашний экран; последующее хранилище отдельно.
- [WebKit: Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/):
  актуальное поведение добавления сайтов как web app; инструкции установки привязать к версии.
- [MDN: Using Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers):
  lifecycle/install/waiting/activate; безопасную политику обновления проектируем отдельно.
- [MDN: Storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria):
  best-effort storage и persist не дают безусловной сохранности.
- [Yandex: code + PKCE](https://yandex.ru/dev/id/doc/ru/codes/code-url):
  зарегистрированный redirect, state, verifier/challenge и серверный обмен кода.

Это проектные решения, а не доказательство поведения установленной iOS PWA;
после передачи сверить актуальные браузеры и проверить выбранный navigation flow.

## Recovery 16 ноября 2026

Это продолжение того же local source handoff. Provider доступен в текущем запуске;
новые worker/provider/permissions не использовались. Серверные права остаются у lead.
Ordinary backend acceptance CONFIRMED; старый WAIT не является текущим prerequisite.
Текущие артефакты local review — `docs/pwa-evidence/recovery-20261116/`, архитектура —
`docs/pwa-architecture-review.md`, процедура packaging — `deploy/pwa/package-review.py`.
Прежние результаты считаются историческими; свежие результаты имеют explicit EXIT.
Новая независимая критика/immutable build/rollout/real-owner acceptance ещё обязательны.

## Ordinary checkpoint corrections — 17 ноября 2026

Текущая ordinary app-owned рецензия разрешила scoped LOCAL implementation после
независимой критики. Это supersedes только старое submission-finalization-only
ограничение, не передаёт server/build dispatch/ops/rollout. Исправления и evidence
сохраняются в corrections-20261117; recovery-20261116, original reviews и frozen
feedback неизменяемы. Новый checkpoint завершает локальное исправление и передаёт
материал обычной стадии review этого же task, без self-dependent WAIT. Исходная цель
публикации live/install/login/sync пока не завершена; owner action сейчас не нужен.

## Isolated local image preparation —18Nov2026

Same task ordinary review authorizes a local candidate commit/worktree and pinned
image preflight after scoped retention/deadline fixes. Only this local operation
supersedes the previous image-pull/build prohibition. Main/index, original proof,
owner/foreign files, runtime/ops/gates and remote CI/push/deploy remain protected.
New records are in docs/pwa-evidence/image-preflight-20261118 in the primary project;
source is in the separate worktree named by handoff-and-ownership.json. No self-WAIT
or new reviewer task. Original live/install/login/sync outcome remains incomplete.
