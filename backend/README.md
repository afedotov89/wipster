# Wipster cloud API

Optional cloud for the existing Tauri desktop app. Implementation contract: [../docs/cloud-sync-contract.md](../docs/cloud-sync-contract.md).

Django 5.2 LTS (supported through April 2028), PostgreSQL 18, Python 3.13. Dependencies select the latest 5.2 patch (`>=5.2.8,<5.3`; validated with 5.2.19). See [Django support policy](https://www.djangoproject.com/download/#supported-versions). Legacy email/social API boilerplate files under `apps/api` and exercise tests remain in the repository for history but are not loaded; there was no working Wipster server data model or client connection to those routes. API v1 exposes primary Yandex ID sign-in, optional legacy Google/phone adapters and synchronization. See [short Yandex setup](../docs/yandex-auth-setup.md) and the [authentication contract](../docs/yandex-auth-contract.md). Yandex uses the fixed HTTPS backend callback, not Google’s dynamic loopback redirect. Do not point an unrelated old boilerplate deployment at this schema without reviewing its database.

Confirmed public API origin: **`https://wipster.fedotovs.net`** (existing server `msf`). New native account forms default to this address; stored origins are preserved. Lead approved Yandex auth source for integration. Production remains closed pending green immutable combined-source CI, lead combined-artifact review and real owner Yandex OAuth configuration. The fixed Yandex callback is **`https://wipster.fedotovs.net/api/v1/auth/yandex/callback`**, without a trailing slash; see the [Yandex deployment handoff](../docs/yandex-deployment-handoff.md). Real provider/browser login and public deployment are not established by fixture tests.

## Local phone simulator: no real SMS, no cost

```sh
# Explicit local phone simulation, no real SMS:
OTP_PROVIDER=development DEV_OTP_ENABLED=true docker compose up --build -d --wait
curl http://127.0.0.1:8080/readyz
```

Run the existing debug Tauri app (`cargo tauri dev` from `src-tauri`, or the project's usual desktop development command). Settings → Account and sync: API origin `http://127.0.0.1:8080`, a valid canonical E.164 number, Send code. Retrieve only that random development code locally:

```sh
docker compose exec api python manage.py dev_otp CHALLENGE_UUID
```

Enter the code within five minutes. The API never returns it, and it is never logged. The development adapter requires **both** `DEBUG=true` and `DEV_OTP_ENABLED=true`; production startup rejects it. Codes are randomly generated per challenge, hashed for comparison and consumed once. Resending invalidates previous challenges under a per-phone database lock. The readable development copy exists only for the local command and is cleared upon success.

On the first device select **Copy tasks and projects…** only when intending to upload the original offline workspace to an empty cloud account. This copies task text and non-file custom values too. Source data stays intact. A second device signs in with the same phone without import. Sign-in/out restart the native app to prevent old editor/AI continuations from entering another account. The first cloud sync runs on app startup, then every 10 seconds while visible, on focus and reconnect. Native release builds require HTTPS; loopback HTTP is debug-only. Browser cloud login is explicitly unavailable.

For a real second computer in a private test environment, use a reachable **HTTPS** origin, a development provider only on an isolated non-public DEBUG server, and retrieve its development code via the server's local command. Do not expose the local DEBUG Compose stack publicly. Use configured Google (no SMS required) or an explicitly configured Verify service for a public environment.

Alternative host Python API with the Compose PostgreSQL database:

```sh
docker compose up -d db
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.lock
export DEBUG=true DEV_OTP_ENABLED=true OTP_PROVIDER=development
export DATABASE_URL=postgresql://wipster:local-development-only@127.0.0.1:54329/wipster
backend/.venv/bin/python backend/manage.py migrate
backend/.venv/bin/python backend/manage.py runserver 127.0.0.1:8080 --noreload
# In another shell with the same environment:
backend/.venv/bin/python backend/manage.py dev_otp CHALLENGE_UUID
```

Compose creates a project-scoped volume, binds PostgreSQL/API to loopback and uses a development-only password. `docker compose down` keeps the volume. Never use `down -v` on data to retain.

## Authentication and abuse controls

- `GET /api/v1/auth/capabilities` advertises only enabled Google/SMS flags. Google start/finish/cancel and signed-in linking are described in [API_DOCS.md](API_DOCS.md); Google pending attempts have durable global/IP quotas, five-minute expiry and single-use consumption before provider exchange. Production has no mock authentication provider.
- `POST /api/v1/auth/start` `{phone}` → `{challenge_id,expires_in}`.
- `POST /api/v1/auth/verify` `{challenge_id,code,device_name}` → `{token,account_id,phone,expires_at}`.
- `POST /api/v1/auth/logout` bearer token → revokes that device only.
- Credentials are random 256-bit tokens, HMAC-hashed at rest, 30-day expiry, checked on every request and again inside account-locked sync transactions. No cookie authentication, no account lookup/enumeration route. The stable account UUID is independent of login method. Google identities use verified issuer+sub, never email. Explicit signed-in linking preserves an existing phone account; matching email never merges accounts. Recovery/phone recycling and identity changes still require a future product policy.
- Native tokens stay in the macOS Keychain / Windows credential store, never React, localStorage or SQLite. Linux has no credential-store adapter in this slice and fails closed instead of persisting plaintext. Those desktop targets need platform packaging tests before release. No browser token-storage implementation is shipped.
- Logout immediately disconnects the local workspace, queues server revocation durably by OS-credential identifier, and retries on the next app startup/poll when online. The credential remains only in the OS store until revocation is acknowledged; metadata contains no bearer token. Remote revocation is delayed while offline, bounded additionally by token expiry. Account workspaces and recovery records stay on disk after logout; this is isolation, not a secure erase feature.
- Durable PostgreSQL row locks protect hourly phone/IP/global quotas and a one-per-minute phone cooldown. Sends: 5/phone/hour, 20/source IP/hour, 600/global/hour; verifies: 30/phone/hour, 100/IP/hour, 3000/global/hour, plus 5 attempts/challenge. Quotas also count failed/provider attempts. Fixed windows can allow boundary bursts. Shared NATs may need reviewed limit adjustments.
- IP comes only from `REMOTE_ADDR`; do not trust arbitrary forwarded headers. Behind an ingress this conservatively applies the IP quota to the proxy. Configure a trusted ingress layer rate limit with verified client IP before broader rollout. Add provider destination/country restrictions and Twilio Fraud Guard/spend limits before activating paid SMS.
- [Twilio Verify adapter](https://www.twilio.com/docs/verify/api/verification-check) uses Verification SID, `(3s connect, 7s read)` timeouts, refuses redirects and exposes only generic errors. Its live send/check has **not** been exercised. Production has no fixed/test code or console delivery.

## Sync contract and recovery

See architecture doc for full endpoint semantics. Bearer authenticated `sync/push` is an atomic bounded batch (`<=5000` entities, request limit 8 MiB, client limit 7 MiB). Optimistic `base_version`, durable batch receipts, immutable per-account sequence feed and deletion tombstones support offline delivery, replay and paging. Compact UTF-8 acknowledgements/conflicts contain only entity identity/version metadata; stored old receipts are projected on read. Pull uses a hard 10 MiB encoded-byte limit as well as a count limit, below the unchanged native 16 MiB ceiling. A page cursor advances only through emitted entries, and the SQLite inbox still applies the final graph atomically after all pages are staged. No device clock determines conflict resolution. Server validates final reference ownership, project cycles, field uniqueness and final WIP. The account row lock serializes writes and logout. An empty-account import guard is checked inside that lock.

The native journal uses SQLite triggers, covering frontend commands, Rust AI, undo, order and cascade operations. Frozen request/revision snapshots survive crashes. An ack clears only the revisions it sent. Incoming pages are staged on disk and applied atomically after downloading; dirty work stops incoming application. Acknowledged echoes do not report applied changes or refresh the UI. Open editors track per-field draft baselines; clean fields refresh, dirty fields are retained, and native compare-and-set rejects stale blur writes before they can overwrite a same-field update. The same protection covers custom text/markdown and checklist text. A stale persisted write stops with a conflict. **Keep mine** explicitly rebases the pending local batch over current conflicting versions; **Use cloud** replaces this account workspace with a fresh feed. Both retain recovery material in `sync_recovery`; recovery currently requires SQLite inspection, no recovery browser is shipped. WIP/schema errors keep local edits and allow correction before retry.

Synced: all task business fields, hierarchy/appearance/order, archive, tags/checklist, custom definitions (including removed/disabled), non-file values and **only** `wip_limit`. `return_ref` is a captured machine context JSON and is deliberately projected as null, retained locally on existing tasks. Context snapshots, chat/tool confirmations, changelog/undo and dependencies are local-only. File-list values and actual attachments are local-only; file paths never become cross-device attachments. Free text is not automatically redacted. Cloud account workspaces start with device integration settings copied locally from the original workspace; those settings are never serialized by sync. Later integration changes are per-workspace, not synced.

Local DB layout under the app data directory: original `wipster.db`, cloud databases named by a SHA-256 of origin/account, `cloud-active.json` (metadata only), `cloud-revocations.json` (credential identifiers only). Every account/origin has its own SQLite database. Do not manually merge them. Back up database/WAL consistently (SQLite backup API or shut down the app before copying). Server entity IDs are account-scoped strings; imports preserve IDs. No remote account data can be imported into a different account through account switching.

## Production release procedure (not performed)

The original authentication follow-up did not execute the Yandex workflows. Deployment integration retires those Wipster operations and supplies the reviewed msf CI/CD path, provider configuration and a single migration release job; see [deployment status](../docs/deployment-msf.md). The local Compose/CI verification does not activate a deployment.

1. Provision PostgreSQL with private access, TLS, a least-privilege application role and separate migration/backup access. Review/pin the selected image and dependency patches through the release process. Configure encrypted backups/PITR and retention for phone numbers, task text and the append-only feed.
2. Supply variables from `.env.production.example` through the deployment secret manager, not source control. Generate a strong `SECRET_KEY`, set exact `ALLOWED_HOSTS`, Google Desktop client ID (and optional server-only Desktop client secret) for Google-only setup; Twilio credentials are required only if SMS is explicitly enabled. Startup rejects SQLite, development OTP, weak/default key, wildcard/test host and missing provider credentials. SECRET_KEY rotation invalidates sessions/challenge hashes and rate bucket keys; plan it as a forced sign-in event.
3. Terminate HTTPS at an ingress that strips spoofed forwarding headers. `TRUST_PROXY_TLS=true` only when it overwrites X-Forwarded-Proto. Configure ingress body limit 8 MiB, timeouts >=60 seconds, safe request metadata logging (never bodies/Authorization/OTP), verified-client-IP and global abuse limits. Native clients require no CORS origins. Do not log phone numbers or provider response bodies.
4. Take a database backup, run `python manage.py migrate --noinput` once as a release job, and `python manage.py check --deploy`. The production entrypoint does **not** race migrations in each worker. Roll out compatible API processes; run `gunicorn project.wsgi:application --bind 0.0.0.0:8080 --workers 2 --timeout 60`. Do not run Django's debug server publicly.
5. Liveness `GET /healthz` does not touch the DB; readiness `GET /readyz` checks the actual account table and returns 503 if unavailable/unmigrated. Exempt probes from ingress HTTPS redirection only over private trusted transport, or send verified X-Forwarded-Proto. Monitor latency/errors, DB connections/locks, feed/receipt size, provider failures, rate rejections and backup recovery health without sensitive payloads.
6. Scale API replicas horizontally against the **same** PostgreSQL database and SECRET_KEY/provider configuration. There is no process-local correctness cache. Bound workers to the database connection budget. One user's writes serialize and validate its materialized graph in memory (O(account entities)); very large/hot accounts and large imports need load testing and a future staged-import/indexed-domain model. Different accounts do not share the sync row lock. OTP global quota rows serialize auth briefly. No multi-region active-active writes or read replicas for cursors/auth.
7. Retain tombstones, immutable feed and idempotency receipts indefinitely in v1; never independently prune them or an offline device could resurrect data/skip changes. A future retention/epoch/reset protocol is required before compaction. Periodically delete expired rate buckets, old consumed/expired Google attempts and old consumed/expired phone challenges through a reviewed maintenance job. Session retention/privacy policy and account deletion/export remain product work.

### Backup and restore rehearsal

Use your secret-managed PostgreSQL connection, never paste its password into logs:

```sh
pg_dump --format=custom --file=wipster-backup.dump "$DATABASE_URL"
# Restore into a NEW isolated database first; do not overwrite the live database.
pg_restore --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" wipster-backup.dump
```

Verify migration state, counts, ownership, a test device pull/retry, phone login with a test provider on the isolated environment, and restore latency before switching traffic. **A rollback to an older snapshot can invalidate cursors and receipts**. Stop writers, preserve the original database and device workspaces, recover WAL/PITR to a consistent point where possible. If data/feed history is lost, force sessions to reauthenticate and use new client workspaces/origin with explicit recovery/import; v1 intentionally does not silently reset an ahead-of-server cursor. Do not blindly replay old outboxes against a rolled-back database.

## Verification

```sh
# With DEBUG/development provider environment, and PostgreSQL DATABASE_URL:
backend/.venv/bin/pytest -q backend/tests_cloud
backend/.venv/bin/python backend/manage.py makemigrations --check --dry-run
backend/.venv/bin/python backend/manage.py check
(cd frontend && npm test && npm run build)
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
# With the host debug API running and same local database/provider environment:
WIPSTER_TEST_API=http://127.0.0.1:8080 cargo test --locked --manifest-path src-tauri/Cargo.toml --lib native_two_clients_http_offline_retry_conflict_delete -- --ignored
```

CI runs PostgreSQL tests (including WIP and OTP races), frontend tests/build, Rust tests on macOS and the native HTTP scenario against an isolated development API. The opt-in native HTTP test starts phone auth via the local provider, then runs two independent native SQLite clients against real HTTP: offline failure/retry, conflict/rebase, propagation, deletion and logout rejection. It authenticates two independent device sessions for the same phone using two single-use development challenges, respecting the 60-second cooldown (the test takes about 70 seconds). Client databases are files reopened before retries, after a lost acknowledgement and with a partially staged feed. It additionally transfers 240 tasks with 24,000,000 UTF-8 comment bytes across four legal batches, including Unicode-heavy text, and verifies that revoking one device leaves the other usable. No real SMS, live production, complete packaged sign-in/restart or physical two-device validation is claimed by automated tests. A separately identified debug `.app` was launched safely through its account form and local development-code request; completing packaged login/restart remains unverified. For isolated debug acceptance, `WIPSTER_DEV_DATA_DIR` can select an absolute test directory; release builds ignore that override. These remain release acceptance work. A temporary macOS Keychain save/read/delete round trip is separately covered by the opt-in `native_credential_store_round_trip` test; it was executed locally without retaining its test entry.
