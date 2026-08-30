import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { createBlankCase } from "./domain/blankCase";
import { createDemoScenario, DEMO_SCENARIO_IDS, type DemoScenarioId } from "./domain/demoScenarios";
import { importReplayCase } from "./domain/importExport";
import type { ReplayCase } from "./domain/models";
import {
  deleteCaseLocally,
  loadCaseById,
  loadLocalVault,
  reconcilePendingEvidencePurges,
  type EvidencePurgeCleanupStatus,
  type LocalCaseSummary,
  type LocalVaultLoadResult,
  type RetainedRecoveryRecord,
} from "./persistence/database";
import { detectWebMCPSupport } from "./webmcp/support";
import { BlankCaseWizard, type BlankCaseInput } from "./components/BlankCaseWizard";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LandingPage } from "./components/LandingPage";

const Workspace = lazy(async () => {
  const module = await import("./components/Workspace");
  return { default: module.Workspace };
});

type View = "landing" | "wizard" | "workspace";
type ExperienceMode = "simple" | "expert";

const DEMO_CASE_ID = "case-demo-roundabout";
const CASE_ROUTE_PREFIX = "#case/";
const DEFAULT_DEMO_SCENARIO: DemoScenarioId = "roundabout-calibrated";
const EXPERIENCE_MODE_SESSION_KEY = "replay-workspace-experience-mode";

