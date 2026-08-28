import { lazy, Suspense, useEffect, useRef, useState } from "react";

import {
  createBlankCase,
  createDemoScenario,
  DEMO_SCENARIO_IDS,
  importReplayCase,
  type DemoScenarioId,
  type ReplayCase,
} from "./domain";
import { loadCaseById, loadLocalVault, type RetainedRecoveryRecord } from "./persistence/database";
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
const DEMO_CASE_ROUTE_PREFIX = "#case/";
const DEFAULT_DEMO_SCENARIO: DemoScenarioId = "roundabout-calibrated";

function demoRunId(scenarioId: DemoScenarioId): string {
  return `case-demo-${scenarioId}-run-${crypto.randomUUID()}`;
}

function createDemoRun(scenarioId: DemoScenarioId): ReplayCase {
  const createdAt = new Date().toISOString();
  const replayCase = importReplayCase(createDemoScenario(scenarioId), {
    trustHumanAttestations: true,
    rekeyCaseId: demoRunId(scenarioId),
  });
  return { ...replayCase, createdAt, updatedAt: createdAt };
}

function caseIdFromHash(hash: string): string | undefined {
  if (!hash.startsWith(DEMO_CASE_ROUTE_PREFIX)) return undefined;
  try {
    const value = decodeURIComponent(hash.slice(DEMO_CASE_ROUTE_PREFIX.length)).trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function caseHash(caseId: string): string {
  return `${DEMO_CASE_ROUTE_PREFIX}${encodeURIComponent(caseId)}`;
}

function demoScenarioFromCaseId(caseId: string): DemoScenarioId | undefined {
  return DEMO_SCENARIO_IDS.find((scenarioId) => caseId.startsWith(`case-demo-${scenarioId}-run-`));
}

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
  const [activeDemoScenarioId, setActiveDemoScenarioId] = useState<DemoScenarioId>();
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [hydrating, setHydrating] = useState(true);
  const [recoveryRecords, setRecoveryRecords] = useState<RetainedRecoveryRecord[]>([]);
  const [vaultLoadError, setVaultLoadError] = useState<string>();
  const [vaultLoadAttempt, setVaultLoadAttempt] = useState(0);
  const [demoResetError, setDemoResetError] = useState<string>();
  const [routeLoadError, setRouteLoadError] = useState<string>();
  const [startWorkspaceTour, setStartWorkspaceTour] = useState(false);
  const resettingDemoRef = useRef(false);
  const routeLoadTokenRef = useRef(0);
  const webMcpSupported = detectWebMCPSupport().available;

  useEffect(() => {
    let cancelled = false;
    const requestedHash = window.location.hash;
    const loadToken = ++routeLoadTokenRef.current;
    void (async () => {
      const localVault = await loadLocalVault();
      const routeCaseId = caseIdFromHash(requestedHash);
      const routeVault = routeCaseId ? await loadCaseById(routeCaseId) : undefined;
      return { localVault, routeCaseId, routeVault };
    })().then(
      ({ localVault, routeCaseId, routeVault }) => {
        if (
          cancelled ||
          routeLoadTokenRef.current !== loadToken ||
          window.location.hash !== requestedHash
        ) {
          return;
        }
        const loaded = localVault.replayCase;
        setRecoveryRecords(
          mergeRecoveryRecords(
            localVault.retainedRecoveryRecords,
            routeVault?.retainedRecoveryRecords ?? [],
          ),
        );
        setRecentCase(loaded);
        if (requestedHash === "#demo") {
          const demo = createDemoRun(DEFAULT_DEMO_SCENARIO);
          setActiveCase(demo);
          setActiveDemoScenarioId(DEFAULT_DEMO_SCENARIO);
          setView("workspace");
          window.history.replaceState(
            {},
            "",
            `${window.location.pathname}${window.location.search}${caseHash(demo.id)}`,
          );
        } else if (routeCaseId && routeVault?.replayCase) {
          setActiveCase(routeVault.replayCase);
          setActiveDemoScenarioId(demoScenarioFromCaseId(routeVault.replayCase.id));
          setView("workspace");
        } else if (routeCaseId) {
          setRouteLoadError(
            "That saved demo run is not available in this browser. Open a fresh demo or use a valid exported case file.",
          );
          setActiveCase(undefined);
          setActiveDemoScenarioId(undefined);
          setView("landing");
        } else if (requestedHash === "#workspace" && loaded) {
          setActiveCase(loaded);
          setActiveDemoScenarioId(demoScenarioFromCaseId(loaded.id));
          setView("workspace");
        }
        setHydrating(false);
      },
      (error: unknown) => {
        if (cancelled || routeLoadTokenRef.current !== loadToken) return;
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
      const requestedHash = window.location.hash;
      const loadToken = ++routeLoadTokenRef.current;
      setRouteLoadError(undefined);
      if (window.location.hash === "#demo") {
        const demo = createDemoRun(DEFAULT_DEMO_SCENARIO);
        setActiveCase(demo);
        setActiveDemoScenarioId(DEFAULT_DEMO_SCENARIO);
        setWorkspaceKey((value) => value + 1);
        window.history.replaceState(
          {},
          "",
          `${window.location.pathname}${window.location.search}${caseHash(demo.id)}`,
        );
        setView("workspace");
        setHydrating(false);
      } else if (caseIdFromHash(window.location.hash)) {
        const caseId = caseIdFromHash(window.location.hash);
        if (!caseId) return;
        if (activeCase?.id === caseId) {
          setView("workspace");
          setHydrating(false);
          return;
        }
        setHydrating(true);
        void loadCaseById(caseId).then(
          (result) => {
            if (routeLoadTokenRef.current !== loadToken || window.location.hash !== requestedHash) {
              return;
            }
            if (!result.replayCase) {
              setActiveCase(undefined);
              setActiveDemoScenarioId(undefined);
              setRouteLoadError(
                "That saved demo run is not available in this browser. Open a fresh demo or use a valid exported case file.",
              );
              setView("landing");
              setHydrating(false);
              return;
            }
            setActiveCase(result.replayCase);
            setActiveDemoScenarioId(demoScenarioFromCaseId(result.replayCase.id));
            setWorkspaceKey((value) => value + 1);
            setView("workspace");
            setHydrating(false);
          },
          (error: unknown) => {
            if (routeLoadTokenRef.current !== loadToken) return;
            setActiveCase(undefined);
            setActiveDemoScenarioId(undefined);
            setRouteLoadError(
              error instanceof Error
                ? `REPLAY could not open that saved run. ${error.message}`
                : "REPLAY could not open that saved run.",
            );
            setView("landing");
            setHydrating(false);
          },
        );
      } else if (window.location.hash === "#workspace" && recentCase) {
        setActiveCase(recentCase);
        setActiveDemoScenarioId(demoScenarioFromCaseId(recentCase.id));
        setView("workspace");
        setHydrating(false);
      } else if (window.location.hash === "#new") {
        setView("wizard");
        setHydrating(false);
      } else {
        setView("landing");
        setHydrating(false);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [activeCase?.id, recentCase]);

  function navigate(next: View, replace = false, workspaceHash = "#workspace"): void {
    const hash = next === "workspace" ? workspaceHash : next === "wizard" ? "#new" : "";
    const location = `${window.location.pathname}${window.location.search}${hash}`;
    if (replace) window.history.replaceState({}, "", location);
    else window.history.pushState({}, "", location);
    setView(next);
  }

  function openCase(
    replayCase: ReplayCase,
    replace = false,
    demoScenarioId?: DemoScenarioId,
  ): void {
    const storage = Reflect.get(navigator, "storage") as
      { persist?: () => Promise<boolean> } | undefined;
    if (typeof storage?.persist === "function") {
      void storage.persist().catch(() => false);
    }
    setActiveCase(replayCase);
    setRecentCase(replayCase);
    const resolvedDemoScenarioId = demoScenarioId ?? demoScenarioFromCaseId(replayCase.id);
    setActiveDemoScenarioId(resolvedDemoScenarioId);
    setDemoResetError(undefined);
    setRouteLoadError(undefined);
    setWorkspaceKey((value) => value + 1);
    navigate("workspace", replace, resolvedDemoScenarioId ? caseHash(replayCase.id) : "#workspace");
  }

  function openFreshDemo(scenarioId: DemoScenarioId, replace = false): void {
    openCase(createDemoRun(scenarioId), replace, scenarioId);
  }

  function resetDemo(): boolean {
    if (resettingDemoRef.current) return false;
    resettingDemoRef.current = true;
    setDemoResetError(undefined);
    try {
      openFreshDemo(activeDemoScenarioId ?? DEFAULT_DEMO_SCENARIO);
      return true;
    } catch (error) {
      setDemoResetError(
        error instanceof Error
          ? `A fresh demo copy could not be opened. ${error.message}`
          : "A fresh demo copy could not be opened. The current saved run was left unchanged.",
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
      {recoveryRecords.length > 0 && !demoResetError && !routeLoadError && (
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
      {demoResetError && !routeLoadError && (
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
      {routeLoadError && (
        <aside className="vault-recovery-notice" role="alert">
          <div>
            <strong>Saved run unavailable</strong>
            <span>{routeLoadError}</span>
          </div>
          <button aria-label="Dismiss saved run error" onClick={() => setRouteLoadError(undefined)}>
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
          onOpenDemo={() => openFreshDemo(DEFAULT_DEMO_SCENARIO)}
          onOpenGuidedDemo={() => {
            setStartWorkspaceTour(true);
            openFreshDemo(DEFAULT_DEMO_SCENARIO);
          }}
          onStartBlank={() => navigate("wizard")}
          onOpenCollaboration={() =>
            document.getElementById("collaboration")?.scrollIntoView({ behavior: "smooth" })
          }
          onOpenScenario={(scenarioId: DemoScenarioId) => {
            setStartWorkspaceTour(false);
            openFreshDemo(scenarioId);
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
              isDemo={Boolean(activeDemoScenarioId) || activeCase.id === DEMO_CASE_ID}
              onHome={(latestCase) => {
                setActiveCase(latestCase);
                setRecentCase(latestCase);
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
