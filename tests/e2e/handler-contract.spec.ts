import { expect, test } from "@playwright/test";

import { installModelContextPolyfill, openDemo } from "./helpers";

const workspaceSections = [
  "scene",
  "timeline",
  "claims",
  "evidence",
  "questions",
  "hypotheses",
  "report",
  "selection",
] as const;
const compactWorkspaceTargetBytes = 32 * 1024;
const readOutputLimitBytes = 512 * 1024;

test("keeps the complete browser Site Tools read bounded and mutation-free", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`,
    );
  });

  await installModelContextPolyfill(page);
  await openDemo(page);
  const trace = await page.evaluate(async (sections) => {
    const scopedDocument = document as Document & {
      modelContext?: {
        getTools(): Promise<Array<{ name: string }>>;
        executeTool(
          tool: { name: string },
          input: Readonly<Record<string, unknown>>,
        ): Promise<string>;
      };
    };
    const scopedWindow = window as unknown as Window & {
      __replayWebMCPRegistrationAudit: {
        calls: string[];
        aborted: string[];
        executions: Array<{ name: string }>;
      };
    };
    const modelContext = scopedDocument.modelContext;
    if (!modelContext) throw new Error("Site Tools polyfill is unavailable.");
    const tools = await modelContext.getTools();
    const workspaceTool = tools.find((tool) => tool.name === "get_workspace_state");
    if (!workspaceTool) throw new Error("get_workspace_state is not registered.");
    const serialized = await modelContext.executeTool(workspaceTool, { sections });
    return {
      serialized,
      toolNames: tools.map((tool) => tool.name),
      audit: structuredClone(scopedWindow.__replayWebMCPRegistrationAudit),
    };
  }, workspaceSections);

  const outputBytes = new TextEncoder().encode(trace.serialized).byteLength;
  const result = JSON.parse(trace.serialized) as {
    ok: boolean;
    caseVersion: number;
    affectedIds: string[];
    message: string;
    data: Record<string, unknown>;
  };
  testInfo.annotations.push({
    type: "handler-contract-bytes",
    description: String(outputBytes),
  });

  expect(trace.toolNames).toHaveLength(18);
  expect(trace.audit.calls).toHaveLength(18);
  expect(trace.audit.aborted).toEqual([]);
  expect(trace.audit.executions.map((entry) => entry.name)).toEqual(["get_workspace_state"]);
  expect(result).toMatchObject({
    ok: true,
    caseVersion: 1,
    affectedIds: [],
    message: "Returned 8 requested workspace sections.",
  });
  expect(Object.keys(result.data).sort()).toEqual(
    ["coordinateSystem", ...workspaceSections].sort(),
  );
  expect(result.data.selection).toBeNull();
  expect(outputBytes).toBeLessThanOrEqual(compactWorkspaceTargetBytes);
  expect(outputBytes).toBeLessThanOrEqual(readOutputLimitBytes);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
