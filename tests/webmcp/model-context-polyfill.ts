import type {
  ModelContextLike,
  ModelContextRegisteredTool,
  WebMCPExecuteOptions,
  WebMCPToolDefinition,
} from "../../src/webmcp/types";

type RegisteredDefinition = Omit<WebMCPToolDefinition, "validationSchema" | "group">;

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("The simulated tool execution was cancelled.");
  error.name = "AbortError";
  return error;
}

export class ModelContextPolyfill implements ModelContextLike {
  readonly registrationCalls: string[] = [];
  readonly executionCalls: { name: string; input: Readonly<Record<string, unknown>> }[] = [];
  readonly abortedRegistrations: string[] = [];

  private readonly definitions = new Map<string, RegisteredDefinition>();

  registerTool(
    tool: RegisteredDefinition,
    options: { signal?: AbortSignal; exposedTo?: readonly string[] } = {},
  ): Promise<void> {
    if (options.signal?.aborted === true) throw abortReason(options.signal);
    if (this.definitions.has(tool.name)) {
      throw new DOMException(
        `A tool named ${tool.name} is already registered.`,
        "InvalidStateError",
      );
    }
    JSON.stringify(tool.inputSchema);
    this.registrationCalls.push(tool.name);
    this.definitions.set(tool.name, tool);

    options.signal?.addEventListener(
      "abort",
      () => {
        if (this.definitions.get(tool.name) === tool) {
          this.definitions.delete(tool.name);
          this.abortedRegistrations.push(tool.name);
        }
      },
      { once: true },
    );
    return Promise.resolve();
  }

  getTools(): Promise<readonly ModelContextRegisteredTool[]> {
    return Promise.resolve(
      [...this.definitions.values()]
        .map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          origin: "https://replay.test",
        }))
        .sort((first, second) => first.name.localeCompare(second.name)),
    );
  }

  async executeTool(
    registeredTool: ModelContextRegisteredTool,
    input: Readonly<Record<string, unknown>> | string = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<string> {
    const definition = this.definitions.get(registeredTool.name);
    if (definition === undefined) {
      throw new DOMException(`${registeredTool.name} is not registered.`, "NotFoundError");
    }
    const fallback = new AbortController();
    const signal = options.signal ?? fallback.signal;
    if (signal.aborted) throw abortReason(signal);
    const parsedInput =
      typeof input === "string" ? (JSON.parse(input) as Readonly<Record<string, unknown>>) : input;
    this.executionCalls.push({ name: registeredTool.name, input: parsedInput });

    const execution = definition.execute(parsedInput, { signal } satisfies WebMCPExecuteOptions);
    const cancellation = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(abortReason(signal)), { once: true });
    });
    const result = await Promise.race([execution, cancellation]);
    return JSON.stringify(result);
  }

  registeredNames(): string[] {
    return [...this.definitions.keys()].sort();
  }

  definition(name: string): RegisteredDefinition | undefined {
    return this.definitions.get(name);
  }
}
