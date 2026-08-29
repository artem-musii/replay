import {
  Braces,
  Check,
  ChevronDown,
  CircleAlert,
  CircleOff,
  Copy,
  Play,
  RotateCw,
  Shield,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { WebMCPDebugState, WebMCPToolName } from "../webmcp";
import { copyTextToClipboard } from "./clipboard";
import { useDialogFocus } from "./useDialogFocus";

interface WebMCPDebugPanelProps {
  state: WebMCPDebugState;
  onClose: () => void;
  onSimulate: (
    name: WebMCPToolName,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<unknown>;
  onRetryRegistrations: () => Promise<void>;
}

const samples: Partial<Record<WebMCPToolName, Record<string, unknown>>> = {
  get_case_summary: {},
  get_workspace_state: { sections: ["scene", "claims", "questions"] },
  get_recent_activity: { limit: 10, author: "all" },
  validate_case_consistency: { scope: "all" },
};

const VISIBLE_UI_ONLY_TOOLS: ReadonlySet<WebMCPToolName> = new Set([
  "focus_workspace_item",
  "compare_hypotheses",
  "build_report_preview",
]);

function sideEffectLabel(name: WebMCPToolName, readOnly: boolean): string {
  if (readOnly) return "Read only";
  return VISIBLE_UI_ONLY_TOOLS.has(name) ? "Changes visible UI/session" : "Changes case";
}

export function WebMCPDebugPanel({
  state,
  onClose,
  onSimulate,
  onRetryRegistrations,
}: WebMCPDebugPanelProps) {
  const initial = state.registeredToolNames[0] ?? "get_case_summary";
  const [selected, setSelected] = useState<WebMCPToolName>(initial);
  const [input, setInput] = useState(() => JSON.stringify(samples[initial] ?? {}, null, 2));
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const [retryingRegistrations, setRetryingRegistrations] = useState(false);
  const [registrationRetryError, setRegistrationRetryError] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetTimerRef = useRef<number | undefined>(undefined);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus<HTMLElement>({
    initialFocusRef: closeButtonRef,
    onEscape: onClose,
  });
  const selectedTool = useMemo(
    () => state.tools.find((tool) => tool.name === selected),
    [selected, state.tools],
  );
  const failedToolCount = state.tools.filter((tool) => tool.registrationState === "error").length;

  useEffect(
    () => () => {
      if (copyResetTimerRef.current !== undefined) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    },
    [],
  );

  async function copyInput(): Promise<void> {
    if (copyResetTimerRef.current !== undefined) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    try {
      await copyTextToClipboard(input);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    copyResetTimerRef.current = window.setTimeout(() => setCopyStatus("idle"), 1_600);
  }

  async function retryRegistrations(): Promise<void> {
    setRegistrationRetryError(undefined);
    setRetryingRegistrations(true);
    try {
      await onRetryRegistrations();
    } catch (retryError) {
      setRegistrationRetryError(
        retryError instanceof Error
          ? retryError.message
          : "The browser did not provide a registration failure reason.",
      );
    } finally {
      setRetryingRegistrations(false);
    }
  }

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
        ref={dialogRef}
        className="debug-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="webmcp-debug-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <p>Development inspector</p>
            <h2 id="webmcp-debug-title">WebMCP Site Tools</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            onClick={onClose}
            aria-label="Close WebMCP inspector"
          >
            <X size={18} />
          </button>
        </header>
        <div
          className={`debug-support is-${failedToolCount > 0 ? "error" : state.supported ? "supported" : "fallback"}`}
          role="status"
          aria-live="polite"
        >
          {failedToolCount > 0 ? (
            <CircleAlert size={15} aria-hidden="true" />
          ) : state.supported ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <CircleOff size={15} aria-hidden="true" />
          )}
          <div className="debug-support__copy">
            <strong>
              {failedToolCount > 0
                ? "Site Tool registration needs attention"
                : state.supported
                  ? "Browser Site Tools available"
                  : "Manual browser mode"}
            </strong>
            <span>
              {failedToolCount > 0
                ? `${failedToolCount} ${failedToolCount === 1 ? "tool is" : "tools are"} unavailable. Retry after the browser or page has recovered.`
                : state.supported
                  ? `${state.registeredToolNames.length} tools registered for ${state.lifecycleMode} mode.`
                  : "document.modelContext is unavailable. Every manual workspace feature remains available."}
            </span>
            {registrationRetryError && (
              <span className="debug-support__retry-error" role="alert">
                {registrationRetryError}
              </span>
            )}
          </div>
          {failedToolCount > 0 && (
            <button
              type="button"
              className="button button--secondary"
              disabled={retryingRegistrations}
              onClick={() => void retryRegistrations()}
            >
              <RotateCw size={14} aria-hidden="true" />
              {retryingRegistrations ? "Retrying…" : "Retry registration"}
            </button>
          )}
        </div>
        <div className="debug-layout">
          <div className="debug-tool-list" role="list" aria-label="Site Tools">
            {state.tools.map((tool) => (
              <div key={tool.name} role="listitem">
                <button
                  className={selected === tool.name ? "is-selected" : ""}
                  onClick={() => {
                    setSelected(tool.name);
                    setInput(JSON.stringify(samples[tool.name] ?? {}, null, 2));
                    setResult(undefined);
                    setError(undefined);
                  }}
                >
                  <span className={`tool-state is-${tool.registrationState}`} />
                  <span>
                    <strong>{tool.title}</strong>
                    <small>{tool.name}</small>
                  </span>
                  <ChevronDown size={12} />
                </button>
              </div>
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
                    {sideEffectLabel(selectedTool.name, selectedTool.annotations.readOnlyHint)}
                  </span>
                  <span>
                    {selectedTool.annotations.untrustedContentHint
                      ? "May contain untrusted case content"
                      : "No untrusted-content hint"}
                  </span>
                </div>
                {selectedTool.registrationError && (
                  <div className="debug-registration-error" role="note">
                    <strong>Registration failed</strong>
                    <span>{selectedTool.registrationError}</span>
                  </div>
                )}
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
                  <button className="button button--secondary" onClick={() => void copyInput()}>
                    <Copy size={14} />
                    {copyStatus === "copied"
                      ? "Copied"
                      : copyStatus === "failed"
                        ? "Copy failed"
                        : "Copy input"}
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
                {copyStatus === "failed" && (
                  <p className="debug-copy-error" role="alert">
                    Clipboard access is unavailable. Select and copy the JSON manually.
                  </p>
                )}
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
