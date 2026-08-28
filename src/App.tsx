import { lazy, Suspense, useEffect, useRef, useState } from "react";

import {
  createBlankCase,
  createDemoCase,
  createDemoScenario,
  type DemoScenarioId,
  type ReplayCase,
} from "./domain";
import {
  deleteCaseLocally,
  loadCaseById,
  loadLocalVault,
  type RetainedRecoveryRecord,
} from "./persistence/database";
import { detectWebMCPSupport } from "./webmcp";
import { BlankCaseWizard, type BlankCaseInput } from "./components/BlankCaseWizard";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LandingPage } from "./components/LandingPage";

const Workspace = lazy(async () => {
  const module = await import("./components/Workspace");
  return { default: module.Workspace };
});

type View = "landing" | "wizard" | "workspace";

const DEMO_CASE_ID = "case-demo-roundabout";

function mergeRecoveryRecords(
  ...recordGroups: RetainedRecoveryRecord[][]
): RetainedRecoveryRecord[] {
  const recordsByVaultAndId = new Map<string, RetainedRecoveryRecord>();
  let anonymousIndex = 0;
  for (const retained of recordGroups.flat()) {
    const recordId = retainedRecordId(retained.record);
    recordsByVaultAndId.set(
      recordId
        ? `${retained.vault}:${recordId}`
        : `${retained.vault}:anonymous-${anonymousIndex++}`,
      retained,
    );
  }
  return [...recordsByVaultAndId.values()];
}

function retainedRecordId(record: unknown): string | undefined {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return undefined;
  const id: unknown = Reflect.get(record, "id");
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function downloadRecoveryBackup(records: RetainedRecoveryRecord[]): void {
  const seen = new WeakSet<object>();
  const blob = new Blob(
    [
      JSON.stringify(
        { exportedAt: new Date().toISOString(), records },
        (_key, value: unknown) => {
          if (typeof value === "bigint") return { type: "bigint", value: value.toString() };
          if (typeof value === "object" && value !== null) {
            if (seen.has(value)) return { type: "circular-reference" };
            seen.add(value);
          }
          return value;
        },
        2,
      ),
    ],
    { type: "application/json;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "replay-local-recovery.json";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function App() {
  const [view, setView] = useState<View>("landing");
  const [activeCase, setActiveCase] = useState<ReplayCase>();
  const [recentCase, setRecentCase] = useState<ReplayCase>();
  const [savedDemoCase, setSavedDemoCase] = useState<ReplayCase>();
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [hydrating, setHydrating] = useState(true);
  const [recoveryRecords, setRecoveryRecords] = useState<RetainedRecoveryRecord[]>([]);
  const [vaultLoadError, setVaultLoadError] = useState<string>();
  const [vaultLoadAttempt, setVaultLoadAttempt] = useState(0);
  const [demoResetError, setDemoResetError] = useState<string>();
  const [startWorkspaceTour, setStartWorkspaceTour] = useState(false);
  const resettingDemoRef = useRef(false);
  const webMcpSupported = detectWebMCPSupport().available;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadLocalVault(), loadCaseById(DEMO_CASE_ID)]).then(
      ([localVault, demoVault]) => {
        if (cancelled) return;
        const loaded = localVault.replayCase;
        const savedDemo = demoVault.replayCase;
        setRecoveryRecords(
          mergeRecoveryRecords(
            localVault.retainedRecoveryRecords,
            demoVault.retainedRecoveryRecords,
          ),
        );
        setRecentCase(loaded);
        setSavedDemoCase(savedDemo);
        if (window.location.hash === "#demo") {
          setActiveCase(savedDemo ?? createDemoCase());
          setView("workspace");
        } else if (window.location.hash === "#workspace" && loaded) {
          setActiveCase(loaded);
          setView("workspace");
        }
        setHydrating(false);
      },
      (error: unknown) => {
        if (cancelled) return;
        setVaultLoadError(
          error instanceof Error
            ? `REPLAY could not open the local vault. ${error.message}`
            : "REPLAY could not open the local vault. The browser did not provide a reason.",
        );
        setHydrating(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [vaultLoadAttempt]);

  useEffect(() => {
    const handlePopState = () => {
      if (window.location.hash === "#demo") {
        setActiveCase(savedDemoCase ?? createDemoCase());
        setView("workspace");
      } else if (window.location.hash === "#workspace" && recentCase) {
        setActiveCase(recentCase);
        setView("workspace");
      } else if (window.location.hash === "#new") setView("wizard");
      else setView("landing");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [recentCase, savedDemoCase]);

  function navigate(next: View, replace = false, workspaceHash = "#workspace"): void {
    const hash = next === "workspace" ? workspaceHash : next === "wizard" ? "#new" : "";
    const location = `${window.location.pathname}${window.location.search}${hash}`;
    if (replace) window.history.replaceState({}, "", location);
    else window.history.pushState({}, "", location);
    setView(next);
  }

  function openCase(replayCase: ReplayCase, replace = false, demo = false): void {
    const storage = Reflect.get(navigator, "storage") as
      { persist?: () => Promise<boolean> } | undefined;
    if (typeof storage?.persist === "function") {
      void storage.persist().catch(() => false);
    }
    setActiveCase(replayCase);
    setRecentCase(replayCase);
    if (replayCase.id === DEMO_CASE_ID) setSavedDemoCase(replayCase);
    setDemoResetError(undefined);
    setWorkspaceKey((value) => value + 1);
    navigate("workspace", replace, demo ? "#demo" : "#workspace");
  }

  async function resetDemo(): Promise<boolean> {
    if (resettingDemoRef.current) return false;
    resettingDemoRef.current = true;
    setDemoResetError(undefined);
    try {
      await deleteCaseLocally(DEMO_CASE_ID);
      setRecoveryRecords((records) =>
        records.filter((record) => retainedRecordId(record.record) !== DEMO_CASE_ID),
      );
      openCase(createDemoCase(), true, true);
      return true;
    } catch (error) {
      setDemoResetError(
        error instanceof Error
          ? `The saved demo could not be cleared. ${error.message}`
          : "The saved demo could not be cleared. Your existing local copy was left unchanged.",
      );
      return false;
    } finally {
      resettingDemoRef.current = false;
    }
  }

  if (hydrating) {
    return (
      <main className="app-loading" aria-label="Loading REPLAY">
        <span />
        <strong>REPLAY</strong>
        <p>Opening the local workspace</p>
      </main>
    );
  }

  if (vaultLoadError) {
    return (
      <ErrorBoundary>
        <main className="fatal-state" id="main-content" tabIndex={-1}>
          <p className="section-kicker">Local recovery</p>
          <div role="alert">
            <h1>Local vault could not be opened</h1>
            <p>
              {vaultLoadError} Saved browser data was not changed. REPLAY has disabled case actions
              so an unreadable record cannot be overwritten.
            </p>
          </div>
          <div className="fatal-state__actions">
            <button
              className="button button--primary"
              onClick={() => {
                setVaultLoadError(undefined);
                setHydrating(true);
                setVaultLoadAttempt((attempt) => attempt + 1);
              }}
            >
              Retry local load
            </button>
          </div>
        </main>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          // REPLAY uses the URL fragment for routes. Keep the current route
          // while providing native skip-link focus and scrolling behavior.
          event.preventDefault();
          const target = document.getElementById("main-content");
          target?.focus();
          target?.scrollIntoView({ block: "start" });
        }}
      >
        Skip to main content
      </a>
      {recoveryRecords.length > 0 && !demoResetError && (
        <aside className="vault-recovery-notice" role="alert">
          <div>
            <strong>Local recovery copy retained</strong>
            <span>
              REPLAY skipped {recoveryRecords.length} malformed or unsupported local case{" "}
              {recoveryRecords.length === 1 ? "record" : "records"} without deleting them.
            </span>
          </div>
          <button
            className="button button--secondary"
            onClick={() => downloadRecoveryBackup(recoveryRecords)}
          >
            Download raw recovery
          </button>
          <button aria-label="Dismiss recovery notice" onClick={() => setRecoveryRecords([])}>
            ×
          </button>
        </aside>
      )}
      {demoResetError && (
        <aside className="vault-recovery-notice" role="alert">
          <div>
            <strong>Demo reset did not finish</strong>
            <span>{demoResetError}</span>
          </div>
          <button
            aria-label="Dismiss demo reset error"
            onClick={() => setDemoResetError(undefined)}
          >
            ×
          </button>
        </aside>
      )}
      {view === "landing" && (
        <LandingPage
          webMcpSupported={webMcpSupported}
          {...(recentCase
            ? { recentCaseTitle: recentCase.title, onResumeCase: () => openCase(recentCase) }
            : {})}
          onOpenDemo={() => openCase(savedDemoCase ?? createDemoCase(), false, true)}
          onOpenGuidedDemo={() => {
            setStartWorkspaceTour(true);
            openCase(savedDemoCase ?? createDemoCase(), false, true);
          }}
          onStartBlank={() => navigate("wizard")}
          onOpenCollaboration={() =>
            document.getElementById("collaboration")?.scrollIntoView({ behavior: "smooth" })
          }
          onOpenScenario={(scenarioId: DemoScenarioId) => {
            if (scenarioId === "roundabout-calibrated") {
              openCase(savedDemoCase ?? createDemoCase(), false, true);
              return;
            }
            setStartWorkspaceTour(false);
            openCase(createDemoScenario(scenarioId));
          }}
        />
      )}
      {view === "wizard" && (
        <BlankCaseWizard
          onCancel={() => navigate("landing")}
          onCreate={(input: BlankCaseInput) => openCase(createBlankCase(input))}
        />
      )}
      {view === "workspace" && activeCase && (
        <ErrorBoundary key={`workspace-boundary-${activeCase.id}-${workspaceKey}`}>
          <Suspense
            fallback={
              <main className="app-loading" aria-label="Loading case workspace">
                <span />
                <strong>REPLAY</strong>
                <p>Preparing the scene editor</p>
              </main>
            }
          >
            <Workspace
              key={`${activeCase.id}-${workspaceKey}`}
              initialCase={activeCase}
              isDemo={activeCase.id === DEMO_CASE_ID}
              onHome={(latestCase) => {
                setActiveCase(latestCase);
                setRecentCase(latestCase);
                if (latestCase.id === DEMO_CASE_ID) setSavedDemoCase(latestCase);
                navigate("landing");
              }}
              onResetDemo={resetDemo}
              onImportCase={(imported) => openCase(imported, true)}
              startWithTour={startWorkspaceTour}
              onTourStarted={() => setStartWorkspaceTour(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </ErrorBoundary>
  );
}
