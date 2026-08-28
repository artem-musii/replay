import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LandingPage } from "../../src/components/LandingPage";
import { ReplayGuide } from "../../src/components/ReplayGuide";
import { WorkspaceTour } from "../../src/components/WorkspaceTour";
import {
  markGuideSectionComplete,
  readReplayGuideProgress,
  recordWorkspaceTourStep,
  REPLAY_GUIDE_PROGRESS_KEY,
  resetReplayGuideProgress,
  writeReplayGuideProgress,
} from "../../src/onboarding/progress";

describe("landing onboarding", () => {
  it("describes capability detection and reversible agent work without overstating readiness", () => {
    render(
      <LandingPage
        webMcpSupported
        onOpenDemo={vi.fn()}
        onOpenGuidedDemo={vi.fn()}
        onStartBlank={vi.fn()}
        onOpenCollaboration={vi.fn()}
      />,
    );

    expect(screen.getByText("Site Tools compatible")).toBeVisible();
    expect(
      screen.getByText(/eligible agent work can be reverted while it remains safe/),
    ).toBeVisible();
    expect(screen.queryByText(/every mutation visible and undoable/)).not.toBeInTheDocument();
  });
});

describe("onboarding progress", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores only guarded, versioned guide preferences", () => {
    expect(readReplayGuideProgress()).toEqual({
      version: 1,
      lastSectionId: "quick-start",
      completedSectionIds: [],
      dismissedHintIds: [],
      workspaceTour: { step: 0, completed: false },
    });

    markGuideSectionComplete("scene");
    recordWorkspaceTourStep(3);

    const stored = JSON.parse(localStorage.getItem(REPLAY_GUIDE_PROGRESS_KEY) ?? "null") as {
      completedSectionIds: string[];
      workspaceTour: { step: number };
    };
    expect(stored.completedSectionIds).toEqual(["scene"]);
    expect(stored.workspaceTour.step).toBe(3);
    expect(localStorage.getItem(REPLAY_GUIDE_PROGRESS_KEY)).not.toContain("caseId");
    expect(localStorage.getItem(REPLAY_GUIDE_PROGRESS_KEY)).not.toContain("evidence");
  });

  it("recovers from corrupt, stale, and blocked preference storage", () => {
    localStorage.setItem(REPLAY_GUIDE_PROGRESS_KEY, "not-json");
    expect(readReplayGuideProgress().lastSectionId).toBe("quick-start");

    localStorage.setItem(
      REPLAY_GUIDE_PROGRESS_KEY,
      JSON.stringify({
        version: 1,
        lastSectionId: "scene",
        completedSectionIds: ["scene", "scene", "not-a-section"],
        dismissedHintIds: ["first-tip", "", 42],
        workspaceTour: { step: 99, completed: true },
      }),
    );
    expect(readReplayGuideProgress()).toEqual({
      version: 1,
      lastSectionId: "scene",
      completedSectionIds: ["scene"],
      dismissedHintIds: ["first-tip"],
      workspaceTour: { step: 5, completed: true },
    });

    const blockedStorage = {
      getItem: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
    };
    expect(readReplayGuideProgress(blockedStorage).lastSectionId).toBe("quick-start");
    expect(writeReplayGuideProgress(readReplayGuideProgress(), blockedStorage)).toBe(false);
    expect(resetReplayGuideProgress(blockedStorage).version).toBe(1);
  });
});

