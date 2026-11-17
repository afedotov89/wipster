# PWA — план integrated review и поставки (ничего не опубликовано)

SOURCE HANDOFF разрешает локальный candidate; сервером/rollout владеет ведущий.
Frozen baseline и исходный backup/restore/maintenance результат не переписываются.
Backend принят: ordinary acceptance `9f86227a-800d-4ff3-20e1-88b15ebf6050`
CONFIRMED 14 Nov 02:30; task done по переданной ведущим inventory. Исторические
pending/failed accept commands сохранены в контракте как история, не текущий gate.

## Конкретная предлагаемая интеграция

- Новый build entrypoint `deploy/pwa/Dockerfile` собирает React тем же lockfile,
  кладёт versioned dist в неизменяемый backend image и задаёт `PWA_ROOT=/app/pwa`.
  Это предложение для нового проверенного artifact; старый backend Dockerfile и
  approved_artifact/records не менялись. До реальной сборки ведущий передаёт обязательные `NODE_IMAGE`/`PYTHON_IMAGE`
  с digest, как в существующем release процессе. Копируются только явные production
  directories; host .env/.venv, tests и test proxy в runtime image отсутствуют. Mutable production latest нет.
- Django `project/pwa.py` обслуживает только root/index и точный allowlist assets из
  build manifest. Никакой произвольной навигации или fallback для API. `project/urls.py`
  сохраняет API/callback/health раньше static. Unknown API/static routes — 404.
- Внешний HTTPS ingress сейчас перехватывает `/` и отдаёт factual landing. Единственная
  предлагаемая правка — заменить этот exact location на существующий proxy upstream.
  Полный location в `deploy/pwa/wipster-root-location.conf.proposal`; существующий
  catchall proxy для API/static, trusted headers, TLS, logs без query, quotas и соседи
  сохраняются. ACME и unpublished privacy policy остаются отдельно; политику не сочиняем.
- Никакой новой сети, сервиса, публичного порта, БД, secret или provider registration.
  Существующие compose image slot/proxy_wsgi/gateway остаются путём API и static.
  Нужна новая согласованная ops source/hash, а не подмена frozen approvals. Обе строки
  из maintenance commit c0e286 остаются в integrated истории и service files.

## Headers, cache и MIME

`/`, `/index.html`, `/sw.js`, `/manifest.webmanifest`, `/icons/*`: `Cache-Control: no-cache`.
`/assets/<content-hash>.*`: год immutable. API/web-auth/native-auth/callback: no-store.
Service worker scope `/`, content type `text/javascript`, `Service-Worker-Allowed: /`.
Manifest `application/manifest+json`; CSS/JS/PNG имеют точные MIME, nosniff везде.
CSP shell: script-src self, style-src self unsafe-inline (Emotion/MUI), img-src self
+ data/blob, connect/worker/manifest self, object/base/frame запрещены, form self.
Никакой inline JS в index. Callback сохраняет свой строгий CSP/no-referrer и не отражает
state/code/proof/session. CSP не добавляет provider script/token в страницу.

SW precache содержит только перечисленные shell/static файлы. Query-bearing запросы,
redirect/API/callback/health не перехватываются. Только `/` navigation получает shell.
Обновление ждёт закрытия всех клиентов; не вызывает skipWaiting/reload. Старые cache
versions пока сохраняются для живых окон/отката; будущая bounded GC требует отдельной
проверки, чтобы не удалить нужные открытым клиентам chunks.

## CI и immutable promotion

Новый `.github/workflows/pwa-ci.yml` — verification-only PR/reusable workflow, без SSH,
secrets, deploy job или dispatch. Chromium и WebKit работают с реальным PostgreSQL/API
и production static build; заменён только внешний провайдер, fixture fail-closed при
production. Artifact связывает точный source/run/attempt и hashes всех dist files.
Workflow ещё не запущен в GitHub — source handoff запрещает push/dispatch.

Перед публикацией ведущий должен review exact source/diff/tests/screenshots и получить
независимую AI-критику. Затем отдельный reviewed patch к существующему backend build:

