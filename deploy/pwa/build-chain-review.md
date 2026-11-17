# Build inputs assessment — local proposal, 17 Nov 2026

No image pull/build, GitHub dispatch, push or production access was performed.
`reviewed-inputs.json` records read-only resolutions of Node/Python OCI indexes
(including linux/amd64 child digests) and five Actions commit identities. The
integration patch uses those immutable references; this is a review proposal,
not certification that their entire upstream contents were audited.

Fresh `corrections-20261117/npm-audit-current.json`: 14 vulnerable packages,
2 critical / 7 high / 4 moderate / 1 low. npm exit1 is retained, not relabelled PASS.
Fresh `npm-runtime-audit.json` (`--omit=dev`): zero findings / exit0. These are npm
registry advisory results for the exact lockfile, not an exhaustive security audit.
The runtime image contains Python + static bundle, not npm/node/Vite/Vitest tools.

| Class | Current exposure assessment | Before actual immutable build |
| --- | --- | --- |
| Vitest/mocker/Vite dev-server traversal, mock injection, editor invocation; esbuild CORS | No Vite/Vitest UI/dev server is published or enabled in proposed CI. `vitest run` and `vite build` still execute packages. Source tests/config are executable reviewed code. | Use ephemeral builder, no production credentials, read-only job token. Lead reviews actual advisory scope; do not claim absence of exploitable code based only on no dev server. |
| tinypool prototype-pollution gadgets → worker execution | Requires a pollution/attacker-controlled options path; this assessment has not proved all test dependencies free of such a path. Excluding Node from final runtime does not remove builder risk. | Lead must review this residual risk or approve a focused toolchain upgrade; no blanket `audit fix --force`. |
| Babel/PostCSS/source-map arbitrary reads and resource exhaustion | Untrusted source maps/CSS input could affect compiler. PWA build consumes reviewed local source/lockfile; clean context excludes owner's docs/.env. | No secret mounts in builder; exact context manifest and source provenance checks; dependency review remains necessary. |
| browserslist/baseline mapping/nanoid/form-data/ws | Input-triggered DoS/read/disclosure issues in transitive build/test tools; runtime audit reports none. | Retain current audit evidence; select scoped fixes after review rather than major-upgrading the native build chain blindly. |

Primary sources checked:
- [Tinypool maintainer advisory](https://github.com/tinylibs/tinypool/security/advisories/GHSA-5gmw-xhrv-c9v3)
- [Vitest maintainer advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp)
- Each additional advisory's exact URL/range is preserved in current npm audit JSON.

The unchanged 14 count is a fresh measurement, not reuse of the historical Nov14
report. No dependency upgrade was performed in this scoped correction. Residual
builder advisories are an explicit lead review gate before actual image creation;
the local checkpoint does not silently grant that build or deployment authority.

## Local preflight handoff18Nov

Lead reviewed this residual risk and explicitly permits ONLY isolated local
Linux/amd64 image preparation from the reviewed trusted clean context, using
exact Node/Python/PostgreSQL references already recorded. This supersedes the
previous no-pull/no-image-build rule for that operation, not CI push/dispatch,
production credentials/provider consent, or deployment. Findings remain open;
no dependency changes, clean-audit certification or wider exception is claimed.
