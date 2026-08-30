import { expect, test, type Page } from "@playwright/test";

import { installModelContextPolyfill, openDemoSimple, waitForLocalSave } from "./helpers";

interface SiteToolResult {
  ok: boolean;
  caseVersion: number;
  data?: unknown;
}

interface WorkspaceTrajectory {
  id: string;
  actorId: string;
  branchId: string;
  keyframes: Array<{ id: string; timeMs: number; x: number; y: number }>;
}

async function invokeSiteTool(
  page: Page,
  name: string,
  input: Readonly<Record<string, unknown>>,
): Promise<SiteToolResult> {
  const serialized = await page.evaluate(
    async ({ toolName, payload }) => {
      const modelContext = (
        document as Document & {
          modelContext?: {
            getTools(): Promise<Array<{ name: string }>>;
            executeTool(
              tool: { name: string },
              input: Readonly<Record<string, unknown>>,
            ): Promise<string>;
          };
        }
      ).modelContext;
      if (!modelContext) throw new Error("Site Tools polyfill is unavailable.");
      const tool = (await modelContext.getTools()).find((candidate) => candidate.name === toolName);
      if (!tool) throw new Error(`${toolName} is not registered.`);
      return modelContext.executeTool(tool, payload);
    },
    { toolName: name, payload: input },
  );
  return JSON.parse(serialized) as SiteToolResult;
}

test("defaults to Simple, preserves Expert, and completes the guided human flow", async ({
  page,
}) => {
  test.slow();
  await installModelContextPolyfill(page);
  await openDemoSimple(page);

  await expect(page.getByRole("button", { name: "Simple", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Review the open question" })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Which vehicle, if either, crossed the lane boundary before contact?",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask agent to review" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Case workspaces" })).toHaveCount(0);
  await expect(page.locator(".workspace-activity")).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "Timeline position" })).toBeVisible();

  const workspace = await invokeSiteTool(page, "get_workspace_state", {
    sections: ["scene", "questions"],
  });
  expect(workspace).toMatchObject({ ok: true, caseVersion: 1 });
  const trajectories = (workspace.data as { scene: { trajectories: WorkspaceTrajectory[] } }).scene
    .trajectories;
  const vehicleA = trajectories.find((trajectory) => trajectory.actorId === "actor-vehicle-a");
  const vehicleB = trajectories.find((trajectory) => trajectory.actorId === "actor-vehicle-b");
  const pointA = vehicleA?.keyframes.find((keyframe) => keyframe.timeMs === 8_000);
  const pointB = vehicleB?.keyframes.find((keyframe) => keyframe.timeMs === 8_000);
  if (!vehicleA || !vehicleB || !pointA || !pointB) throw new Error("Demo paths are incomplete.");

  const proposal = await invokeSiteTool(page, "propose_scene_changes", {
    title: "Review a coordinated lane alternative",
    rationale:
      "The recorded statements allow more than one lane account, so keep this as an unapplied alternative.",
    changes: [
      {
        kind: "trajectory-keyframe-patch",
        actorId: vehicleA.actorId,
        branchId: vehicleA.branchId,
        adjustments: [{ keyframeId: pointA.id, y: pointA.y + 0.008 }],
        visible: true,
      },
      {
        kind: "trajectory-keyframe-patch",
        actorId: vehicleB.actorId,
        branchId: vehicleB.branchId,
        adjustments: [{ keyframeId: pointB.id, y: pointB.y - 0.008 }],
        visible: true,
      },
    ],
    expectedVersion: 1,
    requestId: "simple-flow-proposal-0001",
  });
  expect(proposal).toMatchObject({ ok: true, caseVersion: 2 });

  const decideStage = page.getByLabel("Decide on the proposal");
  await expect(page.getByRole("heading", { name: "Decide on the proposal" })).toBeVisible();
  await expect(decideStage.getByText("Agent proposal", { exact: true })).toBeVisible();
  await expect(decideStage.getByText("Evidence in scope", { exact: true })).toBeVisible();
  await expect(decideStage.getByText("Human statements", { exact: true })).toBeVisible();
  await expect(decideStage.getByText("Uncertainty", { exact: true })).toBeVisible();
  await expect(decideStage.getByText("Possible contradictions", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Expert", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "Case workspaces" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "1 change set awaiting you" })).toBeVisible();
  await page.getByRole("button", { name: "Simple", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Decide on the proposal" })).toBeVisible();

  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review the factual report" })).toBeVisible();
  await waitForLocalSave(page);

  await page.getByRole("button", { name: "Review final report" }).click();
  const review = page.getByRole("dialog", { name: "Review before finalizing" });
  await expect(review).toBeVisible();
  await review.getByLabel("I reviewed unresolved questions.").check();
  await review.getByLabel("I acknowledge the method and limitations.").check();
  await review.getByLabel("I reviewed every confirmed fact.").check();
  await review
    .getByLabel("I reviewed every included unconfirmed and hypothesis statement.")
    .check();
  await review.getByRole("button", { name: "Continue to confirmation" }).click();
  await page
    .getByRole("alertdialog", { name: "Create an immutable report snapshot?" })
    .getByRole("button", { name: "Finalize factual report" })
    .click();

  await expect(page.getByText("Finalized by a person", { exact: true })).toBeVisible();
  await expect(page.getByText(/Immutable snapshot from case v/)).toBeVisible();
  await waitForLocalSave(page);
});
