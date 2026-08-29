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
    const onOpenScenario = vi.fn();
    render(
      <LandingPage
        webMcpSupported
        onOpenDemo={vi.fn()}
        onOpenGuidedDemo={vi.fn()}
        onStartBlank={vi.fn()}
        onOpenCollaboration={vi.fn()}
        onOpenScenario={onOpenScenario}
      />,
    );

    expect(screen.getByText("Site Tools compatible")).toBeVisible();
    expect(screen.getByRole("link", { name: "Source" })).toHaveAttribute(
      "href",
      "https://github.com/artem-musii/replay-sol",
    );
    expect(screen.getByRole("link", { name: "MIT License" })).toHaveAttribute(
      "href",
      "https://github.com/artem-musii/replay-sol/blob/main/LICENSE",
    );
    expect(
      screen.getByText(/eligible agent work can be reverted while it remains safe/),
    ).toBeVisible();
    expect(screen.queryByText(/every mutation visible and undoable/)).not.toBeInTheDocument();

    const hero = screen.getByRole("img", { name: /Editorial top-down illustration/ });
    expect(hero).toHaveAttribute("srcset", expect.stringContaining("replay-hero-640.webp 640w"));
    expect(hero).toHaveAttribute(
      "sizes",
      "(max-width: 540px) calc(100vw - 62px), (max-width: 800px) calc(100vw + 100px), 60vw",
    );

    const scenarioButtons = screen.getAllByRole("button", { name: /^Open case:/ });
    expect(scenarioButtons).toHaveLength(4);
    const [firstScenarioButton] = scenarioButtons;
    if (!firstScenarioButton) throw new Error("Expected at least one scenario button.");
    fireEvent.click(firstScenarioButton);
    expect(onOpenScenario).toHaveBeenCalledTimes(1);
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
    expect(screen.getByRole("heading", { name: "Use a supported OpenAI setup" })).toBeVisible();
    expect(screen.getByText(/OpenAI guidance checked August 29, 2026/)).toBeVisible();
    expect(screen.getByText(/GPT-5\.6 Sol or GPT-5\.6 Terra/)).toBeVisible();
    expect(screen.getByText(/GPT-5\.6 Luna currently has Site Tools disabled/)).toBeVisible();
    expect(screen.getByText(/not available in Enterprise or Edu workspaces/)).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: "Check current OpenAI Site Tools guidance (opens in a new tab)",
      }),
    ).toHaveAttribute("href", "https://learn.chatgpt.com/docs/webmcp");
    expect(screen.getByText("Manual mode is a complete workflow")).toBeVisible();
    expect(
      screen.getByText(/REPLAY does not send structured case data to an agent in manual mode/),
    ).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores the root and body overflow styles after closing", () => {
    const previousDocumentOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "scroll";
    document.body.style.overflow = "auto";

    const { unmount } = render(
      <ReplayGuide
        context="landing"
        webMcpSupported={false}
        initialSection="quick-start"
        onClose={vi.fn()}
      />,
    );

    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");

    unmount();

    expect(document.documentElement.style.overflow).toBe("scroll");
    expect(document.body.style.overflow).toBe("auto");
    document.documentElement.style.overflow = previousDocumentOverflow;
    document.body.style.overflow = previousBodyOverflow;
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
        isDemo
        demoScenarioId="roundabout-calibrated"
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
      screen.getByText(/does not model driver control, collision forces, or fault/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    expect(readReplayGuideProgress().completedSectionIds).toContain("scene");

    fireEvent.click(screen.getByRole("button", { name: "Quick start" }));
    expect(screen.getByText(/start a fresh copy without overwriting this run/)).toBeVisible();
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
        isDemo
        demoScenarioId="roundabout-calibrated"
        registeredTools={18}
        initialSection="site-tools"
        onClose={vi.fn()}
        onOpenTechnicalInspector={onOpenTechnicalInspector}
      />,
    );

    expect(screen.getByText("18 Site Tools registered")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "30 seconds from structured read to review" }),
    ).toBeVisible();
    expect(
      screen.getByText(/A pending proposal appears; base geometry stays unchanged/),
    ).toBeVisible();
    expect(screen.getByText("Show deterministic fallback").closest("details")).not.toHaveAttribute(
      "open",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy prompt: Review the unresolved lane question" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const quickProofPrompt = writeText.mock.calls[0]?.[0] as string;
    expect(quickProofPrompt).toMatch(/review the unresolved lane-position question/);
    expect(quickProofPrompt).toMatch(/smallest coordinated two-car alternative/);
    expect(quickProofPrompt).toMatch(/Keep the baseline, claims, endpoints, point IDs, times/);
    expect(quickProofPrompt).toMatch(/before\/after versions/);
    expect(quickProofPrompt).toMatch(/Do not apply anything/);
    expect(quickProofPrompt).not.toMatch(/8,000 ms/);

    fireEvent.click(screen.getByText("Show deterministic fallback"));
    fireEvent.click(
      screen.getByRole("button", { name: "Copy prompt: Run the deterministic proof fixture" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    const deterministicPrompt = writeText.mock.calls[1]?.[0] as string;
    expect(deterministicPrompt).toMatch(/existing 8,000 ms keyframe/);
    expect(deterministicPrompt).toMatch(/Vehicle A y \+0\.008/);
    expect(deterministicPrompt).toMatch(/Vehicle B y −0\.008/);
    expect(deterministicPrompt).toMatch(/Reuse both keyframe IDs and preserve every other value/);

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt: Inspect the case" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
    expect(screen.getByText("Prompt copied to the clipboard.")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Copy prompt: Propose the smallest review" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(4));
    const proposalPrompt = writeText.mock.calls[3]?.[0] as string;
    expect(proposalPrompt).toMatch(/highest-priority blocker/);
    expect(proposalPrompt).toMatch(/smallest conservative interior path adjustments/);
    expect(proposalPrompt).toMatch(/preserve endpoints, point IDs, times, unrelated geometry/);
    expect(proposalPrompt).not.toMatch(/8,000 ms|0\.008/);

    fireEvent.click(screen.getByRole("button", { name: "Open technical Site Tools inspector" }));
    expect(onOpenTechnicalInspector).toHaveBeenCalledTimes(1);
  });

  it("keeps fixture-specific prompts out of local cases and offers the proof case", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onClose = vi.fn();
    const onOpenProofDemo = vi.fn();
    render(
      <ReplayGuide
        context="workspace"
        webMcpSupported
        registeredTools={18}
        toolRegistrationStatus="ready"
        initialSection="site-tools"
        onClose={onClose}
        onOpenProofDemo={onOpenProofDemo}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Open the Roundabout demo for the 30-second proof" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Copy prompt: Review the unresolved lane question" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/existing 8,000 ms keyframe/)).not.toBeInTheDocument();
    expect(screen.getByText(/safe prompts below inspect the case that is open now/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt: Inspect this case" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const currentCasePrompt = writeText.mock.calls[0]?.[0] as string;
    expect(currentCasePrompt).toMatch(
      /read the case summary, scene, facts, questions, and timeline/,
    );
    expect(currentCasePrompt).not.toMatch(/8,000 ms/);

    fireEvent.click(screen.getByRole("button", { name: "Open proof case" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenProofDemo).toHaveBeenCalledTimes(1);
  });

  it("describes local-case durability without promising a fresh demo copy", () => {
    const onStartWorkspaceTour = vi.fn();
    render(
      <ReplayGuide
        context="workspace"
        webMcpSupported={false}
        initialSection="quick-start"
        onClose={vi.fn()}
        onStartWorkspaceTour={onStartWorkspaceTour}
      />,
    );

    expect(screen.getByText(/This local case is safe to explore/)).toBeVisible();
    expect(screen.getByText(/structured exports provide a portable record/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Start 6-step workspace tour" })).toBeNull();
    expect(screen.getByText(/playback tour uses the calibrated demo/)).toBeVisible();
    expect(
      screen.queryByText(/start a fresh copy without overwriting this run/),
    ).not.toBeInTheDocument();
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

    const copy = screen.getByRole("button", { name: "Copy prompt: Inspect this case" });
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
    const onTryAction = vi.fn();
    const { rerender } = render(
      <WorkspaceTour
        step={0}
        onStepChange={onStepChange}
        onExit={onExit}
        onFinish={vi.fn()}
        onTryAction={onTryAction}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Step 1 of 6")).toBeVisible();
    expect(scene).toHaveAttribute("data-onboarding-active", "true");
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Jump to approximate contact" }));
    expect(onTryAction).toHaveBeenCalledWith("jump-impact");
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
