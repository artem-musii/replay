import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  CloudRain,
  CornerDownRight,
  GitFork,
  Map,
  SquareParking,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { RoadSceneType } from "../domain/models";
import { isSharedGitHubPagesHostname } from "../privacy/sharedOrigin";
import { BrandMark } from "./BrandMark";

export interface BlankCaseInput {
  title: string;
  incidentDate?: string;
  approximateTime?: string;
  sceneType: RoadSceneType;
  roadCondition: "wet" | "dry" | "unknown";
  vehicleCount: 2 | 3 | 4;
  initialStatement?: string;
}

interface BlankCaseWizardProps {
  onCancel: () => void;
  onCreate: (input: BlankCaseInput) => void;
}

type WizardStep = 1 | 2 | 3;

const stepHeadings: Record<WizardStep, string> = {
  1: "Name the case.",
  2: "Choose the scene.",
  3: "Record a first statement, if known.",
};

const sceneOptions = [
  {
    id: "roundabout" as const,
    label: "Roundabout",
    helper: "Circular, two-lane template",
    Icon: GitFork,
  },
  {
    id: "intersection" as const,
    label: "Intersection",
    helper: "Four-way road template",
    Icon: Map,
  },
  {
    id: "t-junction" as const,
    label: "T-junction",
    helper: "Major road with one side road",
    Icon: CornerDownRight,
  },
  {
    id: "straight-road" as const,
    label: "Straight road",
    helper: "Rear-end and lane-change cases",
    Icon: ArrowLeftRight,
  },
  {
    id: "parking-area" as const,
    label: "Parking area",
    helper: "Low-speed aisle and reversing",
    Icon: SquareParking,
  },
];

