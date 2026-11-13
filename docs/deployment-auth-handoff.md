# Deployment ↔ Google worker handoff

2026-11-13. Deployment worker owns `deploy/msf/**`, four retired/replaced Yandex workflows and deployment docs only. Google worker retains backend/settings/auth/frontend/Rust ownership. The lead now authorizes deployment integration to stage/commit/push accepted cloud and corrected Google source only. Owner files, secrets and unrelated work remain excluded.

Target: `https://wipster.fedotovs.net`, Desktop OAuth loopback redirect, not this domain as OAuth callback. Owner's actual Desktop `GOOGLE_CLIENT_ID` is still missing. Optional Desktop `GOOGLE_CLIENT_SECRET` stays server-only; no VITE/native secret.

Production config is `DEBUG=false`, `DEV_OTP_ENABLED=false`, `OTP_PROVIDER=disabled`, `GOOGLE_ENABLED=true`, strong random `SECRET_KEY`, isolated private PostgreSQL, `TRUST_PROXY_TLS=true`, exact allowed host, no CORS origins. Generated credentials are server-only in 0600 files; Google ID is deliberately blank and fail-closed. No mock provider is installed in production.

Ingress replaces client-supplied X-Real-IP, X-Forwarded-For and X-Forwarded-Proto. The API has no host port. A deployment-only read-only WSGI wrapper validates a single X-Real-IP address and sets REMOTE_ADDR, so durable backend quotas receive actual client identity through both proxy hops. Do not change global settings/auth for deployment. If the backend later natively implements this exact trusted-ingress boundary, coordinate removal of the wrapper.

Backend payload admission is 8MiB; nginx allows 8MiB request bodies, streams without temporary body files, allows byte-bounded pull responses and 65s upstream timeout. Gateway logs are disabled; host access log omits query/body/headers. No public DB port.

Capabilities expected by deployment: GET `/api/v1/auth/capabilities` => `{ "google": true, "sms": false }`. Health/readiness must accept the configured Host and forwarded TLS header. A single migration job runs before starting the candidate; entrypoint must not auto-migrate in production. PostgreSQL migrations must remain compatible with the previous application for app-only rollback. Breaking schemas require a separately reviewed maintenance procedure.

Corrected auth code and deployment preparation package `e430974aa7063828a76528f261f655bdb1c9059f4b27c21cfd37bfe7ab816e82` are accepted/reviewed by the lead. Publish accepted source and enable only the replacement workflow for verification CI while repository deploy flag remains false and server rollout gate stays absent. After an immutable CI artifact is ready, the remaining credential dependency is the actual Desktop Client ID. Only after that dependency is resolved may the authorized rollout continue. Real owner Google login remains a separate mandatory acceptance; provider mocks/container smoke cannot establish it. See `docs/deployment-msf.md` and its evidence.

## Confirmed code acceptance; production still closed

Lead acceptance command `596bf3c8-d503-e786-a2b9-278935b9f2ea` is confirmed for corrected Google result `1ec5f42a-c920-4440-a1d0-b0fc5985c982:1abc8966-3069-4340-bd3c-03ed44706d29:9c638241-7497-4ad8-b9b6-acf9e69772f7:vt514j6v8hgx`. Lead independently reran 66 PostgreSQL tests and the manually forced normal-login/explicit-link reproduction: both now succeed with the original session preserved. Prior 122 Rust tests, 81 frontend tests/build and signed native Google fixture evidence is retained. The earlier deadlock finding is corrected and accepted; it is no longer an open code blocker.

Lead also passed all 12 deployment/failure tests, ShellCheck, actual Actionlint, and current corrected-backend arm64 container smoke (migrations, both slots, rollback, failed candidate isolation, backup/full restore). Diagnostic image `sha256:536a19ba53a4c5b531a7cf142a58bc925f77d6c009775ba390380f5d72529f37` includes uncommitted source and must not be promoted. The CI image must come from the concrete accepted main SHA.

Actual Desktop OAuth ID/JSON, real consent/token exchange, packaged owner login and production ingress remain unverified. No test credentials are installed on msf. Readiness/fixture successes are not real provider acceptance. CI runs the full backend test directory, including all PostgreSQL lock regressions, before packaging.
