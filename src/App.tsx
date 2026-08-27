import { lazy, Suspense, useEffect, useState } from "react";

import { createBlankCase, createDemoCase, type ReplayCase } from "./domain";
import { loadMostRecentCase } from "./persistence/database";
import { detectWebMCPSupport } from "./webmcp";
import { BlankCaseWizard, type BlankCaseInput } from "./components/BlankCaseWizard";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LandingPage } from "./components/LandingPage";

const Workspace = lazy(async () => {
  const module = await import("./components/Workspace");
  return { default: module.Workspace };
});

type View = "landing" | "wizard" | "workspace";

export function App() {
  const [view, setView] = useState<View>("landing");
  const [activeCase, setActiveCase] = useState<ReplayCase>();
  const [recentCase, setRecentCase] = useState<ReplayCase>();
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [hydrating, setHydrating] = useState(true);
  const webMcpSupported = detectWebMCPSupport().available;

  useEffect(() => {
    let cancelled = false;
    void loadMostRecentCase().then(
      (loaded) => {
        if (cancelled) return;
        setRecentCase(loaded);
        if (window.location.hash === "#demo") {
          setActiveCase(createDemoCase());
          setView("workspace");
        } else if (window.location.hash === "#workspace" && loaded) {
          setActiveCase(loaded);
          setView("workspace");
        }
        setHydrating(false);
      },
      () => setHydrating(false),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      if (window.location.hash === "#demo") {
        setActiveCase(createDemoCase());
        setView("workspace");
      } else if (window.location.hash === "#workspace" && recentCase) {
        setActiveCase(recentCase);
        setView("workspace");
      } else if (window.location.hash === "#new") setView("wizard");
      else setView("landing");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [recentCase]);

  function navigate(next: View, replace = false, workspaceHash = "#workspace"): void {
    const hash = next === "workspace" ? workspaceHash : next === "wizard" ? "#new" : "";
    if (replace) window.history.replaceState({}, "", `${window.location.pathname}${hash}`);
    else window.history.pushState({}, "", `${window.location.pathname}${hash}`);
    setView(next);
  }

  function openCase(replayCase: ReplayCase, replace = false, demo = false): void {
    setActiveCase(replayCase);
    setRecentCase(replayCase);
    setWorkspaceKey((value) => value + 1);
    navigate("workspace", replace, demo ? "#demo" : "#workspace");
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

  return (
    <ErrorBoundary>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {view === "landing" && (
        <LandingPage
          webMcpSupported={webMcpSupported}
          {...(recentCase
            ? { recentCaseTitle: recentCase.title, onResumeCase: () => openCase(recentCase) }
            : {})}
          onOpenDemo={() => openCase(createDemoCase(), false, true)}
          onStartBlank={() => navigate("wizard")}
          onOpenCollaboration={() =>
            document.getElementById("collaboration")?.scrollIntoView({ behavior: "smooth" })
          }
        />
      )}
      {view === "wizard" && (
        <BlankCaseWizard
          onCancel={() => navigate("landing")}
          onCreate={(input: BlankCaseInput) => openCase(createBlankCase(input))}
        />
      )}
      {view === "workspace" && activeCase && (
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
            isDemo={activeCase.id === "case-demo-roundabout"}
            onHome={(latestCase) => {
              setActiveCase(latestCase);
              setRecentCase(latestCase);
              navigate("landing");
            }}
            onResetDemo={() => openCase(createDemoCase(), true, true)}
            onImportCase={(imported) => openCase(imported, true)}
          />
        </Suspense>
      )}
    </ErrorBoundary>
  );
}
