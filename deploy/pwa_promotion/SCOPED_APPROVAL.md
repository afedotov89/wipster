# Run-specific PWA commit-status approval (preparation only)

This change is local preparation, not permission to push, post a status, dispatch,
release or alter any setting. The old shared-window authorization for main46239
remains unused and cannot authorize this changed code. Use the exact NEW reviewed
promotion commit S, its dedicated verification and integration evidence in a later
same-task handoff. Image e16/artifact14541275501, compatibility44922797399/14714472781
and installed069fa5/e071 remain unchanged. No new image/helper/install is needed.

## Authority and execution-time reads

Only `.github/workflows/promote_pwa.yml` uses this path. It stays manual-only,
main-only, in `wipster-production`, under `wipster-msf-production` concurrency.
Both old delivery workflows are unchanged. The shared repository variable stays
false; this workflow neither writes it nor pretends `DEPLOY_ENABLED=true`.
Its false job context is a closed-gate guard, NOT the run approval channel.
No post-dispatch variable update or propagation is needed.

A runner has contents:read/actions:read and, only for the promote job,
statuses:read. It never has statuses:write and never posts a record. The selected
trust boundary is existing account **afedotov89 / numeric creator.id7385763**,
not an assertion that all its other credentials or sessions have been reserved.
Caller input `promotion_source` is checked context, not approval.

For actual run R/attempt1 at S, the ONLY context is:

```
wipster/pwa/v1/<S>/<R>/1
```

Success must be the newest same-context record returned by the runtime GitHub API
on exact S. Context comparison accounts for GitHub's case-insensitivity: a newer
case variant rejects instead of falling back to an older spelling. The status's
`url` must identify this repository AND commit (the API status URL contains SHA,
not status ID). Record creator numeric ID, User type/login, target run URL and
exact description are checked. The description is `wipster-pwa/v1:<sha256>` of
canonical `run_approval.binding(S,R,pin,proofs)`: repository/workflow/source/run/
attempt, original image/build attempts/artifact/ZIP/archive/config/OCI/image-ops,
installed runtime identity, immutable proof hashes and compatibility pins.

Status created_at must be at/after run.created_at and at/before check time;
updated_at must equal created_at. TTL is **600 seconds**, exclusive at the end.
Future, expired, pre-run, malformed or timestamp-tied same-context records fail.
Newest pending/error/failure/wrong-creator success cannot fall back to old success.
Wrong commit/run/attempt is never accepted; attempt2 always rejects. Current exact
main is read before and after the history snapshot. API repository, actual run,
workflow ID427224624/path/state, head repository, event/ref/SHA, input and local
checkout/workflow SHA all must agree. Original CI/compat/package pins are checked
before accepting authority.

Reads are HTTPS GET to api.github.com only, redirects disabled including same-host,
8s per request, 45s per snapshot, 2MiB JSON/duplicate-key bound, 100 records per page,
maximum10 complete pages. The ordered history is checked, page1 resampled to
reject a detectable pagination race. No bearer, raw response error or key is logged.
API errors are terminal, never treated as absence.

Fetch waits at most300 seconds only for genuinely ABSENT approval. A new status
posted during that interval is seen by execution-time reads. Pending, revoked,
malformed or failed reads stop immediately. This wait is internal to the existing
30-minute promote job, not a new Prism cooldown/approval grant. There is no actor
action request until a real future run R exists.

## Ordering and receipts

1. Load exact frozen image/helper/proof pins and validate original GitHub CI/
   compatibility metadata; validate runtime context.
2. Check/wait for run-specific authority. Before success: no archive download,
   no artifact outputs and no deploy-key environment.
3. Download and validate only the original ZIP/archive with the existing checks.
   Fetch receipt records status ID/context/creator/time/expiry/history hash,
   complete input binding and package identity. Only then emit delivery outputs.
4. A separate `check-delivery` step WITHOUT DEPLOY_KEY verifies the fetch receipt,
   archive, original metadata and fresh latest status/current main again. It writes
   exclusive `run-approval-pre-ssh.json`. Any revocation/drift/expiry/error prevents
   the secret-bearing transport step from starting.
5. Transport's offline `transport-ready` check requires the same run/pins/authority,
   remaining TTL and a pre-SSH observation no older than30s, before creating the
   key file. Existing forced receiver/key/host pin/command fields remain exact.
6. The workflow uploads both nonsecret approval receipts even on failure where
   present. verify-only writes `run_approval:null`, no promotion_run and no delivery
   outputs; its receipt cannot be rechecked or transported as approval.

The final read is an observation, not atomic revocation of an already-started SSH
transport. A later pending/failure status does not undo bytes sent, a migration or
a release. TTL and before-SSH checks bound acceptance only. No automatic rollback,
DB restore, marker/root action or queue cancellation is introduced.

## Inert activation/reconciliation recipe for a future exact review

