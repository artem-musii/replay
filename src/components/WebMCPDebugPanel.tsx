import { Braces, Check, ChevronDown, CircleOff, Copy, Play, Shield, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { WebMCPDebugState, WebMCPToolName } from "../webmcp";

interface WebMCPDebugPanelProps {
  state: WebMCPDebugState;
  onClose: () => void;
  onSimulate: (
    name: WebMCPToolName,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<unknown>;
}

const samples: Partial<Record<WebMCPToolName, Record<string, unknown>>> = {
  get_case_summary: {},
  get_workspace_state: { sections: ["scene", "claims", "questions"] },
  get_recent_activity: { limit: 10, author: "all" },
  validate_case_consistency: { scope: "all" },
};

export function WebMCPDebugPanel({ state, onClose, onSimulate }: WebMCPDebugPanelProps) {
  const initial = state.registeredToolNames[0] ?? "get_case_summary";
  const [selected, setSelected] = useState<WebMCPToolName>(initial);
  const [input, setInput] = useState(() => JSON.stringify(samples[initial] ?? {}, null, 2));
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const selectedTool = useMemo(
    () => state.tools.find((tool) => tool.name === selected),
    [selected, state.tools],
  );

  async function run(): Promise<void> {
    setError(undefined);
    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(input) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error("Input must be a JSON object.");
      parsed = value as Record<string, unknown>;
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Invalid JSON input.");
      return;
    }
    const controller = new AbortController();
    setRunning(true);
    try {
      setResult(await onSimulate(selected, parsed, controller.signal));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Tool simulation failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      className="debug-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="debug-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="webmcp-debug-title"
      >
        <header>
          <div>
            <p>Development inspector</p>
            <h2 id="webmcp-debug-title">WebMCP Site Tools</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close WebMCP inspector">
            <X size={18} />
          </button>
        </header>
        <div className={`debug-support is-${state.supported ? "supported" : "fallback"}`}>
          {state.supported ? <Check size={15} /> : <CircleOff size={15} />}
          <div>
            <strong>
              {state.supported ? "Browser Site Tools available" : "Manual browser mode"}
            </strong>
            <span>
              {state.supported
                ? `${state.registeredToolNames.length} tools registered for ${state.lifecycleMode} mode.`
                : "document.modelContext is unavailable. Every manual workspace feature remains available."}
            </span>
          </div>
        </div>
        <div className="debug-layout">
          <div className="debug-tool-list" role="list" aria-label="Site Tools">
            {state.tools.map((tool) => (
              <button
                key={tool.name}
                className={selected === tool.name ? "is-selected" : ""}
                onClick={() => {
                  setSelected(tool.name);
                  setInput(JSON.stringify(samples[tool.name] ?? {}, null, 2));
                  setResult(undefined);
                  setError(undefined);
                }}
                role="listitem"
              >
                <span className={`tool-state is-${tool.registrationState}`} />
                <span>
                  <strong>{tool.title}</strong>
                  <small>{tool.name}</small>
                </span>
                <ChevronDown size={12} />
              </button>
            ))}
          </div>
          <div className="debug-detail">
            {selectedTool && (
              <>
                <div className="debug-detail__title">
                  <div>
                    <h3>{selectedTool.title}</h3>
                    <code>{selectedTool.name}</code>
                  </div>
                  <span className={`registration-badge is-${selectedTool.registrationState}`}>
                    {selectedTool.registrationState}
                  </span>
                </div>
                <p>{selectedTool.description}</p>
                <div className="annotation-row">
                  <span>
                    <Shield size={12} />{" "}
                    {selectedTool.annotations.readOnlyHint ? "Read only" : "Mutates case"}
                  </span>
                  <span>
                    {selectedTool.annotations.untrustedContentHint
                      ? "Reads untrusted case content"
                      : "Deterministic or trusted input"}
                  </span>
                </div>
                <details>
                  <summary>
                    <Braces size={13} /> Input schema
                  </summary>
                  <pre>{JSON.stringify(selectedTool.inputSchema, null, 2)}</pre>
                </details>
                <label className="debug-input">
                  <span>Simulation input</span>
                  <textarea
                    rows={7}
                    spellCheck={false}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                  />
                </label>
                <div className="debug-actions">
                  <button
                    className="button button--secondary"
                    onClick={() => {
                      void navigator.clipboard.writeText(input);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1_200);
                    }}
                  >
                    <Copy size={14} /> {copied ? "Copied" : "Copy input"}
                  </button>
                  <button
                    className="button button--primary"
                    disabled={
                      !state.canSimulate ||
                      running ||
                      selectedTool.registrationState !== "registered"
                    }
                    onClick={() => void run()}
                  >
                    <Play size={14} /> {running ? "Running" : "Run through browser"}
                  </button>
                </div>
                {!state.canSimulate && (
                  <p className="debug-hint">
                    Simulation requires a browser exposing modelContext.getTools() and
                    executeTool(). Registration details remain inspectable here.
                  </p>
                )}
                {error && (
                  <div className="debug-result is-error" role="alert">
                    {error}
                  </div>
                )}
                {result !== undefined && (
                  <div className="debug-result">
                    <span>Result</span>
                    <pre>{JSON.stringify(result, null, 2)}</pre>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {(state.lastInvocation !== undefined || state.lastResult !== undefined) && (
          <footer>
            <strong>Last browser invocation</strong>
            <code>{state.lastInvocation?.toolName ?? "Result available"}</code>
          </footer>
        )}
      </section>
    </div>
  );
}
