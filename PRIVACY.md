# Privacy

REPLAY is local-first and account-free. The core application does not send case content, evidence, interaction analytics, location, or model prompts to an application server.

## Data stored in the browser

REPLAY uses IndexedDB on the current origin for:

- structured case state and activity;
- request IDs used for mutation idempotency; and
- uploaded JPEG, PNG, or WebP evidence blobs.

The deterministic demo’s five generated images are ordinary same-origin application assets. They are synthetic and contain no real incident or personal data.

## Data leaving the browser

The application creates a download only after an explicit human action: case JSON, scene SVG/PNG, or report PDF. JSON export does not include evidence blobs. REPLAY has no automatic evidence upload, telemetry, advertising, geolocation, or runtime image/model request.

Your browser, operating system, extensions, hosting provider, and any service to which you later upload an exported file have their own privacy behavior and policies outside REPLAY’s control.

## Deletion and retention

- Deleting uploaded evidence removes its active metadata, links, and local blob; historical activity remains for attribution.
- Resetting the deterministic demo replaces that fixture with its original state.
- Browser site-data controls can remove all REPLAY IndexedDB data for the origin.
- Uninstalling or clearing a browser profile may also remove local cases.

REPLAY does not provide remote recovery. Export anything you need before clearing site data, while remembering that the current JSON backup excludes image bytes.

## Sensitive information

Browser storage is not application-level encrypted. Do not use this prototype for highly sensitive production records without an appropriate device, browser-profile, retention, access-control, and legal review. See [SECURITY.md](SECURITY.md) and [docs/security-and-privacy-notes.md](docs/security-and-privacy-notes.md).
