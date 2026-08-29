import { expect, type Page } from "@playwright/test";

export async function openLanding(page: Page): Promise<void> {
  // Relative navigation preserves a configured static-host base path while
  // remaining identical for the root-hosted development build.
  await page.goto("./");
  await expect(
    page.getByRole("heading", {
      name: "A shared black box for incidents that did not have one.",
      level: 1,
    }),
  ).toBeVisible();
}

export async function openDemo(page: Page): Promise<void> {
  await openLanding(page);
  await page.getByRole("button", { name: "Open Roundabout demo" }).click();
  await expect(page.locator("main.workspace")).toBeVisible();
  await expect(page.getByText("Roundabout incident — 17:42", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#case\/case-demo-roundabout-calibrated-run-/);
}

export function currentDemoRunId(page: Page): string {
  const hash = new URL(page.url()).hash;
  if (!hash.startsWith("#case/")) {
    throw new Error(`Expected a case-specific demo route, received ${hash || "an empty hash"}.`);
  }
  return decodeURIComponent(hash.slice("#case/".length));
}

export async function waitForLocalSave(page: Page): Promise<void> {
  const status = page.locator(".save-status");
  // A fast IndexedDB transaction can complete between the user action and this
  // assertion. The persisted state is verified by the caller after reload.
  await expect(status).toContainText("Saved locally", { timeout: 10_000 });
}

export async function confirmStructuredCaseImport(page: Page): Promise<void> {
  const dialog = page.getByRole("alertdialog", { name: "Review this structured transfer" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Fresh local review required");
  await expect(dialog).toContainText("The transfer is unsigned.");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Open as new local case" }).click();
  await expect(dialog).toHaveCount(0);
}

export function inspectorTab(page: Page, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page
    .getByRole("tablist", { name: "Case workspaces" })
    .getByRole("tab", { name: new RegExp(`^${escapedName}(?:\\s|$)`) });
}

export async function openWebMCPInspector(page: Page) {
  const invoker = page.getByLabel("Case options");
  await invoker.click();
  await page.getByRole("button", { name: "WebMCP inspector" }).click();
  const dialog = page.getByRole("dialog", { name: "WebMCP Site Tools" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("details.workspace-menu")).not.toHaveAttribute("open", "");
  return { dialog, invoker };
}

/** Installs the current imperative WebMCP surface before the app is evaluated. */
export async function installModelContextPolyfill(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface ToolDefinition {
      name: string;
      title?: string;
      description: string;
      inputSchema?: Readonly<Record<string, unknown>>;
      annotations?: Readonly<Record<string, unknown>>;
      execute(
        input: Readonly<Record<string, unknown>>,
        options: { signal: AbortSignal },
      ): Promise<unknown>;
    }

    interface RegisteredTool {
      name: string;
      title?: string;
      description: string;
      inputSchema?: Readonly<Record<string, unknown>>;
      annotations?: Readonly<Record<string, unknown>>;
      origin: string;
    }

    const definitions = new Map<string, ToolDefinition>();
    const registrationAudit = {
      calls: [] as string[],
      aborted: [] as string[],
      executions: [] as Array<{
        name: string;
        input: Readonly<Record<string, unknown>>;
      }>,
    };
    Object.defineProperty(window, "__replayWebMCPRegistrationAudit", {
      value: registrationAudit,
      configurable: true,
    });
    const modelContext = {
      registerTool(tool: ToolDefinition, options: { signal?: AbortSignal } = {}): Promise<void> {
        if (options.signal?.aborted) throw new DOMException("Registration aborted", "AbortError");
        registrationAudit.calls.push(tool.name);
        definitions.set(tool.name, tool);
        options.signal?.addEventListener(
          "abort",
          () => {
            registrationAudit.aborted.push(tool.name);
            if (definitions.get(tool.name) === tool) definitions.delete(tool.name);
          },
          { once: true },
        );
        return Promise.resolve();
      },
      getTools(): Promise<RegisteredTool[]> {
        return Promise.resolve(
          [...definitions.values()].map((tool) => ({
            name: tool.name,
            ...(tool.title ? { title: tool.title } : {}),
            description: tool.description,
            ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
            origin: window.location.origin,
          })),
        );
      },
      async executeTool(
        tool: RegisteredTool,
        input: Readonly<Record<string, unknown>> = {},
        options: { signal?: AbortSignal } = {},
      ): Promise<string> {
        const definition = definitions.get(tool.name);
        if (!definition) throw new DOMException(`${tool.name} is not registered`, "NotFoundError");
        const fallback = new AbortController();
        const signal = options.signal ?? fallback.signal;
        if (signal.aborted) throw new DOMException("Execution aborted", "AbortError");
        registrationAudit.executions.push({ name: tool.name, input });
        return JSON.stringify(await definition.execute(input, { signal }));
      },
    };

    Object.defineProperty(document, "modelContext", {
      value: modelContext,
      configurable: true,
    });
  });
}

export async function waitForImages(page: Page): Promise<void> {
  await page.locator("img").first().waitFor({ state: "visible" });
  await page.locator("img").evaluateAll(async (images) => {
    await Promise.all(
      images.map(async (image) => {
        const element = image as HTMLImageElement;
        if (element.complete && element.naturalWidth > 0) return;
        await element.decode();
      }),
    );
  });
}
