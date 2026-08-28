# Accessibility report

Status updated **2026-08-28**. REPLAY targets WCAG 2.2 AA behavior but does not claim complete conformance or certification.

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

The current `00688d8a51fb783dbf147e08ece60470b8877544` release adds automated focus trapping, Escape/cancel behavior, focus restoration, 320px and 200%-text reflow, exact trajectory/rotation editors, reachable mobile guide and tour controls, and iframe-guard regressions. Its clean Playwright gate completed **108 runs: 103 passed, 5 intentional mobile screenshot-owner skips, and 0 failed**, including the axe states and 10 checked screenshot baselines. The deployed public Lighthouse 13.4.1 audit scored **100 for accessibility**; the complete 100/100/100/100 report has SHA-256 `7c903b69675faa5e70283876434cca6da501a56d8c44d058706c5c90262714e4`.

These automated checks are guardrails, not a substitute for assistive-technology review. The historical `f980d28` results above remain preserved rather than being substituted for current manual evidence.

## Manual checks still required

- complete keyboard-only traversal and focus order, plus manual assistive-technology confirmation of the automated dialog trap/Escape/restoration regressions;
- VoiceOver and NVDA announcement review;
- 200% zoom and reflow without content loss;
- reduced-motion and high-contrast/forced-colors review;
- color-contrast review for every interactive state; and
- exported PDF reading order and document accessibility.

Report accessibility defects through a public issue unless they expose a security or privacy vulnerability, in which case follow [SECURITY.md](../SECURITY.md).
