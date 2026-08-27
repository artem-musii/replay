# Privacy

REPLAY is local-first and account-free. The core application has no REPLAY-operated backend, analytics service, geolocation lookup, evidence-upload service, or runtime model API. “Local-first” describes REPLAY’s own storage and processing; it does not include an external Site Tools client or model service.

## Data stored in the browser

REPLAY uses IndexedDB on the current origin for:

- structured case state and activity;
- request IDs and semantic-intent fingerprints used to prevent mutation replay; and
- uploaded JPEG, PNG, or WebP evidence blobs.

The deterministic demo’s five generated images are ordinary same-origin application assets. They are synthetic and contain no real incident or personal data. When a case opens, REPLAY asks the browser for persistent storage where that API exists; the browser may deny the request, and clearing site data can still delete the vault.

The public challenge deployment is hosted below the shared `artem-musii.github.io` origin. IndexedDB is isolated by origin, not URL path, so another application on that origin is inside the same browser-storage boundary. Use only synthetic or non-sensitive records on the public demo. A sensitive deployment needs a dedicated origin plus an appropriate browser profile, device, retention policy, and legal review.

## Data leaving the browser

In ordinary manual-browser mode, REPLAY creates data outside IndexedDB only after an explicit human download: structured case JSON, scene SVG/PNG, raw recovery JSON, or report PDF. Structured JSON excludes evidence image bytes.

In Site Tools mode, invoking a tool can return structured case text and metadata—including titles, claims, evidence names/metadata, notes, assumptions, questions, activity, and report text—to the connected browser/client. That client and its model service may process the returned structure under their own privacy terms. REPLAY tools do not return locally uploaded image bytes, but this structured-data egress means agent mode is not a browser-only privacy boundary.

REPLAY itself has no automatic evidence upload, telemetry, advertising, geolocation, or runtime image/model request.

Your browser, operating system, extensions, hosting provider, and any service to which you later upload an exported file have their own privacy behavior and policies outside REPLAY’s control.

## Deletion and retention

- Deleting uploaded evidence first scrubs its active metadata/links and saves that tombstone, then attempts to remove the local blob. If physical blob deletion fails, the bytes may remain in IndexedDB and the UI reports the failure so the person can retry or clear the origin's site data. Redacted historical activity remains; immutable report snapshots or already downloaded files may retain text or references derived before deletion.
- Resetting the deterministic demo replaces that fixture with the current seed-v2 state.
- Opening `/#demo` resumes a valid saved seed-v1 or seed-v2 demo when one exists; it is not itself a reset.
- Browser site-data controls can remove all REPLAY IndexedDB data for the origin.
- Uninstalling or clearing a browser profile may also remove local cases.
- Malformed or unsupported local records are retained for an explicit raw-recovery download rather than silently deleted. That recovery file may contain sensitive, invalid, or untrusted case content.

REPLAY does not provide remote recovery. Its JSON file is a structured case transfer, not a full-fidelity backup: it excludes evidence bytes and contains the source case ID. The visible import flow opens a re-keyed local copy to avoid overwriting that source ID. Importing an unsigned transfer deliberately demotes or clears local trust attestations, reopens answered questions, unreviews notes, removes finalized report snapshots, relabels imported activity as unverified, and tombstones blob-backed evidence because its bytes are absent.

For ordinary human UI mutations, the live case changes before the queued compare-and-swap save; a save failure pauses further mutations and exposes retry or recovery export. WebMCP mutations use an isolated staged case, save it first, and only then commit it live; post-save cancellation/conflict is compensated when possible. A failed compensation is surfaced as `PERSISTENCE_FAILED` because the durable record may need recovery.

## Sensitive information

Browser storage is not application-level encrypted. Do not use this prototype for highly sensitive production records without a dedicated origin and appropriate device, browser-profile, retention, access-control, and legal review. See [SECURITY.md](SECURITY.md) and [docs/security-and-privacy-notes.md](docs/security-and-privacy-notes.md).
