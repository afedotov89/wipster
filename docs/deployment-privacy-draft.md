# Privacy content — owner review required, not published

Proposed URL: https://wipster.fedotovs.net/privacy. This file does not establish a live URL or a final policy.

Planned facts from the approved Yandex architecture; implementation acceptance and real-provider verification are still pending:

- Yandex ID sign-in requests only `login:email`; the stable Yandex identity identifies the account. Email is display metadata, never an account matching/linking key. There is no mailbox permission.
- The server exchanges a one-use authorization code with S256 PKCE and checks Yandex userinfo identity/client ID. Provider tokens are discarded, not persisted. The desktop keeps its Wipster session in OS credential storage; the server stores a hash of each device session.
- When sync is enabled, the server stores the account's task entities, change history, conflict/receipt data, and authentication attempt/rate-limit records in PostgreSQL. The desktop also maintains its local workspaces. Existing external task-system integrations remain a separate desktop concern.
- Wipster ingress logs client IP, request method/path (without query string), response status/size/time. Request bodies, authorization headers and OAuth code/state/proof/tokens are excluded: Wipster proxy error logs and Gunicorn access/error/worker console logs are discarded.
- Server backups contain Wipster PostgreSQL data. Backup timer source is prepared but not installed; off-host copies and a final retention schedule are not configured yet.

Owner must supply/approve: operator identity and contact, applicable policy wording, retention/deletion/account-removal process and its actual implementation, backup retention and any off-host destination, public-launch Yandex application/branding details. Do not invent those promises. Publish the approved factual policy as `site/privacy.html` and add an exact nginx `/privacy` route only when approved. The placeholder draft is never mounted as public content.
