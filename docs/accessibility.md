# Accessibility report

Status updated **2026-08-29**. REPLAY targets WCAG 2.2 AA behavior but does not claim complete conformance or certification.

## Implemented support

- semantic landmarks, headings, labels, status regions, dialogs, lists, buttons, and form controls;
- a skip link and visible keyboard focus;
- keyboard-operable vehicles, timeline events, and path keyframes with accessible names;
- synchronized text output for timeline time and playback state;
- status conveyed with text and icons in addition to color;
- responsive desktop/mobile layouts and enlarged coarse-pointer targets;
- reduced-motion handling for nonessential animation;
- alt text for meaningful images and decorative treatment for redundant thumbnails; and
- explicit human-review labels and confirmation controls for consequential actions.

## Automated evidence

The `f980d28` Playwright suite passed **32/32 project runs**: 16 scenarios in desktop Chromium and 16 in mobile Chrome. Axe checks covered the landing page, blank-case wizard, deterministic workspace, and human-finalization dialog with **zero serious or critical violations**.

Lighthouse 13.4.1 scored both the seeded local production-preview workspace and the public GitHub Pages build **100 for accessibility** for that historical commit. A label-in-name diagnostic found during the first audit was corrected before those recorded runs.

The current public seed-v6 release at `b2e93905ff349a29f21b0b544a59e3afc738671d` passed **230 Playwright project runs: 221 passed, 9 intentional mobile screenshot-owner skips, and 0 failed**, including its automated axe, focus/reflow, exact-editor, guide/tour, iframe-guard, and 20 checked visual-baseline regressions. GitHub Actions run `33272807674` then deployed the exact configured-base artifact, and its post-deploy verifier byte-matched all **46 public payload files / 5,297,260 bytes** with manifest SHA-256 `586c81a32c8b0d15deed08ecd99ebd069697a2158aa0ca047d87cdd0f0e6bb87`. The Playwright result is automated current-release accessibility evidence; the payload verification establishes release identity. Neither is a manual assistive-technology or complete WCAG conformance claim.

The superseded seed-v3 release at `00688d8a51fb783dbf147e08ece60470b8877544` completed **108 Playwright runs: 103 passed, 5 intentional skips, and 0 failed**. Its deployed public Lighthouse 13.4.1 audit scored **100 for accessibility**; the complete 100/100/100/100 report has SHA-256 `7c903b69675faa5e70283876434cca6da501a56d8c44d058706c5c90262714e4`. Those results remain historical evidence for `00688d8a` and are not attributed to the current public commit.

The current release's browser split was 114/114 desktop Chromium, 105 passed plus 9 intentional skips in mobile Chrome, and 1/1 release smoke in both Firefox and WebKit. Its desktop/mobile axe sweep covers the landing page, blank-case wizard, base workspace, impact-review state, evidence and hypothesis views, the keyboard-operable labelled annotation target and exact coordinate form, semantic tab interfaces, agent proposal, Site Tools guide and inspector, branch comparison, evidence relationship removal, cancel-first import review, oversized-evidence rejection before browser decode, and both report-confirmation stages with zero serious or critical findings. Automated checks also cover dialog focus trapping, Escape/restoration and background scroll locking, arbitrary finite scene bounds, 320 px and 200%-text reflow, the compact CTA/header-label breakpoints, the complete bounded Site Tools read, and the full submission story. The exact deployed configured-base artifact passed **12/12** focused runs, including handler-contract and submission-story coverage on desktop and mobile. Lighthouse 13.4.1/Chrome 151 results—mobile performance **89/91/90** with accessibility/best-practices/SEO **100/100/100**, and desktop **100/100/100/100**—belong to the preceding `cd88755b` payload. They remain historical local lab evidence rather than a current-payload or live-site audit, a complete WCAG conformance claim, or a replacement for the manual checks below.

These automated checks are guardrails, not a substitute for assistive-technology review. The historical `f980d28` results above remain preserved rather than being substituted for current manual evidence.

## Manual checks still required

- complete keyboard-only traversal and focus order, plus manual assistive-technology confirmation of the automated dialog trap/Escape/restoration regressions;
- VoiceOver and NVDA announcement review;
- shipping Safari/iOS and real-device pointer, touch, file-picker, and zoom behavior;
- 200% zoom and reflow without content loss;
- reduced-motion and high-contrast/forced-colors review;
- color-contrast review for every interactive state; and
- exported PDF reading order and document accessibility.

Report accessibility defects through a public issue unless they expose a security or privacy vulnerability, in which case follow [SECURITY.md](../SECURITY.md).
