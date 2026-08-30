import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Database,
  FileCheck2,
  LoaderCircle,
  MessageCircleQuestion,
  RefreshCw,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  rankOpenQuestions,
  reportPreviewHasValidReviewBinding,
  validateCurrentReportPreview,
  type AgentProposal,
  type OpenQuestion,
  type ReplayCase,
  type ReportPreview,
} from "../domain";
import { FinalizationDialog } from "./InspectorPanel";
import { isProposalStale, simpleStageForCase, type SimpleStage } from "./simpleWorkspaceState";

interface SimpleWorkspaceProps {
  replayCase: ReplayCase;
  reportPreview?: ReportPreview | undefined;
  agentWorking?: string | undefined;
  siteToolsSupported: boolean;
  siteToolsError: boolean;
  mutationBlocked?: string | undefined;
  onAskAgent: () => void | Promise<void>;
  onAcceptProposal: (proposalId: string) => boolean;
  onRejectProposal: (proposalId: string) => boolean;
  onBuildReport: () => void;
  onFinalizeReport: (preview: ReportPreview) => boolean;
}

function relatedEvidence(replayCase: ReplayCase, question: OpenQuestion | undefined) {
  if (!question) return [];
  const claimIds = new Set(question.relatedClaimIds);
  const evidenceIds = new Set(
    replayCase.claims
      .filter((claim) => claimIds.has(claim.id))
      .flatMap((claim) => claim.linkedEvidenceIds),
  );
  for (const asset of replayCase.evidence) {
    if (
      asset.linkedClaimIds.some((id) => claimIds.has(id)) ||
      asset.linkedSceneObjectIds.some((id) => question.relatedSceneObjectIds.includes(id))
    ) {
      evidenceIds.add(asset.id);
    }
  }
  return replayCase.evidence.filter((asset) => !asset.deleted && evidenceIds.has(asset.id));
}

function stageIndex(stage: SimpleStage): number {
  return stage === "review" ? 0 : stage === "decide" ? 1 : 2;
}

