import {
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  CircleDotDashed,
  FileCheck2,
  Gauge,
  LockKeyhole,
  MousePointer2,
  Route,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEMO_SCENARIO_METADATA, type DemoScenarioId } from "../domain/demoScenarios";
import { BrandMark } from "./BrandMark";
import { ReplayGuide, type GuideSectionId } from "./ReplayGuide";
import { useDialogFocus } from "./useDialogFocus";

interface LandingPageProps {
  webMcpSupported: boolean;
  localCases?: LandingLocalCase[];
  onOpenDemo: () => void;
  onOpenGuidedDemo: () => void;
  onStartBlank: () => void;
  onOpenCollaboration: () => void;
  onOpenScenario?: (id: DemoScenarioId) => void;
  onOpenLocalCase?: (caseId: string) => void;
  onDeleteLocalCase?: (caseId: string) => Promise<void>;
}

export interface LandingLocalCase {
  id: string;
  title: string;
  updatedAt: string;
  caseVersion: number;
  isDemo: boolean;
}

const steps = [
  {
    number: "01",
    title: "Reconstruct",
    text: "Place vehicles, shape trajectories, and synchronize the scene with a shared timeline.",
    Icon: MousePointer2,
  },
  {
    number: "02",
    title: "Resolve uncertainty",
    text: "Keep observations, memory, disputes, and agent hypotheses visibly separate.",
    Icon: CircleDotDashed,
  },
  {
    number: "03",
    title: "Produce a factual report",
    text: "Export a neutral account where every substantive statement retains its source.",
    Icon: FileCheck2,
  },
];

const localCaseTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

function formatLocalCaseTime(value: string): string {
  return localCaseTimeFormatter.format(new Date(value));
}

const SOURCE_REPOSITORY_URL = "https://github.com/artem-musii/replay";
const MIT_LICENSE_URL = `${SOURCE_REPOSITORY_URL}/blob/main/LICENSE`;

