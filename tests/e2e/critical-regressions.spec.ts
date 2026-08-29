/// <reference types="node" />

import { readFile } from "node:fs/promises";

import { expect, test, type Download, type Page } from "@playwright/test";

import {
  confirmStructuredCaseImport,
  currentDemoRunId,
  inspectorTab,
  installModelContextPolyfill,
  openDemo,
  openWebMCPInspector,
  waitForLocalSave,
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
  data?: unknown;
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
    data?: unknown;
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

async function writeUnannouncedConcurrentCaseVersion(
  page: Page,
  caseId: string,
  caseVersion: number,
): Promise<void> {
  await page.evaluate(
    ({ id, version }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("replay-local-vault-v2");
        open.onerror = () => reject(open.error ?? new Error("Could not open the local vault."));
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction("cases", "readwrite");
          const store = transaction.objectStore("cases");
          const get = store.get(id);
          get.onerror = () => reject(get.error ?? new Error("Could not read the local case."));
          get.onsuccess = () => {
            const record = get.result as
              | {
                  id: string;
                  updatedAt: string;
                  payload: Record<string, unknown>;
                  schemaVersion: number;
                  seedVersion?: number;
                }
              | undefined;
            if (!record) {
              reject(new Error("The durable case was not found."));
              return;
            }
            const updatedAt = "2026-08-29T23:59:59.000Z";
            store.put({
              ...record,
              updatedAt,
              payload: {
                ...record.payload,
                caseVersion: version,
                title: "Unannounced concurrent edit",
                updatedAt,
              },
            });
          };
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () =>
            reject(transaction.error ?? new Error("Could not write the concurrent case."));
        };
      }),
    { id: caseId, version: caseVersion },
  );
}

async function holdCaseStoreWriteQueue(page: Page, caseId: string): Promise<void> {
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const scopedWindow = window as Window & {
          __replayReleaseVaultGate?: boolean;
        };
        scopedWindow.__replayReleaseVaultGate = false;
        window.setTimeout(() => {
          scopedWindow.__replayReleaseVaultGate = true;
        }, 10_000);
        const open = indexedDB.open("replay-local-vault-v2");
        open.onerror = () => reject(open.error ?? new Error("Could not open the local vault."));
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction("cases", "readwrite");
          const store = transaction.objectStore("cases");
          let ready = false;
          const keepAlive = (): void => {
            const request = store.get(id);
            request.onerror = () =>
              reject(request.error ?? new Error("Could not hold the case write queue."));
            request.onsuccess = () => {
              if (!ready) {
                ready = true;
                resolve();
              }
              if (!scopedWindow.__replayReleaseVaultGate) keepAlive();
            };
          };
          transaction.oncomplete = () => database.close();
          transaction.onerror = () => {
            database.close();
            reject(transaction.error ?? new Error("The case write queue gate failed."));
          };
          keepAlive();
        };
      }),
    caseId,
  );
}

async function releaseCaseStoreWriteQueue(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scopedWindow = window as Window & {
      __replayReleaseVaultGate?: boolean;
    };
    scopedWindow.__replayReleaseVaultGate = true;
  });
}

