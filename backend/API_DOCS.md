# Cloud API v1

Authoritative architecture and wire contract: [../docs/cloud-sync-contract.md](../docs/cloud-sync-contract.md).
Local flow, configuration, limits and operations: [README.md](README.md).

All JSON endpoints have no trailing slash. Responses use `Cache-Control: no-store`.
Authenticated endpoints require `Authorization: Bearer <device-session>`; cookie authentication is not enabled.
Google codes/tokens, PKCE verifiers, nonce/proofs, phone codes, email and bearer tokens must never be logged. Google codes/proofs are native/server only; React sees public capability flags and account display metadata.

| Endpoint | Request | Response |
| --- | --- | --- |
| GET `/api/v1/auth/capabilities` | none | `{google:boolean,sms:boolean}` |
| POST `/api/v1/auth/google/start` | `{redirect_uri,code_challenge}` exact desktop loopback + S256 | native-only `{attempt_id,proof,state,authorization_url,expires_in}` |
| POST `/api/v1/auth/google/finish` | `{attempt_id,proof,state,code,code_verifier,device_name?}` | native-only `{token,account_id,phone:null|string,email,name,google_linked,expires_at}` |
| POST `/api/v1/auth/google/cancel` | `{attempt_id,proof}` | `{ok:true}` |
| POST `/api/v1/auth/google/link/start` | same start body + existing bearer | same native-only attempt, bound to this exact device session |
| POST `/api/v1/auth/google/link/finish` | same finish body + same bearer | `{linked:true,email,name,google_linked:true}`, no new session/workspace |
| POST `/api/v1/auth/google/link/cancel` | same cancel body + same bearer | `{ok:true}` |
| POST `/api/v1/auth/start` | `{phone}` canonical E.164 | `{challenge_id,expires_in}` |
| POST `/api/v1/auth/verify` | `{challenge_id,code,device_name?}` | `{token,account_id,phone,email,name,google_linked,expires_at}` |
| POST `/api/v1/auth/logout` | `{}` | `{ok:true}` |
| POST `/api/v1/sync/push` | `{batch_id,operations,require_empty?}` | `{batch_id,changes:[{kind,id,version}]}` |
| GET `/api/v1/sync/pull?cursor=0&limit=200` | account-scoped integer cursor | `{changes:[{kind,id,version,data,sequence}],cursor,has_more}` |
| GET `/healthz` | none | liveness |
| GET `/readyz` | none | readiness (503 on DB/schema failure) |

Operation: `{kind,id,base_version,data}`. Kinds: `project`, `task`, `field`, `value`, `preference`.
`data:null` is a tombstone. Creation uses version 0; every accepted change increments it. Data mirrors raw native SQLite columns, with explicit validation in `apps/sync/validation.py`. Field options, task tags/checklist and custom values are JSON-encoded strings to match native persistence. `value` IDs are `TASK_ID:FIELD_ID`. `preference` permits only `{key:"wip_limit",value:"1".."20"}` with ID `wip_limit`. Task `return_ref` must be null (device-local context). File-list definitions sync; file values do not.

Push atomically applies the entire batch, or commits nothing. Retry the same successful batch ID/body for the same result. Reusing an ID with another body returns 409 `batch_id_reused`. A version conflict returns 409 `{error:"conflict",conflicts:[{kind,id,version}]}`. No automatic overwrite or auto-merge. `require_empty:true` rejects a nonempty account. Validation/WIP returns 422; auth 401; durable quotas 429; provider outage 503. Errors do not reveal account existence or provider internals.

All JSON responses use compact UTF-8 encoding. Pull is bounded by both count and **10 MiB encoded bytes**, under the native 16 MiB ceiling. Cursor advances only through returned entries; `has_more` remains true when byte limits split a page. Push acknowledgements and conflict responses carry metadata only. Existing full-payload receipts are projected on read, not rewritten or pruned.

Clients must freeze the batch before send, preserve unsynced local revisions across acknowledgement, and never advance the applied cursor before persisting the feed. Sequence assignment is serialized by the account transaction, independent of client time and global database allocation order. Tombstones, feeds and receipts have no pruning protocol in v1.

## Google attempt semantics

Google is disabled unless explicitly configured; SMS is independently disabled by default. Disabled methods return 404 `google_disabled`/`sms_disabled`; existing device sessions remain valid. Start accepts only `http://127.0.0.1:<port>/` and a 43-character base64url S256 challenge. The server generates state, nonce and a proof hashed at rest. Exact state, proof, verifier, redirect and five-minute expiry bind the exchange. A PostgreSQL row lock commits consumption before the bounded Google request; replay/concurrent consumption fails with `invalid_google_login`. Provider failure/lost response requires a fresh attempt. Cancellation remains possible during an exchange and is checked again before issuing a session/link. Do not automatically retry a consumed finish body.

The trusted Google RS256 signature, issuer, configured audience, issued-at/expiry, subject and nonce are verified on the server using fixed trusted JWKS and PyJWT. Only issuer+sub resolve an identity. Email/name are display metadata; matching email/phone never links accounts. Two devices obtain independent existing Wipster sessions for the same UUID. Signed-in linking is bound to the exact live session and rejects another account's identity with 409 `google_identity_in_use`; no merge/workspace mutation occurs. Other safe errors: `invalid_google_request`/`invalid_google_login` (400), `google_unavailable` (503), `unauthorized` (401), `rate_limited` (429).

Google starts: 20/IP/hour, 600/global/hour; finishes and cancellations separately 100/IP/hour, 3000/global/hour. Fixed windows count failed attempts. No forwarded IP header is trusted. All providers share the existing per-device logout/sync protocol. See [setup and acceptance boundaries](../docs/google-auth-setup.md).
