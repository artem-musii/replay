import { expect, type Page } from "@playwright/test";

export async function openLanding(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "A shared black box for incidents that did not have one.",
      level: 1,
    }),
  ).toBeVisible();
}

export async function openDemo(page: Page): Promise<void> {
  await openLanding(page);
  await page.getByRole("button", { name: /Try the demo case/ }).click();
  await expect(page.locator("main.workspace")).toBeVisible();
  await expect(page.getByText("Roundabout incident — 17:42", { exact: true })).toBeVisible();
}

export async function waitForLocalSave(page: Page): Promise<void> {
  const status = page.locator(".save-status");
  await expect(status).toContainText("Saving locally", { timeout: 5_000 });
  await expect(status).toContainText("Saved locally", { timeout: 10_000 });
}

export function inspectorTab(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Case workspaces" })
    .getByRole("button", { name, exact: true });
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
    const modelContext = {
      registerTool(tool: ToolDefinition, options: { signal?: AbortSignal } = {}): Promise<void> {
        if (options.signal?.aborted) throw new DOMException("Registration aborted", "AbortError");
        definitions.set(tool.name, tool);
        options.signal?.addEventListener(
          "abort",
          () => {
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