export function BlankCaseWizard({ onCancel, onCreate }: BlankCaseWizardProps) {
  const titleId = useId();
  const titleErrorId = useId();
  const isSharedGitHubPagesOrigin = isSharedGitHubPagesHostname(window.location.hostname);
  const [step, setStep] = useState<WizardStep>(1);
  const [stepAnnouncement, setStepAnnouncement] = useState("");
  const [titleError, setTitleError] = useState<string>();
  const [form, setForm] = useState<BlankCaseInput>({
    title: "Untitled incident",
    sceneType: "roundabout",
    roadCondition: "unknown",
    vehicleCount: 2,
  });
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const focusInvalidTitleAfterNavigationRef = useRef(false);

  useEffect(() => {
    if (!stepAnnouncement) return;
    if (focusInvalidTitleAfterNavigationRef.current) {
      focusInvalidTitleAfterNavigationRef.current = false;
      titleInputRef.current?.focus();
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step, stepAnnouncement]);

  function goToStep(nextStep: WizardStep) {
    setStep(nextStep);
    setStepAnnouncement(`Step ${String(nextStep)} of 3`);
  }

  function normalizedInput(): BlankCaseInput {
    const normalized: BlankCaseInput = {
      ...form,
      title: form.title.trim(),
    };
    const initialStatement = form.initialStatement?.trim();
    if (initialStatement) normalized.initialStatement = initialStatement;
    else delete normalized.initialStatement;
    return normalized;
  }

  function validateTitle(input: BlankCaseInput): boolean {
    if (input.title) {
      setTitleError(undefined);
      return true;
    }
    setTitleError("Enter a case title before continuing.");
    if (step === 1) titleInputRef.current?.focus();
    else {
      focusInvalidTitleAfterNavigationRef.current = true;
      goToStep(1);
    }
    return false;
  }

  function next() {
    if (step === 1) goToStep(2);
    else if (step === 2) goToStep(3);
  }

  function previous() {
    if (step === 1) onCancel();
    else goToStep(step === 3 ? 2 : 1);
  }

  return (
    <main className="wizard-page">
      <header className="wizard-header">
        <BrandMark />
        <span>New local case</span>
      </header>
      <ol className="wizard-progress" aria-label={`Step ${step} of 3`}>
        {[1, 2, 3].map((item) => (
          <li
            key={item}
            className={item <= step ? "is-active" : ""}
            aria-current={item === step ? "step" : undefined}
          >
            <span aria-hidden="true">{item < step ? <Check size={13} /> : item}</span>
            <span className="visually-hidden">
              Step {item}
              {item < step ? ", complete" : item === step ? ", current" : ", not started"}
            </span>
          </li>
        ))}
      </ol>
      <p
        className="visually-hidden wizard-step-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {stepAnnouncement}
      </p>

      <form
        id="main-content"
        tabIndex={-1}
        className="wizard-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const normalized = normalizedInput();
          if (!validateTitle(normalized)) return;
          setForm(normalized);
          if (step < 3) next();
          else onCreate(normalized);
        }}
      >
        <div className="wizard-form__content">
          {isSharedGitHubPagesOrigin && (
            <aside
              className="origin-privacy-warning wizard-origin-warning"
              aria-label="Public demo privacy warning"
            >
              <LockKeyholeSmall />
              <span>
                <strong>Public demo: use synthetic or non-sensitive data.</strong> Browser storage
                shares the owner’s <code>github.io</code> origin with other project sites. Use a
                dedicated origin before entering private evidence.
              </span>
            </aside>
          )}
          {step === 1 && (
            <section className="wizard-step" aria-labelledby="wizard-step-one">
              <p className="eyebrow">
                <span /> Step 1 of 3
              </p>
              <h1 id="wizard-step-one" ref={stepHeadingRef} tabIndex={-1}>
                {stepHeadings[1]}
              </h1>
              <p>Start with what is known. Approximate dates and times can stay approximate.</p>
              <label className="field" htmlFor={titleId}>
                <span>Case title</span>
                <input
                  id={titleId}
                  ref={titleInputRef}
                  value={form.title}
                  required
                  autoFocus
                  maxLength={100}
                  aria-invalid={titleError ? "true" : undefined}
                  aria-describedby={titleError ? titleErrorId : undefined}
                  onChange={(event) => {
                    const title = event.target.value;
                    setForm({ ...form, title });
                    if (titleError && title.trim()) setTitleError(undefined);
                  }}
                />
                {titleError && (
                  <small id={titleErrorId} className="field__error" role="alert">
                    {titleError}
                  </small>
                )}
              </label>
              <div className="field-row">
                <label className="field">
                  <span>
                    Incident date <small>optional</small>
                  </span>
                  <input
                    type="date"
                    value={form.incidentDate ?? ""}
                    onChange={(event) =>
                      setForm((current) => {
                        const next = { ...current };
                        if (event.target.value) next.incidentDate = event.target.value;
                        else delete next.incidentDate;
                        return next;
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>
                    Approximate time <small>optional</small>
                  </span>
                  <input
                    type="time"
                    value={form.approximateTime ?? ""}
                    onChange={(event) =>
                      setForm((current) => {
                        const next = { ...current };
                        if (event.target.value) next.approximateTime = event.target.value;
                        else delete next.approximateTime;
                        return next;
                      })
                    }
                  />
                </label>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="wizard-step" aria-labelledby="wizard-step-two">
              <p className="eyebrow">
                <span /> Step 2 of 3
              </p>
              <h1 id="wizard-step-two" ref={stepHeadingRef} tabIndex={-1}>
                {stepHeadings[2]}
              </h1>
              <p>This starts a geometry template. Everything remains editable in the workspace.</p>
              <fieldset className="choice-fieldset">
                <legend>Scene type</legend>
                <div className="scene-choice-grid">
                  {sceneOptions.map(({ id, label, helper, Icon }) => (
                    <label
                      key={id}
                      className={form.sceneType === id ? "choice-tile is-selected" : "choice-tile"}
                    >
                      <input
                        type="radio"
                        name="sceneType"
                        value={id}
                        checked={form.sceneType === id}
                        onChange={() => setForm({ ...form, sceneType: id })}
                      />
                      <Icon size={24} aria-hidden="true" />
                      <strong>{label}</strong>
                      <span>{helper}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="field-row">
                <label className="field">
                  <span>
                    <CloudRain size={15} /> Road condition
                  </span>
                  <select
                    value={form.roadCondition}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        roadCondition: event.target.value as BlankCaseInput["roadCondition"],
                      })
                    }
                  >
                    <option value="unknown">Not known yet</option>
                    <option value="dry">Dry</option>
                    <option value="wet">Wet</option>
                  </select>
                </label>
                <label className="field">
                  <span>Vehicles</span>
                  <select
                    value={form.vehicleCount}
                    onChange={(event) =>
                      setForm({ ...form, vehicleCount: Number(event.target.value) as 2 | 3 | 4 })
                    }
                  >
                    <option value={2}>2 vehicles</option>
                    <option value={3}>3 vehicles</option>
                    <option value={4}>4 vehicles</option>
                  </select>
                </label>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="wizard-step" aria-labelledby="wizard-step-three">
              <p className="eyebrow">
                <span /> Step 3 of 3
              </p>
              <h1 id="wizard-step-three" ref={stepHeadingRef} tabIndex={-1}>
                {stepHeadings[3]}
              </h1>
              <p>
                Use plain language. REPLAY stores this as reported, never automatically confirmed.
              </p>
              <label className="field">
                <span>
                  Initial factual statement <small>optional</small>
                </span>
                <textarea
                  rows={7}
                  maxLength={1500}
                  placeholder="For example: Vehicle A and Vehicle B were present; their exact movements are not yet established…"
                  value={form.initialStatement ?? ""}
                  autoFocus
                  onChange={(event) =>
                    setForm((current) => {
                      const next = { ...current };
                      if (event.target.value) next.initialStatement = event.target.value;
                      else delete next.initialStatement;
                      return next;
                    })
                  }
                />
                <small className="field__hint">
                  Stored as a human statement with reported status.
                </small>
              </label>
              <div className="wizard-summary">
                <span>{form.sceneType}</span>
                <span>{form.roadCondition} road</span>
                <span>{form.vehicleCount} vehicles</span>
              </div>
            </section>
          )}
        </div>

        <footer className="wizard-actions">
          <button type="button" className="button button--quiet" onClick={previous}>
            <ArrowLeft size={16} /> {step === 1 ? "Back to REPLAY" : "Previous"}
          </button>
          <button type="submit" className="button button--primary">
            {step === 3 ? "Create local case" : "Continue"} <ArrowRight size={16} />
          </button>
        </footer>
      </form>
      <aside className="wizard-aside" aria-label="Privacy note">
        <LockKeyholeSmall />
        <p>
          <strong>Stored locally.</strong> Site Tools can share structured case fields with the
          connected agent; uploaded image bytes stay in this browser.
        </p>
      </aside>
    </main>
  );
}

function LockKeyholeSmall() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}
