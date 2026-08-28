export interface WorkspaceTourStepDefinition {
  id: string;
  targetId: string;
  eyebrow: string;
  title: string;
  body: string;
}

export const WORKSPACE_TOUR_STEPS: readonly WorkspaceTourStepDefinition[] = [
  {
    id: "scene",
    targetId: "scene-editor",
    eyebrow: "Scene",
    title: "Start with the road and vehicles",
    body: "The scene shows the active hypothesis at the current playhead. Select an object to reveal exact controls. This tour only points things out and never changes the case.",
  },
  {
    id: "timeline",
    targetId: "incident-timeline",
    eyebrow: "Time",
    title: "The playhead drives every pose",
    body: "Scrub or play the interval to see paths and events together. Path markers are timed poses. Moving the playhead alone does not edit the factual record.",
  },
  {
    id: "inspector",
    targetId: "case-inspector",
    eyebrow: "Inspector",
    title: "Keep provenance and uncertainty separate",
    body: "Use the inspector for observations, evidence, questions, hypotheses, and the report. Selecting an item reveals its source, status, links, and exact editing controls.",
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
    body: "Manual mode keeps every visible workflow available. In a supported client, the agent can use narrow structured actions while human-only review boundaries remain enforced.",
  },
  {
    id: "case-options",
    targetId: "case-options",
    eyebrow: "Local files",
    title: "Export, import, reset, or inspect",
    body: "Case options contains structured JSON transfer, deterministic demo reset, and advanced Site Tools inspection. Watch the save status before relying on browser storage.",
  },
];
