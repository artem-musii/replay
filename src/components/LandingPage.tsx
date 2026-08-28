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
} from "lucide-react";
import { useState } from "react";
import { DEMO_SCENARIO_METADATA, type DemoScenarioId } from "../domain/demoScenarios";
import { BrandMark } from "./BrandMark";
import { ReplayGuide, type GuideSectionId } from "./ReplayGuide";

interface LandingPageProps {
  webMcpSupported: boolean;
  recentCaseTitle?: string;
  onOpenDemo: () => void;
  onOpenGuidedDemo: () => void;
  onStartBlank: () => void;
  onOpenCollaboration: () => void;
  onOpenScenario?: (id: DemoScenarioId) => void;
  onResumeCase?: () => void;
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

export function LandingPage({
  webMcpSupported,
  recentCaseTitle,
  onOpenDemo,
  onOpenGuidedDemo,
  onStartBlank,
  onOpenCollaboration,
  onOpenScenario,
  onResumeCase,
}: LandingPageProps) {
  const [guideSection, setGuideSection] = useState<GuideSectionId>();
  const isSharedGitHubPagesOrigin = window.location.hostname.endsWith(".github.io");
  return (
    <main className="landing">
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
            Reconstruct a minor road incident with an AI agent while preserving the difference
            between evidence, memory, uncertainty, and inference.
          </p>
          <div className="landing-hero__actions">
            <button className="button button--primary button--large" onClick={onOpenDemo}>
              Open a clean demo <ArrowRight size={17} aria-hidden="true" />
            </button>
            <button className="button button--secondary button--large" onClick={onStartBlank}>
              Start a blank case
            </button>
          </div>
          <button className="guided-demo-link" onClick={onOpenGuidedDemo}>
            <BookOpen size={15} aria-hidden="true" /> Guided demo · about 4 minutes
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
          {recentCaseTitle && onResumeCase && (
            <button className="resume-case" onClick={onResumeCase}>
              <span>Continue local case</span>
              <strong>{recentCaseTitle}</strong>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        <figure className="landing-hero__visual">
          <div className="landing-hero__frame">
            <img
              src={`${import.meta.env.BASE_URL}assets/generated/replay-hero.webp`}
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
              Four synthetic cases cover calibrated contact, braking, crossing movement, and an
              attributable record contradiction. WebMCP reports what conflicts without deciding why
              it conflicts.
            </p>
          </header>
          <div className="scenario-lab__grid">
            {DEMO_SCENARIO_METADATA.map((scenario) => (
              <article
                key={scenario.id}
                className={`scenario-card${scenario.adversarial ? " is-adversarial" : ""}`}
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
                    {scenario.adversarial ? "Contradiction test" : "Plausibility case"}
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
                    aria-label={`Open ${scenario.title}`}
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
          <h2>See the human-agent loop in under three minutes.</h2>
        </div>
        <button className="button button--primary button--large" onClick={onOpenDemo}>
          Open a fresh Roundabout incident — 17:42 <ArrowRight size={17} />
        </button>
      </section>

      <footer className="landing-footer">
        <BrandMark />
        <p>
          Evidence-bound incident documentation. Local-first, open source, and human-controlled.
        </p>
        <span>REPLAY · 2026</span>
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
    </main>
  );
}
