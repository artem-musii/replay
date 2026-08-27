# Dependency and license notes

Inspected from `package.json` and installed package manifests on **2026-08-27**. Versions are exact and locked by `package-lock.json`. This is an engineering inventory, not legal advice; the release owner should retain the lockfile and perform the project’s normal legal/security review before public distribution.

REPLAY’s own source is licensed under the checked-in MIT `LICENSE`. Direct runtime dependencies use permissive MIT, ISC, or Apache-2.0 licenses.

## Runtime dependencies

| Package                                                  | Version | Purpose in REPLAY                                                        | Declared license | Notes                                                          |
| -------------------------------------------------------- | ------: | ------------------------------------------------------------------------ | ---------------- | -------------------------------------------------------------- |
| [React](https://react.dev/)                              |  19.2.8 | Component and client rendering model.                                    | MIT              | Core UI runtime.                                               |
| [react-dom](https://react.dev/)                          |  19.2.8 | Mounts the application into the browser document.                        | MIT              | Core UI runtime.                                               |
| [Dexie](https://dexie.org/)                              |   4.4.5 | IndexedDB case records and separate local evidence blobs.                | Apache-2.0       | Local-first persistence; no server dependency.                 |
| [Zod](https://zod.dev/)                                  |   4.4.3 | Runtime validation for case state, commands, imports, and WebMCP inputs. | MIT              | TypeScript types alone do not validate untrusted runtime data. |
| [jsPDF](https://github.com/parallax/jsPDF)               |   4.2.1 | Explicit local factual-report PDF export.                                | MIT              | Loaded in the export path, not required to inspect a case.     |
| [html-to-image](https://github.com/bubkoo/html-to-image) | 1.11.13 | Converts the same-origin SVG scene surface to PNG for explicit export.   | MIT              | Scene SVG export itself does not depend on rasterization.      |
| [lucide-react](https://lucide.dev/)                      |  1.34.0 | Consistent accessible interface icon components.                         | ISC              | Icons supplement text/labels and are not the only status cue.  |

## Development and verification dependencies

| Package                                                                           |          Version | Purpose                                                | Declared license | Notes                                                                                                                   |
| --------------------------------------------------------------------------------- | ---------------: | ------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [Vite](https://vite.dev/)                                                         |            8.2.2 | Development server and static production build.        | MIT              | Security headers in `vite.config.ts` cover development/preview; production host configuration must set its own.         |
| [`@vitejs/plugin-react`](https://github.com/vitejs/vite-plugin-react)             |            6.1.0 | React transformation and development integration.      | MIT              | Build-only.                                                                                                             |
| [TypeScript](https://www.typescriptlang.org/)                                     |            6.0.3 | Strict static checking and project references.         | Apache-2.0       | Build-only.                                                                                                             |
| [ESLint](https://eslint.org/) and `@eslint/js`                                    |           9.39.5 | Static code-quality checks.                            | MIT              | `eslint-plugin-react-hooks` requires the ESLint 9 line in this lockfile.                                                |
| [typescript-eslint](https://typescript-eslint.io/)                                |           8.68.0 | TypeScript parsing and lint rules.                     | MIT              | Build-only.                                                                                                             |
| `eslint-plugin-react-hooks`                                                       |            7.0.1 | React hook and compiler-oriented rules.                | MIT              | Build-only.                                                                                                             |
| `eslint-plugin-react-refresh`                                                     |           0.4.26 | Guards React refresh-compatible exports.               | MIT              | Development/build-only.                                                                                                 |
| [Prettier](https://prettier.io/)                                                  |            3.9.6 | Deterministic formatting checks.                       | MIT              | Build-only.                                                                                                             |
| [Vitest](https://vitest.dev/)                                                     |           4.1.11 | Unit and component test runner.                        | MIT              | Test-only.                                                                                                              |
| `@vitest/coverage-v8`                                                             |           4.1.11 | Optional V8 coverage report.                           | MIT              | Test-only.                                                                                                              |
| [jsdom](https://github.com/jsdom/jsdom)                                           |           28.0.0 | DOM environment for Vitest component tests.            | MIT              | Test-only.                                                                                                              |
| [Testing Library React](https://github.com/testing-library/react-testing-library) |           16.3.2 | User-observable React component tests.                 | MIT              | Test-only.                                                                                                              |
| `@testing-library/jest-dom`                                                       |            6.9.1 | Accessible DOM assertions.                             | MIT              | Test-only.                                                                                                              |
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB)                     |            6.2.5 | Deterministic IndexedDB test environment.              | Apache-2.0       | Test-only.                                                                                                              |
| [Playwright](https://playwright.dev/) `@playwright/test`                          |           1.62.1 | Desktop/mobile end-to-end browser tests and artifacts. | Apache-2.0       | Sixteen scenarios run in both configured projects; the documented snapshot passed 32/32 in 17.1 seconds.                |
| `@axe-core/playwright`                                                            |           4.13.0 | Automated accessibility checks in browser tests.       | MPL-2.0          | Test-only; MPL applies to the dependency, not REPLAY source. Four principal UI states have serious/critical guardrails. |
| `@types/node`                                                                     |          24.10.1 | Node/tooling type declarations.                        | MIT              | Build-only.                                                                                                             |
| `@types/react`, `@types/react-dom`                                                | 19.2.18 / 19.2.5 | React TypeScript declarations.                         | MIT              | Build-only.                                                                                                             |

## Why the production bundle remains local-first

No runtime dependency provides authentication, analytics, maps, telemetry, a hosted database, or an AI API. The core demo loads the compiled application and five same-origin generated images. Dexie talks only to IndexedDB. Export libraries create local downloads after an explicit action.

The initial planning-only dependencies Zustand, Immer, `webmcp-types`, and `@testing-library/user-event` have been removed from `package.json` and the lockfile. Canonical state is implemented by `ReplayEngine` plus React state, and current WebMCP declarations live in `src/webmcp/types.ts`.

Dependencies still execute with same-origin application authority, so “local-first” is not a substitute for supply-chain review. Keep versions pinned, review lockfile changes, run `npm audit` or the organization’s preferred scanner, and verify production network behavior.

## Cleanup and release checks

1. Confirm every remaining direct package is still imported by production or verification code; remove any package that becomes unused.
2. Run `npm ci` from a clean checkout and review warnings.
3. Run the complete checks in [testing.md](testing.md).
4. Generate an automated third-party notice or software bill of materials if the deployment organization requires one; this file covers direct dependencies only.
5. Review transitive licenses from the exact lockfile. Direct-license compatibility does not automatically audit every transitive artifact.
6. Verify no asset or dependency introduces a third-party trademark, font, music track, or service requirement into the demo.
7. Record the final dependency tree with `npm ls --all` and investigate unexpected duplicates or invalid peer relationships.

Useful commands:

```bash
npm ls --depth=0
npm audit
npm outdated
```

`npm outdated` is informational. Do not upgrade during release solely to make the list empty; evaluate API changes, then rerun the full verification matrix.
