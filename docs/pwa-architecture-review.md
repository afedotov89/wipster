# PWA candidate — архитектура и границы доказательств

Локальная реализация на исходной точке c0e286df90c4dad6e766ea28ec46fa8fd94f0a96.
Это материал для integrated review ведущего, не разрешение на rollout и не live acceptance.
Backend task уже принят ordinary acceptance 9f86227a-800d-4ff3-20e1-88b15ebf6050.

## Приложение и данные

Существующие React/MUI AppShell, проекты, board, редактор, поля и настройки сохранены.
Общий `utils/tauri.invoke` выбирает native IPC либо browser commands. Native credentials
остаются в прежнем OS-store пути. BrowserApp не запускает native bootstrap/effects;
OS paths/context/AI/provider secrets/updater/agent IPC не показываются как доступные.
На телефоне — drawer проектов, переключатель колонок, fullscreen редактор и реальные
кнопки перемещения/порядка/архива. Вложенные проекты и WIP проверяются локально для
немедленного ответа; backend повторно проверяет ownership, graph и WIP как authority.

IndexedDB control DB содержит только account metadata, epoch, blocked/revoke и
короткую координационную lease. Каждому account_id соответствует отдельная DB.
Одна readwrite-транзакция меняет entity/revision и durable dirty journal; UI получает
успех только после transaction complete. Данные продукта и outbox не в localStorage.
Настройки темы/языка UI используют прежнее предпочтение устройства.

Sync берёт transactional fenced lease на workspace. Web Locks не обязательны для
sync. Перед push dirty revisions замораживаются в точных bytes/batch_id; lost ack и
restart повторяют тот же пакет. Новая правка во время отправки не очищается ack старой
revision. Pull использует страницы 200; feed и staged cursor сначала пишутся отдельно,
затем весь граф и рабочий cursor применяются одной транзакцией. Пересечение новой
ленты с локальной работой останавливает автоматическое применение. Явный выбор
сохраняет прежний граф в recovery; tombstone не превращается молча в resurrection.
Черновики редактора хранят baseline отдельно, остаются при incoming edits/deletion.
Экспорт включает entities, staged data, outbox, recovery и drafts; автоматического
импорта recovery-файла этот candidate не добавляет.

Ограничения: один frozen пакет до 5000 операций/7 MiB, ответ до 16 MiB UTF-8; превышение
останавливает sync с сообщением и сохраняет работу для экспорта. Очередь не режется
вслепую через зависимые сущности. Большой feed проверен постранично с Unicode.
Браузерное хранилище best-effort; persist запрашивается, но не гарантируется.
Quota/IDB failures не дают ложного успеха; повтор сохраняет исходный ввод.

## Вход и выход

Отдельные `/api/v1/web/*` принимают только host-only HttpOnly Secure SameSite=Strict
cookies (в DEBUG loopback без Secure). Native Bearer API cookie-blind и дополнительно
принимает только default-native channel. Migration0006 additive: старые sessions
и Yandex attempts получают native channel, данные и native токены не перевыпускаются.
Web session — отдельный device, bounded 30 days, индивидуально отзывается.
Unsafe web endpoints проходят csrf_protect + exact Origin + Fetch Metadata; account
header лишь проверяет совпадение с серверным владельцем session, не задаёт ownership.
CSRF token доступен JSON/in-memory, session/proof/provider token в JS не выдаются.

Существующий Yandex client, callback и login:email не меняются; code+S256/state остаются
в прежнем provider service. Различие native/web — server channel. Start ставит bounded
5-minute pending proof cookie. Callback можно выполнить в другом storage контексте:
он завершает server attempt; исходная PWA после reload/focus/status/finish предъявляет
свой HttpOnly proof и получает session cookie. Нет popup/opener dependency и токенов
в redirect. Повтор finish после потерянного ответа восстанавливает ту же session.
Email — display metadata, identity resolution по issuer+subject, без merge по email.

Координация web auth (исправления 17 ноября): Web Locks использует тот же IDB lease,
что fallback без Web Locks (4 секунды, heartbeat750ms, отдельный owner). Каждая
операция получает возрастающий fence и исходный account epoch. Guard проверяется
после каждого await и непосредственно перед каждым fetch, включая GET session,
POST claim, скрытый CSRF bootstrap/retry, start/status/finish/cancel/logout.
HTTP имеет deadline12s; abort — оптимизация, не откат уже отправленного запроса.

Migration0007 добавляет WebBrowser: hash opaque HttpOnly binding credential,
не секретный public_id, generation, ссылки на текущие attempt/device и expires_at30d.
Перед auth mutation клиент делает CSRF+Origin защищённый claim поколения. Claim и
mutation блокируют одну DB row; устаревшее поколение получает409 без auth effects.
Ограничитель частоты сохраняет reservation ДО mutation transaction; отклонённые
операции тоже учитываются. Native channel сохраняет прежнюю точку reservation.

Cookie names неизменяемы и уникальны: browser-<public UUID>, pending-<attempt UUID>,
session-<hash>. Public browser selector в JS — только адрес binding, не credential;
для выбора нужны совпадающие HttpOnly cookie и серверная identity. Произвольный
account/browser ID не открывает другой account. При нескольких provisioning cookies
без selector сервер возвращает409 вместо произвольного выбора. Bootstrap может
создать только неавторизованный binding. Старый provisioning response не перезапишет
новый binding. Start выбирает server pending pointer; finish требует соответствующий
5-minute HttpOnly proof. Session доступ требует отдельный session credential, сам
binding никогда не аутентифицирует sync. После finish lost ack proof восстанавливает
только тот же device. Старые proof/session Set-Cookie могут прийти после нового
claim, но имеют иное имя и не заменят текущие указатели. Logout/cancel отзывает
lost-finish device и завершает attempt; late credentials уже revoked. Cleanup удаляет
только terminal immutable identities, не будущую cookie. CSRF cookie остаётся
неавторизующим механизмом; запоздавшая rotation восстанавливается bounded retry
под тем же guard. Browser credentials не входят в IndexedDB/JS/export.

