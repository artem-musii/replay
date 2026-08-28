export const GUIDE_SECTION_IDS = [
  "quick-start",
  "scene",
  "timeline",
  "evidence",
  "hypotheses",
  "site-tools",
  "report",
] as const;

export type GuideSectionId = (typeof GUIDE_SECTION_IDS)[number];

export interface GuideTopic {
  title: string;
  body: string;
}

export interface GuideSection {
  id: GuideSectionId;
  label: string;
  kicker: string;
  title: string;
  summary: string;
  topics: readonly GuideTopic[];
  note?: string;
}

export const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    id: "quick-start",
    label: "Quick start",
    kicker: "Start with the shared model",
    title: "See one account from several useful angles",
    summary:
      "REPLAY keeps scene geometry, time, provenance, uncertainty, and activity synchronized. You can work entirely through visible controls, with or without Site Tools.",
    topics: [
      {
        title: "Choose a moment",
        body: "Move the timeline playhead to review the vehicle poses and events at that time. Play the interval when you want to see the reconstruction unfold.",
      },
      {
        title: "Select what you want to inspect",
        body: "Select a vehicle, path, event, observation, evidence item, question, or hypothesis to reveal its exact controls and recorded context.",
      },
      {
        title: "Keep certainty visible",
        body: "Reported, likely, uncertain, disputed, unknown, and agent hypothesis are separate classifications. Confirmed always requires an explicit human review.",
      },
      {
        title: "Review the record",
        body: "Activity distinguishes human, agent, and system actions. Undo and redo cover current human work, while eligible agent actions can be reverted from activity.",
      },
      {
        title: "Stay local by default",
        body: "The save indicator confirms browser storage. Manual mode sends no case data to an agent. Use exports when you need a portable record.",
      },
    ],
    note: "The deterministic demo is safe to explore. Changes stay in your browser, and Case options can reset the demo.",
  },
  {
    id: "scene",
    label: "Scene and paths",
    kicker: "Spatial reconstruction",
    title: "Place vehicles and shape timed paths",
    summary:
      "The scene is a structured reconstruction, not a collision simulator. Every position and heading remains inspectable and editable.",
    topics: [
      {
        title: "Move and rotate a vehicle",
        body: "Set the playhead first, then select a vehicle. Drag to move it, use the rotation control or exact pose fields for heading, and use arrow keys for small position changes. Moving a vehicle updates a point within 0.15 seconds of the playhead or creates a new point at that time. Locked vehicles and paths must be unlocked before editing.",
      },
      {
        title: "Build a path from timed points",
        body: "A path point is the vehicle pose at a specific time. Select a path to edit its points, add a point at the playhead, or remove an unnecessary point. The timeline controls point time while the scene controls point position.",
      },
      {
        title: "Understand the movement model",
        body: "Two timed points produce a straight path. Three or more use a time-aware smooth curve through the recorded poses, while headings turn through the shortest angle. REPLAY derives review metrics from those inputs; it does not model driver control, collision forces, or fault.",
      },
      {
        title: "Use lane snap deliberately",
        body: "When you drag a position near a drawn roundabout lane, Lane snap places it on that lane’s centerline. Keyboard nudges and exact fields stay precise. Lane snap does not rotate the vehicle or curve the rest of the path.",
      },
      {
        title: "Record impact, damage, and locks",
        body: "Mark an approximate impact at the playhead, record neutral damage descriptions on a selected vehicle, and lock reviewed geometry that should not be overwritten.",
      },
    ],
    note: "Scene coordinates use a 0 to 100 workspace. Exact numeric controls remain available when dragging is inconvenient.",
  },
  {
    id: "timeline",
    label: "Timeline",
    kicker: "Temporal reconstruction",
    title: "Connect every pose and event to time",
    summary:
      "The playhead is the shared clock for the scene, paths, and incident events. Moving it never changes the factual record by itself.",
    topics: [
      {
        title: "Scrub or play",
        body: "Drag the timeline position, use the transport controls, or press Space while the timeline is focused. Playback speed changes viewing speed, not recorded timing.",
      },
      {
        title: "Read path points",
        body: "Each path lane contains timed point markers. Select one to move the playhead to that pose. Drag it horizontally to change time, or use Left and Right arrows for precise adjustments.",
      },
      {
        title: "Add an event at the playhead",
        body: "Use the plus control to add an observation, maneuver, evidence moment, start, or stop. Give it a neutral title, certainty classification, and linked vehicle scope.",
      },
      {
        title: "Edit an event",
        body: "Select an event to change its exact time, location when present, or certainty. Shift plus an arrow moves an editable timeline marker by one second.",
      },
      {
        title: "Read uncertainty as data",
        body: "An event such as exact lane positions not being established is a recorded limitation linked to claims. It is not an automatic result of the movement model.",
      },
    ],
  },
  {
    id: "evidence",
    label: "Facts and evidence",
    kicker: "Provenance and uncertainty",
    title: "Record what is known without flattening its source",
    summary:
      "Observations, evidence, and unanswered questions have different jobs. REPLAY keeps those differences visible in the report.",
    topics: [
      {
        title: "Classify an observation",
        body: "Record the statement, its source, and its current classification. Reported means someone stated it. Uncertain means a detail is recorded but not adequately established. Unknown means it is not known.",
      },
      {
        title: "Confirm only after review",
        body: "Confirmed means a person explicitly reviewed the observation in REPLAY. It does not mean independently verified, legally proven, or forensically established.",
      },
      {
        title: "Keep evidence local and inspectable",
        body: "Upload JPEG, PNG, or WebP images to the local evidence tray. Add neutral notes, mark point or rectangle annotations, and link the asset or annotation to the relevant case item.",
      },
      {
        title: "Use questions for missing information",
        body: "Create ranked open questions instead of silently filling gaps. An answer can remain a question response or also create a separate reported observation.",
      },
      {
        title: "Delete and export with care",
        body: "Evidence deletion requires human confirmation. Structured JSON does not include evidence image bytes, so keep source files separately when transferring a case.",
      },
    ],
  },
  {
    id: "hypotheses",
    label: "Hypotheses",
    kicker: "Competing explanations",
    title: "Preserve alternatives without choosing a winner",
    summary:
      "A hypothesis branch changes only the uncertain reconstruction. Shared observations keep their identity across branches.",
    topics: [
      {
        title: "Fork a reconstruction",
        body: "Create a branch when more than one movement remains plausible. Name the specific difference and keep the description neutral.",
      },
      {
        title: "State assumptions explicitly",
        body: "Add the premise that makes a branch different. Link supporting or conflicting evidence instead of treating the premise as a fact.",
      },
      {
        title: "Edit the active branch",
        body: "Activate a branch before changing its path or events. Shared confirmed observations remain shared while branch geometry and assumptions can diverge.",
      },
      {
        title: "Compare, archive, and restore",
        body: "Overlay two branches to inspect path, question, evidence, and consistency differences. Comparison never labels a branch true or at fault. Archive alternatives you no longer need and restore them later.",
      },
    ],
  },
  {
    id: "site-tools",
    label: "Site Tools",
    kicker: "Optional agent collaboration",
    title: "Work manually or invite an agent into the same case",
    summary:
      "WebMCP is the browser bridge behind Site Tools, not a chat box inside REPLAY. A supported client can expose narrow, validated case actions to its agent while the visible workspace remains the source of review.",
    topics: [
      {
        title: "Manual mode is a complete workflow",
        body: "Use the scene, timeline, observations, evidence, questions, hypotheses, report, and exports yourself. REPLAY does not send structured case data to an agent in manual mode.",
      },
      {
        title: "Connect through the client conversation",
        body: "Open REPLAY inside a Site Tools-compatible ChatGPT, Codex, or other client and keep the case open. The header says how many tools are registered when the connection is available. Ask in that client’s conversation, not on the REPLAY page. In an ordinary browser the header says Manual mode.",
      },
      {
        title: "Review visible agent work",
        body: "Agent mutations are attributed in activity. Coordinated scene changes arrive as proposals and do not alter current geometry until a person reviews and accepts them.",
      },
      {
        title: "Know the human boundary",
        body: "An agent cannot confirm an observation, accept or reject a proposal, delete evidence, or finalize a report. Those actions require visible human controls.",
      },
      {
        title: "Understand the data boundary",
        body: "A called tool can return compact structured fields to the connected client and model service. REPLAY tools never return uploaded evidence image bytes. Stale writes are rejected instead of overwriting newer work.",
      },
    ],
  },
  {
    id: "report",
    label: "Report and files",
    kicker: "Neutral output",
    title: "Validate, review, and export an evidence-bound account",
    summary:
      "The report is derived from the structured case. Confirmed information, uncertainty, hypotheses, citations, and limitations remain visibly separate.",
    topics: [
      {
        title: "Run consistency checks",
        body: "Deterministic checks find missing links, timing problems, implausible continuity, and geometry mismatches. They are informational and never determine truth, physics, fault, or liability.",
      },
      {
        title: "Build a fresh preview",
        body: "The preview uses the current case version. Confirmed observations appear separately from reported or uncertain material, and unresolved questions remain visible.",
      },
      {
        title: "Add cited review notes",
        body: "A report note must cite at least one observation or evidence item. Agent drafts remain visibly unreviewed until a person approves or rejects them.",
      },
      {
        title: "Finalize through human review",
        body: "Review unresolved questions, method limits, and every confirmed observation before creating an immutable snapshot. An agent may prepare the review screen but cannot complete it.",
      },
      {
        title: "Choose the right export",
        body: "PDF exports the report, SVG or PNG exports the scene, and JSON transfers structured case data without evidence bytes. Importing an unsigned JSON file clears local trust attestations for fresh review.",
      },
    ],
    note: "Saved locally confirms browser persistence for the current case version. Browser storage is best effort, so keep an export when the record matters.",
  },
];

export interface SiteToolPrompt {
  id: string;
  title: string;
  prompt: string;
}

export const SITE_TOOL_PROMPTS: readonly SiteToolPrompt[] = [
  {
    id: "inspect",
    title: "Inspect the case",
    prompt:
      "Inspect this case and separate what is confirmed, reported, unknown, and inconsistent.",
  },
  {
    id: "propose",
    title: "Propose coordinated paths",
    prompt:
      "Propose coordinated paths for both vehicles from the current information, but do not apply them or decide fault.",
  },
  {
    id: "alternatives",
    title: "Preserve two possibilities",
    prompt:
      "Review recent activity, revalidate the case, and preserve two hypotheses for the unresolved lane movement.",
  },
  {
    id: "report",
    title: "Prepare a neutral report",
    prompt:
      "Prepare a neutral report using only confirmed information and keep every unresolved detail visible.",
  },
];

export function guideSectionById(id: GuideSectionId): GuideSection {
  const section = GUIDE_SECTIONS.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`Missing REPLAY guide section: ${id}`);
  return section;
}
