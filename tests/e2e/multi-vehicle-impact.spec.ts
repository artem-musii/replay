/// <reference types="node" />

import { readFile } from "node:fs/promises";

import { expect, test, type Download, type Page } from "@playwright/test";

import { createBlankCase, exportReplayCase, ReplayEngine, type ReplayCase } from "../../src/domain";
import { confirmStructuredCaseImport, openDemo, waitForLocalSave } from "./helpers";

interface ContactProjection {
  id: string;
  linkedActorIds: string[];
  location?: { x: number; y: number };
}

async function downloadedBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error(`Playwright did not retain ${download.suggestedFilename()}.`);
  return readFile(path);
}

async function createThreeVehicleCase(page: Page): Promise<void> {
  await page.goto("./");
  await page.getByRole("button", { name: "Start a blank case" }).click();
  await page.getByLabel("Case title").fill("Three vehicle contact review");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Vehicles").selectOption("3");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create local case" }).click();
  await expect(page.locator("main.workspace")).toBeVisible();
  await page.getByRole("button", { name: "Expert", exact: true }).click();
  await waitForLocalSave(page);
}

async function placeContact(
  page: Page,
  firstVehicle: string,
  secondVehicle: string,
  location: { x: number; y: number },
): Promise<void> {
  await page.getByRole("button", { name: "Mark impact", exact: true }).click();
  const form = page.getByRole("form", { name: /Place approximate impact by coordinates/ });
  await expect(form).toBeVisible();
  const first = form.getByLabel("First vehicle");
  const second = form.getByLabel("Second vehicle");
  await second.selectOption({ label: secondVehicle });
  await first.selectOption({ label: firstVehicle });
  await form.getByRole("spinbutton", { name: "X" }).fill(String(location.x));
  await form.getByRole("spinbutton", { name: "Y" }).fill(String(location.y));
  await form
    .getByRole("button", { name: `Place contact between ${firstVehicle} and ${secondVehicle}` })
    .click();
  await expect(form).toHaveCount(0);
  await waitForLocalSave(page);
}

async function exportContacts(page: Page): Promise<ContactProjection[]> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.getByLabel("Case options").click();
      await page.getByRole("button", { name: "Export structured case JSON" }).click();
    })(),
  ]);
  const replayCase = JSON.parse((await downloadedBytes(download)).toString("utf8")) as {
    timelineEvents: ContactProjection[];
  };
  return replayCase.timelineEvents.filter((event) => event.id.startsWith("event-"));
}

function contactForPair(
  contacts: readonly ContactProjection[],
  firstActorId: string,
  secondActorId: string,
): ContactProjection | undefined {
  return contacts.find(
    (contact) =>
      contact.linkedActorIds.length === 2 &&
      contact.linkedActorIds.includes(firstActorId) &&
      contact.linkedActorIds.includes(secondActorId),
  );
}

function createLegacyMultiActorImpactCase(): ReplayCase {
  let idCounter = 0;
  const replayCase = createBlankCase(
    {
      title: "Legacy three vehicle contact",
      incidentDate: "2026-08-29",
      sceneType: "intersection",
      roadCondition: "dry",
      vehicleCount: 3,
    },
    {
      caseId: "case-legacy-three-vehicle-contact",
      now: "2026-08-29T10:00:00.000Z",
    },
  );
  const engine = new ReplayEngine(replayCase, {
    now: () => "2026-08-29T10:00:01.000Z",
    idFactory: (prefix) => `${prefix}-legacy-contact-${String(++idCounter)}`,
  });
  const result = engine.execute({
    type: "timeline.upsert",
    actor: "human",
    origin: "ui",
    branchId: replayCase.activeBranchId,
    timeMs: 2_000,
    eventType: "impact",
    title: "Legacy approximate contact",
    certainty: "uncertain",
    linkedActorIds: replayCase.actors.map((actor) => actor.id),
    linkedClaimIds: [],
    linkedEvidenceIds: [],
    location: { x: 45, y: 55 },
  });
  if (!result.ok) throw new Error(result.error.message);
  return engine.state;
}

test.describe("multi-vehicle contact placement", () => {
  test("creates and updates contacts by exact actor pair", async ({ page }) => {
    await createThreeVehicleCase(page);

    await placeContact(page, "Vehicle A", "Vehicle B", { x: 25, y: 35 });
    await placeContact(page, "Vehicle B", "Vehicle C", { x: 65, y: 75 });

    await expect(
      page.getByRole("button", {
        name: /Approximate impact at .*between Vehicle A and Vehicle B/,
      }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", {
        name: /Approximate impact at .*between Vehicle B and Vehicle C/,
      }),
    ).toHaveCount(1);

    await placeContact(page, "Vehicle A", "Vehicle B", { x: 30, y: 40 });

    const contacts = await exportContacts(page);
    expect(contacts).toHaveLength(2);
    expect(contactForPair(contacts, "actor-vehicle-a", "actor-vehicle-b")).toMatchObject({
      linkedActorIds: ["actor-vehicle-a", "actor-vehicle-b"],
      location: { x: 30, y: 40 },
    });
    expect(contactForPair(contacts, "actor-vehicle-b", "actor-vehicle-c")).toMatchObject({
      linkedActorIds: ["actor-vehicle-b", "actor-vehicle-c"],
      location: { x: 65, y: 75 },
    });
  });

  test("corrects one legacy all-actor impact into the chosen pair", async ({ page }) => {
    await openDemo(page);
    const legacyCase = createLegacyMultiActorImpactCase();
    await page.getByLabel("Import case JSON").setInputFiles({
      name: "legacy-three-vehicle-contact.replay.json",
      mimeType: "application/json",
      buffer: Buffer.from(exportReplayCase(legacyCase)),
    });
    await confirmStructuredCaseImport(page);
    await expect(page.getByText(legacyCase.title, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Approximate impact at .*involving Vehicle A, Vehicle B, and Vehicle C/,
      }),
    ).toHaveCount(1);

    await placeContact(page, "Vehicle B", "Vehicle C", { x: 50, y: 60 });

    const contacts = await exportContacts(page);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      linkedActorIds: ["actor-vehicle-b", "actor-vehicle-c"],
      location: { x: 50, y: 60 },
    });
  });
});