1. Добавить pwa-ci как обязательный reusable job; собрать новый Dockerfile из repo-root
   context и сохранить прежние org.opencontainers.image.revision/amd64/archive checks.
2. Расширить build smoke на static root/SW/manifest/API/callback и migration0006/0007;
   проверить safe no-store cache и no auth leakage в exact построенном image.
3. Выпустить **новый** immutable artifact/receipt с backend+frontend build/source,
   source ops hash и проверенным archive/config identity; старые receipts неизменны.
4. Ведущий принимает concrete artifact и exact ops diff, после чего сам координирует
   gates/normal nonblocking lock/maintenance. Эта задача не меняет их самостоятельно.
5. Migration0006 добавляет default-native channel в DeviceSession/YandexAttempt;
   migration0007 добавляет отдельный WebBrowser binding/generation.
   существующие UUID/session/data сохраняются. Ready проверяет новые колонки.
6. Через существующий artifact-only promotion загрузить новый image, проверить новый
   slot до маршрутизации. Root ingress менять только в рамках согласованного атомарного
   плана; до switch он продолжает landing. No manual rsync/build on production.
7. После switch проверить CA/hostname TLS, exact release/source, root, immutable assets,
   MIME/SW scope/manifest/icons, API unknown404, authenticated401/CSRF403, callback
   no-store/no-query-logs и соседние safety baselines. Provider exchange не делать без
   согласованной реальной приёмки владельца.

## Откат

Самый простой первый rollout — один integrated image с backend/static. Откат на реальную
сохранённую здоровую release identity через прежний promotion механизм, без rebuild/tag.
При откате на исходный backend вернуть ровно прежний root location/landing; additive migrations0006/0007
можно оставить (additive default-native, downgrade кода не требует удаления данных).
Уже открытые PWA и cache хранят локальную очередь; после backend rollback показать ошибку
недоступности web API и сохранить unsent работу, не пытаться подменить native auth.
Не отзывать native sessions и не удалять IndexedDB при rollback. Отдельный frontend-only
rollback возможен позже на сохранённый проверенный image той же web API/schema; пока
выбран согласованный integrated rollback, чтобы не расширять текущий server scope.

После concrete rollout финальная проверка владельца: реальный Яндекс login/consent и
добавление на экран Домой iPhone, правка offline → reconnect → тот же аккаунт на desktop.
Playwright WebKit и fixture не заменяют этот шаг. До rollout owner action не требуется.

## Точный локальный пакет review

`deploy/pwa/package-review.py` сохраняет полный tracked source плюс явный allowlist
новых PWA files, включая untracked icons/adapters/web boundary/tests/proposals.
`source-manifest.json` фиксирует каждый файл SHA256/mode/size и общий fingerprint;
`integrated-source.tar.gz` — snapshot без git metadata и owner/foreign untracked.
`integrated.diff` относится к HEAD c0e286, **не** к реально работающему release.
`maintenance-base.diff` отдельно сохраняет ровно две ещё не pushed service lines
между local tracking origin/main13c327 и c0e286. Полный snapshot уже содержит их.
При будущей интеграции не применять один PWA diff на старый серверный source: ведущий
переносит обе baseline maintenance lines вместе с reviewed PWA source. Никакого push
или изменения existing frozen ops approvals packaging не выполняет.

## Конкретные исправления integration proposal 17 ноября

`deploy/pwa/backend-workflow-integration.patch` готов к рассмотрению, **не применён**
к действующему backend workflow. Добавляет обязательный reusable pwa-ci в needs
verify-build и deploy, exact commit identities Actions и digest-pinned base inputs
из `reviewed-inputs.json`. Теги разрешены read-only17Nov, образы не pull/build.
Изменение существующих deployment gates/receipts этим patch не разрешено.

Root `.dockerignore` и `deploy/pwa/Dockerfile.dockerignore` — одинаковый deny-default
allowlist. `context.py` дополнительно создаёт tar только из явных config/source/assets
paths/extensions, без symlinks, владельческих docs, .env/.venv/node_modules/test provider.
`test-context.py` проверяет восемь forbidden sentinels и собирает frontend из извлечённых
allowlisted bytes существующими локальными tools; hashes должны совпасть с current dist.
Это доказательство completeness/isolation source context, не Docker image smoke.