Do NOT execute any POST below in this preparation. Do not reuse the old shared-
flag driver or old dispatch nonce. No real R or approval ID is asserted here.

1. Lead accepts exact new commit S/diff/tests, later dedicated CI and main
   integration; S must match main, workflow SHA, checkout and promotion_source.
   New approval does not relabel image e16 or original attempt1 package. Refresh
   artifact expiry/availability and independent compatibility provenance.
2. Fresh normal local process/ownership/headroom + canonical checked NONBLOCK
   admission and strict pinned SSH read-only server operation-lock probe. Check
   exact installed069fa5/e071 maps/config, protected marker metadata ONLY,
   healthy old full blue/current/image/record/root, inactive maintenance, current
   eligible recovery copy + exact independent restore proof, disk and retained
   rollback/stock. No extra backup/restore/install merely to prepare this path.
   Release server FD BEFORE receiver, which locks itself. Preserve all Stop and
   real machine/provider limits.
3. Read actual main/workflow/CI/environment/flagfalse, paginated incomplete runs,
   current actor ID and status read/write metadata. Account identity+repo/push and
   existing visible OAuth repo scope support capability inference; no test POST,
   new token/scope or permissions change. GITHUB_TOKEN stays read-only. Record
   future capability errors factually, never infer absent approval from flagfalse.
4. Before the sole dispatch, O_EXCL/fsync(file)+fsync(directory) a new local intent
   with task/S/actor/time/nonce/exact pins/input/body/baseline/run watermark. Body:

   ```json
   {"ref":"main","inputs":{"promotion_source":"<S>"}}
   ```

   Endpoint: `POST /repos/afedotov89/wipster/actions/workflows/promote_pwa.yml/dispatches`.
   Record response and independently identify exactly one R/attempt1 by returned
   ID if any plus metadata: workflow427224624/event/manual/main/headS/actor/time/
   watermark. Never guess the latest run, rerun, or repeat an ambiguous POST.
   Common flag remains false throughout, no broad writer window to open/close.
5. When the actual promote approval-wait step is observed, Lead (using the existing
   trusted7385763 identity) reviews that run and the pinned inputs. Generate the
   inert status body locally from the reviewed source; this does NOT authorize it:

   ```python
   # In a clean exact-S checkout; R comes from actual observed run metadata.
   import json, promote, run_approval
   pin, proofs = promote.load_approval()
   body = {"state": "success", "context": run_approval.context(S, R),
           "description": run_approval.description(run_approval.binding(S, R, pin, proofs)),
           "target_url": f"https://github.com/afedotov89/wipster/actions/runs/{R}"}
   print(json.dumps(body))  # public input only; no API call
   ```

   Separate exclusive fsynced approval intent binds S/R/attempt1, actor7385763,
   exact body/digest, actual run, current-main and UTC window. Only a later concrete
   approval scope permits `POST /repos/afedotov89/wipster/statuses/<S>` with that body.
   Runner cannot perform this write. Record201 response/status ID, creator and API
   timestamps, then independent paginated list readback and expires_at=created+600s.
6. Ambiguous status POST: read exact S/history/context/actor/body/time against the
   original intent. Never repeat merely because response/report was lost. Zero
   matching records is unknown until reconciled; multiple candidates/tied stamps
   reject. A guessed ID, combined status or caller input never releases anything.
   If approval has expired or job skipped/failed, stop for exact new disposition;
   attempt2 cannot inherit it. Any later revocation is a NEW record in the SAME
   context; newest state rules, and recovery must not claim reversal after SSH.
7. Report exact R/attempt/status link and approval ID/expiry plus fetch/pre-SSH
   receipts. If still active, release the worker slot with actual run dependency;
   do not wait for its own report. After actual delivery, use the established full
   record/current/image/slot and full public ready ID equality (not source regexp)
   plus static hash/header readback and flagfalse. The workflow's existing public
   probe is supplementary, not substitute for record.promotion_run==R.

Release retains the normal just-before-migrate backup under receiver lock. The
previous verified dump is separate, with empty-row/grant limitations intact. App
rollback target remains full old blue basename
`20261113T215948Z-6e275c26c1f9bcd2722445641a3c7982a8c56ef6-1804140`, image
`sha256:339cc373a642ba4ee8025deff37f53226113668bac3f465483d93bb1b1109fdf`;
fresh slot/record/image/health guards, self-locking rollback, no DB/default reversal
or outbox deletion. Original root hash
`d7d959efd363602ea07022989131af90152e3cd8b7ff75307e6355aec8147623` remains unchanged
until independently authorized root work; inverse root hash guard/saved original
bytes are separate. Real iPhone installation/Yandex/shared native/offline acceptance
remains later same-task work.

References (primary):
- https://docs.github.com/en/rest/commits/statuses#list-commit-statuses-for-a-reference
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions
