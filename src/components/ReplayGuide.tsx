import {
  ArrowRight,
  Bot,
  Camera,
  CarFront,
  Check,
  ChevronLeft,
  CircleHelp,
  Clock3,
  Copy,
  FileText,
  GitFork,
  Play,
  SearchCheck,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  GUIDE_SECTIONS,
  SITE_TOOL_PROMPTS,
  guideSectionById,
  type GuideSectionId,
} from "../onboarding/content";
import {
  markGuideSectionComplete,
  readReplayGuideProgress,
  recordGuideSectionVisit,
} from "../onboarding/progress";
import "../styles/guide.css";
import { BrandMark } from "./BrandMark";
import { useDialogFocus } from "./useDialogFocus";

export type { GuideSectionId } from "../onboarding/content";

export interface ReplayGuideProps {
  context: "landing" | "workspace";
  webMcpSupported: boolean;
  registeredTools?: number;
  toolRegistrationStatus?: "registering" | "ready" | "error";
  initialSection?: GuideSectionId;
  onClose: () => void;
  onOpenGuidedDemo?: () => void;
  onStartWorkspaceTour?: () => void;
  onOpenTechnicalInspector?: () => void;
}

const sectionIcons: Record<GuideSectionId, LucideIcon> = {
  "quick-start": Play,
  scene: CarFront,
  timeline: Clock3,
  evidence: Camera,
  hypotheses: GitFork,
  "site-tools": Bot,
  report: FileText,
};

async function copyText(text: string): Promise<void> {
  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall back to a local selection when the Clipboard API is unavailable.
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = typeof document.execCommand === "function" && document.execCommand("copy");
  input.remove();
  previousFocus?.focus();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}