Сериализация не обещает отменить серверную операцию, которая успела commit ДО
нового claim: это линейно упорядоченный предшественник. Новая операция видит её
server state и заменяет/отзывает под row lock. Уже отправленная A, пришедшая ПОСЛЕ
claim B, отвергается. При suspend/reload B получает новый fence после expiry lease.
Гонки проверены реальными двумя страницами/IDB, Web Locks отключены; loopback proxy
задерживает actual API request/response, включая применение поздних Set-Cookie.

Logout немедленно ставит local blocked, увеличивает epoch и очищает stores/counters,
сохраняя account partition. Offline revoke journal завершается до нового sync/login.
Старый proof не воскресит выход. Continuations проверяют исходный account epoch.
Вход другого account не показывает предыдущие projects/tasks; исходный account
возвращает только свою pending работу. WebBrowser expiry не продлевает device expiry.

## Shell, обновление и сервер

Manifest scope/id/start_url `/`, standalone; обычные/maskable/Apple icons из Wipster W.
Build создаёт content-derived shell version и точный allowlist. SW кэширует только
этот shell/static, не перехватывает API/auth/health/query/foreign-origin/Authorization.
Только root navigation получает cached index; entity deep links — fragment.
Без skipWaiting и принудительного reload. Waiting update просит закончить работу и
закрыть окна; открытый draft/документ остаётся до обычной смены версии.

Django static boundary обслуживает только root/index, sw/manifest и allowlisted assets;
API/callback/health раньше static, неизвестные URL — 404. Hashed assets immutable,
shell/SW/manifest/icons no-cache; web API no-store, точный MIME, CSP и nosniff.
Dockerfile proposal копирует только явные production directories; fixture provider,
test proxy, .venv/.env/node_modules хоста не попадают в runtime image. Build требует
reviewed digest base-image args. Existing frozen deploy Dockerfile/receipts не меняются.
CI proposal verification-only, без dispatch/push/SSH/secrets/production jobs.
Полный route/header/rollback план — pwa-deployment-review-plan.md.

## Что означают браузерные проверки

Chromium/WebKit используют реальный isolated PostgreSQL + Django production static
boundary. Только внешний provider заменён fail-closed DEBUG fixture; callback вызван
в независимом cookie context. Потери сети/ack и задержки — loopback test proxy, который
сначала обращается к реальному API, затем рвёт/задерживает ответ. Для offline события
тест задаёт navigator.onLine, а весь транспорт устройства реально обрывается на proxy.
Доказывается новый document timeOrigin после offline reload, а не сохранённый экран.
Playwright WebKit context.setOffline дал ошибку до SW и оставлял старый документ;
исторический catch не считается proof и сохранён в critique-before.

200% — CSS root text scale, не physical Safari Dynamic Type. Keyboard — уменьшенный
viewport с focus, не настоящая iOS клавиатура. Safe areas — CSS env integration, не
подтверждение inset на физическом вырезе. Отдельные installed iPhone context behavior,
real-owner OAuth/consent, install UI, real TLS/production routes и фактический immutable
image/CI rollout остаются gates ведущего после независимой критики. Закрытая iOS PWA
не обещает sync; локальные правки отправляются при активном приложении и связи.

## Сверка первичных источников 16 ноября 2026

- WebKit Safari 17.2: https://webkit.org/blog/14787/webkit-features-in-safari-17-2/ —
  initial cookies при установке и отдельное subsequent storage. Поэтому callback и
  завершение исходной PWA связаны server attempt/proof, не общим Safari storage.
- WebKit Safari 26: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ —
  варианты открытия web app зависят от версии; physical install acceptance отдельно.
- MDN skipWaiting: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting —
  немедленная активация опасна для живых drafts; candidate её не вызывает.
- MDN persist: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist —
  запрос persistence может быть отклонён, приложение не обещает абсолютной сохранности.
- Yandex code/PKCE: https://yandex.ru/dev/id/doc/ru/codes/code-url — exact callback,
  state и S256 verifier/challenge без нового client registration.

## Build dependencies

Исторический npm audit (14 ноября, сохранён отдельно) сообщает 14 findings, включая
Vite/Vitest dev-tool advisories. Это не очищенный security audit. Эти dev tools не
входят в Python/static runtime image, dev server не публикуется. Текущий candidate
не расширяет scope до major migration всей native build toolchain; ведущему передан
этот факт для проверки build-chain риска перед immutable production build.
Vite также предупреждает о bundle >500 kB: основной JS около 0.9 MB / 0.29 MB gzip.
Нет claims о performance budget или подтверждённой скорости на физическом телефоне.

## Дополнительные первичные источники 17 ноября

[MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie):
JS не может отфильтровать поздний Set-Cookie — отсюда immutable names + server pointers,
а не только проверка UI после ответа.
[Docker build context](https://docs.docker.com/build/concepts/context/): context включает
доступные build files; Dockerfile-specific ignore имеет приоритет. Поэтому добавлены
root allowlist, identical Dockerfile.dockerignore и отдельный чистый tar context.

Текущая оценка npm/toolchain и pinned inputs — `deploy/pwa/build-chain-review.md`;
исторические 14 findings выше не заменяют новый audit JSON 17 ноября.
