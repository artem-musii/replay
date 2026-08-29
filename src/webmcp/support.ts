import type { ModelContextLike } from "./types";

export interface WebMCPSupportState {
  available: boolean;
  canSimulate: boolean;
  reason?: string;
}

export function resolveGlobalModelContext(): ModelContextLike | undefined {
  const candidateDocument = (globalThis as { document?: { modelContext?: unknown } }).document;
  const candidate = candidateDocument?.modelContext;
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "registerTool" in candidate &&
    typeof candidate.registerTool === "function"
  ) {
    return candidate as ModelContextLike;
  }
  return undefined;
}

export function detectWebMCPSupport(modelContext?: ModelContextLike | null): WebMCPSupportState {
  const resolved =
    modelContext === undefined ? resolveGlobalModelContext() : (modelContext ?? undefined);
  if (resolved === undefined) {
    return {
      available: false,
      canSimulate: false,
      reason: "document.modelContext is unavailable; manual REPLAY features remain usable.",
    };
  }
  return {
    available: true,
    canSimulate:
      typeof resolved.getTools === "function" && typeof resolved.executeTool === "function",
  };
}