export function ReplayGuide({
  context,
  webMcpSupported,
  registeredTools,
  toolRegistrationStatus,
  initialSection,
  onClose,
  onOpenGuidedDemo,
  onStartWorkspaceTour,
  onOpenTechnicalInspector,
}: ReplayGuideProps) {
  const initialProgress = useMemo(() => readReplayGuideProgress(), []);
  const [activeSectionId, setActiveSectionId] = useState<GuideSectionId>(
    initialSection ?? initialProgress.lastSectionId,
  );
  const [completedSectionIds, setCompletedSectionIds] = useState<GuideSectionId[]>(
    initialProgress.completedSectionIds,
  );
  const [copiedPromptId, setCopiedPromptId] = useState<string>();
  const [copyError, setCopyError] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const topicButtonRefs = useRef(new Map<GuideSectionId, HTMLButtonElement>());
  const copyResetTimerRef = useRef<number | undefined>(undefined);
  const dialogRef = useDialogFocus<HTMLElement>({
    initialFocusRef: closeButtonRef,
    onEscape: onClose,
  });

  useEffect(() => {
    recordGuideSectionVisit(activeSectionId);
    const content = contentRef.current;
    if (content) {
      content.scrollTop = 0;
      if (typeof content.scrollTo === "function") content.scrollTo({ top: 0, behavior: "auto" });
    }
    const activeTopic = topicButtonRefs.current.get(activeSectionId);
    if (activeTopic && typeof activeTopic.scrollIntoView === "function") {
      activeTopic.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    }
  }, [activeSectionId]);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current !== undefined) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const previousDocumentOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  const activeSection = guideSectionById(activeSectionId);
  const activeIndex = GUIDE_SECTIONS.findIndex((section) => section.id === activeSectionId);
  const isComplete = completedSectionIds.includes(activeSectionId);

  function visitSection(sectionId: GuideSectionId): void {
    setActiveSectionId(sectionId);
  }

  function completeSection(sectionId = activeSectionId): void {
    const next = markGuideSectionComplete(sectionId);
    setCompletedSectionIds(next.completedSectionIds);
  }

  function completeAndContinue(): void {
    completeSection();
    const next = GUIDE_SECTIONS[activeIndex + 1];
    if (next) visitSection(next.id);
    else onClose();
  }

  async function copyPrompt(id: string, prompt: string): Promise<void> {
    setCopyError(false);
    try {
      await copyText(prompt);
      setCopiedPromptId(id);
      if (copyResetTimerRef.current !== undefined) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => setCopiedPromptId(undefined), 1_600);
    } catch {
      setCopiedPromptId(undefined);
      setCopyError(true);
    }
  }

  const PrimaryIcon = sectionIcons[activeSectionId];
  const toolsReady =
    webMcpSupported &&
    (toolRegistrationStatus === "ready" ||
      (toolRegistrationStatus === undefined &&
        registeredTools !== undefined &&
        registeredTools > 0));
  const registrationFailed = webMcpSupported && toolRegistrationStatus === "error";
  const partialRegistration = registrationFailed && (registeredTools ?? 0) > 0;
  const modeLabel = !webMcpSupported
    ? "Manual mode is active"
    : partialRegistration
      ? `${String(registeredTools)} Site Tools registered, some unavailable`
      : registrationFailed
        ? "Site Tools could not register"
        : toolsReady
          ? `${String(registeredTools ?? 0)} Site Tools registered`
          : registeredTools === undefined
            ? "Compatible Site Tools client detected"
            : "Site Tools are connecting";

  return (
    <div
      className="guide-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="guide-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replay-guide-title"
        aria-describedby="replay-guide-description"
        tabIndex={-1}
      >
        <header className="guide-panel__header">
          <div className="guide-panel__identity">
            <BrandMark compact />
            <div>
              <p>Optional product guide</p>
              <h2 id="replay-guide-title">Learn REPLAY</h2>
            </div>
          </div>
          <p id="replay-guide-description" className="guide-panel__summary">
            Choose a topic or take a short guided tour. Nothing here changes the open case.
          </p>
          <button
            ref={closeButtonRef}
            className="icon-button guide-panel__close"
            type="button"
            onClick={onClose}
            aria-label="Close REPLAY guide"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="guide-panel__body">
          <nav className="guide-topics" aria-label="REPLAY help topics">
            {GUIDE_SECTIONS.map((section) => {
              const Icon = sectionIcons[section.id];
              const complete = completedSectionIds.includes(section.id);
              return (
                <button
                  key={section.id}
                  ref={(node) => {
                    if (node) topicButtonRefs.current.set(section.id, node);
                    else topicButtonRefs.current.delete(section.id);
                  }}
                  type="button"
                  className={section.id === activeSectionId ? "is-active" : ""}
                  aria-current={section.id === activeSectionId ? "page" : undefined}
                  onClick={() => visitSection(section.id)}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span>{section.label}</span>
                  {complete && (
                    <span className="guide-topic__complete">
                      <Check size={13} aria-hidden="true" />
                      <span className="guide-visually-hidden">Completed</span>
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <article ref={contentRef} className="guide-content" aria-labelledby="guide-section-title">
            <div className="guide-content__heading">
              <span className="guide-content__icon">
                <PrimaryIcon size={20} aria-hidden="true" />
              </span>
              <div>
                <p>{activeSection.kicker}</p>
                <h3 id="guide-section-title">{activeSection.title}</h3>
              </div>
            </div>
            <p className="guide-content__summary">{activeSection.summary}</p>

            {activeSectionId === "site-tools" && (
              <div
                className={`guide-mode-status${toolsReady ? " is-supported" : " is-manual"}`}
                role="status"
              >
                {toolsReady ? (
                  <ShieldCheck size={18} aria-hidden="true" />
                ) : (
                  <CircleHelp size={18} aria-hidden="true" />
                )}
                <div>
                  <strong>{modeLabel}</strong>
                  <span>
                    {partialRegistration
                      ? "Registered tools remain available. Use Case options to inspect the registration error. Manual controls remain available for every workflow."
                      : toolsReady
                        ? "Ask the connected agent in its conversation. Mutations are validated, reflected in the case, and attributed in recent activity."
                        : webMcpSupported && registrationFailed
                          ? "Continue in Manual mode and use Case options to inspect the registration error. Site Tools remain unavailable until registration succeeds."
                          : webMcpSupported
                            ? "Open a case or wait for the registered-tool count before asking the connected agent. Manual controls remain available."
                            : "Every visible case workflow remains available. Open REPLAY in a supported client when you want agent collaboration."}
                  </span>
                </div>
              </div>
            )}

            <ol className="guide-topic-list">
              {activeSection.topics.map((topic, index) => (
                <li key={topic.title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h4>{topic.title}</h4>
                    <p>{topic.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            {activeSection.note && (
              <p className="guide-note">
                <SearchCheck size={16} aria-hidden="true" />
                <span>{activeSection.note}</span>
              </p>
            )}

            {activeSectionId === "site-tools" && (
              <section className="guide-prompts" aria-labelledby="guide-prompts-title">
                <div>
                  <p>Conversation starters</p>
                  <h4 id="guide-prompts-title">Try a narrow, reviewable request</h4>
                </div>
                <ul>
                  {SITE_TOOL_PROMPTS.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.prompt}</p>
                      </div>
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => void copyPrompt(item.id, item.prompt)}
                        aria-label={`Copy prompt: ${item.title}`}
                      >
                        {copiedPromptId === item.id ? (
                          <Check size={14} aria-hidden="true" />
                        ) : (
                          <Copy size={14} aria-hidden="true" />
                        )}
                        {copiedPromptId === item.id ? "Copied" : "Copy"}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="guide-copy-status" role="status" aria-live="polite">
                  {copyError
                    ? "Clipboard access is unavailable. Select the prompt text to copy it."
                    : copiedPromptId
                      ? "Prompt copied to the clipboard."
                      : ""}
                </p>
                {onOpenTechnicalInspector && (
                  <button
                    className="button button--secondary guide-technical-action"
                    type="button"
                    onClick={onOpenTechnicalInspector}
                  >
                    Open technical Site Tools inspector
                  </button>
                )}
              </section>
            )}

            {activeSectionId === "quick-start" && (
              <div className="guide-start-action">
                {context === "landing" && onOpenGuidedDemo && (
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={() => {
                      completeSection("quick-start");
                      onOpenGuidedDemo();
                      onClose();
                    }}
                  >
                    Open guided demo <ArrowRight size={16} aria-hidden="true" />
                  </button>
                )}
                {context === "workspace" && onStartWorkspaceTour && (
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={() => {
                      completeSection("quick-start");
                      onStartWorkspaceTour();
                      onClose();
                    }}
                  >
                    Start 6-step workspace tour <ArrowRight size={16} aria-hidden="true" />
                  </button>
                )}
                <span>Optional, replayable, and safe to exit at any time.</span>
              </div>
            )}

            <p className="guide-section-announcement" aria-live="polite">
              {activeSection.label} help topic selected.
            </p>
          </article>
        </div>

        <footer className="guide-panel__footer">
          <span>
            {completedSectionIds.length} of {GUIDE_SECTIONS.length} topics reviewed
          </span>
          <div>
            <button
              className="button button--quiet"
              type="button"
              disabled={activeIndex === 0}
              onClick={() => {
                const previous = GUIDE_SECTIONS[activeIndex - 1];
                if (previous) visitSection(previous.id);
              }}
            >
              <ChevronLeft size={15} aria-hidden="true" /> Previous
            </button>
            {!isComplete && (
              <button
                className="button button--secondary"
                type="button"
                onClick={() => completeSection()}
              >
                <Check size={15} aria-hidden="true" /> Mark reviewed
              </button>
            )}
            <button className="button button--primary" type="button" onClick={completeAndContinue}>
              {activeIndex === GUIDE_SECTIONS.length - 1 ? "Done" : "Next topic"}
              {activeIndex < GUIDE_SECTIONS.length - 1 && (
                <ArrowRight size={15} aria-hidden="true" />
              )}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