export function LandingPage({
  webMcpSupported,
  localCases = [],
  onOpenDemo,
  onOpenGuidedDemo,
  onStartBlank,
  onOpenCollaboration,
  onOpenScenario,
  onOpenLocalCase,
  onDeleteLocalCase,
}: LandingPageProps) {
  const [guideSection, setGuideSection] = useState<GuideSectionId>();
  const [deleteCandidate, setDeleteCandidate] = useState<LandingLocalCase>();
  const [deletingCaseId, setDeletingCaseId] = useState<string>();
  const [deleteError, setDeleteError] = useState(false);
  const [deleteAnnouncement, setDeleteAnnouncement] = useState<string>();
  const deleteInFlightRef = useRef(false);
  const deleteCancelButtonRef = useRef<HTMLButtonElement>(null);
  const deleteDialogRef = useDialogFocus<HTMLElement>({
    active: Boolean(deleteCandidate),
    initialFocusRef: deleteCancelButtonRef,
    onEscape: () => {
      if (deleteInFlightRef.current) return;
      setDeleteCandidate(undefined);
      setDeleteError(false);
    },
  });
  const isSharedGitHubPagesOrigin = window.location.hostname.endsWith(".github.io");

  useEffect(() => {
    if (!deleteAnnouncement) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("local-case-delete-status")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [deleteAnnouncement]);

  async function confirmLocalCaseDeletion(): Promise<void> {
    if (!deleteCandidate || !onDeleteLocalCase || deleteInFlightRef.current) return;
    deleteInFlightRef.current = true;
    setDeletingCaseId(deleteCandidate.id);
    setDeleteError(false);
    try {
      await onDeleteLocalCase(deleteCandidate.id);
      setDeleteAnnouncement(`Deleted ${deleteCandidate.title} from this browser.`);
      setDeleteCandidate(undefined);
    } catch {
      setDeleteError(true);
    } finally {
      deleteInFlightRef.current = false;
      setDeletingCaseId(undefined);
    }
  }

  function requestLocalCaseDeletion(localCase: LandingLocalCase): void {
    if (deleteInFlightRef.current) return;
    setDeleteAnnouncement(undefined);
    setDeleteError(false);
    setDeleteCandidate(localCase);
  }

  return (
    <main className="landing" id="top">
      <nav className="landing-nav" aria-label="Primary navigation">
        <a href="#top" className="landing-nav__brand">
          <BrandMark />
        </a>
        <div className="landing-nav__meta">
          <span className={`compatibility-pill ${webMcpSupported ? "is-supported" : ""}`}>
            <span className="compatibility-pill__dot" aria-hidden="true" />
            {webMcpSupported ? "Site Tools compatible" : "Manual mode ready"}
          </span>
          <a href="#privacy">Privacy</a>
          <button
            className="text-button landing-guide-button"
            onClick={() => setGuideSection("quick-start")}
          >
            <BookOpen size={14} aria-hidden="true" /> How to use REPLAY
          </button>
          <button className="text-button" onClick={onOpenCollaboration}>
            How collaboration works
          </button>
        </div>
      </nav>

      <section className="landing-hero" id="main-content" tabIndex={-1}>
        <div className="landing-hero__copy">
          <p className="eyebrow">
            <span /> Shared incident reconstruction
          </p>
          <h1>A shared black box for incidents that did not have one.</h1>
          <p className="landing-hero__lede">
            Reconstruct a minor road incident with an AI agent working through WebMCP Site Tools,
            while preserving the difference between evidence, memory, uncertainty, and inference.
          </p>
          <div className="landing-hero__actions">
            <button className="button button--primary button--large" onClick={onOpenDemo}>
              Open Roundabout demo <ArrowRight size={17} aria-hidden="true" />
            </button>
            <button className="button button--secondary button--large" onClick={onStartBlank}>
              Start a blank case
            </button>
          </div>
          <button className="guided-demo-link" onClick={onOpenGuidedDemo}>
            <BookOpen size={15} aria-hidden="true" /> Take the 6-step guided tour
          </button>
          <ul className="landing-hero__assurances" aria-label="Product assurances">
            <li>
              <LockKeyhole size={14} /> Local-first
            </li>
            <li>
              <CheckCircle2 size={14} /> No account
            </li>
            <li>
              <ShieldCheck size={14} /> Human-approved reports
            </li>
          </ul>
        </div>
        <figure className="landing-hero__visual">
          <div className="landing-hero__frame">
            <img
              src={`${import.meta.env.BASE_URL}assets/generated/replay-hero.webp`}
              srcSet={`${import.meta.env.BASE_URL}assets/generated/replay-hero-640.webp 640w, ${import.meta.env.BASE_URL}assets/generated/replay-hero-1200.webp 1200w, ${import.meta.env.BASE_URL}assets/generated/replay-hero.webp 1672w`}
              sizes="(max-width: 540px) calc(100vw - 62px), (max-width: 800px) calc(100vw + 100px), 60vw"
              width="1672"
              height="941"
              alt="Editorial top-down illustration of a roundabout reconstruction with two vehicles, trajectories, evidence photographs, a timeline, and provenance nodes."
              fetchPriority="high"
            />
            <figcaption>
              <span className="visual-caption__index">CASE 04 / 17:42</span>
              <span>Scene, time, and provenance in one model</span>
            </figcaption>
          </div>
        </figure>
      </section>

      {deleteAnnouncement && (
        <p
          className="local-case-delete-status"
          id="local-case-delete-status"
          role="status"
          tabIndex={-1}
        >
          <CheckCircle2 size={17} aria-hidden="true" />
          {deleteAnnouncement}
        </p>
      )}

      {localCases.length > 0 && onOpenLocalCase && (
        <section className="local-case-library" aria-labelledby="local-cases-title">
          <header className="local-case-library__heading">
            <div>
              <p className="section-kicker">This browser</p>
              <h2 id="local-cases-title">Your local cases</h2>
            </div>
            <p>
              Reopen any retained case. Site Tools may share structured case fields with the
              connected agent; uploaded image bytes stay in this browser.
            </p>
          </header>
          <ul aria-label="Local cases">
            {localCases.map((localCase, index) => (
              <li key={localCase.id}>
                <div className="local-case-item">
                  <button
                    className="local-case-row"
                    aria-label={`Open local case: ${localCase.title} (${String(index + 1)} of ${String(localCases.length)})`}
                    onClick={() => onOpenLocalCase(localCase.id)}
                  >
                    <span className="local-case-row__kind">
                      {localCase.isDemo ? "Demo run" : "Local case"}
                      {index === 0 && <small>Most recent</small>}
                    </span>
                    <strong>{localCase.title}</strong>
                    <span className="local-case-row__details">
                      <span>v{localCase.caseVersion}</span>
                      <time dateTime={localCase.updatedAt}>
                        Updated {formatLocalCaseTime(localCase.updatedAt)}
                      </time>
                    </span>
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                  {onDeleteLocalCase && (
                    <button
                      className="local-case-row__delete"
                      type="button"
                      aria-label={`Delete local case: ${localCase.title}`}
                      title={`Delete ${localCase.title} from this browser`}
                      onClick={() => requestLocalCaseDeletion(localCase)}
                    >
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="landing-thesis" aria-labelledby="thesis-title">
        <p className="section-kicker">One inspectable account</p>
        <h2 id="thesis-title">Chat can describe an incident. REPLAY lets you inspect it.</h2>
        <p>
          Geometry, timing, provenance, and competing explanations do not fit safely inside a
          paragraph. REPLAY gives a person and an agent the same live, structured workspace.
        </p>
      </section>

      <section className="landing-steps" aria-label="How REPLAY works">
        {steps.map(({ number, title, text, Icon }) => (
          <article className="landing-step" key={number}>
            <div className="landing-step__heading">
              <span className="landing-step__number">{number}</span>
              <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
            </div>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>

      {onOpenScenario && (
        <section className="scenario-lab" aria-labelledby="scenario-lab-title">
          <header className="scenario-lab__heading">
            <div>
              <p className="section-kicker">Deterministic scenario lab</p>
              <h2 id="scenario-lab-title">Test the model on roads that behave differently.</h2>
            </div>
            <p>
              Four synthetic cases cover calibrated contact, high-speed braking, crossing movement,
              and an attributable record contradiction. WebMCP reports what conflicts without
              deciding why it conflicts.
            </p>
          </header>
          <div className="scenario-lab__grid">
            {DEMO_SCENARIO_METADATA.map((scenario) => (
              <article
                key={scenario.id}
                className={`scenario-card${scenario.adversarial ? " is-adversarial" : ""}${scenario.highSpeed ? " is-high-speed" : ""}`}
              >
                <div className="scenario-card__meta">
                  <span>
                    {scenario.adversarial ? (
                      <ShieldAlert size={14} aria-hidden="true" />
                    ) : scenario.validationFocus.includes("motion") ? (
                      <Gauge size={14} aria-hidden="true" />
                    ) : (
                      <Route size={14} aria-hidden="true" />
                    )}
                    {scenario.adversarial
                      ? "Contradiction test"
                      : scenario.highSpeed
                        ? "High-speed review"
                        : "Plausibility case"}
                  </span>
                  <small>{scenario.sceneType.replaceAll("-", " ")}</small>
                </div>
                <h3>{scenario.title}</h3>
                <p>{scenario.summary}</p>
                <footer>
                  <small>{scenario.validationFocus.join(" · ")}</small>
                  <button
                    className="text-button"
                    onClick={() => onOpenScenario(scenario.id)}
                    aria-label={`Open case: ${scenario.title}`}
                  >
                    Open case <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      <section
        className="collaboration-section"
        id="collaboration"
        aria-labelledby="collaboration-title"
      >
        <div className="collaboration-section__intro">
          <p className="section-kicker">Why Site Tools matter</p>
          <h2 id="collaboration-title">The agent works inside your case, not beside it.</h2>
          <p>
            Site Tools expose narrow, validated actions through WebMCP. The agent reads the live
            case and works through the same validated state you see. Durable mutations are
            attributed in activity, and eligible agent work can be reverted while it remains safe.
          </p>
        </div>
        <ol className="collaboration-loop">
          <li>
            <span>Human</span>
            <strong>Corrects Vehicle B on the scene</strong>
            <small>Direct manipulation</small>
          </li>
          <li>
            <span>REPLAY</span>
            <strong>Records the override and revalidates</strong>
            <small>Deterministic command</small>
          </li>
          <li>
            <span>Agent</span>
            <strong>Reads the change and branches uncertainty</strong>
            <small>WebMCP Site Tool</small>
          </li>
          <li>
            <span>Human</span>
            <strong>Compares, confirms, or disputes</strong>
            <small>Final authority</small>
          </li>
        </ol>
        <div className="collaboration-note">
          <Bot size={18} aria-hidden="true" />
          <p>
            Agent inferences can never become confirmed facts. Report finalization always requires a
            visible human review.
          </p>
        </div>
        <button className="collaboration-guide-link" onClick={() => setGuideSection("site-tools")}>
          Learn how to use Site Tools <ArrowRight size={15} aria-hidden="true" />
        </button>
      </section>

      <section className="privacy-section" id="privacy" aria-labelledby="privacy-title">
        <div>
          <p className="section-kicker">Private by default</p>
          <h2 id="privacy-title">Local by default, explicit when shared.</h2>
        </div>
        <div className="privacy-section__body">
          <p>
            REPLAY stores cases and uploaded evidence locally. There is no REPLAY account,
            analytics, app-owned model API, or external evidence upload. Demo photographs are
            original synthetic assets and never represent a real incident.
          </p>
          <p>
            If you use Site Tools, the structured case fields returned by a tool can be processed by
            the connected ChatGPT, Codex, or model service. REPLAY tools never return uploaded image
            bytes. Manual mode sends no case data to an agent.
          </p>
          <p>
            Browser storage is best-effort and is not encrypted by REPLAY. A structured JSON export
            excludes evidence bytes, and importing it resets human attestations for fresh review.
          </p>
          {isSharedGitHubPagesOrigin && (
            <p className="safety-copy">
              This public GitHub Pages demo shares a web origin with the owner’s other project
              sites. Use synthetic or non-sensitive data here; deploy REPLAY on a dedicated origin
              before handling private evidence.
            </p>
          )}
          <p className="safety-copy">
            REPLAY helps organize and visualize a factual account. Its consistency checks are
            informational and are not a forensic or legal determination.
          </p>
        </div>
      </section>

      <section className="landing-closing">
        <div>
          <p className="section-kicker">A complete case is already waiting</p>
          <h2>Explore a complete case in under three minutes.</h2>
        </div>
        <button className="button button--primary button--large" onClick={onOpenDemo}>
          Open fresh Roundabout demo <ArrowRight size={17} />
        </button>
      </section>

      <footer className="landing-footer">
        <BrandMark />
        <p>
          Evidence-bound incident documentation. Local-first, open source, and human-controlled.
        </p>
        <span className="landing-footer__meta">
          <span>REPLAY · 2026</span>
          <a href={SOURCE_REPOSITORY_URL} target="_blank" rel="noreferrer">
            Source
          </a>
          <a href={MIT_LICENSE_URL} target="_blank" rel="noreferrer">
            MIT License
          </a>
          <a
            href={`${import.meta.env.BASE_URL}licenses/inter-OFL-1.1.txt`}
            target="_blank"
            rel="noreferrer"
          >
            Inter font license
          </a>
          <a
            href={`${import.meta.env.BASE_URL}licenses/noto-sans-Apache-2.0.txt`}
            target="_blank"
            rel="noreferrer"
          >
            Noto Sans license
          </a>
        </span>
      </footer>
      {guideSection && (
        <ReplayGuide
          key={guideSection}
          context="landing"
          webMcpSupported={webMcpSupported}
          initialSection={guideSection}
          onClose={() => setGuideSection(undefined)}
          onOpenGuidedDemo={onOpenGuidedDemo}
        />
      )}
      {deleteCandidate && (
        <div className="dialog-backdrop" role="presentation">
          <section
            ref={deleteDialogRef}
            className="dialog confirm-dialog local-case-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="local-case-delete-title"
            aria-describedby="local-case-delete-description local-case-delete-boundary"
            aria-busy={deletingCaseId === deleteCandidate.id}
            tabIndex={-1}
          >
            <div className="dialog-icon is-destructive">
              <Trash2 size={20} aria-hidden="true" />
            </div>
            <h2 id="local-case-delete-title">Delete “{deleteCandidate.title}”?</h2>
            <p id="local-case-delete-description">
              This permanently removes the saved case and its locally stored evidence from this
              browser. Exported files are not affected, and previously shared information cannot be
              retracted by REPLAY.
            </p>
            <p className="local-case-delete-dialog__boundary" id="local-case-delete-boundary">
              Site Tools cannot request or confirm this deletion. It only runs from this visible
              human control.
            </p>
            {deleteError && (
              <p className="local-case-delete-dialog__error" role="alert">
                REPLAY could not finish removing this case. It remains listed so you can retry.
                Check that browser storage is available.
              </p>
            )}
            <footer>
              <button
                ref={deleteCancelButtonRef}
                className="button button--quiet"
                type="button"
                disabled={deletingCaseId === deleteCandidate.id}
                onClick={() => {
                  setDeleteCandidate(undefined);
                  setDeleteError(false);
                }}
              >
                Keep case
              </button>
              <button
                className="button button--danger"
                type="button"
                disabled={deletingCaseId === deleteCandidate.id}
                onClick={() => void confirmLocalCaseDeletion()}
              >
                {deletingCaseId === deleteCandidate.id ? "Deleting…" : "Delete local case"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
