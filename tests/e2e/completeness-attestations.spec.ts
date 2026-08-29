/// <reference types="node" />

import { expect, test } from "@playwright/test";

import {
  createDemoCase,
  exportReplayCase,
  validateCaseReferences,
  type ReplayCase,
} from "../../src/domain";
import { confirmStructuredCaseImport, inspectorTab, openDemo, waitForLocalSave } from "./helpers";

function noEvidenceCase(): ReplayCase {
  const replayCase = createDemoCase();
  replayCase.id = "case-e2e-no-evidence";
  replayCase.title = "No supplied evidence finalization";
  replayCase.reportSnapshots = [];
  replayCase.reportNotes = [];
  replayCase.completenessAttestations = [];
  delete replayCase.selectedItem;

  const evidenceIds = new Set(replayCase.evidence.map((asset) => asset.id));
  const damageMarkerIds = new Set(
    replayCase.actors.flatMap((actor) => actor.damageMarkers.map((marker) => marker.id)),
  );
  const evidenceEventIds = new Set(
    replayCase.timelineEvents.filter((event) => event.type === "evidence").map((event) => event.id),
  );
  replayCase.actors.forEach((actor) => {
    actor.damageMarkers = [];
  });
  replayCase.claims.forEach((claim) => {
    claim.sourceIds = claim.sourceIds.filter((id) => !evidenceIds.has(id));
    claim.linkedEvidenceIds = [];
    if (
      (claim.sourceType === "photo" || claim.sourceType === "document") &&
      claim.sourceIds.length === 0
    ) {
      claim.sourceType = "scene-observation";
    }
    claim.linkedEventIds = claim.linkedEventIds.filter((id) => !evidenceEventIds.has(id));
    claim.linkedSceneObjectIds = claim.linkedSceneObjectIds.filter(
      (id) => !damageMarkerIds.has(id),
    );
  });
  replayCase.timelineEvents = replayCase.timelineEvents
    .filter((event) => !evidenceEventIds.has(event.id))
    .map((event) => ({ ...event, linkedEvidenceIds: [] }));
  replayCase.branches.forEach((branch) => {
    branch.eventIds = branch.eventIds.filter((id) => !evidenceEventIds.has(id));
    branch.assumptions = branch.assumptions.map((assumption) => ({
      ...assumption,
      supportingEvidenceIds: [],
      conflictingEvidenceIds: [],
    }));
  });
  replayCase.evidence = [];
  replayCase.questions = [];
  replayCase.consistencyIssues = [];

  const issues = validateCaseReferences(replayCase);
  if (issues.length > 0) {
    throw new Error(`Invalid no-evidence E2E fixture: ${JSON.stringify(issues)}`);
  }
  return replayCase;
}

test("human completeness review makes a legitimate no-evidence case finalizable", async ({
  page,
}) => {
  await openDemo(page);
  await waitForLocalSave(page);

  await page.getByLabel("Import case JSON").setInputFiles({
    name: "no-supplied-evidence.replay.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportReplayCase(noEvidenceCase())),
  });
  await confirmStructuredCaseImport(page);
  await expect(page.locator(".workspace-case-title")).toContainText(
    "No supplied evidence finalization",
  );
  await waitForLocalSave(page);

  await inspectorTab(page, "Facts").click();
  await page
    .getByRole("button", { name: /No injuries were reported in this minor incident/ })
    .click();
  await page.getByRole("button", { name: "Confirm as human-reviewed" }).click();

  await inspectorTab(page, "Report").click();
  const review = page.locator(".completeness-review");
  await expect(review.getByText("Human actions only", { exact: true })).toBeVisible();
  await expect(review).toContainText(
    "These records document what a person reviewed; they are not evidence or factual findings.",
  );

  await review.getByRole("button", { name: "Record no evidence supplied" }).click();
  await review.getByRole("button", { name: "Record Vehicle A damage as unknown" }).click();
  await review.getByRole("button", { name: "Record Vehicle B damage as not assessed" }).click();
  await review.getByRole("button", { name: "Record uncertainty review complete" }).click();

  await expect(review).toContainText("This does not establish that evidence does not exist.");
  await expect(review.getByRole("region", { name: "Vehicle A damage review" })).toContainText(
    "unknown",
  );
  await expect(review.getByRole("region", { name: "Vehicle B damage review" })).toContainText(
    "not assessed",
  );
  await expect(review).toContainText("This record does not make unknown information certain.");

  await page.getByRole("button", { name: "Build report preview" }).click();
  const preview = page.locator(".report-preview");
  await expect(preview.getByText("Not ready to finalize", { exact: true })).toHaveCount(0);
  await preview.getByRole("button", { name: /Show all \d+ sections/ }).click();
  await expect(preview.locator(".report-certainty.is-attested")).toHaveCount(4);
  await expect(preview).toContainText(
    "A human recorded that no evidence was supplied for this local case.",
  );
  await expect(preview).toContainText("Human attestation");

  const finalize = page.getByRole("button", { name: "Review and finalize" });
  await expect(finalize).toBeEnabled();
  await finalize.click();
  const finalizationReview = page.getByRole("dialog", { name: "Review before finalizing" });
  await expect(finalizationReview).toContainText("None remain open or deferred.");
  await finalizationReview.getByLabel("I reviewed unresolved questions.").check();
  await finalizationReview.getByLabel("I acknowledge the method and limitations.").check();
  await finalizationReview.getByLabel("I reviewed every confirmed fact.").check();
  await finalizationReview
    .getByLabel("I reviewed every included unconfirmed and hypothesis statement.")
    .check();
  await finalizationReview.getByRole("button", { name: "Continue to confirmation" }).click();

  const confirmation = page.getByRole("alertdialog", {
    name: "Create an immutable report snapshot?",
  });
  await confirmation.getByRole("button", { name: "Finalize factual report" }).click();
  await expect(page.getByText("Finalized immutable snapshot", { exact: true })).toBeVisible();
  await expect(page.getByText("Historical snapshot view", { exact: true })).toBeVisible();
});