function initialExperienceMode(): ExperienceMode {
  return window.sessionStorage.getItem(EXPERIENCE_MODE_SESSION_KEY) === "expert"
    ? "expert"
    : "simple";
}

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
  if (!hash.startsWith(CASE_ROUTE_PREFIX)) return undefined;
  try {
    const value = decodeURIComponent(hash.slice(CASE_ROUTE_PREFIX.length)).trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function caseHash(caseId: string): string {
  return `${CASE_ROUTE_PREFIX}${encodeURIComponent(caseId)}`;
}

function demoScenarioFromCaseId(caseId: string): DemoScenarioId | undefined {
  return DEMO_SCENARIO_IDS.find((scenarioId) => caseId.startsWith(`case-demo-${scenarioId}-run-`));
}

function isDemoCaseId(caseId: string): boolean {
  return caseId === DEMO_CASE_ID || demoScenarioFromCaseId(caseId) !== undefined;
}

function summarizeCase(replayCase: ReplayCase): LocalCaseSummary {
  return {
    id: replayCase.id,
    title: replayCase.title,
    updatedAt: replayCase.updatedAt,
    caseVersion: replayCase.caseVersion,
  };
}

function summariesFromLoad(result: LocalVaultLoadResult): LocalCaseSummary[] {
  // The fallback keeps older mocked/custom persistence implementations safe
  // while the production vault always supplies the complete local index.
  const indexedCases: unknown = Reflect.get(result, "localCases");
  return Array.isArray(indexedCases)
    ? (indexedCases as LocalCaseSummary[])
    : result.replayCase
      ? [summarizeCase(result.replayCase)]
      : [];
}

function mergeLocalCaseSummaries(...groups: readonly LocalCaseSummary[][]): LocalCaseSummary[] {
  const summariesById = new Map<string, LocalCaseSummary>();
  for (const summary of groups.flat()) {
    const existing = summariesById.get(summary.id);
    const summaryTime = Date.parse(summary.updatedAt);
    const existingTime = existing ? Date.parse(existing.updatedAt) : Number.NEGATIVE_INFINITY;
    if (
      !existing ||
      summaryTime > existingTime ||
      (summaryTime === existingTime && summary.caseVersion >= existing.caseVersion)
    ) {
      summariesById.set(summary.id, summary);
    }
  }
  return [...summariesById.values()].sort((left, right) => {
    const timeOrder = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (timeOrder !== 0) return timeOrder;
    if (left.title !== right.title) return left.title < right.title ? -1 : 1;
    return left.id < right.id ? -1 : left.id === right.id ? 0 : 1;
  });
}

function unavailableCaseMessage(caseId: string): string {
  return isDemoCaseId(caseId)
    ? "That saved demo run is not available in this browser. Open a fresh demo or use a valid exported case file."
    : "That local case is not available in this browser. It may have been removed, or this may be a different browser profile. Reopen another local case, start a blank case, or import a valid structured transfer.";
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
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function App() {
  const [view, setView] = useState<View>("landing");
  const [workspaceExperienceMode, setWorkspaceExperienceMode] =
    useState<ExperienceMode>(initialExperienceMode);
  const [activeCase, setActiveCase] = useState<ReplayCase>();
  const [localCases, setLocalCases] = useState<LocalCaseSummary[]>([]);
  const [activeDemoScenarioId, setActiveDemoScenarioId] = useState<DemoScenarioId>();
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [hydrating, setHydrating] = useState(true);
  const [recoveryRecords, setRecoveryRecords] = useState<RetainedRecoveryRecord[]>([]);
  const [vaultLoadError, setVaultLoadError] = useState<string>();
  const [vaultLoadAttempt, setVaultLoadAttempt] = useState(0);
  const [evidencePurgeCleanup, setEvidencePurgeCleanup] = useState<EvidencePurgeCleanupStatus>();
  const [evidencePurgeRetrying, setEvidencePurgeRetrying] = useState(false);
  const [evidencePurgeRetryError, setEvidencePurgeRetryError] = useState(false);
  const [demoResetError, setDemoResetError] = useState<string>();
  const [routeLoadError, setRouteLoadError] = useState<string>();
  const [startWorkspaceTour, setStartWorkspaceTour] = useState(false);
  const resettingDemoRef = useRef(false);
  const routeLoadTokenRef = useRef(0);
  const activeCaseIdRef = useRef<string | undefined>(undefined);
  const workspaceLeaveGuardRef = useRef<(() => Promise<boolean>) | undefined>(undefined);
  const webMcpSupported = detectWebMCPSupport().available;

  useEffect(() => {
    window.sessionStorage.setItem(EXPERIENCE_MODE_SESSION_KEY, workspaceExperienceMode);
  }, [workspaceExperienceMode]);

  useEffect(() => {
    activeCaseIdRef.current = activeCase?.id;
  }, [activeCase?.id]);

  useEffect(() => {
    let cancelled = false;
    const requestedHash = window.location.hash;
    const loadToken = ++routeLoadTokenRef.current;
    void (async () => {
      const routeCaseId = caseIdFromHash(requestedHash);
      const [localVault, routeVault] = await Promise.all([
        loadLocalVault(),
        routeCaseId ? loadCaseById(routeCaseId) : Promise.resolve(undefined),
      ]);
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
        setEvidencePurgeCleanup(
          routeVault?.evidencePurgeCleanup ?? localVault.evidencePurgeCleanup,
        );
        setLocalCases(
          mergeLocalCaseSummaries(
            summariesFromLoad(localVault),
            ...(routeVault ? [summariesFromLoad(routeVault)] : []),
          ),
        );
        if (requestedHash === "#demo") {
          const demo = createDemoRun(DEFAULT_DEMO_SCENARIO);
          setActiveCase(demo);
          setLocalCases((current) => mergeLocalCaseSummaries(current, [summarizeCase(demo)]));
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
          setLocalCases((current) => current.filter(({ id }) => id !== routeCaseId));
          setRouteLoadError(unavailableCaseMessage(routeCaseId));
          setActiveCase(undefined);
          setActiveDemoScenarioId(undefined);
          setView("landing");
        } else if (requestedHash === "#new") {
          setView("wizard");
        } else if (requestedHash === "#workspace" && loaded) {
          setActiveCase(loaded);
          setActiveDemoScenarioId(demoScenarioFromCaseId(loaded.id));
          setView("workspace");
          window.history.replaceState(
            {},
            "",
            `${window.location.pathname}${window.location.search}${caseHash(loaded.id)}`,
          );
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
      const applyRequestedRoute = () => {
        if (routeLoadTokenRef.current !== loadToken || window.location.hash !== requestedHash) {
          return;
        }
        if (requestedHash === "#demo") {
          const demo = createDemoRun(DEFAULT_DEMO_SCENARIO);
          setActiveCase(demo);
          setLocalCases((current) => mergeLocalCaseSummaries(current, [summarizeCase(demo)]));
          setActiveDemoScenarioId(DEFAULT_DEMO_SCENARIO);
          setWorkspaceKey((value) => value + 1);
          window.history.replaceState(
            {},
            "",
            `${window.location.pathname}${window.location.search}${caseHash(demo.id)}`,
          );
          setView("workspace");
          setHydrating(false);
        } else if (caseIdFromHash(requestedHash)) {
          const caseId = caseIdFromHash(requestedHash);
          if (!caseId) return;
          setHydrating(true);
          void loadCaseById(caseId).then(
            (result) => {
              if (
                routeLoadTokenRef.current !== loadToken ||
                window.location.hash !== requestedHash
              ) {
                return;
              }
              if (!result.replayCase) {
                setActiveCase(undefined);
                setLocalCases((current) => current.filter(({ id }) => id !== caseId));
                setActiveDemoScenarioId(undefined);
                setRouteLoadError(unavailableCaseMessage(caseId));
                setView("landing");
                setHydrating(false);
                return;
              }
              setRecoveryRecords((current) =>
                mergeRecoveryRecords(current, result.retainedRecoveryRecords),
              );
              setEvidencePurgeCleanup(result.evidencePurgeCleanup);
              setActiveCase(result.replayCase);
              setLocalCases((current) =>
                mergeLocalCaseSummaries(current, summariesFromLoad(result)),
              );
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
                  ? `REPLAY could not open that saved case. ${error.message}`
                  : "REPLAY could not open that saved case.",
              );
              setView("landing");
              setHydrating(false);
            },
          );
        } else if (requestedHash === "#workspace") {
          setHydrating(true);
          void loadLocalVault().then(
            (result) => {
              if (
                routeLoadTokenRef.current !== loadToken ||
                window.location.hash !== requestedHash
              ) {
                return;
              }
              setRecoveryRecords((current) =>
                mergeRecoveryRecords(current, result.retainedRecoveryRecords),
              );
              setEvidencePurgeCleanup(result.evidencePurgeCleanup);
              setLocalCases((current) =>
                mergeLocalCaseSummaries(current, summariesFromLoad(result)),
              );
              if (!result.replayCase) {
                setActiveCase(undefined);
                setActiveDemoScenarioId(undefined);
                setView("landing");
                setHydrating(false);
                return;
              }
              setActiveCase(result.replayCase);
              setActiveDemoScenarioId(demoScenarioFromCaseId(result.replayCase.id));
              setWorkspaceKey((value) => value + 1);
              setView("workspace");
              window.history.replaceState(
                {},
                "",
                `${window.location.pathname}${window.location.search}${caseHash(result.replayCase.id)}`,
              );
              setHydrating(false);
            },
            (error: unknown) => {
              if (routeLoadTokenRef.current !== loadToken) return;
              setActiveCase(undefined);
              setActiveDemoScenarioId(undefined);
              setRouteLoadError(
                error instanceof Error
                  ? `REPLAY could not reopen the most recent case. ${error.message}`
                  : "REPLAY could not reopen the most recent case.",
              );
              setView("landing");
              setHydrating(false);
            },
          );
        } else if (requestedHash === "#new") {
          setView("wizard");
          setHydrating(false);
        } else {
          setView("landing");
          setHydrating(false);
        }
      };

      const guard = workspaceLeaveGuardRef.current;
      if (!guard) {
        applyRequestedRoute();
        return;
      }
      const restoreWorkspaceRoute = () => {
        const caseId = activeCaseIdRef.current;
        if (!caseId) return;
        window.history.pushState(
          {},
          "",
          `${window.location.pathname}${window.location.search}${caseHash(caseId)}`,
        );
      };
      void guard().then(
        (allowed) => {
          if (routeLoadTokenRef.current !== loadToken) return;
          if (!allowed) {
            restoreWorkspaceRoute();
            return;
          }
          applyRequestedRoute();
        },
        () => {
          if (routeLoadTokenRef.current !== loadToken) return;
          restoreWorkspaceRoute();
        },
      );
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(next: View, replace = false, workspaceHash?: string): void {
    if (next === "workspace" && !workspaceHash) {
      throw new Error("A case-specific route is required before opening a workspace.");
    }
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
    setLocalCases((current) => mergeLocalCaseSummaries(current, [summarizeCase(replayCase)]));
    const resolvedDemoScenarioId = demoScenarioId ?? demoScenarioFromCaseId(replayCase.id);
    setActiveDemoScenarioId(resolvedDemoScenarioId);
    setDemoResetError(undefined);
    setRouteLoadError(undefined);
    setWorkspaceKey((value) => value + 1);
    navigate("workspace", replace, caseHash(replayCase.id));
  }

  function openFreshDemo(scenarioId: DemoScenarioId, replace = false): void {
    openCase(createDemoRun(scenarioId), replace, scenarioId);
  }

  async function resumeSavedCase(caseId: string): Promise<void> {
    const loadToken = ++routeLoadTokenRef.current;
    setRouteLoadError(undefined);
    setHydrating(true);
    try {
      const result = await loadCaseById(caseId);
      if (routeLoadTokenRef.current !== loadToken) return;
      setRecoveryRecords((current) =>
        mergeRecoveryRecords(current, result.retainedRecoveryRecords),
      );
      setEvidencePurgeCleanup(result.evidencePurgeCleanup);
      if (!result.replayCase) {
        setLocalCases((current) => current.filter(({ id }) => id !== caseId));
        setRouteLoadError(unavailableCaseMessage(caseId));
        setActiveCase(undefined);
        setActiveDemoScenarioId(undefined);
        setView("landing");
        return;
      }
      openCase(result.replayCase);
    } catch (error) {
      if (routeLoadTokenRef.current !== loadToken) return;
      setRouteLoadError(
        error instanceof Error
          ? `REPLAY could not reopen that saved case. ${error.message}`
          : "REPLAY could not reopen that saved case.",
      );
      setActiveCase(undefined);
      setActiveDemoScenarioId(undefined);
      setView("landing");
    } finally {
      if (routeLoadTokenRef.current === loadToken) setHydrating(false);
    }
  }

  async function deleteSavedCase(caseId: string): Promise<void> {
    // Local-vault deletion is deliberately not a domain command or WebMCP
    // operation. The only entry point is LandingPage's visible human
    // confirmation, so it cannot become agent activity or mutate another case.
    await deleteCaseLocally(caseId);
    setLocalCases((current) => current.filter(({ id }) => id !== caseId));
    if (activeCaseIdRef.current === caseId) {
      activeCaseIdRef.current = undefined;
      setActiveCase(undefined);
      setActiveDemoScenarioId(undefined);
    }
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

  async function retryEvidenceCleanup(): Promise<void> {
    if (evidencePurgeRetrying) return;
    setEvidencePurgeRetrying(true);
    setEvidencePurgeRetryError(false);
    try {
      const cleanup = await reconcilePendingEvidencePurges();
      setEvidencePurgeCleanup(cleanup);
    } catch {
      // Never surface the underlying storage error because it can contain a
      // local case id or evidence key. The durable queue remains available.
      setEvidencePurgeRetryError(true);
    } finally {
      setEvidencePurgeRetrying(false);
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
      <div className="app-notice-stack">
        {(evidencePurgeCleanup?.pending ?? 0) > 0 && (
          <aside
            className="vault-recovery-notice vault-recovery-notice--persistent"
            role="alert"
            aria-labelledby="evidence-purge-warning-title"
          >
            <div>
              <strong id="evidence-purge-warning-title">
                Evidence cleanup still needs attention
              </strong>
              <span>
                REPLAY could not remove all local evidence bytes queued for deletion. Cleanup
                remains queued, but bytes may still remain in this browser. Retry cleanup. If it
                keeps failing, clear REPLAY’s site data in browser settings before leaving this
                device.
                {evidencePurgeRetryError ? " The latest retry could not finish." : ""}
              </span>
            </div>
            <button
              className="button button--secondary"
              disabled={evidencePurgeRetrying}
              onClick={() => void retryEvidenceCleanup()}
            >
              {evidencePurgeRetrying ? "Retrying cleanup…" : "Retry evidence cleanup"}
            </button>
          </aside>
        )}
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
              <strong>Saved case unavailable</strong>
              <span>{routeLoadError}</span>
            </div>
            <button
              aria-label="Dismiss saved case error"
              onClick={() => setRouteLoadError(undefined)}
            >
              ×
            </button>
          </aside>
        )}
      </div>
      {view === "landing" && (
        <LandingPage
          webMcpSupported={webMcpSupported}
          localCases={localCases.map((localCase) => ({
            ...localCase,
            isDemo: isDemoCaseId(localCase.id),
          }))}
          onOpenLocalCase={(caseId) => void resumeSavedCase(caseId)}
          onDeleteLocalCase={deleteSavedCase}
          onOpenDemo={() => openFreshDemo(DEFAULT_DEMO_SCENARIO)}
          onOpenGuidedDemo={() => {
            setWorkspaceExperienceMode("expert");
            setStartWorkspaceTour(true);
            openFreshDemo(DEFAULT_DEMO_SCENARIO);
          }}
          onStartBlank={() => navigate("wizard")}
          onOpenCollaboration={() => {
            const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            document
              .getElementById("collaboration")
              ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
          }}
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
              experienceMode={workspaceExperienceMode}
              onExperienceModeChange={setWorkspaceExperienceMode}
              isDemo={Boolean(activeDemoScenarioId) || activeCase.id === DEMO_CASE_ID}
              {...(activeDemoScenarioId ? { activeDemoScenarioId } : {})}
              onOpenDemoScenario={(scenarioId) => {
                setStartWorkspaceTour(false);
                openFreshDemo(scenarioId);
              }}
              onRegisterLeaveGuard={(guard) => {
                workspaceLeaveGuardRef.current = guard;
              }}
              onHome={(latestCase) => {
                setActiveCase(latestCase);
                setLocalCases((current) =>
                  mergeLocalCaseSummaries(current, [summarizeCase(latestCase)]),
                );
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