function SimpleProgress({ stage }: { stage: SimpleStage }) {
  const current = stageIndex(stage);
  const steps: Array<{ id: SimpleStage; label: string }> = [
    { id: "review", label: "Review" },
    { id: "decide", label: "Decide" },
    { id: "report", label: "Report" },
  ];
  return (
    <ol className="simple-progress" aria-label="Simple review progress">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={index === current ? "is-current" : index < current ? "is-complete" : ""}
          aria-current={index === current ? "step" : undefined}
        >
          <span>{index < current ? <Check size={13} aria-hidden="true" /> : index + 1}</span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

function ReviewStage({
  question,
  evidenceCount,
  agentWorking,
  siteToolsSupported,
  siteToolsError,
  mutationBlocked,
  onAskAgent,
}: {
  question?: OpenQuestion | undefined;
  evidenceCount: number;
  agentWorking?: string | undefined;
  siteToolsSupported: boolean;
  siteToolsError: boolean;
  mutationBlocked?: string | undefined;
  onAskAgent: () => void | Promise<void>;
}) {
  return (
    <section className="simple-stage" aria-labelledby="simple-review-title">
      <header className="simple-stage__heading">
        <span>Step 1</span>
        <h2 id="simple-review-title">Review the open question</h2>
        <p>The scene and timeline stay unchanged while the agent prepares a reviewable option.</p>
      </header>
      {question ? (
        <article className="simple-question">
          <div className="simple-question__icon">
            <MessageCircleQuestion size={20} aria-hidden="true" />
          </div>
          <div>
            <span>{question.importance === "blocking" ? "Key blocker" : "Key question"}</span>
            <h3>{question.question}</h3>
            <p>{question.reason}</p>
          </div>
        </article>
      ) : (
        <div className="simple-empty" role="status">
          <CheckCircle2 size={22} aria-hidden="true" />
          <div>
            <strong>No unresolved question is recorded</strong>
            <p>Switch to Expert mode to add or inspect questions before asking for a review.</p>
          </div>
        </div>
      )}
      <div className="simple-check-scope" aria-label="Agent review scope">
        <strong>What the agent will check</strong>
        <ul>
          <li>Current vehicle paths and timing</li>
          <li>
            {evidenceCount} related evidence item{evidenceCount === 1 ? "" : "s"} and their links
          </li>
          <li>Contradictions, missing support, and uncertainty</li>
        </ul>
      </div>
      {agentWorking && (
        <div className="simple-loading" role="status" aria-live="polite">
          <LoaderCircle size={18} aria-hidden="true" />
          <div>
            <strong>Agent is reviewing the live case</strong>
            <span>{agentWorking.replaceAll("_", " ")}</span>
          </div>
        </div>
      )}
      {siteToolsError && (
        <div className="simple-error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Site Tools did not finish registering</strong>
            <span>Retry in Expert mode, or continue with the manual workspace.</span>
          </div>
        </div>
      )}
      <button
        className="button button--primary button--large simple-primary-action"
        type="button"
        disabled={!question || Boolean(agentWorking) || Boolean(mutationBlocked)}
        onClick={() => void onAskAgent()}
      >
        {agentWorking ? <LoaderCircle className="is-spinning" size={17} /> : <Bot size={17} />}
        {agentWorking ? "Agent is reviewing…" : "Ask agent to review"}
      </button>
      <p className="simple-action-help">
        {mutationBlocked ??
          (siteToolsSupported
            ? "Copies a native Site Tools request. It does not authorize computer or browser control."
            : "Copies a Site Tools-only request. If Site Tools are unavailable, the agent must stop instead of controlling the browser.")}
      </p>
    </section>
  );
}

function DecideStage({
  replayCase,
  proposal,
  question,
  evidence,
  mutationBlocked,
  onAcceptProposal,
  onRejectProposal,
}: {
  replayCase: ReplayCase;
  proposal: AgentProposal;
  question?: OpenQuestion | undefined;
  evidence: ReturnType<typeof relatedEvidence>;
  mutationBlocked?: string | undefined;
  onAcceptProposal: (proposalId: string) => boolean;
  onRejectProposal: (proposalId: string) => boolean;
}) {
  const [decisionError, setDecisionError] = useState<string>();
  const revision = proposal.revisions.at(-1);
  const stale = isProposalStale(replayCase, proposal);
  const disputes = replayCase.claims.filter((claim) => claim.status === "disputed");
  const contradictions = replayCase.consistencyIssues.filter(
    (issue) => issue.severity === "error" || issue.severity === "warning",
  );
  const actorLabels = new Map(replayCase.actors.map((actor) => [actor.id, actor.label]));
  const changedActors = [
    ...new Set(
      revision?.changes.map((change) => actorLabels.get(change.actorId) ?? change.actorId),
    ),
  ];
  function decide(outcome: "accepted" | "rejected") {
    setDecisionError(undefined);
    const decided =
      outcome === "accepted" ? onAcceptProposal(proposal.id) : onRejectProposal(proposal.id);
    if (!decided) {
      setDecisionError(
        outcome === "accepted"
          ? "This proposal no longer matches the current scene. Ask the agent for a fresh review."
          : "The decision could not be recorded. Resolve the save or editing notice and try again.",
      );
    }
  }
  return (
    <section className="simple-stage" aria-labelledby="simple-decide-title">
      <header className="simple-stage__heading">
        <span>Step 2</span>
        <h2 id="simple-decide-title">Decide on the proposal</h2>
        <p>Agent inference is shown separately. It is not evidence and it is not confirmed.</p>
      </header>
      <article className="simple-proposal">
        <div className="simple-proposal__label">
          <Bot size={15} aria-hidden="true" /> Agent proposal
        </div>
        <h3>{proposal.title}</h3>
        <p>{proposal.rationale}</p>
        <dl>
          <div>
            <dt>Suggested change</dt>
            <dd>{changedActors.length ? changedActors.join(" and ") : "No current target"}</dd>
          </div>
          <div>
            <dt>Explanation</dt>
            <dd>{revision?.summary ?? "No reviewable revision is available."}</dd>
          </div>
        </dl>
      </article>
      <div className="simple-source-register">
        <section>
          <span className="simple-source-register__kind is-evidence">
            <Database size={14} /> Evidence in scope
          </span>
          {evidence.length ? (
            <ul>
              {evidence.slice(0, 3).map((asset) => (
                <li key={asset.id}>{asset.name}</li>
              ))}
            </ul>
          ) : (
            <p>No linked evidence establishes the proposal.</p>
          )}
        </section>
        <section>
          <span className="simple-source-register__kind is-memory">
            <Scale size={14} /> Human statements
          </span>
          <p>
            {question?.relatedClaimIds.length
              ? `${String(question.relatedClaimIds.length)} related statement${question.relatedClaimIds.length === 1 ? "" : "s"}, kept as reported or disputed until a person confirms a claim.`
              : "No related human statement is linked to this question."}
          </p>
        </section>
        <section>
          <span className="simple-source-register__kind is-uncertain">
            <MessageCircleQuestion size={14} /> Uncertainty
          </span>
          <p>{question?.reason ?? "The proposal does not resolve the open factual record."}</p>
        </section>
        <section>
          <span className="simple-source-register__kind is-dispute">
            <AlertTriangle size={14} /> Possible contradictions
          </span>
          <p>
            {disputes.length || contradictions.length
              ? `${String(disputes.length)} disputed statement${disputes.length === 1 ? "" : "s"}; ${String(contradictions.length)} consistency warning${contradictions.length === 1 ? "" : "s"}.`
              : "No current dispute or consistency warning is linked."}
          </p>
        </section>
      </div>
      {stale && (
        <div className="simple-stale" role="alert">
          <RefreshCw size={18} aria-hidden="true" />
          <div>
            <strong>This proposal is stale</strong>
            <span>
              The scene changed after this revision. Reject it and request a fresh review.
            </span>
          </div>
        </div>
      )}
      {decisionError && (
        <p className="simple-decision-error" role="alert">
          {decisionError}
        </p>
      )}
      <div className="simple-decision-actions">
        <button
          className="button button--secondary button--large"
          type="button"
          disabled={Boolean(mutationBlocked)}
          onClick={() => decide("rejected")}
        >
          Reject
        </button>
        <button
          className="button button--primary button--large"
          type="button"
          disabled={stale || Boolean(mutationBlocked)}
          onClick={() => decide("accepted")}
        >
          <Check size={17} /> Accept proposal
        </button>
      </div>
      <p className="simple-action-help">
        Only this human UI action can apply the proposal. It does not confirm any claim.
      </p>
    </section>
  );
}

function ReportStage({
  replayCase,
  reportPreview,
  mutationBlocked,
  onBuildReport,
  onFinalizeReport,
}: {
  replayCase: ReplayCase;
  reportPreview?: ReportPreview | undefined;
  mutationBlocked?: string | undefined;
  onBuildReport: () => void;
  onFinalizeReport: (preview: ReportPreview) => boolean;
}) {
  const [reviewRequested, setReviewRequested] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const latestSnapshot = replayCase.reportSnapshots.at(-1);
  const preview = latestSnapshot?.preview ?? reportPreview;
  const confirmed = replayCase.claims.filter(
    (claim) => claim.status === "confirmed" && claim.humanConfirmed,
  );
  const unresolved = replayCase.questions.filter(
    (question) => question.status === "open" || question.status === "deferred",
  );
  const evidence = replayCase.evidence.filter((asset) => !asset.deleted);
  const previewErrors = reportPreview
    ? validateCurrentReportPreview(replayCase, reportPreview).filter(
        (issue) => issue.severity === "error",
      )
    : [];
  const previewReady = reportPreview
    ? reportPreview.caseVersion === replayCase.caseVersion &&
      reportPreviewHasValidReviewBinding(reportPreview) &&
      reportPreview.missingRequirements.length === 0 &&
      replayCase.consistencyIssues.every((issue) => issue.severity !== "error") &&
      previewErrors.length === 0
    : false;
  const showReview = reviewOpen || (reviewRequested && Boolean(reportPreview));
  function reviewReport() {
    if (!reportPreview) {
      setReviewRequested(true);
      onBuildReport();
      return;
    }
    setReviewOpen(true);
  }
  return (
    <section className="simple-stage" aria-labelledby="simple-report-title">
      <header className="simple-stage__heading">
        <span>Step 3</span>
        <h2 id="simple-report-title">Review the factual report</h2>
        <p>Confirmed material, unresolved details, and sources remain visibly separate.</p>
      </header>
      <div className="simple-report-summary">
        <section>
          <span className="is-confirmed">
            <CheckCircle2 size={16} /> Confirmed by a person
          </span>
          <strong>{confirmed.length}</strong>
          <p>{confirmed[0]?.statement ?? "No claim has been human-confirmed yet."}</p>
        </section>
        <section>
          <span className="is-uncertain">
            <MessageCircleQuestion size={16} /> Still uncertain
          </span>
          <strong>{unresolved.length}</strong>
          <p>{unresolved[0]?.question ?? "No unresolved question is recorded."}</p>
        </section>
        <section>
          <span className="is-evidence">
            <Database size={16} /> Sources used
          </span>
          <strong>{preview?.includedEvidenceIds.length ?? evidence.length}</strong>
          <p>
            {evidence.length
              ? evidence
                  .slice(0, 2)
                  .map((asset) => asset.name)
                  .join(", ")
              : "No evidence source is indexed."}
          </p>
        </section>
      </div>
      {reportPreview && reportPreview.caseVersion !== replayCase.caseVersion && (
        <div className="simple-stale" role="alert">
          <RefreshCw size={18} aria-hidden="true" />
          <div>
            <strong>The report preview is stale</strong>
            <span>The case changed. Build a fresh preview before final review.</span>
          </div>
        </div>
      )}
      {reportPreview?.missingRequirements.length ? (
        <div className="simple-error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Report is not ready for final review</strong>
            <span>{reportPreview.missingRequirements.join("; ")}</span>
          </div>
        </div>
      ) : null}
      {latestSnapshot ? (
        <div className="simple-finalized" role="status">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>Finalized by a person</strong>
            <span>Immutable snapshot from case v{latestSnapshot.caseVersion}</span>
          </div>
        </div>
      ) : (
        <button
          className="button button--primary button--large simple-primary-action"
          type="button"
          disabled={Boolean(mutationBlocked) || reviewRequested}
          onClick={reviewReport}
        >
          {reviewRequested ? (
            <LoaderCircle className="is-spinning" size={17} />
          ) : (
            <FileCheck2 size={17} />
          )}
          {reviewRequested ? "Building report…" : "Review final report"}
        </button>
      )}
      <p className="simple-action-help">
        {latestSnapshot
          ? "Later edits cannot change this finalized snapshot."
          : previewReady
            ? "A person must review four acknowledgements before finalizing."
            : "REPLAY will show any missing or stale information before finalization."}
      </p>
      {showReview && reportPreview && previewReady && (
        <FinalizationDialog
          preview={reportPreview}
          onCancel={() => {
            setReviewRequested(false);
            setReviewOpen(false);
          }}
          onFinalize={() => {
            const finalized = onFinalizeReport(reportPreview);
            if (finalized) {
              setReviewRequested(false);
              setReviewOpen(false);
            }
            return finalized;
          }}
        />
      )}
    </section>
  );
}

export function SimpleWorkspace(props: SimpleWorkspaceProps) {
  const stage = simpleStageForCase(props.replayCase);
  const question = useMemo(
    () =>
      rankOpenQuestions(
        props.replayCase.questions.filter(
          (candidate) => candidate.status === "open" || candidate.status === "deferred",
        ),
      )[0],
    [props.replayCase.questions],
  );
  const evidence = useMemo(
    () => relatedEvidence(props.replayCase, question),
    [props.replayCase, question],
  );
  const pendingProposal = [...props.replayCase.proposals]
    .reverse()
    .find((proposal) => proposal.status === "pending");
  return (
    <aside className="simple-panel" aria-label="Guided case review">
      <SimpleProgress stage={stage} />
      {stage === "review" && (
        <ReviewStage
          question={question}
          evidenceCount={evidence.length}
          agentWorking={props.agentWorking}
          siteToolsSupported={props.siteToolsSupported}
          siteToolsError={props.siteToolsError}
          mutationBlocked={props.mutationBlocked}
          onAskAgent={props.onAskAgent}
        />
      )}
      {stage === "decide" && pendingProposal && (
        <DecideStage
          replayCase={props.replayCase}
          proposal={pendingProposal}
          question={question}
          evidence={evidence}
          mutationBlocked={props.mutationBlocked}
          onAcceptProposal={props.onAcceptProposal}
          onRejectProposal={props.onRejectProposal}
        />
      )}
      {stage === "report" && (
        <ReportStage
          replayCase={props.replayCase}
          reportPreview={props.reportPreview}
          mutationBlocked={props.mutationBlocked}
          onBuildReport={props.onBuildReport}
          onFinalizeReport={props.onFinalizeReport}
        />
      )}
      <footer className="simple-panel__boundary">
        <ShieldCheck size={15} aria-hidden="true" />
        Agent: review and propose. Human: decide, confirm claims, and finalize.
      </footer>
    </aside>
  );
}
