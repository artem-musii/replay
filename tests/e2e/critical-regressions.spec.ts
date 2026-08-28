/// <reference types="node" />

import { readFile } from "node:fs/promises";

import { expect, test, type Download, type Page } from "@playwright/test";

import {
  currentDemoRunId,
  inspectorTab,
  installModelContextPolyfill,
  openDemo,
  openWebMCPInspector,
} from "./helpers";

async function downloadedBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error(`Playwright did not retain ${download.suggestedFilename()}.`);
  return readFile(path);
}

async function runSiteTool(
  page: Page,
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): Promise<void> {
  await expect(page.locator("button.webmcp-status")).toContainText(/\d+ registered/, {
    timeout: 10_000,
  });
  const { dialog } = await openWebMCPInspector(page);
  await dialog.locator(".debug-tool-list button").filter({ hasText: toolName }).click();
  await dialog.getByLabel("Simulation input").fill(JSON.stringify(input, null, 2));
  await dialog.getByRole("button", { name: "Run through browser" }).click();
  await expect(dialog.locator(".debug-result")).toContainText('"ok": true');
  await dialog.getByRole("button", { name: "Close WebMCP inspector" }).click();
}

async function invokeSiteTool(
  page: Page,
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): Promise<{
  ok: boolean;
  message: string;
  caseVersion: number;
  activityId?: string;
  affectedIds: string[];
  issues: Array<{ id: string; title: string; affectedIds: string[] }>;
  visibleState: { workspaceMode: string };
}> {
  const serialized = await page.evaluate(
    async ({ name, payload }) => {
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
      const tool = (await modelContext.getTools()).find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`${name} is not registered.`);
      return modelContext.executeTool(tool, payload);
    },
    { name: toolName, payload: input },
  );
  const parsed: unknown = JSON.parse(serialized);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${toolName} returned a non-object result.`);
  }
  return parsed as {
    ok: boolean;
    message: string;
    caseVersion: number;
    activityId?: string;
    affectedIds: string[];
    issues: Array<{ id: string; title: string; affectedIds: string[] }>;
    visibleState: { workspaceMode: string };
  };
}

async function openCaseOptions(page: Page): Promise<void> {
  await page.getByLabel("Case options").click();
}

async function persistedCaseVersion(
  page: Page,
  caseId = currentDemoRunId(page),
): Promise<number | undefined> {
  return page.evaluate(
    (persistedCaseId) =>
      new Promise<number | undefined>((resolve, reject) => {
        const open = indexedDB.open("replay-local-vault-v2");
        open.onerror = () => reject(open.error ?? new Error("Could not open the local vault."));
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction("cases", "readonly");
          const get = transaction.objectStore("cases").get(persistedCaseId);
          get.onerror = () => reject(get.error ?? new Error("Could not read the saved case."));
          get.onsuccess = () => {
            const record = get.result as { payload?: { caseVersion?: unknown } } | undefined;
            const version = record?.payload?.caseVersion;
            resolve(typeof version === "number" ? version : undefined);
            database.close();
          };
        };
      }),
    caseId,
  );
}

async function seedPollutedLegacyDemo(page: Page, sourceCaseId: string): Promise<void> {
  await page.evaluate(
    ({ sourceId }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("replay-local-vault-v2");
        open.onerror = () => reject(open.error ?? new Error("Could not open the local vault."));
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction("cases", "readwrite");
          const cases = transaction.objectStore("cases");
          const get = cases.get(sourceId);
          get.onerror = () => reject(get.error ?? new Error("Could not read the source demo."));
          get.onsuccess = () => {
            const serialized = JSON.stringify(get.result);
            if (!serialized) {
              reject(new Error("The source demo was not persisted."));
              return;
            }
            const legacyCaseId = "case-demo-roundabout";
            const record = JSON.parse(serialized.replaceAll(sourceId, legacyCaseId)) as {
              id: string;
              updatedAt: string;
              payload: { id: string; caseVersion: number; updatedAt: string };
            };
            const pollutedAt = "2099-01-01T00:00:00.000Z";
            record.id = legacyCaseId;
            record.updatedAt = pollutedAt;
            record.payload.id = record.id;
            record.payload.caseVersion = 77;
            record.payload.updatedAt = pollutedAt;
            cases.put(record);
          };
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () =>
            reject(transaction.error ?? new Error("Could not seed the polluted legacy demo."));
        };
      }),
    { sourceId: sourceCaseId },
  );
}

async function failCaseMetadataWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scopedWindow = window as Window & {
      __replayOriginalCasePut?: IDBObjectStore["put"];
    };
    // The method is restored onto its original prototype and always invoked with an explicit store.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    scopedWindow.__replayOriginalCasePut ??= IDBObjectStore.prototype.put;
    const original = scopedWindow.__replayOriginalCasePut;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      ...args: [unknown, IDBValidKey?]
    ) {
      if (this.name === "cases") {
        throw new DOMException("Simulated local vault write failure.", "UnknownError");
      }
      return Reflect.apply(original, this, args) as IDBRequest<IDBValidKey>;
    } as IDBObjectStore["put"];
  });
}

async function restoreCaseMetadataWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scopedWindow = window as Window & {
      __replayOriginalCasePut?: IDBObjectStore["put"];
    };
    if (scopedWindow.__replayOriginalCasePut) {
      IDBObjectStore.prototype.put = scopedWindow.__replayOriginalCasePut;
    }
  });
}

async function localEvidenceBlobCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("replay-local-vault-v2");
        open.onerror = () => reject(open.error ?? new Error("Could not open the local vault."));
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction("evidenceBlobs", "readonly");
          const count = transaction.objectStore("evidenceBlobs").count();
          count.onerror = () => reject(count.error ?? new Error("Could not count evidence."));
          count.onsuccess = () => resolve(count.result);
          transaction.oncomplete = () => database.close();
        };
      }),
  );
}

test.describe("production-critical regressions", () => {
  test("previews coordinated agent geometry and requires human acceptance", async ({ page }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);
    const summary = await invokeSiteTool(page, "get_case_summary", {});

    const proposal = await invokeSiteTool(page, "propose_scene_changes", {
      title: "Test two-vehicle alignment",
      rationale: "Preview both vehicle positions together so the human can review their spacing.",
      changes: [
        {
          kind: "actor-pose",
          actorId: "actor-vehicle-a",
          proposedPose: { x: 0.61, y: 0.47, rotationDeg: 8 },
        },
        {
          kind: "actor-pose",
          actorId: "actor-vehicle-b",
          proposedPose: { x: 0.55, y: 0.64, rotationDeg: 84 },
        },
      ],
      expectedVersion: summary.caseVersion,
      requestId: "request-proposal-e2e-0001",
    });

    expect(proposal).toMatchObject({ ok: true });
    await expect(page.getByRole("heading", { name: "1 change set awaiting you" })).toBeVisible();
    await expect(page.locator(".proposal-scene-actor")).toHaveCount(2);
    await page.getByRole("button", { name: "Accept and apply" }).click();
    const confirmation = page.getByRole("alertdialog", { name: "Apply this proposal?" });
    await confirmation.getByRole("button", { name: "Accept and apply" }).click();

    await expect(page.locator(".proposal-scene-actor")).toHaveCount(0);
    await page.getByText("Recent proposal decisions (1)").click();
    await expect(page.locator(".proposal-history")).toContainText("accepted");
    await expect(
      page
        .locator(".activity-item__summary")
        .filter({ hasText: "Human accepted agent proposal: Test two-vehicle alignment." }),
    ).toBeVisible();
  });

  test("provides an accessible exact editor for scene, path, and event geometry", async ({
    page,
  }) => {
    await openDemo(page);

    const vehicleA = page.getByRole("button", { name: /^Vehicle A, position/ });
    await vehicleA.focus();
    await vehicleA.press("Enter");
    const vehicleEditor = page.getByRole("region", { name: "Vehicle A" });
    await vehicleEditor.getByLabel("X position").fill("55.5");
    await vehicleEditor.getByLabel("Y position").fill("33.5");
    await vehicleEditor.getByLabel("Rotation °").fill("42");
    await vehicleEditor.getByRole("button", { name: "Apply exact pose" }).click();
    await expect(vehicleEditor.getByLabel("X position")).toHaveValue("55.5");

    await page.getByRole("button", { name: "Edit path" }).click();
    const trajectoryEditor = page.getByRole("region", { name: "Vehicle A" });
    const showPath = trajectoryEditor.getByRole("checkbox", { name: "Show path" });
    await showPath.uncheck();
    await expect(showPath).not.toBeChecked();
    const firstPoint = trajectoryEditor.locator(".keyframe-editor").first();
    await firstPoint.getByLabel("X").fill("44.5");
    await firstPoint.getByRole("button", { name: "Apply point" }).click();
    await expect(firstPoint.getByLabel("X")).toHaveValue("44.5");

    const impact = page.getByRole("button", { name: /^Approximate impact at/ });
    await impact.focus();
    await impact.press("Enter");
    const eventEditor = page.getByRole("region", { name: "Approximate contact" });
    await eventEditor.getByLabel("Time s").fill("10.5");
    await eventEditor.getByLabel("X location").fill("50");
    await eventEditor.getByRole("button", { name: "Apply event details" }).click();
    await expect(eventEditor.getByLabel("Time s")).toHaveValue("10.5");
  });

  test("focuses the requested consistency issue and reveals its affected IDs", async ({ page }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);

    const validation = await invokeSiteTool(page, "validate_case_consistency", { scope: "all" });
    await expect(page.getByText(/Ran validate case consistency:/)).toBeVisible();
    const issue = validation.issues[0];
    expect(issue).toBeDefined();
    if (!issue) throw new Error("The deterministic demo did not expose a consistency issue.");

    const focused = await invokeSiteTool(page, "focus_workspace_item", {
      itemType: "issue",
      itemId: issue.id,
      workspaceMode: "report",
    });
    expect(focused).toMatchObject({
      ok: true,
      affectedIds: issue.affectedIds,
      visibleState: { workspaceMode: "report" },
    });
    await expect(inspectorTab(page, "Report")).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".issue-row.is-focused")).toContainText(issue.title);
  });

  test("keeps the original agent mutation beside an explicit human override", async ({ page }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);

    const statement = "Vehicle B may have moved outward before contact.";
    await runSiteTool(page, "add_observation", {
      statement,
      sourceType: "agent-inference",
      linkedIds: [],
      status: "agent-hypothesis",
      sharedAcrossBranches: true,
      expectedVersion: 1,
      requestId: "e2e-human-override-agent-observation",
    });

    const agentActivity = page
      .locator(".activity-item--agent")
      .filter({ hasText: "Added an observation." });
    await expect(agentActivity).toBeVisible();
    await expect(agentActivity).toContainText("Agent");
    await expect(agentActivity).toContainText("Site Tool");
    await expect(agentActivity).toContainText("Request e2e-human-override-agent-observation");

    await inspectorTab(page, "Facts").click();
    await page.getByRole("button", { name: new RegExp(statement) }).click();
    await page
      .getByLabel("Selected observation")
      .getByLabel("Classification")
      .selectOption("reported");

    const humanOverride = page
      .locator(".activity-item--human")
      .filter({ hasText: "Human override" });
    await expect(humanOverride).toBeVisible();
    await expect(humanOverride).toContainText("Human override: Updated an observation.");
    await expect(humanOverride).toContainText(/Overrides activity-/);
    await expect(agentActivity).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await openCaseOptions(page);
        await page.getByRole("button", { name: "Export structured case JSON" }).click();
      })(),
    ]);
    const exported = JSON.parse((await downloadedBytes(download)).toString("utf8")) as {
      activity: Array<{
        id: string;
        requestId?: string;
        classification?: string;
        overridesActivityId?: string;
      }>;
    };
    const original = exported.activity.find(
      (activity) => activity.requestId === "e2e-human-override-agent-observation",
    );
    const override = exported.activity.find(
      (activity) => activity.classification === "human-override",
    );
    expect(original).toBeDefined();
    expect(override).toMatchObject({ overridesActivityId: original?.id });
  });

  test("imports a structured transfer under a fresh local case identity", async ({ page }) => {
    await openDemo(page);
    const sourceCaseId = currentDemoRunId(page);
    const [sourceDownload] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await openCaseOptions(page);
        await page.getByRole("button", { name: "Export structured case JSON" }).click();
      })(),
    ]);
    const source = await downloadedBytes(sourceDownload);

    await page.getByLabel("Import case JSON").setInputFiles({
      name: "roundabout-transfer.replay.json",
      mimeType: "application/json",
      buffer: source,
    });
    await expect(page).toHaveURL(/#workspace$/);
    await expect(page.locator(".workspace-case-title")).toContainText("Local case");
    await expect(page.locator(".activity-list")).toContainText(
      "Imported an unsigned structured case export",
    );

    const [copyDownload] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await openCaseOptions(page);
        await page.getByRole("button", { name: "Export structured case JSON" }).click();
      })(),
    ]);
    const copy = JSON.parse((await downloadedBytes(copyDownload)).toString("utf8")) as {
      id: string;
    };
    expect(copy.id).toMatch(/^case-import-/);
    expect(copy.id).not.toBe(sourceCaseId);
  });

  test("exports a parseable finalized case and a non-empty PDF", async ({ page }) => {
    test.slow();
    await openDemo(page);
    const demoRunId = currentDemoRunId(page);
    await inspectorTab(page, "Report").click();
    await page.getByRole("button", { name: "Build report preview" }).click();

    await page.getByRole("button", { name: "Review and finalize" }).click();
    const review = page.getByRole("dialog", { name: "Review before finalizing" });
    await review.getByLabel("I reviewed unresolved questions.").check();
    await review.getByLabel("I acknowledge the method and limitations.").check();
    await review.getByLabel("I reviewed every confirmed fact.").check();
    await review.getByRole("button", { name: "Continue to confirmation" }).click();
    await page
      .getByRole("alertdialog", { name: "Create an immutable report snapshot?" })
      .getByRole("button", { name: "Finalize factual report" })
      .click();

    await expect(page.locator(".activity-list")).toContainText(
      "Human finalized an immutable factual report snapshot.",
    );

    const [jsonDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "JSON", exact: true }).click(),
    ]);
    expect(jsonDownload.suggestedFilename()).toMatch(/\.replay\.json$/);
    const exported = JSON.parse((await downloadedBytes(jsonDownload)).toString("utf8")) as {
      id: string;
      schemaVersion: number;
      caseVersion: number;
      reportSnapshots: Array<{
        caseVersion: number;
        immutable: boolean;
        humanAcknowledged: boolean;
      }>;
    };
    expect(exported).toMatchObject({
      id: demoRunId,
      schemaVersion: 2,
      caseVersion: 2,
    });
    expect(exported.reportSnapshots).toHaveLength(1);
    expect(exported.reportSnapshots[0]).toMatchObject({
      caseVersion: 2,
      immutable: true,
      humanAcknowledged: true,
    });

    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PDF", exact: true }).click(),
    ]);
    expect(pdfDownload.suggestedFilename()).toMatch(/-factual-report\.pdf$/);
    const pdf = await downloadedBytes(pdfDownload);
    expect(pdf.byteLength).toBeGreaterThan(1_000);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  test("exports a non-empty PNG under the production preview CSP", async ({ page }) => {
    test.slow();
    const response = await page.request.get("/");
    expect(response.headers()["content-security-policy"]).toContain("connect-src 'self'");

    await openDemo(page);
    await inspectorTab(page, "Report").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PNG", exact: true }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/-scene\.png$/);
    const png = await downloadedBytes(download);
    expect(png.byteLength).toBeGreaterThan(1_000);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  test("blocks human and Site Tool mutations after a save failure until recovery", async ({
    page,
  }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);
    await expect.poll(() => persistedCaseVersion(page)).toBe(1);
    await failCaseMetadataWrites(page);

    await inspectorTab(page, "Facts").click();
    await page
      .getByRole("button", {
        name: /Vehicle A was leaving the roundabout when Vehicle B made contact/,
      })
      .click();
    await page.getByRole("button", { name: "Confirm as human-reviewed" }).click();

    const saveFailure = page.locator(".workspace-save-failure");
    await expect(saveFailure).toContainText("Local save failed. Editing is paused.");
    await expect(page.locator(".workspace-case-title")).toContainText("v2");

    const blockedTool = await invokeSiteTool(page, "add_observation", {
      statement: "This Site Tool mutation must remain blocked.",
      sourceType: "agent-inference",
      linkedIds: [],
      status: "agent-hypothesis",
      sharedAcrossBranches: true,
      expectedVersion: 2,
      requestId: "e2e-blocked-after-save-failure",
    });
    expect(blockedTool).toMatchObject({ ok: false, caseVersion: 2 });

    await page
      .getByLabel("Case inspector")
      .getByRole("button", { name: "Add observation", exact: true })
      .click();
    let form = page.locator("form.inline-form");
    await form
      .getByRole("textbox", { name: "Observation", exact: true })
      .fill("This human mutation must remain blocked.");
    await form.getByRole("button", { name: "Add observation" }).click();
    await expect(page.locator(".workspace-case-title")).toContainText("v2");
    await expect(page.getByText("This human mutation must remain blocked.")).toHaveCount(0);

    const [recoveryDownload] = await Promise.all([
      page.waitForEvent("download"),
      saveFailure.getByRole("button", { name: "Download recovery backup" }).click(),
    ]);
    expect(recoveryDownload.suggestedFilename()).toMatch(/\.replay\.json$/);
    await expect(saveFailure).toContainText("Recovery backup downloaded.");

    await page
      .getByLabel("Case inspector")
      .getByRole("button", { name: "Add observation", exact: true })
      .click();
    form = page.locator("form.inline-form");
    await form
      .getByRole("textbox", { name: "Observation", exact: true })
      .fill("Backed-up human observation.");
    await form.getByRole("button", { name: "Add observation" }).click();
    await expect(page.getByText("Backed-up human observation.", { exact: true })).toBeVisible();
    await expect(page.locator(".workspace-case-title")).toContainText("v3");
    await expect(saveFailure).toContainText("Local save failed. Editing is paused.");
    await expect(saveFailure).toContainText("version 3");

    await restoreCaseMetadataWrites(page);
    await saveFailure.getByRole("button", { name: "Retry local save" }).click();
    await expect(saveFailure).toHaveCount(0);
    await expect(page.locator(".save-status")).toContainText("Saved locally");
    await expect.poll(() => persistedCaseVersion(page)).toBe(3);
  });

  test("keeps uploaded evidence bytes until its deletion tombstone is durable", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Evidence").click();
    const uploadBytes = await readFile("public/assets/generated/demo-vehicle-a-damage.webp");
    await page.getByLabel("Choose evidence image").setInputFiles({
      name: "local-recovery-evidence.webp",
      mimeType: "image/webp",
      buffer: uploadBytes,
    });
    await expect(
      page
        .getByRole("list", { name: "Evidence images" })
        .getByRole("button", { name: "local-recovery-evidence.webp", exact: true }),
    ).toBeVisible();
    await expect.poll(() => localEvidenceBlobCount(page)).toBe(1);
    await expect(page.locator(".save-status")).toContainText("Saved locally");

    await failCaseMetadataWrites(page);
    await page.getByRole("button", { name: "Delete local evidence" }).click();
    await page
      .getByRole("alertdialog", { name: "Delete this evidence?" })
      .getByRole("button", { name: "Delete evidence" })
      .click();

    await expect(page.locator(".workspace-save-failure")).toContainText(
      "Local save failed. Editing is paused.",
    );
    await expect(page.getByText(/image bytes remain in the local vault/i)).toBeVisible();
    await expect.poll(() => localEvidenceBlobCount(page)).toBe(1);

    await restoreCaseMetadataWrites(page);
    await page.getByRole("button", { name: "Retry local save" }).click();
    await expect(page.locator(".workspace-save-failure")).toHaveCount(0);
    await expect.poll(() => localEvidenceBlobCount(page)).toBe(0);
  });

  test("resumes a demo run and starts a fresh copy without overwriting the saved run", async ({
    page,
  }) => {
    await openDemo(page);
    const originalRunId = currentDemoRunId(page);
    const originalRunUrl = page.url();
    await inspectorTab(page, "Facts").click();
    await page
      .getByRole("button", {
        name: /Vehicle A was leaving the roundabout when Vehicle B made contact/,
      })
      .click();
    await page.getByRole("button", { name: "Confirm as human-reviewed" }).click();
    await expect.poll(() => persistedCaseVersion(page, originalRunId)).toBe(3);

    await page.reload();
    await expect(page).toHaveURL(originalRunUrl);
    await expect(page.locator("main.workspace")).toBeVisible();
    await expect(page.locator(".workspace-case-title")).toContainText("v3");
    await inspectorTab(page, "Facts").click();
    await expect(page.getByText("5 confirmed", { exact: true })).toBeVisible();

    await openCaseOptions(page);
    const startFreshDemo = page.getByRole("button", { name: "Start fresh demo copy" });
    await startFreshDemo.click();
    let confirmation = page.getByRole("alertdialog", {
      name: "Start a fresh demo copy?",
    });
    await expect(confirmation).toContainText("Your current demo work stays available");
    await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    const caseOptions = page.getByLabel("Case options");
    await expect(caseOptions).toBeFocused();

    await caseOptions.click();
    await page.getByRole("button", { name: "Start fresh demo copy" }).click();
    confirmation = page.getByRole("alertdialog", { name: "Start a fresh demo copy?" });
    await confirmation.getByRole("button", { name: "Start fresh copy" }).click();
    await expect(page).toHaveURL(/#case\/case-demo-roundabout-calibrated-run-/);
    const freshRunId = currentDemoRunId(page);
    expect(freshRunId).not.toBe(originalRunId);
    await expect(page.locator(".workspace-case-title")).toContainText("v1");
    await expect(page.locator(".workspace-conflict")).toHaveCount(0);
    await expect(page.getByText("4 confirmed", { exact: true })).toBeVisible();
    await expect(page.getByText("5 unresolved", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Vehicle A was leaving the roundabout when Vehicle B made contact.*Reported/,
      }),
    ).toBeVisible();
    await expect.poll(() => persistedCaseVersion(page, freshRunId)).toBe(1);
    await expect.poll(() => persistedCaseVersion(page, originalRunId)).toBe(3);

    await page.goBack();
    await expect(page.locator("main.workspace")).toBeVisible();
    expect(currentDemoRunId(page)).toBe(originalRunId);
    await expect(page.locator(".workspace-case-title")).toContainText("v3");
    await page.goForward();
    await expect(page.locator("main.workspace")).toBeVisible();
    expect(currentDemoRunId(page)).toBe(freshRunId);
    await expect(page.locator(".workspace-case-title")).toContainText("v1");

    await page.reload();
    expect(currentDemoRunId(page)).toBe(freshRunId);
    await expect(page.locator("main.workspace")).toBeVisible();
    await expect(page.locator(".workspace-case-title")).toContainText("v1");
    await inspectorTab(page, "Facts").click();
    await expect(page.getByText("4 confirmed", { exact: true })).toBeVisible();

    await page.goto(originalRunUrl);
    await expect(page.locator("main.workspace")).toBeVisible();
    expect(currentDemoRunId(page)).toBe(originalRunId);
    await expect(page.locator(".workspace-case-title")).toContainText("v3");
    await inspectorTab(page, "Facts").click();
    await expect(page.getByText("5 confirmed", { exact: true })).toBeVisible();
  });

  test("opens a clean unique run from bare #demo despite a polluted legacy demo", async ({
    page,
  }) => {
    await openDemo(page);
    const firstRunId = currentDemoRunId(page);
    await expect.poll(() => persistedCaseVersion(page, firstRunId)).toBe(1);
    await seedPollutedLegacyDemo(page, firstRunId);
    await expect.poll(() => persistedCaseVersion(page, "case-demo-roundabout")).toBe(77);

    await page.goto("/#demo");
    await expect(page.locator("main.workspace")).toBeVisible();
    const cleanRunId = currentDemoRunId(page);
    expect(cleanRunId).not.toBe(firstRunId);
    expect(cleanRunId).not.toBe("case-demo-roundabout");
    await expect(page.locator(".workspace-case-title")).toContainText("Demo run");
    await expect(page.locator(".workspace-case-title")).toContainText("v1");
    await expect(page.locator(".workspace-conflict")).toHaveCount(0);
    await expect(page.locator(".scene-contact-readout")).toHaveAttribute(
      "data-contact-state",
      "clear",
    );
    await expect.poll(() => persistedCaseVersion(page, cleanRunId)).toBe(1);
    await expect.poll(() => persistedCaseVersion(page, "case-demo-roundabout")).toBe(77);
  });

  test("does not infer another editor from a delayed single-page lease check", async ({ page }) => {
    await page.addInitScript(() => {
      const originalRequest = navigator.locks.request.bind(navigator.locks);
      Object.defineProperty(navigator.locks, "request", {
        configurable: true,
        value: (name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) =>
          new Promise((resolve, reject) => {
            window.setTimeout(() => {
              originalRequest(name, options, callback).then(resolve, reject);
            }, 700);
          }),
      });
    });

    await openDemo(page);
    await expect(page.locator(".workspace-conflict")).toHaveCount(0);
    await expect(page.locator(".save-status")).toContainText("Saved locally");
  });

  test("isolates bare demo runs but keeps same-run editing leases exclusive", async ({
    context,
    page,
  }) => {
    await openDemo(page);
    const originalRunId = currentDemoRunId(page);
    const originalRunUrl = page.url();
    await expect(page.locator(".workspace-conflict")).toHaveCount(0);
    await inspectorTab(page, "Facts").click();
    await page
      .getByRole("button", {
        name: /Vehicle A was leaving the roundabout when Vehicle B made contact/,
      })
      .click();
    await page.getByRole("button", { name: "Confirm as human-reviewed" }).click();
    await expect.poll(() => persistedCaseVersion(page, originalRunId)).toBe(3);

    const contender = await context.newPage();
    await contender.goto("/#demo");
    await expect(contender.locator("main.workspace")).toBeVisible();
    expect(currentDemoRunId(contender)).not.toBe(originalRunId);
    await expect(contender.locator(".workspace-conflict")).toHaveCount(0);
    await expect(contender.locator(".workspace-case-title")).toContainText("v1");

    await contender.goto(originalRunUrl);
    await expect(contender.locator("main.workspace")).toBeVisible();
    const conflict = contender.locator(".workspace-conflict");
    await expect(conflict).toContainText("Another page context still owns this case");
    await expect(conflict).toContainText("hidden or recently closed tab");

    await conflict.getByRole("button", { name: "Take over & reload" }).click();
    const takeover = contender.getByRole("alertdialog", { name: "Take over editing?" });
    await expect(takeover).toContainText("newest saved copy");
    await expect(takeover.getByRole("button", { name: "Cancel" })).toBeFocused();
    await takeover.getByRole("button", { name: "Take over & reload" }).click();
    await expect(contender.locator("main.workspace")).toBeVisible();
    await expect(contender.locator(".workspace-conflict")).toHaveCount(0);
    await expect(contender.locator(".save-status")).toContainText("Saved locally");
    await expect(contender.locator(".workspace-case-title")).toContainText("v3");
    await inspectorTab(contender, "Facts").click();
    await expect(contender.getByText("5 confirmed", { exact: true })).toBeVisible();

    await expect(page.locator(".workspace-conflict")).toContainText(
      "Another page context still owns this case",
    );
    await expect(page.getByRole("button", { name: "Take over & reload" })).toBeVisible();
  });
});