test.describe("production-critical regressions", () => {
  test("explains why report review adds one contextual Site Tool", async ({ page }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);
    const status = page.locator("button.webmcp-status");

    await expect(status).toContainText("18 registered", { timeout: 10_000 });
    await expect(status).toHaveAttribute(
      "title",
      /Opening a report preview makes one contextual report note tool eligible/,
    );

    const result = await invokeSiteTool(page, "build_report_preview", { expectedVersion: 1 });
    expect(result).toMatchObject({ ok: true, caseVersion: 1 });
    await expect(status).toContainText("19 registered", { timeout: 10_000 });
    const registrationAudit = await page.evaluate(() =>
      structuredClone(
        (
          window as unknown as Window & {
            __replayWebMCPRegistrationAudit: { calls: string[]; aborted: string[] };
          }
        ).__replayWebMCPRegistrationAudit,
      ),
    );
    expect(registrationAudit.calls).toHaveLength(19);
    expect(registrationAudit.calls.at(-1)).toBe("add_report_note");
    expect(registrationAudit.aborted).toEqual([]);
    await expect(status).toHaveAttribute(
      "title",
      /includes the contextual report note tool because a report preview is open/,
    );
  });

  test("previews coordinated agent geometry and requires human acceptance", async ({ page }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);
    const vehicleA = page.getByRole("button", { name: /^Vehicle A, position/ });
    await expect(vehicleA).toHaveAttribute("transform", "translate(280 350)");
    const workspace = await invokeSiteTool(page, "get_workspace_state", {
      sections: ["scene"],
    });
    const scene = workspace.data as { scene: { branchId: string; playheadTimeMs: number } };

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
      expectedPoseTarget: {
        branchId: scene.scene.branchId,
        playheadTimeMs: scene.scene.playheadTimeMs,
      },
      expectedVersion: workspace.caseVersion,
      requestId: "request-proposal-e2e-0001",
    });

    expect(proposal).toMatchObject({ ok: true });
    const proposalHeading = page.getByRole("heading", { name: "1 change set awaiting you" });
    await expect(proposalHeading).toBeVisible();
    await expect(proposalHeading).toBeInViewport();
    await expect(page.locator(".proposal-scene-actor")).toHaveCount(2);
    const proposalCard = page.locator(".proposal-card");
    await expect(proposalCard).toContainText(
      "Review only. The authored baseline stays unchanged until you accept every target together.",
    );
    await expect(proposalCard.locator("details.proposal-exact-editor")).not.toHaveAttribute(
      "open",
      /.*/,
    );
    await proposalCard.locator("details.proposal-exact-editor").click();
    const adjustedVehicleAX = proposalCard.getByRole("spinbutton", { name: "X" }).first();
    await adjustedVehicleAX.fill("63.4");
    await expect(proposalCard).toContainText(
      "Unsaved exact edits will be saved before the acceptance review.",
    );
    const acceptProposal = proposalCard.getByRole("button", { name: "Accept and apply" });
    await expect(acceptProposal).toBeInViewport();
    await acceptProposal.click();
    const confirmation = page.getByRole("alertdialog", { name: "Apply this proposal?" });
    await confirmation.getByRole("button", { name: "Accept and apply" }).click();

    await expect(page.locator(".proposal-scene-actor")).toHaveCount(0);
    await expect(vehicleA).toHaveAttribute("transform", "translate(634 329)");
    await expect(page.locator(".trajectory.is-accepted-agent-proposal")).toHaveCount(2);
    await expect(page.locator(".trajectory.is-unverified-imported-proposal")).toHaveCount(0);
    const appliedScene = await invokeSiteTool(page, "get_workspace_state", {
      sections: ["scene"],
    });
    const actors = (
      appliedScene.data as { scene: { actors: Array<{ id: string; pose: { x: number } }> } }
    ).scene.actors;
    expect(actors.find((actor) => actor.id === "actor-vehicle-a")?.pose.x).toBe(0.634);
    const proposalHistory = page.getByText("Recent proposal decisions · showing newest 1 of 1");
    await expect(proposalHistory).toBeFocused();
    await proposalHistory.click();
    await expect(page.locator(".proposal-history")).toContainText(
      "accepted · local human decision",
    );
    await expect(
      page
        .locator(".activity-item__summary")
        .filter({ hasText: "Human accepted agent proposal: Test two-vehicle alignment." }),
    ).toBeVisible();

    await waitForLocalSave(page);
    await page.reload();
    await expect(page.locator("main.workspace")).toBeVisible();
    await expect(page.locator(".trajectory.is-accepted-agent-proposal")).toHaveCount(2);
    await expect(page.locator(".trajectory.is-unverified-imported-proposal")).toHaveCount(0);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await openCaseOptions(page);
        await page.getByRole("button", { name: "Export structured case JSON" }).click();
      })(),
    ]);
    await page.getByLabel("Import case JSON").setInputFiles({
      name: "accepted-proposal-transfer.replay.json",
      mimeType: "application/json",
      buffer: await downloadedBytes(download),
    });
    await confirmStructuredCaseImport(page);

    await expect(page.locator(".trajectory.is-accepted-agent-proposal")).toHaveCount(0);
    await expect(page.locator(".trajectory.is-unverified-imported-proposal")).toHaveCount(2);
    await expect(page.locator(".scene-legend")).toContainText(
      "Unverified imported proposal geometry",
    );
    const importedVehicleAPath = page.getByRole("button", {
      name: /Select unverified imported proposal path for Vehicle A/,
    });
    await importedVehicleAPath.focus();
    await importedVehicleAPath.press("Enter");
    await expect(page.locator(".provenance-chip.is-unverified")).toContainText(
      "Unverified imported proposal geometry",
    );
    await page.getByText("Recent proposal decisions · showing newest 1 of 1").click();
    await expect(page.locator(".proposal-history")).toContainText(
      "accepted · unverified imported decision",
    );
  });

  test("preserves every untouched proposal coordinate when one exact field is adjusted", async ({
    page,
  }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);
    const workspace = await invokeSiteTool(page, "get_workspace_state", { sections: ["scene"] });
    type ProjectedKeyframe = {
      id: string;
      timeMs: number;
      x: number;
      y: number;
      rotationDeg: number;
    };
    type ProjectedTrajectory = {
      id: string;
      actorId: string;
      branchId: string;
      keyframes: ProjectedKeyframe[];
    };
    type ProjectedProposalChange = {
      kind: "trajectory-set";
      actorId: string;
      proposedTrajectory: { keyframes: ProjectedKeyframe[]; visible: boolean };
    };
    const scene = workspace.data as {
      scene: {
        branchId: string;
        playheadTimeMs: number;
        trajectories: ProjectedTrajectory[];
      };
    };
    const trajectories = scene.scene.trajectories;
    const trajectoryFor = (actorId: string) => {
      const trajectory = trajectories.find((candidate) => candidate.actorId === actorId);
      const keyframe = trajectory?.keyframes.find((candidate) => candidate.timeMs === 8_000);
      if (!trajectory || !keyframe) throw new Error(`Missing 8 s path point for ${actorId}.`);
      return { trajectory, keyframe };
    };
    const vehicleA = trajectoryFor("actor-vehicle-a");
    const vehicleB = trajectoryFor("actor-vehicle-b");
    await invokeSiteTool(page, "propose_scene_changes", {
      title: "Exact proposal adjustment regression",
      rationale: "Keep every unedited path value exact while a person adjusts one rotation.",
      changes: [
        {
          kind: "trajectory-keyframe-patch",
          actorId: vehicleA.trajectory.actorId,
          branchId: vehicleA.trajectory.branchId,
          adjustments: [{ keyframeId: vehicleA.keyframe.id, y: vehicleA.keyframe.y + 0.008 }],
        },
        {
          kind: "trajectory-keyframe-patch",
          actorId: vehicleB.trajectory.actorId,
          branchId: vehicleB.trajectory.branchId,
          adjustments: [{ keyframeId: vehicleB.keyframe.id, y: vehicleB.keyframe.y - 0.008 }],
        },
      ],
      expectedPoseTarget: {
        branchId: scene.scene.branchId,
        playheadTimeMs: scene.scene.playheadTimeMs,
      },
      expectedVersion: workspace.caseVersion,
      requestId: "request-proposal-precision-e2e-0001",
    });

    const readProposedChanges = async () => {
      const result = await invokeSiteTool(page, "get_workspace_state", {
        sections: ["hypotheses"],
      });
      const proposals = (
        result.data as {
          hypotheses: {
            proposals: Array<{
              status: string;
              revisions: Array<{ changes: ProjectedProposalChange[] }>;
            }>;
          };
        }
      ).hypotheses.proposals;
      const proposal = proposals.find((candidate) => candidate.status === "pending");
      const changes = proposal?.revisions.at(-1)?.changes;
      if (!changes) throw new Error("The pending proposal projection is unavailable.");
      return changes;
    };
    const beforeChanges = await readProposedChanges();
    const beforeVehicleA = beforeChanges.find((change) => change.actorId === "actor-vehicle-a");
    const beforeVehicleB = beforeChanges.find((change) => change.actorId === "actor-vehicle-b");
    if (!beforeVehicleA || !beforeVehicleB) throw new Error("The proposal targets are incomplete.");

    const proposalCard = page.locator(".proposal-card");
    const vehicleATarget = proposalCard.getByRole("button", {
      name: /Vehicle A proposal details/,
    });
    const vehicleBTarget = proposalCard.getByRole("button", {
      name: /Vehicle B proposal details/,
    });
    await expect(vehicleATarget).toHaveAttribute("aria-expanded", "true");
    await expect(vehicleBTarget).toHaveAttribute("aria-expanded", "false");
    await expect(vehicleATarget).toBeInViewport();
    await expect(vehicleBTarget).toBeInViewport();
    await expect(proposalCard.locator(".proposal-target__details")).toHaveCount(1);

    await vehicleBTarget.focus();
    await vehicleBTarget.press("Enter");
    await expect(vehicleATarget).toHaveAttribute("aria-expanded", "false");
    await expect(vehicleBTarget).toHaveAttribute("aria-expanded", "true");
    await expect(proposalCard.locator(".proposal-target__details")).toHaveCount(1);

    await vehicleATarget.focus();
    await vehicleATarget.press("Space");
    await expect(vehicleATarget).toHaveAttribute("aria-expanded", "true");
    await expect(vehicleBTarget).toHaveAttribute("aria-expanded", "false");
    await proposalCard.locator("details.proposal-exact-editor").click();
    const vehicleAEditor = proposalCard
      .locator("fieldset.proposal-change")
      .filter({ hasText: "Vehicle A · proposed path" });
    const frames = vehicleAEditor.locator(".proposal-keyframe");
    await expect(frames.first()).toContainText("Start");
    await expect(frames.last()).toContainText("Final");
    let eightSecondFrame = frames.first();
    for (let index = 0; index < (await frames.count()); index += 1) {
      const candidate = frames.nth(index);
      if ((await candidate.getByLabel("Time ms").inputValue()) === "8000") {
        eightSecondFrame = candidate;
        break;
      }
    }
    await expect(eightSecondFrame.getByLabel("Time ms")).toHaveAttribute("min", "0");
    await expect(eightSecondFrame.getByLabel("Time ms")).toHaveAttribute("max", "31536000000");
    await expect(eightSecondFrame.getByLabel("Time ms")).toHaveAttribute("step", "any");
    await expect(eightSecondFrame.getByLabel("X")).toHaveAttribute("min", "-1000000");
    await expect(eightSecondFrame.getByLabel("X")).toHaveAttribute("max", "1000000");
    const rotation = eightSecondFrame.getByLabel("Angle °");
    await expect(rotation).toHaveAttribute("min", "-1000000");
    await expect(rotation).toHaveAttribute("max", "1000000");
    const adjustedRotation = Number(await rotation.inputValue()) + 0.25;
    await rotation.fill(String(adjustedRotation));
    await proposalCard.getByRole("button", { name: "Save adjustment" }).click();
    await expect(proposalCard).toContainText("Revision 2 · human");

    const afterChanges = await readProposedChanges();
    const afterVehicleA = afterChanges.find((change) => change.actorId === "actor-vehicle-a");
    const afterVehicleB = afterChanges.find((change) => change.actorId === "actor-vehicle-b");
    if (!afterVehicleA || !afterVehicleB) throw new Error("The adjusted targets are incomplete.");
    expect(afterVehicleB.proposedTrajectory).toEqual(beforeVehicleB.proposedTrajectory);
    const beforeTarget = beforeVehicleA.proposedTrajectory.keyframes.find(
      (keyframe) => keyframe.id === vehicleA.keyframe.id,
    );
    const afterTarget = afterVehicleA.proposedTrajectory.keyframes.find(
      (keyframe) => keyframe.id === vehicleA.keyframe.id,
    );
    if (!beforeTarget || !afterTarget) throw new Error("The adjusted keyframe is unavailable.");
    expect(afterTarget).toEqual({ ...beforeTarget, rotationDeg: adjustedRotation });
    expect(
      afterVehicleA.proposedTrajectory.keyframes.filter(
        (keyframe) => keyframe.id !== vehicleA.keyframe.id,
      ),
    ).toEqual(
      beforeVehicleA.proposedTrajectory.keyframes.filter(
        (keyframe) => keyframe.id !== vehicleA.keyframe.id,
      ),
    );
  });

  test("keeps a mixed pose proposal bound to its reviewed time after an exact path edit", async ({
    page,
  }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);
    await page.getByRole("slider", { name: "Timeline position" }).fill("7000");
    const workspace = await invokeSiteTool(page, "get_workspace_state", { sections: ["scene"] });
    type ProjectedKeyframe = {
      id: string;
      timeMs: number;
      x: number;
      y: number;
      rotationDeg: number;
    };
    type ProjectedTrajectory = {
      id: string;
      actorId: string;
      branchId: string;
      keyframes: ProjectedKeyframe[];
    };
    type ProjectedPoseChange = {
      kind: "actor-pose";
      actorId: string;
      branchId?: string;
      targetTimeMs?: number;
      proposedPose: { x: number; y: number; rotationDeg: number };
    };
    type ProjectedPathChange = {
      kind: "trajectory-set";
      actorId: string;
      proposedTrajectory: { keyframes: ProjectedKeyframe[]; visible: boolean };
    };
    type ProjectedProposalChange = ProjectedPoseChange | ProjectedPathChange;
    const trajectories = (workspace.data as { scene: { trajectories: ProjectedTrajectory[] } })
      .scene.trajectories;
    const vehicleBTrajectory = trajectories.find(
      (trajectory) => trajectory.actorId === "actor-vehicle-b",
    );
    const vehicleBFrame = vehicleBTrajectory?.keyframes.find(
      (keyframe) => keyframe.timeMs === 8_000,
    );
    if (!vehicleBTrajectory || !vehicleBFrame) {
      throw new Error("Vehicle B's 8 s path point is unavailable.");
    }

    await invokeSiteTool(page, "propose_scene_changes", {
      title: "Mixed exact adjustment binding",
      rationale: "Keep the reviewed pose binding while a person adjusts the accompanying path.",
      changes: [
        {
          kind: "actor-pose",
          actorId: "actor-vehicle-a",
          proposedPose: { x: 0.61, y: 0.47, rotationDeg: 8.125 },
        },
        {
          kind: "trajectory-keyframe-patch",
          actorId: vehicleBTrajectory.actorId,
          branchId: vehicleBTrajectory.branchId,
          adjustments: [{ keyframeId: vehicleBFrame.id, y: vehicleBFrame.y - 0.008 }],
        },
      ],
      expectedPoseTarget: {
        branchId: vehicleBTrajectory.branchId,
        playheadTimeMs: 7_000,
      },
      expectedVersion: workspace.caseVersion,
      requestId: "request-proposal-mixed-binding-e2e-0001",
    });

    const readChanges = async (): Promise<ProjectedProposalChange[]> => {
      const result = await invokeSiteTool(page, "get_workspace_state", {
        sections: ["hypotheses"],
      });
      const pending = (
        result.data as {
          hypotheses: {
            proposals: Array<{
              status: string;
              revisions: Array<{ changes: ProjectedProposalChange[] }>;
            }>;
          };
        }
      ).hypotheses.proposals.find((proposal) => proposal.status === "pending");
      const changes = pending?.revisions.at(-1)?.changes;
      if (!changes) throw new Error("The pending mixed proposal is unavailable.");
      return changes;
    };
    const beforeChanges = await readChanges();
    const beforePose = beforeChanges.find(
      (change): change is ProjectedPoseChange => change.kind === "actor-pose",
    );
    const beforePath = beforeChanges.find(
      (change): change is ProjectedPathChange => change.kind === "trajectory-set",
    );
    if (!beforePose || !beforePath) throw new Error("The mixed proposal targets are incomplete.");
    expect(beforePose).toMatchObject({
      branchId: vehicleBTrajectory.branchId,
      targetTimeMs: 7_000,
    });
    const poseBindingBytes = JSON.stringify({
      actorId: beforePose.actorId,
      branchId: beforePose.branchId,
      targetTimeMs: beforePose.targetTimeMs,
      proposedPose: beforePose.proposedPose,
    });

    await page.getByRole("slider", { name: "Timeline position" }).fill("12000");
    const proposalCard = page.locator(".proposal-card");
    await proposalCard.locator("details.proposal-exact-editor").click();
    const poseEditor = proposalCard
      .locator("fieldset.proposal-change")
      .filter({ hasText: "Vehicle A · proposed pose" });
    await expect(poseEditor.getByLabel("X")).toHaveAttribute("min", "-1000000");
    await expect(poseEditor.getByLabel("X")).toHaveAttribute("max", "1000000");
    await expect(poseEditor.getByLabel("Angle °")).toHaveAttribute("min", "-1000000");
    await expect(poseEditor.getByLabel("Angle °")).toHaveAttribute("max", "1000000");
    const pathEditor = proposalCard
      .locator("fieldset.proposal-change")
      .filter({ hasText: "Vehicle B · proposed path" });
    const frames = pathEditor.locator(".proposal-keyframe");
    let targetFrame = frames.first();
    for (let index = 0; index < (await frames.count()); index += 1) {
      const candidate = frames.nth(index);
      if ((await candidate.getByLabel("Time ms").inputValue()) === "8000") {
        targetFrame = candidate;
        break;
      }
    }
    const rotation = targetFrame.getByLabel("Angle °");
    const adjustedRotation = Number(await rotation.inputValue()) + 0.125;
    await rotation.fill(String(adjustedRotation));
    await proposalCard.getByRole("button", { name: "Save adjustment" }).click();
    await expect(proposalCard).toContainText("Revision 2 · human");

    const afterChanges = await readChanges();
    const afterPose = afterChanges.find(
      (change): change is ProjectedPoseChange => change.kind === "actor-pose",
    );
    const afterPath = afterChanges.find(
      (change): change is ProjectedPathChange => change.kind === "trajectory-set",
    );
    if (!afterPose || !afterPath) throw new Error("The adjusted mixed proposal is incomplete.");
    expect(
      JSON.stringify({
        actorId: afterPose.actorId,
        branchId: afterPose.branchId,
        targetTimeMs: afterPose.targetTimeMs,
        proposedPose: afterPose.proposedPose,
      }),
    ).toBe(poseBindingBytes);
    const expectedPath = structuredClone(beforePath.proposedTrajectory);
    const expectedFrame = expectedPath.keyframes.find(
      (keyframe) => keyframe.id === vehicleBFrame.id,
    );
    if (!expectedFrame) throw new Error("The expected Vehicle B point is unavailable.");
    expectedFrame.rotationDeg = adjustedRotation;
    expect(JSON.stringify(afterPath.proposedTrajectory)).toBe(JSON.stringify(expectedPath));
  });

  test("reveals the reviewed proposal point in the compact scene with reduced motion", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installModelContextPolyfill(page);
    await openDemo(page);
    const workspace = await invokeSiteTool(page, "get_workspace_state", { sections: ["scene"] });
    type ProjectedTrajectory = {
      id: string;
      actorId: string;
      branchId: string;
      keyframes: Array<{ id: string; timeMs: number; y: number }>;
    };
    const trajectories = (workspace.data as { scene: { trajectories: ProjectedTrajectory[] } })
      .scene.trajectories;
    const targetFor = (actorId: string) => {
      const trajectory = trajectories.find((candidate) => candidate.actorId === actorId);
      const frame = trajectory?.keyframes.find((keyframe) => keyframe.timeMs === 8_000);
      if (!trajectory || !frame) throw new Error(`${actorId}'s 8 s path point is unavailable.`);
      return { trajectory, frame };
    };
    const vehicleA = targetFor("actor-vehicle-a");
    const vehicleB = targetFor("actor-vehicle-b");
    await invokeSiteTool(page, "propose_scene_changes", {
      title: "Compact proposal review",
      rationale: "Bring the selected proposal point into view on a compact screen.",
      changes: [
        {
          kind: "trajectory-keyframe-patch",
          actorId: vehicleA.trajectory.actorId,
          branchId: vehicleA.trajectory.branchId,
          adjustments: [{ keyframeId: vehicleA.frame.id, y: vehicleA.frame.y + 0.008 }],
        },
        {
          kind: "trajectory-keyframe-patch",
          actorId: vehicleB.trajectory.actorId,
          branchId: vehicleB.trajectory.branchId,
          adjustments: [{ keyframeId: vehicleB.frame.id, y: vehicleB.frame.y - 0.008 }],
        },
      ],
      expectedVersion: workspace.caseVersion,
      requestId: "request-proposal-compact-review-e2e-0001",
    });

    const reviewPoint = page.getByRole("button", {
      name: /Review Vehicle A proposal at 8\.000 s/,
    });
    await expect(reviewPoint).toBeInViewport();
    const scrollBeforeReview = await page.evaluate(() => window.scrollY);
    await reviewPoint.click();
    const scene = page.getByRole("region", { name: "Incident scene editor" });
    await expect(scene).toBeInViewport();
    await expect(page.getByTestId("proposal-scene-review")).toBeInViewport();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(scrollBeforeReview);
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
    });
    expect(focused.caseVersion).toBe(validation.caseVersion);
    expect(focused).not.toHaveProperty("activityId");
    expect(focused).toMatchObject({
      ok: true,
      affectedIds: issue.affectedIds,
      visibleState: { workspaceMode: "report" },
    });
    await expect(inspectorTab(page, "Report")).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".issue-row.is-focused")).toContainText(issue.title);

    await inspectorTab(page, "Facts").click();
    const visibleAfterTabChange = await invokeSiteTool(page, "get_workspace_state", {
      sections: ["selection"],
    });
    expect(visibleAfterTabChange).toMatchObject({
      ok: true,
      visibleState: { workspaceMode: "facts" },
      data: {},
    });
    expect(visibleAfterTabChange.visibleState).not.toHaveProperty("selectedItemId");

    const sessionLane = page.getByRole("region", { name: "Site Tool calls" });
    await expect(sessionLane).toContainText("Session only");
    await expect(sessionLane).toContainText("No case change · observed v1");
    await expect(sessionLane).toContainText("Ran get workspace state");
    await expect(page.getByRole("region", { name: "Case changes" })).not.toContainText(
      "Ran get workspace state",
    );
  });

  test("a damage relation focuses the marker's owning vehicle", async ({ page }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);
    const summary = await invokeSiteTool(page, "get_case_summary", {});
    const created = await invokeSiteTool(page, "create_open_question", {
      question: "Does the recorded front-left damage need another source photograph?",
      reason: "Keep the damage record connected to the vehicle a human should inspect.",
      importance: "medium",
      relatedIds: ["damage-a-front-left"],
      expectedVersion: summary.caseVersion,
      requestId: "e2e-damage-relation-owner-0001",
    });
    expect(created.ok).toBe(true);

    await inspectorTab(page, "Questions").click();
    const questionCard = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: "Does the recorded front-left damage need another source photograph?",
      }),
    });
    const relation = questionCard.getByRole("button", {
      name: "Damage · Vehicle A · front left",
    });
    await expect(relation).toBeVisible();
    await relation.click();

    await expect(page.getByRole("region", { name: "Vehicle A" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Vehicle A, position/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("switching workspaces clears an incompatible scene selection", async ({ page }) => {
    await openDemo(page);

    await page.getByRole("button", { name: /Approximate impact at 10\.0 seconds/ }).click();
    await expect(page.getByText("Selected timeline event")).toBeVisible();

    await inspectorTab(page, "Report").click();
    await expect(page.getByRole("heading", { name: "Report", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Build report preview" })).toBeVisible();
    await expect(page.getByText("Selected timeline event")).toHaveCount(0);
  });

  test("keeps the original agent mutation beside an explicit human override", async ({ page }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);

    const statement = "Vehicle B may have moved outward before contact.";
    await runSiteTool(page, "add_observation", {
      statement,
      sourceType: "agent-inference",
      sourceIds: [],
      relatedIds: [],
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
    const sourceUrl = page.url();
    const [sourceDownload] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await openCaseOptions(page);
        await page.getByRole("button", { name: "Export structured case JSON" }).click();
      })(),
    ]);
    const source = await downloadedBytes(sourceDownload);

    await openCaseOptions(page);
    const caseOptions = page.getByLabel("Case options");
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import structured case JSON" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "roundabout-transfer.replay.json",
      mimeType: "application/json",
      buffer: source,
    });
    const review = page.getByRole("alertdialog", { name: "Review this structured transfer" });
    await expect(review).toBeVisible();
    await expect(review).toContainText("The current case stays saved and available.");
    await expect(review.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(review).toHaveCount(0);
    await expect(caseOptions).toBeFocused();
    await expect(page).toHaveURL(sourceUrl);
    expect(currentDemoRunId(page)).toBe(sourceCaseId);
    await expect(page.locator(".workspace-case-title")).toContainText(
      "Roundabout incident — 17:42",
    );

    await page.getByLabel("Import case JSON").setInputFiles({
      name: "roundabout-transfer.replay.json",
      mimeType: "application/json",
      buffer: source,
    });
    await confirmStructuredCaseImport(page);
    await expect(page).toHaveURL(/#case\/case-import-/);
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

  test("exports a parseable finalized case and a non-empty PDF", async ({ page }, testInfo) => {
    test.slow();
    await installModelContextPolyfill(page);
    await openDemo(page);
    const demoRunId = currentDemoRunId(page);
    const siteToolsStatus = page.locator("button.webmcp-status");
    await expect(siteToolsStatus).toContainText("18 registered", { timeout: 10_000 });
    await inspectorTab(page, "Report").click();
    await page.getByRole("button", { name: "Build report preview" }).click();
    await expect(siteToolsStatus).toContainText("19 registered", { timeout: 10_000 });

    await page.getByRole("button", { name: "Review and finalize" }).click();
    const review = page.getByRole("dialog", { name: "Review before finalizing" });
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

    await expect(siteToolsStatus).toContainText("18 registered", { timeout: 10_000 });
    await expect(siteToolsStatus).toHaveAttribute(
      "title",
      /Historical report snapshots are immutable/,
    );
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const modelContext = (
            document as Document & {
              modelContext?: { getTools(): Promise<Array<{ name: string }>> };
            }
          ).modelContext;
          return (await modelContext?.getTools())?.some((tool) => tool.name === "add_report_note");
        }),
      )
      .toBe(false);

    await expect(page.locator(".activity-list")).toContainText(
      "Human finalized an immutable factual report snapshot.",
    );
    await expect(page.getByText(/JSON transfer contains structured case data only/)).toBeVisible();

    const [jsonDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "JSON transfer", exact: true }).click(),
    ]);
    expect(jsonDownload.suggestedFilename()).toMatch(/\.replay\.json$/);
    const json = await downloadedBytes(jsonDownload);
    await testInfo.attach("finalized-case.replay.json", {
      body: json,
      contentType: "application/json",
    });
    const exported = JSON.parse(json.toString("utf8")) as {
      id: string;
      schemaVersion: number;
      caseVersion: number;
      reportSnapshots: Array<{
        id: string;
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

    const snapshotId = exported.reportSnapshots[0]?.id;
    expect(snapshotId).toBeTruthy();
    if (!snapshotId) throw new Error("The finalized snapshot ID was not exported.");
    await waitForLocalSave(page);
    await page.reload();
    await expect(page.locator("main.workspace")).toBeVisible();
    await inspectorTab(page, "Report").click();
    await expect(page.getByRole("heading", { name: "Finalized snapshot history" })).toBeVisible();
    const historyItem = page.getByRole("listitem").filter({ hasText: snapshotId });
    await expect(historyItem).toContainText("reviewed v1");
    await historyItem
      .getByRole("button", { name: `Open finalized snapshot ${snapshotId}` })
      .click();
    await expect(page.locator(".report-preview__status")).toContainText(
      "Finalized immutable snapshot",
    );
    await expect(page.locator(".report-preview__status")).toContainText(snapshotId);
    const reportPanel = page.getByRole("tabpanel", { name: "Report" });
    await expect(
      reportPanel.getByRole("note").filter({ hasText: "Historical snapshot view" }),
    ).toContainText("Historical snapshot view");
    await expect(page.getByText("Add a review note", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Run consistency check" })).toHaveCount(0);
    await expect(page.locator(".snapshot-export-note")).toContainText(
      "The live scene is intentionally excluded",
    );

    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PDF snapshot", exact: true }).click(),
    ]);
    expect(pdfDownload.suggestedFilename()).toContain(`-finalized-${snapshotId}.pdf`);
    const pdf = await downloadedBytes(pdfDownload);
    await testInfo.attach("finalized-factual-report.pdf", {
      body: pdf,
      contentType: "application/pdf",
    });
    expect(pdf.byteLength).toBeGreaterThan(1_000);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const pdfStructure = pdf.toString("latin1");
    expect(pdfStructure).toMatch(/\/Type\s*\/Page\b/);
    expect(pdfStructure).toContain("startxref");
    expect(pdfStructure.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  test("exports self-contained scene SVG and PNG under the production preview CSP", async ({
    page,
  }) => {
    test.slow();
    const response = await page.request.get("/");
    expect(response.headers()["content-security-policy"]).toContain("connect-src 'self'");

    await openDemo(page);
    await inspectorTab(page, "Report").click();
    const [svgDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "SVG", exact: true }).click(),
    ]);
    const svg = (await downloadedBytes(svgDownload)).toString("utf8");
    expect(svgDownload.suggestedFilename()).toMatch(/-scene\.svg$/);
    expect(svg).toContain('role="img"');
    expect(svg).not.toContain('role="application"');
    expect(svg).not.toContain('role="button"');
    expect(svg).not.toContain("tabindex=");
    expect(svg).toContain('data-replay-export-context="review-snapshot"');
    expect(svg).toContain("REVIEW SNAPSHOT");
    expect(svg).toContain("Not a simulation or proof of physical contact");
    expect(svg).toContain('viewBox="0 0 1000 800"');
    expect(svg).not.toContain("is-selected");
    expect(svg).not.toContain("vehicle-rotation-control");
    expect(svg).not.toContain("trajectory__handle");
    expect(svg).toMatch(/class="roundabout-island"[^>]*style="[^"]*fill:/);
    expect(svg).toMatch(/class="vehicle-window"[^>]*style="[^"]*fill:/);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PNG", exact: true }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/-scene\.png$/);
    const png = await downloadedBytes(download);
    expect(png.byteLength).toBeGreaterThan(1_000);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  test("blocks human and Site Tool mutations after a save failure until retry succeeds", async ({
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
      sourceIds: [],
      relatedIds: [],
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
    const form = page.locator("form.inline-form").filter({
      has: page.getByRole("button", { name: "Add observation", exact: true }),
    });
    const observationDraft = form.getByRole("textbox", { name: "Observation", exact: true });
    const claims = page.getByRole("list", { name: "Claims" });
    const activity = page.getByLabel("Case activity");
    await observationDraft.fill("This human mutation must remain blocked.");
    await form.getByRole("button", { name: "Add observation" }).click();
    await expect(form).toBeVisible();
    await expect(observationDraft).toHaveValue("This human mutation must remain blocked.");
    await expect(page.locator(".workspace-case-title")).toContainText("v2");
    await expect(claims).not.toContainText("This human mutation must remain blocked.");
    await expect(activity).not.toContainText("This human mutation must remain blocked.");

    const [structuredTransfer] = await Promise.all([
      page.waitForEvent("download"),
      saveFailure.getByRole("button", { name: "Download structured transfer" }).click(),
    ]);
    expect(structuredTransfer.suggestedFilename()).toMatch(/\.replay\.json$/);
    await expect(
      page.getByText(/Downloaded a structured case transfer for case version 2/),
    ).toBeVisible();
    await expect(page.getByText(/excludes evidence bytes/)).toBeVisible();
    await expect(saveFailure).toContainText("Local save failed. Editing is paused.");

    const stillBlockedTool = await invokeSiteTool(page, "add_observation", {
      statement: "The structured transfer must not unlock Site Tools.",
      sourceType: "agent-inference",
      sourceIds: [],
      relatedIds: [],
      status: "agent-hypothesis",
      sharedAcrossBranches: true,
      expectedVersion: 2,
      requestId: "e2e-blocked-after-structured-transfer",
    });
    expect(stillBlockedTool).toMatchObject({ ok: false, caseVersion: 2 });

    await expect(form).toBeVisible();
    await observationDraft.fill("Structured-transfer human observation.");
    await form.getByRole("button", { name: "Add observation" }).click();
    await expect(form).toBeVisible();
    await expect(observationDraft).toHaveValue("Structured-transfer human observation.");
    await expect(claims).not.toContainText("Structured-transfer human observation.");
    await expect(activity).not.toContainText("Structured-transfer human observation.");
    await expect(page.locator(".workspace-case-title")).toContainText("v2");

    await restoreCaseMetadataWrites(page);
    await saveFailure.getByRole("button", { name: "Retry local save" }).click();
    await expect(saveFailure).toHaveCount(0);
    await expect(page.locator(".save-status")).toContainText("Saved locally");
    await expect.poll(() => persistedCaseVersion(page)).toBe(2);
  });

  test("keeps the workspace open when Home races a failed queued save", async ({ page }) => {
    await openDemo(page);
    const caseId = currentDemoRunId(page);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(1);
    await failCaseMetadataWrites(page);

    await inspectorTab(page, "Facts").click();
    await page
      .getByRole("list", { name: "Claims" })
      .getByRole("button", {
        name: /Vehicle A was leaving the roundabout when Vehicle B made contact/,
      })
      .click();
    await page.evaluate(() => {
      const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent.includes("Confirm as human-reviewed"),
      );
      const home = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Back to REPLAY home"]',
      );
      if (!confirm || !home) throw new Error("The confirmation or Home control is missing.");
      confirm.click();
      home.click();
    });

    await expect(page.locator("main.workspace")).toBeVisible();
    await expect(page.locator(".workspace-case-title")).toContainText("v2");
    const saveFailure = page.locator(".workspace-save-failure");
    await expect(saveFailure).toContainText("Local save failed. Editing is paused.");
    await expect(
      page.getByText(/workspace stayed open because the current case is not safely stored/i),
    ).toBeVisible();
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(1);

    await restoreCaseMetadataWrites(page);
    await saveFailure.getByRole("button", { name: "Retry local save" }).click();
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(2);
    await page.getByRole("button", { name: "Back to REPLAY home" }).click();
    await expect(page.locator("main.workspace")).toHaveCount(0);
    await page.getByRole("button", { name: /Open local case:/ }).click();
    await expect(page.locator(".workspace-case-title")).toContainText("v2");
  });

  test("cancels browser Back when the current revision fails to save", async ({ page }) => {
    await openDemo(page);
    const caseId = currentDemoRunId(page);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(1);
    await failCaseMetadataWrites(page);

    await inspectorTab(page, "Facts").click();
    await page
      .getByRole("list", { name: "Claims" })
      .getByRole("button", {
        name: /Vehicle A was leaving the roundabout when Vehicle B made contact/,
      })
      .click();
    await page.evaluate(() => {
      const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent.includes("Confirm as human-reviewed"),
      );
      if (!confirm) throw new Error("The confirmation control is missing.");
      confirm.click();
      window.history.back();
    });

    await expect(page.locator("main.workspace")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#case/${caseId}$`));
    await expect(page.locator(".workspace-case-title")).toContainText("v2");
    const saveFailure = page.locator(".workspace-save-failure");
    await expect(saveFailure).toContainText("Local save failed. Editing is paused.");
    await expect(
      page.getByText(/Navigation was cancelled because the current case is not safely stored/i),
    ).toBeVisible();
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(1);

    await restoreCaseMetadataWrites(page);
    await saveFailure.getByRole("button", { name: "Retry local save" }).click();
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(2);
    await page.goBack();
    await expect(
      page.getByRole("heading", {
        name: "A shared black box for incidents that did not have one.",
      }),
    ).toBeVisible();
  });

  test("retries a failed queued save with CAS instead of overwriting an unseen newer version", async ({
    page,
  }) => {
    await openDemo(page);
    const caseId = currentDemoRunId(page);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(1);
    await inspectorTab(page, "Facts").click();
    await page
      .getByRole("button", {
        name: /Vehicle A was leaving the roundabout when Vehicle B made contact/,
      })
      .click();
    await failCaseMetadataWrites(page);

    await page.evaluate(async () => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
      const confirm = buttons.find((button) =>
        button.textContent.includes("Confirm as human-reviewed"),
      );
      if (!confirm) throw new Error("The claim confirmation control was not found.");
      confirm.click();
      await Promise.resolve();
      const undo = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.title === "Undo",
      );
      if (!undo || undo.disabled) throw new Error("Undo was not ready for the queued edit.");
      undo.click();
    });

    const saveFailure = page.locator(".workspace-save-failure");
    await expect(saveFailure).toContainText("Local save failed. Editing is paused.");
    await expect(page.locator(".workspace-case-title")).toContainText("v3");

    await restoreCaseMetadataWrites(page);
    await writeUnannouncedConcurrentCaseVersion(page, caseId, 2);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(2);
    await saveFailure.getByRole("button", { name: "Retry local save" }).click();

    await expect(page.locator(".workspace-conflict")).toContainText(
      "Another REPLAY page saved case version 2",
    );
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(2);
  });

  test("freezes later queued revisions after the first CAS conflict", async ({ page }) => {
    await openDemo(page);
    const caseId = currentDemoRunId(page);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(1);
    await inspectorTab(page, "Facts").click();
    await page
      .getByRole("button", {
        name: /Vehicle A was leaving the roundabout when Vehicle B made contact/,
      })
      .click();

    await writeUnannouncedConcurrentCaseVersion(page, caseId, 2);
    await page.evaluate(async () => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
      const confirm = buttons.find((button) =>
        button.textContent.includes("Confirm as human-reviewed"),
      );
      if (!confirm) throw new Error("The claim confirmation control was not found.");
      confirm.click();
      await Promise.resolve();
      const undo = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.title === "Undo",
      );
      if (!undo || undo.disabled) throw new Error("Undo was not ready for the queued edit.");
      undo.click();
    });

    await expect(page.locator(".workspace-case-title")).toContainText("v3");
    await expect(page.locator(".workspace-conflict")).toContainText(
      "Another REPLAY page saved case version 2",
    );
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(2);
    await page.waitForTimeout(250);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(2);
  });

  test("blocks human mutations while a staged Site Tool write is waiting for durability", async ({
    page,
  }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);
    const caseId = currentDemoRunId(page);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(1);
    await inspectorTab(page, "Facts").click();
    await page
      .getByRole("button", {
        name: /Vehicle A was leaving the roundabout when Vehicle B made contact/,
      })
      .click();
    const confirm = page.getByRole("button", { name: "Confirm as human-reviewed" });
    await expect(confirm).toBeEnabled();

    await holdCaseStoreWriteQueue(page, caseId);
    await page.evaluate(async () => {
      const scopedDocument = document as Document & {
        modelContext?: {
          getTools(): Promise<Array<{ name: string }>>;
          executeTool(
            tool: { name: string },
            input: Readonly<Record<string, unknown>>,
          ): Promise<string>;
        };
      };
      const scopedWindow = window as Window & {
        __replayPendingTool?: Promise<string>;
      };
      const modelContext = scopedDocument.modelContext;
      if (!modelContext) throw new Error("Site Tools polyfill is unavailable.");
      const tool = (await modelContext.getTools()).find(
        (candidate) => candidate.name === "upsert_scene_actor",
      );
      if (!tool) throw new Error("upsert_scene_actor is not registered.");
      scopedWindow.__replayPendingTool = modelContext.executeTool(tool, {
        actorId: "actor-vehicle-a",
        position: { x: 0.66, y: 0.51 },
        expectedPoseTarget: { branchId: "branch-baseline", playheadTimeMs: 0 },
        expectedVersion: 1,
        requestId: "request-staged-human-race-0001",
      });
    });
    await expect(page.locator(".webmcp-status")).toHaveClass(/is-working/);

    await confirm.click();
    await expect(
      page.getByText(
        "A Site Tool change is being stored. Wait for it to finish, then retry this action.",
      ),
    ).toBeVisible();
    await expect(page.locator(".workspace-case-title")).toContainText("v1");

    await releaseCaseStoreWriteQueue(page);
    const toolResult = await page.evaluate(async () => {
      const pending = (window as Window & { __replayPendingTool?: Promise<string> })
        .__replayPendingTool;
      if (!pending) throw new Error("The pending Site Tool call is missing.");
      return JSON.parse(await pending) as { ok: boolean; caseVersion: number };
    });

    expect(toolResult).toMatchObject({ ok: true, caseVersion: 2 });
    await expect(page.locator(".workspace-case-title")).toContainText("v2");
    await expect(page.getByRole("button", { name: /^Vehicle A, position/ })).toHaveAttribute(
      "transform",
      "translate(660 357)",
    );
    await expect(confirm).toBeEnabled();
    await expect(page.locator(".workspace-conflict")).toHaveCount(0);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(2);
  });

  test("keeps uploaded evidence bytes until its deletion tombstone is durable", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Evidence").click();
    await page.getByLabel("Choose evidence image").setInputFiles({
      name: "disguised-script.png",
      mimeType: "image/png",
      buffer: Buffer.from("<svg><script>alert('not evidence')</script></svg>"),
    });
    await expect(page.getByText(/not a recognized JPEG, PNG, or WebP image/i)).toBeVisible();
    await expect.poll(() => localEvidenceBlobCount(page)).toBe(0);

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

  test("rejects evidence above 16 megapixels before browser decode or persistence", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Evidence").click();
    await page.evaluate(() => {
      window.createImageBitmap = (() => {
        throw new Error("Oversized evidence reached the browser decoder.");
      }) as typeof createImageBitmap;
    });

    const oversizedPngHeader = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversizedPngHeader);
    oversizedPngHeader.writeUInt32BE(13, 8);
    oversizedPngHeader.write("IHDR", 12, "ascii");
    oversizedPngHeader.writeUInt32BE(4_001, 16);
    oversizedPngHeader.writeUInt32BE(4_000, 20);

    await page.getByLabel("Choose evidence image").setInputFiles({
      name: "oversized-16mp.png",
      mimeType: "image/png",
      buffer: oversizedPngHeader,
    });

    await expect(page.locator(".toast")).toContainText("no more than 16 megapixels total");
    await expect(
      page
        .getByRole("list", { name: "Evidence images" })
        .getByRole("button", { name: "oversized-16mp.png", exact: true }),
    ).toHaveCount(0);
    await expect.poll(() => localEvidenceBlobCount(page)).toBe(0);
  });

  test("commits uploaded evidence metadata and bytes together across save failure and retry", async ({
    page,
  }) => {
    await openDemo(page);
    const caseId = currentDemoRunId(page);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(1);
    await inspectorTab(page, "Evidence").click();
    await failCaseMetadataWrites(page);

    const uploadBytes = await readFile("public/assets/generated/demo-vehicle-a-damage.webp");
    await page.getByLabel("Choose evidence image").setInputFiles({
      name: "atomic-evidence-upload.webp",
      mimeType: "image/webp",
      buffer: uploadBytes,
    });

    const saveFailure = page.locator(".workspace-save-failure");
    await expect(saveFailure).toContainText("Local save failed. Editing is paused.");
    await expect(page.getByText(/evidence attachment was not saved/i)).toBeVisible();
    await expect(page.locator(".workspace-case-title")).toContainText("v2");
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(1);
    await expect.poll(() => localEvidenceBlobCount(page)).toBe(0);

    await restoreCaseMetadataWrites(page);
    await saveFailure.getByRole("button", { name: "Retry local save" }).click();

    await expect(saveFailure).toHaveCount(0);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(2);
    await expect.poll(() => localEvidenceBlobCount(page)).toBe(1);
    await expect(
      page
        .getByRole("list", { name: "Evidence images" })
        .getByRole("button", { name: "atomic-evidence-upload.webp", exact: true }),
    ).toBeVisible();
  });

  test("gates a delayed evidence attachment against Undo, deletion, and Site Tools until it is durable", async ({
    page,
  }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);
    const caseId = currentDemoRunId(page);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(1);
    await inspectorTab(page, "Evidence").click();
    await holdCaseStoreWriteQueue(page, caseId);

    const uploadBytes = await readFile("public/assets/generated/demo-vehicle-a-damage.webp");
    await page.getByLabel("Choose evidence image").setInputFiles({
      name: "delayed-atomic-evidence.webp",
      mimeType: "image/webp",
      buffer: uploadBytes,
    });
    const uploadedEvidence = page
      .getByRole("list", { name: "Evidence images" })
      .getByRole("button", { name: "delayed-atomic-evidence.webp", exact: true });
    await expect(uploadedEvidence).toBeVisible();
    await expect(page.locator('button[title="Undo"]')).toBeDisabled();

    const blockedTool = await invokeSiteTool(page, "upsert_scene_actor", {
      actorId: "actor-vehicle-a",
      position: { x: 0.66, y: 0.51 },
      expectedPoseTarget: { branchId: "branch-baseline", playheadTimeMs: 0 },
      expectedVersion: 2,
      requestId: "request-pending-evidence-gate-0001",
    });
    expect(blockedTool).toMatchObject({
      ok: false,
      caseVersion: 2,
      message:
        "Evidence metadata and image bytes must finish saving together before another change. Wait for this save, or retry it if REPLAY reports a failure.",
    });
    await expect(page.locator(".workspace-case-title")).toContainText("v2");

    await uploadedEvidence.click();
    await page.getByRole("button", { name: "Delete local evidence" }).click();
    await page
      .getByRole("alertdialog", { name: "Delete this evidence?" })
      .getByRole("button", { name: "Delete evidence" })
      .click();
    await expect(page.locator(".toast")).toContainText(
      "Evidence metadata and image bytes must finish saving together before another change.",
    );
    await expect(uploadedEvidence).toBeVisible();

    await releaseCaseStoreWriteQueue(page);
    await expect(page.locator(".toast")).toContainText(
      "Added evidence: delayed-atomic-evidence.webp.",
    );
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(2);
    await expect.poll(() => localEvidenceBlobCount(page)).toBe(1);

    await page.getByRole("button", { name: "Delete local evidence" }).click();
    await page
      .getByRole("alertdialog", { name: "Delete this evidence?" })
      .getByRole("button", { name: "Delete evidence" })
      .click();
    await expect(uploadedEvidence).toHaveCount(0);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(3);
    await expect.poll(() => localEvidenceBlobCount(page)).toBe(0);
  });

  test("recovers a failed delayed attachment after same-item deletion is rejected", async ({
    page,
  }) => {
    await openDemo(page);
    const caseId = currentDemoRunId(page);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(1);
    await inspectorTab(page, "Evidence").click();
    await holdCaseStoreWriteQueue(page, caseId);

    const uploadBytes = await readFile("public/assets/generated/demo-vehicle-a-damage.webp");
    await page.getByLabel("Choose evidence image").setInputFiles({
      name: "retry-after-delete-attempt.webp",
      mimeType: "image/webp",
      buffer: uploadBytes,
    });
    const uploadedEvidence = page
      .getByRole("list", { name: "Evidence images" })
      .getByRole("button", { name: "retry-after-delete-attempt.webp", exact: true });
    await expect(uploadedEvidence).toBeVisible();
    await uploadedEvidence.click();

    await failCaseMetadataWrites(page);
    await page.getByRole("button", { name: "Delete local evidence" }).click();
    await page
      .getByRole("alertdialog", { name: "Delete this evidence?" })
      .getByRole("button", { name: "Delete evidence" })
      .click();
    await expect(page.locator(".toast")).toContainText(
      "Evidence metadata and image bytes must finish saving together before another change.",
    );

    await releaseCaseStoreWriteQueue(page);
    const saveFailure = page.locator(".workspace-save-failure");
    await expect(saveFailure).toContainText("Local save failed. Editing is paused.");
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(1);
    await expect.poll(() => localEvidenceBlobCount(page)).toBe(0);

    await page.getByRole("button", { name: "Delete local evidence" }).click();
    await page
      .getByRole("alertdialog", { name: "Delete this evidence?" })
      .getByRole("button", { name: "Delete evidence" })
      .click();
    await expect(page.locator(".toast")).toContainText("Local saving failed at case version 2");
    await expect(uploadedEvidence).toBeVisible();

    await restoreCaseMetadataWrites(page);
    await saveFailure.getByRole("button", { name: "Retry local save" }).click();
    await expect(saveFailure).toHaveCount(0);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(2);
    await expect.poll(() => localEvidenceBlobCount(page)).toBe(1);
    await expect(uploadedEvidence).toBeVisible();

    await page.getByRole("button", { name: "Delete local evidence" }).click();
    await page
      .getByRole("alertdialog", { name: "Delete this evidence?" })
      .getByRole("button", { name: "Delete evidence" })
      .click();
    await expect(uploadedEvidence).toHaveCount(0);
    await expect.poll(() => persistedCaseVersion(page, caseId)).toBe(3);
    await expect.poll(() => localEvidenceBlobCount(page)).toBe(0);
  });

  test("does not attach an in-flight evidence upload after the open case changes", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Evidence").click();
    await page.evaluate(() => {
      const scopedWindow = window as Window & {
        __evidenceDigestPending?: boolean;
        __evidenceDigestResolved?: boolean;
        __releaseEvidenceDigest?: () => void;
      };
      const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = ((algorithm: AlgorithmIdentifier, data: BufferSource) =>
        new Promise<ArrayBuffer>((resolve, reject) => {
          scopedWindow.__evidenceDigestPending = true;
          scopedWindow.__releaseEvidenceDigest = () => {
            crypto.subtle.digest = originalDigest as SubtleCrypto["digest"];
            void originalDigest(algorithm, data).then((digest) => {
              resolve(digest);
              scopedWindow.__evidenceDigestResolved = true;
            }, reject);
          };
        })) as SubtleCrypto["digest"];
    });

    const uploadBytes = await readFile("public/assets/generated/demo-vehicle-a-damage.webp");
    await page.getByLabel("Choose evidence image").setInputFiles({
      name: "case-switch-race.webp",
      mimeType: "image/webp",
      buffer: uploadBytes,
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as Window & { __evidenceDigestPending?: boolean }).__evidenceDigestPending,
        ),
      )
      .toBe(true);

    await openCaseOptions(page);
    await page
      .getByRole("button", { name: "Open demo scenario: High-speed braking account" })
      .click();
    await expect(page.locator(".workspace-case-title")).toContainText("High-speed braking account");
    await page.evaluate(() => {
      (window as Window & { __releaseEvidenceDigest?: () => void }).__releaseEvidenceDigest?.();
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __evidenceDigestResolved?: boolean }).__evidenceDigestResolved,
        ),
      )
      .toBe(true);

    await expect.poll(() => localEvidenceBlobCount(page)).toBe(0);
    await inspectorTab(page, "Evidence").click();
    await expect(page.getByText("case-switch-race.webp", { exact: true })).toHaveCount(0);
  });

  test("resumes a demo run and starts a fresh copy without overwriting the saved run", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const originalRequest = navigator.locks.request.bind(navigator.locks);
      const seenLeaseNames = new Set<string>();
      const delayedLeaseNames = new Set<string>();
      let latestLeaseName: string | undefined;
      Object.defineProperty(navigator.locks, "request", {
        configurable: true,
        value: (name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) => {
          if (seenLeaseNames.has(name) && latestLeaseName && latestLeaseName !== name) {
            delayedLeaseNames.add(name);
          }
          seenLeaseNames.add(name);
          latestLeaseName = name;
          if (!delayedLeaseNames.has(name)) return originalRequest(name, options, callback);
          return new Promise((resolve, reject) => {
            // Keep a restored workspace visible while its first persistence
            // check is still waiting for the editing lease. Browser Forward
            // must wait for that check instead of truncating the saved route.
            window.setTimeout(() => {
              originalRequest(name, options, callback).then(resolve, reject);
            }, 700);
          });
        },
      });
    });

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
    await expect.poll(() => persistedCaseVersion(page, originalRunId)).toBe(2);

    await page.reload();
    await expect(page).toHaveURL(originalRunUrl);
    await expect(page.locator("main.workspace")).toBeVisible();
    await expect(page.locator(".workspace-case-title")).toContainText("v2");
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
    await expect(page.getByText("6 unresolved", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Vehicle A was leaving the roundabout when Vehicle B made contact.*Reported/,
      }),
    ).toBeVisible();
    await expect.poll(() => persistedCaseVersion(page, freshRunId)).toBe(1);
    await expect.poll(() => persistedCaseVersion(page, originalRunId)).toBe(2);

    await page.goBack();
    await expect(page.locator("main.workspace")).toBeVisible();
    expect(currentDemoRunId(page)).toBe(originalRunId);
    await expect(page.locator(".workspace-case-title")).toContainText("v2");
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
    await expect(page.locator(".workspace-case-title")).toContainText("v2");
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
    await expect.poll(() => persistedCaseVersion(page, originalRunId)).toBe(2);

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
    await expect(contender.locator(".workspace-case-title")).toContainText("v2");
    await inspectorTab(contender, "Facts").click();
    await expect(contender.getByText("5 confirmed", { exact: true })).toBeVisible();

    await expect(page.locator(".workspace-conflict")).toContainText(
      "Another page context still owns this case",
    );
    await expect(page.getByRole("button", { name: "Take over & reload" })).toBeVisible();
  });
});
