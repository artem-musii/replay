# Design System

## Overview

REPLAY is used at a desk in neutral daylight, often after a stressful but non-emergency incident. The interface is therefore light, warm, and low-glare, with cool ink panels that support concentration. The landing page may carry more editorial scale, but the workspace stays restrained and task-first.

## Theme

- Register: product, with a concise editorial landing surface.
- Color strategy: restrained warm neutrals with precise semantic accents.
- Physical metaphor: archival paper, technical tracing film, road paint, and a dark-green field notebook.
- Motion: 160–220ms state transitions using ease-out-quart; no decorative entrance choreography.

## Color

Use OKLCH tokens only in CSS.

- Canvas paper: `oklch(0.965 0.009 85)`
- Raised paper: `oklch(0.985 0.006 85)`
- Ink: `oklch(0.245 0.025 210)`
- Muted ink: `oklch(0.49 0.018 215)`
- Rule: `oklch(0.86 0.014 85)`
- Deep field: `oklch(0.27 0.04 185)`
- Human confirmed: teal `oklch(0.55 0.095 180)`
- Uncertainty: amber `oklch(0.72 0.13 80)`
- Conflict: coral `oklch(0.63 0.14 30)`
- Agent: indigo `oklch(0.57 0.105 275)`
- Selection: blue `oklch(0.58 0.13 240)`

No pure black or white. State differences combine color with icons, labels, line styles, or patterns.

## Typography

- UI stack: `Inter`, `SF Pro Text`, `Segoe UI`, system sans-serif.
- Technical metadata and time: `SFMono-Regular`, `ui-monospace`, monospace with tabular numerals.
- Product title: system sans, 750 weight, tight tracking. No display font inside the workspace.
- Body prose max width: 70ch. Metadata never below 12px.

## Layout

- Desktop workspace: 52px header, flexible scene, 344px inspector, 176px timeline, 112px activity rail.
- 1024px: 304px inspector, shorter metadata, collapsible activity.
- Mobile: landing and report review are fully supported; the editor becomes a simplified read/review surface with explicit desktop-edit guidance.
- Use ruled sections and anchored panels rather than nesting cards.

## Components

- Buttons: 10px radius, strong focus ring, primary filled deep field, secondary paper with rule.
- Status chips: compact label plus shape/icon cue; never color alone.
- Panels: one physical surface, divided by rules; avoid card grids.
- Inspector: semantic tabs with an underline/current-state marker.
- Scene objects: crisp accessible SVG with selection halo, lock badge, and branch-specific line pattern.
- Toasts: short, non-blocking, announced in a polite live region.
- Dialogs: reserved for destructive evidence deletion and immutable report finalization.

## Interaction States

All controls implement default, hover, focus-visible, active, disabled, loading, and error states. Dragging updates geometry smoothly without rerendering unrelated panels. Agent mutations leave a brief indigo outline pulse and a durable activity entry.

## Accessibility

Focus uses a 2px high-contrast blue outline with 2px offset. Pointer targets are at least 40px in dense workspace controls and 44px on touch surfaces. Reduced motion removes path draws, pulses, smooth scrolling, and timeline interpolation animation while preserving deterministic state changes.
