# Security policy

## Supported version

REPLAY is a challenge prototype. Security fixes target the latest `main` branch and current public deployment; older snapshots are not maintained as separate supported release lines.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/artem-musii/replay/security/advisories/new). Do not disclose an exploitable issue, private incident record, or proof-of-concept containing personal data in a public issue.

Include the affected URL or commit, reproduction steps, impact, browser, and any suggested mitigation. Maintainers will acknowledge reports when available, validate scope, and coordinate disclosure after a fix. This prototype does not promise a formal response SLA.

## Security boundaries

- The core application has no account, backend, analytics, runtime model API, or evidence-upload service.
- Case JSON and uploaded evidence are stored in this browser’s IndexedDB. In manual mode, only an explicit download writes case data outside that vault. In Site Tools mode, a called tool returns selected structured case text and metadata to the connected client/model service; tools never return uploaded image bytes.
- Runtime Zod schemas validate persisted, imported, UI, and WebMCP inputs.
- Agent mutations use fixed tools, current case versions, request IDs bound to validated semantic-intent fingerprints, locks, and the same domain authorization rules as the UI.
- The domain rejects agent/WebMCP-origin attempts to confirm claims, adjust/accept/reject coordinated scene proposals, delete evidence, or finalize reports. `propose_scene_changes` records a preview in the proposal ledger; scene geometry changes only after an explicit human UI acceptance whose full baseline/lock validation succeeds. OpenAI's built-in browser may separately interact with ordinary page controls, but that is not a Site Tool call and must not be treated as authorization to operate REPLAY's human confirmation/finalization controls.
- Evidence text, filenames, notes, imported statements, and hypothesis text are untrusted case data and are never executed as instructions.
- Production configuration supplies restrictive CSP, referrer, framing, content-type, origin, and `Permissions-Policy: tools=(self)` headers where the host supports custom response headers.
- The application refuses to render its workspace or register tools while framed. This runtime check is defense in depth, not a substitute for response-level `frame-ancestors`/`X-Frame-Options` policy.

## Known limitations

Browser storage is not application-level encrypted. Anyone with access to the browser profile or device may be able to inspect it. The public GitHub Pages demo shares the `artem-musii.github.io` storage origin with other projects and is suitable only for synthetic or non-sensitive data; sensitive use requires a dedicated origin.

Ordinary human-UI commands commit to the live engine before their queued compare-and-swap IndexedDB save. A failed save can leave memory newer than storage; REPLAY pauses further mutations until a retry succeeds. The user can download an incomplete structured transfer while paused, but it excludes evidence bytes and does not resume editing. WebMCP mutations instead reduce on an isolated engine copy, compare-and-swap save that staged case, then adopt it into the live engine and notify the UI. A rejected primary save leaves live state untouched; cancellation or a live-version conflict after a resolved save triggers a compensating save, and failed compensation returns/audits `PERSISTENCE_FAILED`. Neither path is one physical cross-layer transaction, Web Locks are best effort, and browser paint is not transactionally coupled to a tool result.

Structured JSON export excludes evidence blobs, contains the source case ID, and is not a complete backup. The UI re-keys an imported copy before local save; unsigned import intentionally removes or demotes human trust attestations and immutable report snapshots. Invalid local records are retained for explicit raw recovery, which may itself contain sensitive/untrusted data. Session-only Site Tools invocation audit is visible but is not durable canonical case activity. The project is not a forensic system or a production repository for highly sensitive records.

The complete threat model and residual risks are documented in [docs/security-and-privacy-notes.md](docs/security-and-privacy-notes.md).
