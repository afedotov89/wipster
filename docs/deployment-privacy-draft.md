# Privacy content — owner review required, not published

Proposed URL: https://wipster.fedotovs.net/privacy. This file does not establish a live URL or a final policy.

Facts to cover, checked against the implemented Google contract and backend:

- Google OpenID Connect sign-in requests `openid email`; Google subject/issuer identify the Wipster account. Email and name are display metadata, not an account matching/linking key.
- The server exchanges a one-use authorization code and checks the ID token. Google access/refresh credentials are discarded. The desktop keeps its Wipster session in OS credential storage; the server stores a hash of each device session.
- When sync is enabled, the server stores the account's task entities, change history, conflict/receipt data, and authentication attempt/rate-limit records in PostgreSQL. The desktop also maintains its local workspaces. Existing external task-system integrations remain a separate desktop concern.
- Wipster ingress logs client IP, request method/path (without query string), response status/size/time. Request bodies, authorization headers and Google codes are not deliberately logged by this deployment.
- Server backups contain Wipster PostgreSQL data. This preparation configures daily local backups; off-host copies and a final retention schedule are not configured yet.

Owner must supply/approve: operator identity and contact, applicable policy wording, retention/deletion/account-removal process and its actual implementation, backup retention and any off-host destination, Google branding and consent-screen details. Do not invent those promises. Publish the approved factual policy as `site/privacy.html` and add an exact nginx `/privacy` route only when approved. The placeholder draft is never mounted as public content.
