# Accessibility report

Status recorded **2026-08-27**. REPLAY targets WCAG 2.2 AA behavior but does not claim complete conformance or certification.

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

## Historical automated evidence

The `f980d28` Playwright suite passed **32/32 project runs**: 16 scenarios in desktop Chromium and 16 in mobile Chrome. Axe checks covered the landing page, blank-case wizard, deterministic workspace, and human-finalization dialog with **zero serious or critical violations**.

Lighthouse 13.4.1 scored both the seeded local production-preview workspace and the public GitHub Pages build **100 for accessibility** for that historical commit. A label-in-name diagnostic found during the first audit was corrected before those recorded runs.

The current candidate adds automated focus trapping, Escape/cancel behavior, focus restoration, 320px reflow, exact scene editors, and iframe-guard regressions. A clean candidate Playwright/axe/Lighthouse run is pending. Automated checks are guardrails, not a substitute for assistive-technology review.

## Manual checks still required

- complete keyboard-only traversal and focus order, plus manual assistive-technology confirmation of the automated dialog trap/Escape/restoration regressions;
- VoiceOver and NVDA announcement review;
- 200% zoom and reflow without content loss;
- reduced-motion and high-contrast/forced-colors review;
- color-contrast review for every interactive state; and
- exported PDF reading order and document accessibility.

Report accessibility defects through a public issue unless they expose a security or privacy vulnerability, in which case follow [SECURITY.md](../SECURITY.md).
