import { ArrowLeft, ArrowRight, Check, CloudRain, GitFork, Map } from "lucide-react";
import { useId, useState } from "react";
import { BrandMark } from "./BrandMark";

export interface BlankCaseInput {
  title: string;
  incidentDate?: string;
  approximateTime?: string;
  sceneType: "roundabout" | "intersection";
  roadCondition: "wet" | "dry" | "unknown";
  vehicleCount: 2 | 3 | 4;
  initialStatement?: string;
}

interface BlankCaseWizardProps {
  onCancel: () => void;
  onCreate: (input: BlankCaseInput) => void;
}

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
];

export function BlankCaseWizard({ onCancel, onCreate }: BlankCaseWizardProps) {
  const titleId = useId();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<BlankCaseInput>({
    title: "Untitled incident",
    sceneType: "roundabout",
    roadCondition: "unknown",
    vehicleCount: 2,
  });

  function next() {
    setStep((current) => Math.min(3, current + 1));
  }

  function previous() {
    if (step === 1) onCancel();
    else setStep((current) => current - 1);
  }

  return (
    <main className="wizard-page" id="main-content">
      <header className="wizard-header">
        <BrandMark />
        <span>New local case</span>
      </header>
      <div className="wizard-progress" aria-label={`Step ${step} of 3`}>
        {[1, 2, 3].map((item) => (
          <span key={item} className={item <= step ? "is-active" : ""}>
            {item < step ? <Check size={13} /> : item}
          </span>
        ))}
      </div>

      <form
        className="wizard-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (step < 3) next();
          else onCreate(form);
        }}
      >
        {step === 1 && (
          <section className="wizard-step" aria-labelledby="wizard-step-one">
            <p className="eyebrow">
              <span /> Step 1 of 3
            </p>
            <h1 id="wizard-step-one">Name the account.</h1>
            <p>Start with what is known. Approximate dates and times can stay approximate.</p>
            <label className="field" htmlFor={titleId}>
              <span>Case title</span>
              <input
                id={titleId}
                value={form.title}
                required
                autoFocus
                maxLength={100}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
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
            <h1 id="wizard-step-two">Choose the scene.</h1>
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
            <h1 id="wizard-step-three">Record the first statement.</h1>
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
                placeholder="For example: Vehicle A was leaving the roundabout when contact occurred…"
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
          <strong>Nothing leaves this browser.</strong> You can export or delete the case whenever
          you choose.
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
