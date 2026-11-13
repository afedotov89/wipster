# Wipster: настройка Яндекс ID

Вход через обычный аккаунт Яндекса, включая аккаунт Яндекс Почты. Wipster получает адрес почты, не письма. Пароль Wipster и настройка Google не нужны.

1. Войдите своим постоянным аккаунтом владельца на [страницу создания приложения для авторизации](https://oauth.yandex.ru/client/new/id/). Выбирайте приложение **для авторизации пользователей**, не только для доступа к API.
2. Название — **Wipster**, иконка и актуальная контактная почта.
3. Платформа — **Веб-сервисы**. Redirect URI, точно без завершающего `/`:
   `https://wipster.fedotovs.net/api/v1/auth/yandex/callback`
4. Доступ к данным — только **Адрес электронной почты** (`login:email`). Не добавляйте имя/пол, портрет, телефон, день рождения, почту или диск.
5. Сохраните приложение. Передайте deployment worker его **Client ID** через существующий безопасный канал настройки сервера. Client secret не обязателен: используется S256 PKCE. Если его всё же настраивают, он остаётся только в server env, никогда в чате, git, frontend или Tauri.

Server env: `YANDEX_ENABLED=true`, `YANDEX_CLIENT_ID=<реальный ID>`, `YANDEX_CLIENT_SECRET=` (можно пустой), `GOOGLE_ENABLED=false`, `OTP_PROVIDER=disabled`, `DEV_OTP_ENABLED=false`. Остальная production конфигурация — в `backend/.env.production.example`; deployment worker отвечает за неё отдельно. Не используйте случайный/примерный ID.

После независимого ревью и точного зелёного combined CI deployment worker согласует закрытое включение. Затем в приложении: Настройки → Аккаунт и синхронизация → «Войти с Яндекс ID», подтвердить адрес почты в системном браузере и вернуться в Wipster. Для существующего аккаунта сначала войдите прежним способом и нажмите «Привязать Яндекс ID»: совпадение email не объединяет аккаунты. Уже работающая сессия продолжает синхронизацию.

Настоящий browser login ещё не проверен. Владелец создаёт приложение и авторизуется лично; тесты с имитацией Яндекса этого не заменяют. Публикация, модерация и оформление сервиса — отдельный этап: [публичное оформление](yandex-public-branding.md).

Технические endpoints: `https://oauth.yandex.ru/authorize`, `https://oauth.yandex.ru/token`, `https://login.yandex.ru/info`. Backend принимает только фиксированный callback; ни localhost redirect, ни отдельная web frontend страница не нужны. Native передаёт секрет попытки только HTTPS backend, не браузеру.

Основано на [официальной регистрации](https://yandex.ru/dev/id/doc/ru/register-auth) и [Authorization Code + PKCE](https://yandex.ru/dev/id/doc/ru/codes/code-url), проверено 2026-11-13.
