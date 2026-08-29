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

The current public seed-v5 release at `2855f0bc50da2916128b2278a46f0d0a8a4e2bbd` passed **114 Playwright project runs: 109 passed, 5 intentional mobile screenshot-owner skips, and 0 failed**, including its automated axe, focus/reflow, exact-editor, guide/tour, iframe-guard, and 10 checked visual-baseline regressions. A separate independent 2026-08-29 post-deploy comparison byte-matched the artifact with all 43 cache-busted live files. The Playwright result is automated current-release accessibility evidence; the payload comparison establishes release identity. Neither is a manual assistive-technology or complete WCAG conformance claim.

The superseded seed-v3 release at `00688d8a51fb783dbf147e08ece60470b8877544` completed **108 Playwright runs: 103 passed, 5 intentional skips, and 0 failed**. Its deployed public Lighthouse 13.4.1 audit scored **100 for accessibility**; the complete 100/100/100/100 report has SHA-256 `7c903b69675faa5e70283876434cca6da501a56d8c44d058706c5c90262714e4`. Those results remain historical evidence for `00688d8a` and are not attributed to the current public commit.

The settled current-source candidate completed **230 Playwright project runs: 221 passed, 9 intentional mobile screenshot-owner skips, and 0 failed**, with 20 checked screenshot baselines. The browser split was 114/114 desktop Chromium, 105 passed plus 9 intentional skips in mobile Chrome, and 1/1 release smoke in both Firefox and WebKit. Its desktop/mobile axe sweep covers the landing page, blank-case wizard, base workspace, impact-review state, evidence and hypothesis views, the keyboard-operable labelled annotation target and exact coordinate form, semantic tab interfaces, agent proposal, Site Tools guide and inspector, branch comparison, evidence relationship removal, cancel-first import review, oversized-evidence rejection before browser decode, and both report-confirmation stages with zero serious or critical findings. Automated checks also cover dialog focus trapping, Escape/restoration and background scroll locking, arbitrary finite scene bounds, 320 px and 200%-text reflow, the compact CTA/header-label breakpoints, the complete bounded Site Tools read, and the full submission story. The exact already-built configured-base artifact passed **12/12** focused runs, including handler-contract and submission-story coverage on desktop and mobile. Lighthouse 13.4.1 with Chrome 151 completed three warning-free runs per profile against that exact artifact: the mobile runs scored **89/91/90 performance**, all with **100 accessibility / 100 best practices / 100 SEO**, for median performance **90** and median FCP 2.032 s, LCP 3.308 s, TBT 17 ms, CLS 0.00004, Speed Index 2.032 s, and TTI 3.308 s; every desktop run scored **100/100/100/100**, with median FCP 0.445 s, LCP 0.686 s, TBT 0 ms, CLS 0.0149, Speed Index 0.529 s, and TTI 0.686 s. This is local candidate lab evidence, not deployed evidence, a complete WCAG conformance claim, or a replacement for the manual checks below.

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
