import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  markWorkspaceTourComplete,
  recordWorkspaceTourStep,
  WORKSPACE_TOUR_STEP_COUNT,
} from "../onboarding/progress";
import { WORKSPACE_TOUR_STEPS } from "../onboarding/workspaceTour";
import "../styles/guide.css";

export interface WorkspaceTourProps {
  step: number;
  onStepChange: (step: number) => void;
  onExit: () => void;
  onFinish: () => void;
}

function boundedStep(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.max(0, Math.min(WORKSPACE_TOUR_STEP_COUNT - 1, Math.trunc(step)));
}

export function WorkspaceTour({ step, onStepChange, onExit, onFinish }: WorkspaceTourProps) {
  const currentStep = boundedStep(step);
  const definition = WORKSPACE_TOUR_STEPS[currentStep];
  const tourRef = useRef<HTMLElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<"back" | "primary" | null>(null);
  if (!definition) throw new Error(`Missing workspace tour step: ${String(currentStep)}`);

  useEffect(() => {
    recordWorkspaceTourStep(currentStep);
    const target = document.querySelector<HTMLElement>(
      `[data-onboarding-id="${definition.targetId}"]`,
    );
    target?.setAttribute("data-onboarding-active", "true");

    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: reducedMotion ? "auto" : "smooth",
      });
    }

    return () => target?.removeAttribute("data-onboarding-active");
  }, [currentStep, definition.targetId]);

  useEffect(() => {
    tourRef.current?.focus({ preventScroll: true });
    return () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Open REPLAY guide"]')?.focus();
    };
  }, []);

  useEffect(() => {
    if (messageRef.current) messageRef.current.scrollTop = 0;
    const target =
      pendingFocusRef.current === "back" ? backButtonRef.current : primaryButtonRef.current;
    if (pendingFocusRef.current) target?.focus({ preventScroll: true });
    pendingFocusRef.current = null;
  }, [currentStep]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onExit();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onExit]);

  function finish(): void {
    markWorkspaceTourComplete();
    onFinish();
  }

  function changeStep(nextStep: number, focus: "back" | "primary"): void {
    pendingFocusRef.current = focus;
    onStepChange(nextStep);
  }

  return (
    <aside
      ref={tourRef}
      className={`workspace-tour${
        definition.targetId === "scene-editor" ||
        definition.targetId === "incident-timeline" ||
        definition.targetId === "case-activity"
          ? " workspace-tour--top"
          : ""
      }`}
      aria-labelledby="workspace-tour-title"
      aria-describedby="workspace-tour-body"
      tabIndex={-1}
    >
      <header>
        <div>
          <p>{definition.eyebrow}</p>
          <span>
            Step {currentStep + 1} of {WORKSPACE_TOUR_STEP_COUNT}
          </span>
        </div>
        <button type="button" onClick={onExit} aria-label="Exit workspace tour">
          <X size={17} aria-hidden="true" />
        </button>
      </header>
      <div
        ref={messageRef}
        className="workspace-tour__message"
        role="region"
        aria-label={`Tour step ${String(currentStep + 1)} details`}
        aria-live="polite"
        aria-atomic="true"
        tabIndex={0}
      >
        <h2 id="workspace-tour-title">{definition.title}</h2>
        <p id="workspace-tour-body">{definition.body}</p>
      </div>
      <footer>
        <button className="button button--quiet" type="button" onClick={onExit}>
          Skip tour
        </button>
        <div>
          <button
            ref={backButtonRef}
            className="button button--secondary"
            type="button"
            disabled={currentStep === 0}
            onClick={() => changeStep(currentStep - 1, "back")}
          >
            <ChevronLeft size={15} aria-hidden="true" /> Back
          </button>
          {currentStep === WORKSPACE_TOUR_STEP_COUNT - 1 ? (
            <button
              ref={primaryButtonRef}
              className="button button--primary"
              type="button"
              onClick={finish}
            >
              Finish tour
            </button>
          ) : (
            <button
              ref={primaryButtonRef}
              className="button button--primary"
              type="button"
              onClick={() => changeStep(currentStep + 1, "primary")}
            >
              Next <ChevronRight size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </footer>
    </aside>
  );
}
