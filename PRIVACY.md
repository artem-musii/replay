# Privacy

REPLAY is local-first and account-free. The core application has no REPLAY-operated backend, analytics service, geolocation lookup, evidence-upload service, or runtime model API. “Local-first” describes REPLAY’s own storage and processing; it does not include an external Site Tools client or model service.

## Data stored in the browser

REPLAY uses IndexedDB on the current origin for:

- structured case state and activity;
- request IDs and semantic-intent fingerprints used to prevent mutation replay; and
- uploaded JPEG, PNG, or WebP evidence blobs.

The packaged generated demo images are ordinary same-origin application assets. They are synthetic and contain no real incident or personal data. When a case opens, REPLAY asks the browser for persistent storage where that API exists; the browser may deny the request, and clearing site data can still delete the vault.

REPLAY does not register a service worker. An already loaded workspace can keep operating through a network interruption, but the web manifest does not guarantee that a cold start or reload works offline.

The public challenge deployment is hosted below the shared `artem-musii.github.io` origin. IndexedDB is isolated by origin, not URL path, so another application on that origin is inside the same browser-storage boundary. Use only synthetic or non-sensitive records on the public demo. A sensitive deployment needs a dedicated origin plus an appropriate browser profile, device, retention policy, and legal review.

## Data leaving the browser

In ordinary manual-browser mode, REPLAY creates data outside IndexedDB only after an explicit human download: structured case JSON, scene SVG/PNG, raw recovery JSON, or report PDF. Structured JSON excludes evidence image bytes.

In Site Tools mode, invoking a tool can return structured case text and metadata—including titles, claims, evidence names/metadata, notes, assumptions, questions, activity, and report text—to the connected browser/client. That client and its model service may process the returned structure under their own privacy terms. REPLAY tools do not return locally uploaded image bytes, but this structured-data egress means agent mode is not a browser-only privacy boundary.

REPLAY itself has no automatic evidence upload, telemetry, advertising, geolocation, or runtime image/model request.

Your browser, operating system, extensions, hosting provider, and any service to which you later upload an exported file have their own privacy behavior and policies outside REPLAY’s control.

## Deletion and retention

- Deleting uploaded evidence first scrubs its active metadata/links and saves that tombstone, then attempts to remove the local blob. If physical blob deletion fails, the bytes may remain in IndexedDB and the UI reports the failure so the person can retry or clear the origin's site data. Redacted historical activity remains; immutable report snapshots or already downloaded files may retain text or references derived before deletion.
- From **Your local cases**, a cancel-first visible human control can delete one complete saved case together with its current- and legacy-vault evidence bytes and pending purge records. Site Tools cannot request or confirm this operation. Export anything needed first; REPLAY cannot retract downloaded files or information already shared outside the browser.
- Starting or resetting the deterministic demo opens a new uniquely identified seed-v6 run without implicitly deleting earlier saved runs.
- Opening `/#demo` also creates a fresh unique run; a saved run resumes only through its case-specific URL in the same browser origin.
- Browser site-data controls can remove all REPLAY IndexedDB data for the origin.
- Uninstalling or clearing a browser profile may also remove local cases.
- Malformed or unsupported local records are retained for an explicit raw-recovery download rather than silently deleted. That recovery file may contain sensitive, invalid, or untrusted case content.

REPLAY does not provide remote recovery. Its JSON file is a structured case transfer, not a full-fidelity backup: it excludes evidence bytes and contains the source case ID. The visible import flow opens a re-keyed local copy to avoid overwriting that source ID. Importing an unsigned transfer deliberately demotes or clears local trust attestations, reopens answered questions, unreviews notes, removes finalized report snapshots, relabels imported activity as unverified, and tombstones blob-backed evidence because its bytes are absent.

For ordinary human UI mutations, the live case changes before the queued compare-and-swap save; a save failure pauses further mutations until a retry succeeds. The paused workspace can download an explicitly incomplete structured transfer, but downloading it neither persists the evidence bytes nor resumes editing. WebMCP mutations use an isolated staged case, save it first, and only then commit it live; post-save cancellation/conflict is compensated when possible. A failed compensation is surfaced as `PERSISTENCE_FAILED` because the durable record may need recovery.

## Sensitive information

Browser storage is not application-level encrypted. Do not use this prototype for highly sensitive production records without a dedicated origin and appropriate device, browser-profile, retention, access-control, and legal review. See [SECURITY.md](SECURITY.md) and [docs/security-and-privacy-notes.md](docs/security-and-privacy-notes.md).