Предложенный CI скачивает manifest exact mandatory PWA artifact source/run/attempt.
Build repo-root Dockerfile получает **чистый tar**, сохраняет revision label; image smoke
проверяет label, additive migrations/readiness, отсутствие fixtures, exact root/SW/manifest,
CSP/cache/MIME/API/callback404/400 precedence и все static hashes против обязательного
PWA CI build. Smoke deadline180s относится к одной команде. Изолированные containers
имеют internal network, synthetic credentials, CPU/memory bounds, без host mounts/ports;
cleanup знает только уникальные собственные names. Image smoke в этом run **не выполнялся**.
Прежние isolated slot/backup/restore/archive проверки сохранены в предлагаемой цепочке.

Browser scenario suites разделены на core/checklist и contrast с reset исключительно
синтетической fixture DB между ними: реальный production rate limit20starts/hour/IP
не отключён. Auth-races проходят отдельно с тем же real API и reset fixture перед suite.
Native HTTP scenario не запускается одновременно на той же fixture DB: он потребляет
тот же лимит и должен иметь отдельный isolated reset. Отказы/прежние logs сохранены.

Свежие материалы checkpoint: `docs/pwa-evidence/corrections-20261117/`. Независимая
критика16Nov уже завершена; новый checkpoint передаётся обычной app-managed рецензии,
не создаёт self-WAIT на получение собственного отчёта. Полный live outcome остаётся
открытым до approved build/rollout и real-owner installed iPhone/Yandex acceptance.

## Local image preflight18Nov — separate checkout, not canonical CI

Ordinary review closed the previously inspected auth/UI/ordered-PG findings.
Two bounded corrections remain in this preparation stage: expiry-only WebBrowser
cleanup in existing cleanup_yandex_attempts (200 per transaction, max20 batches),
and a real monotonic smoke deadline plus independent all-resource cleanup attempts.
No installed timer/lock/service/ops changes. Native/session/account parents remain.

Lead explicitly handed off local-only public digest-pinned pulls and one isolated
Linux/amd64 candidate image build. New source lives in a worktree branch fromc0e286;
main source/index and sealed evidence stay unchanged. Candidate commit, context
SHA256 and expected static bytes are in image-preflight-20261118 receipts. The local
commit is neither pushed/published nor a canonical GitHub artifact identity.
Frontend/auth inputs unchanged from9e39 allow exact reuse of reviewed tests/static
bytes; backend cleanup and smoke logic have fresh affected regressions.

Build uses the classic Docker builder with explicit1.5GiB/2CPU RUN limits, no
unknown shared buildx container, no host-home/socket/credential mounts. Only the
three permitted public digest references can be pulled. Runtime smoke uses internal
network, named own migration/API/DB containers, fixed CPU/memory limits and no host
ports. One verification deadline covers all subprocess/retry/wait operations;
cleanup independently tries own api/db/network sequentially, even after errors.

Exact pinned nginx from existing msf images.env is NOT cached. Its pull was not
authorized by this handoff. Therefore unchanged deploy/msf/smoke.sh cannot be run
without expanding allowed input scope, and is retained as a mandatory canonical
CI backup/restore/slot/promotion gate. Do not substitute another cached nginx tag.
The existing cleanup maintenance unit tests run in the permitted Python base on
Linux because macOS lacks flock; no installed source or global tools are changed.

Next canonical CI/ops handoff: approve the exact resulting source tree (including
bothc0e286 maintenance lines), apply the separate mandatory-PWA workflow patch,
run canonical hosted CI, build/archive/provenance+image smoke AND the existing
msf backup/restore/rollback smoke with its exact pinned gateway input. Then review
new immutable artifact ID/archive/source/ops hash and precise ingress root change,
without rewriting old receipts, flags or gates. Lead controls promotion/lock/TLS/
neighbor baselines and final real-owner install/login acceptance. No owner action now.
