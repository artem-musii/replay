# Security policy

## Supported version

REPLAY is a challenge prototype. Security fixes target the latest `main` branch and current public deployment; older snapshots are not maintained as separate supported release lines.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/artem-musii/replay-sol/security/advisories/new). Do not disclose an exploitable issue, private incident record, or proof-of-concept containing personal data in a public issue.

Include the affected URL or commit, reproduction steps, impact, browser, and any suggested mitigation. Maintainers will acknowledge reports when available, validate scope, and coordinate disclosure after a fix. This prototype does not promise a formal response SLA.

## Security boundaries

- The core application has no account, backend, analytics, runtime model API, or evidence-upload service.
- Case JSON and uploaded evidence are stored in this browser’s IndexedDB. Explicit export is the only application feature that writes them outside browser storage.
- Runtime Zod schemas validate persisted, imported, UI, and WebMCP inputs.
- Agent mutations use fixed tools, current case versions, request IDs, locks, and the same domain authorization rules as the UI.
- Agent-origin actions cannot confirm claims or finalize reports.
- Evidence text, filenames, notes, imported statements, and hypothesis text are untrusted case data and are never executed as instructions.
- Production configuration supplies restrictive CSP, referrer, framing, content-type, origin, and `Permissions-Policy: tools=(self)` headers where the host supports custom response headers.

## Known limitations

Browser storage is not application-level encrypted. Anyone with access to the browser profile or device may be able to inspect it. In-memory domain commit and IndexedDB persistence are sequential rather than one rollback-capable cross-layer transaction. JSON backup excludes evidence blobs. The project is not a forensic system or a production repository for highly sensitive records.

The complete threat model and residual risks are documented in [docs/security-and-privacy-notes.md](docs/security-and-privacy-notes.md).
