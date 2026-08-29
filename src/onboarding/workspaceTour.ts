export type WorkspaceTourActionId =
  "jump-impact" | "play-impact" | "build-report-preview" | "open-site-tools-proof";

export interface WorkspaceTourStepDefinition {
  id: string;
  targetId: string;
  eyebrow: string;
  title: string;
  body: string;
  action?: {
    id: WorkspaceTourActionId;
    label: string;
  };
}

export const WORKSPACE_TOUR_STEPS: readonly WorkspaceTourStepDefinition[] = [
  {
    id: "scene",
    targetId: "scene-editor",
    eyebrow: "Scene",
    title: "Start with the road and vehicles",
    body: "The scene shows the active hypothesis at the current playhead. Jump to the approximate contact to see the reviewed actor pair and exact geometry without changing the case.",
    action: { id: "jump-impact", label: "Jump to approximate contact" },
  },
  {
    id: "timeline",
    targetId: "incident-timeline",
    eyebrow: "Time",
    title: "The playhead drives every pose",
    body: "Play the authored window around contact to see the before, contact hold, and visibly changed downstream movement. Playback never edits the factual record.",
    action: { id: "play-impact", label: "Play authored impact response" },
  },
  {
    id: "inspector",
    targetId: "case-inspector",
    eyebrow: "Inspector",
    title: "Keep provenance and uncertainty separate",
    body: "Use the inspector for observations, evidence, questions, hypotheses, and the report. Build a current preview to see practical output while finalization remains a separate human-only decision.",
    action: { id: "build-report-preview", label: "Build report preview" },
  },
  {
    id: "activity",
    targetId: "case-activity",
    eyebrow: "Activity",
    title: "See who changed what",
    body: "Human, agent, and system actions have distinct identities. Use this record to inspect newer corrections and revert eligible agent work without hiding the original action.",
  },
  {
    id: "site-tools",
    targetId: "site-tools-status",
    eyebrow: "Optional collaboration",
    title: "Site Tools add an agent, not a second case",
    body: "Manual mode keeps every visible workflow available. In a supported client, open the practical proof prompt so the agent can inspect and propose while human-only review boundaries stay enforced.",
    action: { id: "open-site-tools-proof", label: "Open Site Tools proof" },
  },
  {
    id: "case-options",
    targetId: "case-options",
    eyebrow: "Local files",
    title: "Export, switch scenarios, or inspect",
    body: "Case options contains structured JSON transfer, fresh demo copies, fast scenario switching, and advanced Site Tools inspection. Watch the save status before relying on browser storage.",
  },
];