describe("ReplayGuide", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens as a focused modal and explains complete manual mode in plain language", () => {
    const onClose = vi.fn();
    render(
      <ReplayGuide
        context="workspace"
        webMcpSupported={false}
        initialSection="site-tools"
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Learn REPLAY" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Close REPLAY guide" })).toHaveFocus();
    expect(screen.getByText("Manual mode is active")).toBeVisible();
    expect(screen.getByText("Manual mode is a complete workflow")).toBeVisible();
    expect(
      screen.getByText(/REPLAY does not send structured case data to an agent in manual mode/),
    ).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("launches the optional guided demo from the landing context", () => {
    const onClose = vi.fn();
    const onOpenGuidedDemo = vi.fn();
    render(
      <ReplayGuide
        context="landing"
        webMcpSupported={false}
        initialSection="quick-start"
        onClose={onClose}
        onOpenGuidedDemo={onOpenGuidedDemo}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open guided demo/ }));
    expect(onOpenGuidedDemo).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(readReplayGuideProgress().completedSectionIds).toContain("quick-start");
  });

  it("navigates topics, records review progress, and exposes the workspace tour callback", () => {
    const onStartWorkspaceTour = vi.fn();
    const onClose = vi.fn();
    render(
      <ReplayGuide
        context="workspace"
        webMcpSupported={false}
        initialSection="quick-start"
        onClose={onClose}
        onStartWorkspaceTour={onStartWorkspaceTour}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Scene and paths" }));
    expect(
      screen.getByRole("heading", { name: "Place vehicles and shape timed paths" }),
    ).toBeVisible();
    expect(
      screen.getByText(/does not model steering, braking, collision forces, or fault/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    expect(readReplayGuideProgress().completedSectionIds).toContain("scene");

    fireEvent.click(screen.getByRole("button", { name: "Quick start" }));
    fireEvent.click(screen.getByRole("button", { name: /Start 6-step workspace tour/ }));
    expect(onStartWorkspaceTour).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports supported tool state and copies safe example prompts", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onOpenTechnicalInspector = vi.fn();
    render(
      <ReplayGuide
        context="workspace"
        webMcpSupported
        registeredTools={18}
        initialSection="site-tools"
        onClose={vi.fn()}
        onOpenTechnicalInspector={onOpenTechnicalInspector}
      />,
    );

    expect(screen.getByText("18 Site Tools registered")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt: Inspect the case" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Prompt copied to the clipboard.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Open technical Site Tools inspector" }));
    expect(onOpenTechnicalInspector).toHaveBeenCalledTimes(1);
  });

  it("distinguishes detected, connecting, failed, and partially available registration states", () => {
    const { rerender } = render(
      <ReplayGuide
        context="workspace"
        webMcpSupported
        initialSection="site-tools"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Compatible Site Tools client detected")).toBeVisible();

    rerender(
      <ReplayGuide
        context="workspace"
        webMcpSupported
        registeredTools={0}
        toolRegistrationStatus="registering"
        initialSection="site-tools"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Site Tools are connecting")).toBeVisible();

    rerender(
      <ReplayGuide
        context="workspace"
        webMcpSupported
        registeredTools={0}
        toolRegistrationStatus="error"
        initialSection="site-tools"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Site Tools could not register")).toBeVisible();
    expect(screen.getByText(/Continue in Manual mode/)).toBeVisible();

    rerender(
      <ReplayGuide
        context="workspace"
        webMcpSupported
        registeredTools={4}
        toolRegistrationStatus="error"
        initialSection="site-tools"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("4 Site Tools registered, some unavailable")).toBeVisible();
    expect(screen.getByText(/Registered tools remain available/)).toBeVisible();
    expect(screen.getByText(/Manual controls remain available for every workflow/)).toBeVisible();
  });

  it("restores the copy button after the local clipboard fallback", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new DOMException("Blocked", "NotAllowedError")),
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    });
    render(
      <ReplayGuide
        context="workspace"
        webMcpSupported={false}
        initialSection="site-tools"
        onClose={vi.fn()}
      />,
    );

    const copy = screen.getByRole("button", { name: "Copy prompt: Inspect the case" });
    copy.focus();
    fireEvent.click(copy);

    await waitFor(() => expect(screen.getByText("Prompt copied to the clipboard.")).toBeVisible());
    expect(copy).toHaveFocus();
  });
});

describe("WorkspaceTour", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    document
      .querySelectorAll<HTMLElement>("[data-onboarding-id]")
      .forEach((target) => target.remove());
  });

  function addTarget(id: string): HTMLElement {
    const target = document.createElement("div");
    target.dataset.onboardingId = id;
    document.body.append(target);
    return target;
  }

  it("highlights stable targets and offers non-modal back, next, skip, and Escape controls", () => {
    const scene = addTarget("scene-editor");
    const timeline = addTarget("incident-timeline");
    const onStepChange = vi.fn();
    const onExit = vi.fn();
    const { rerender } = render(
      <WorkspaceTour step={0} onStepChange={onStepChange} onExit={onExit} onFinish={vi.fn()} />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Step 1 of 6")).toBeVisible();
    expect(scene).toHaveAttribute("data-onboarding-active", "true");
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onStepChange).toHaveBeenCalledWith(1);

    rerender(
      <WorkspaceTour step={1} onStepChange={onStepChange} onExit={onExit} onFinish={vi.fn()} />,
    );
    expect(scene).not.toHaveAttribute("data-onboarding-active");
    expect(timeline).toHaveAttribute("data-onboarding-active", "true");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onStepChange).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it("records completion only when the person finishes the final step", () => {
    addTarget("case-options");
    const onFinish = vi.fn();
    render(<WorkspaceTour step={5} onStepChange={vi.fn()} onExit={vi.fn()} onFinish={onFinish} />);

    expect(readReplayGuideProgress().workspaceTour.completed).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Finish tour" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(readReplayGuideProgress().workspaceTour).toEqual({ step: 5, completed: true });
  });

  it("moves focus to the final action when Next becomes Finish", () => {
    addTarget("site-tools-status");
    addTarget("case-options");
    const onStepChange = vi.fn();
    const { rerender } = render(
      <WorkspaceTour step={4} onStepChange={onStepChange} onExit={vi.fn()} onFinish={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onStepChange).toHaveBeenCalledWith(5);
    rerender(
      <WorkspaceTour step={5} onStepChange={onStepChange} onExit={vi.fn()} onFinish={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Finish tour" })).toHaveFocus();
  });
});
