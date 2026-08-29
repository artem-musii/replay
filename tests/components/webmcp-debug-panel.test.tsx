import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { WebMCPDebugPanel } from "../../src/components/WebMCPDebugPanel";
import type { WebMCPDebugState } from "../../src/webmcp";

const failedTool: WebMCPDebugState["tools"][number] = {
  name: "get_case_summary",
  title: "Get case summary",
  group: "base",
  description: "Return the compact live case summary.",
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  inputSchema: { type: "object", additionalProperties: false },
  registrationState: "error",
  registrationError: "Temporary browser registration failure.",
};

const failedState: WebMCPDebugState = {
  supported: true,
  canSimulate: true,
  lifecycleMode: "base",
  caseVersion: 1,
  registeredToolNames: [],
  tools: [failedTool],
};

function asRegistered(tool: WebMCPDebugState["tools"][number]): WebMCPDebugState["tools"][number] {
  const registered = { ...tool, registrationState: "registered" as const };
  delete registered.registrationError;
  return registered;
}

describe("WebMCPDebugPanel", () => {
  it("distinguishes reads, visible session changes, and durable case changes", () => {
    const state: WebMCPDebugState = {
      ...failedState,
      registeredToolNames: ["get_case_summary", "focus_workspace_item", "mark_impact_event"],
      tools: [
        asRegistered(failedTool),
        {
          name: "focus_workspace_item",
          title: "Focus workspace item",
          group: "base",
          description: "Open the named item for shared review.",
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          inputSchema: { type: "object", additionalProperties: false },
          registrationState: "registered",
        },
        {
          name: "mark_impact_event",
          title: "Mark impact event",
          group: "scene",
          description: "Create a provisional impact event.",
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          inputSchema: { type: "object", additionalProperties: false },
          registrationState: "registered",
        },
      ],
    };

    render(
      <WebMCPDebugPanel
        state={state}
        onClose={vi.fn()}
        onSimulate={vi.fn()}
        onRetryRegistrations={vi.fn()}
      />,
    );

    expect(screen.getByText("Read only")).toBeVisible();
    expect(screen.getByText("May contain untrusted case content")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Focus workspace item/ }));
    expect(screen.getByText("Changes visible UI/session")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Mark impact event/ }));
    expect(screen.getByText("Changes case")).toBeVisible();
  });

  it("explains registration failure and offers one visible manual retry", async () => {
    let finishRetry: (() => void) | undefined;
    const onRetryRegistrations = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRetry = resolve;
        }),
    );

    render(
      <WebMCPDebugPanel
        state={failedState}
        onClose={vi.fn()}
        onSimulate={vi.fn()}
        onRetryRegistrations={onRetryRegistrations}
      />,
    );

    expect(screen.getByText("Site Tool registration needs attention")).toBeVisible();
    expect(screen.getByText(/1 tool is unavailable/)).toBeVisible();
    expect(screen.getByText("Temporary browser registration failure.")).toBeVisible();

    const retry = screen.getByRole("button", { name: "Retry registration" });
    fireEvent.click(retry);
    expect(onRetryRegistrations).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();

    finishRetry?.();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry registration" })).toBeEnabled(),
    );
  });

  it("reports clipboard denial instead of claiming the input was copied", async () => {
    const originalClipboard = navigator.clipboard;
    const originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.reject(new Error("Permission denied"))) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });

    try {
      render(
        <WebMCPDebugPanel
          state={failedState}
          onClose={vi.fn()}
          onSimulate={vi.fn()}
          onRetryRegistrations={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Copy input" }));
      expect(
        await screen.findByText(
          "Clipboard access is unavailable. Select and copy the JSON manually.",
        ),
      ).toHaveAttribute("role", "alert");
      expect(screen.getByRole("button", { name: "Copy failed" })).toBeVisible();
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
      if (originalExecCommandDescriptor) {
        Object.defineProperty(document, "execCommand", originalExecCommandDescriptor);
      } else {
        Reflect.deleteProperty(document, "execCommand");
      }
    }
  });
});
