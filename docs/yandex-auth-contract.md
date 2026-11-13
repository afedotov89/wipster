# Яндекс ID: контракт авторизации

Выбран 2026-11-13. Основной вход — «Войти с Яндекс ID», аккаунт Яндекса, используемый в том числе для Яндекс Почты. Пароля Wipster, SMTP, почтовых кодов и доступа к ящику нет. Google и телефонные адаптеры совместимы с прежними данными, но отключены в production example.

## Протокол и границы доверия

Desktop Rust вызывает `POST /api/v1/auth/yandex/start` (для привязки — `auth/yandex/link/start`). Backend создаёт сохраняемую в PostgreSQL попытку на 5 минут: случайные state, S256 PKCE verifier и отдельный 256-битный proof. В БД хранится только hash proof; verifier нужен только backend. Rust получает proof и открывает исключительно `https://oauth.yandex.ru/authorize` с `response_type=code`, `scope=login:email`, `force_confirm=yes`, state и S256 challenge. Redirect фиксирован: **`https://wipster.fedotovs.net/api/v1/auth/yandex/callback`**, без завершающего `/`. Ни caller, ни native не выбирают callback или provider endpoints.

`GET` callback проверяет единственный state и code/error, атомарно переводит pending → exchanging до сетевого запроса. Backend обменивает code + сохранённый verifier на `https://oauth.yandex.ru/token` и читает JSON `https://login.yandex.ru/info?format=json` с `Authorization: OAuth …`. Проверяются стабильный строковый `id` и точный `client_id`; email — только необязательные отображаемые данные. Только `login:email`, без login:info/avatar/phone, mail/disk и прочих scopes. Токены Яндекса существуют только в памяти обработки callback, не возвращаются native/React и не сохраняются. HTTP redirects отключены, connect/read timeouts и размер ответов ограничены; ошибки не содержат provider bodies/секреты.

Callback сохраняет только проверенные id/email, затем отдаёт статическую страницу без отражения параметров, no-store/no-referrer и CSP. Proof и сессия Wipster никогда не находятся в URL/DOM браузера или React. Rust опрашивает `POST …/status` с attempt_id/proof раз в 2 секунды, затем вызывает `…/finish`. Все операции имеют expiry и PostgreSQL row locks; отмена действует и во время exchange. Callback code используется один раз, crashed exchange требует новой попытки. Finish изменяет состояние один раз; повтор с тем же proof до expiry доставляет **ту же** сессию после потерянного ответа, не создаёт вторую. Токен сессии выводится из секрета сервера, proof и attempt_id; в БД только hash. Cancel после finish отзывает выданную этой попыткой сессию. После expiry повторная доставка запрещена. Привязка привязана к точной живой device session и не выдаёт новую сессию.

Identity namespace `(https://login.yandex.ru, id)` отделён от Google. Account UUID, существующие сессии, миграции, SQLite workspace/import/sync/offline/keyring сохраняются. Совпадающие email никогда не объединяют аккаунты. Привязка доступна только из активного аккаунта; collision — 409 без переноса данных. Порядок блокировок привязки сохраняет исправление Google: account `FOR NO KEY UPDATE` → attempt → identity; logout сериализуется через account. Cancel нормального входа блокирует только его attempt/session, не account.

## Очистка provider credentials

Выбран документированный вариант для **обычных**, не device-bound токенов: немедленно отбросить access/refresh token после userinfo (также при ошибке проверки). `/revoke_token` требует device-bound token и client secret; не вводим обязательный secret/дополнительный device grant ради входа и не отзываем чужие устройства. Удаление из памяти не отзывает согласие в Яндексе: владелец может отозвать его в Яндекс ID «Доступы к данным». Wipster logout отзывает собственную per-device сессию. Долгосрочного хранения и refresh нет.

## Конфигурация и приёмка

`YANDEX_ENABLED=true`, реальный 32-символьный hex `YANDEX_CLIENT_ID`, необязательный server-only `YANDEX_CLIENT_SECRET`; callback — константа кода. PKCE позволяет не передавать secret по официальному протоколу. Production fail-closed без реального ID/провайдера и прочих существующих безопасных настроек. `{yandex:true,google:false,sms:false}` — ожидаемые capabilities. Настройка Google не требуется. Инструкции владельца: [yandex-auth-setup.md](yandex-auth-setup.md); отдельная передача deployment worker: [yandex-deployment-handoff.md](yandex-deployment-handoff.md). В этой задаче нет push/deploy, создания приложения или входа владельца.

Mocked provider/native HTTP проверки не являются реальным Яндекс E2E. До открытия production нужны независимое ревью, реальные настройки Яндекс, зелёный combined CI и отдельный настоящий browser login владельца. Мобильный LoginSDK не входит в этот desktop slice.

Официальные источники, проверены 2026-11-13:
- [Регистрация приложения для авторизации](https://yandex.ru/dev/id/doc/ru/register-auth)
- [Authorization Code и S256 PKCE; secret необязателен с verifier](https://yandex.ru/dev/id/doc/ru/codes/code-url)
- [Userinfo: id, client_id, default_email](https://yandex.ru/dev/id/doc/ru/user-information)
- [Удаление обычного токена и ограничения revoke_token](https://yandex.ru/dev/id/doc/ru/tokens/token-invalidate)
