import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => ({
  deleteCaseLocally: vi.fn(),
  loadCaseById: vi.fn(),
  loadLocalVault: vi.fn(),
  reconcilePendingEvidencePurges: vi.fn(),
}));

vi.mock("../../src/persistence/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/persistence/database")>()),
  deleteCaseLocally: persistence.deleteCaseLocally,
  loadCaseById: persistence.loadCaseById,
  loadLocalVault: persistence.loadLocalVault,
  reconcilePendingEvidencePurges: persistence.reconcilePendingEvidencePurges,
}));

vi.mock("../../src/components/Workspace", () => ({
  Workspace: ({ initialCase }: { initialCase: { caseVersion: number; title: string } }) => (
    <main aria-label="Test case workspace">
      <span>{initialCase.title}</span>
      <span>Workspace version {initialCase.caseVersion}</span>
    </main>
  ),
}));

import { App } from "../../src/App";
import { createDemoCase } from "../../src/domain";

const CLEAN_EVIDENCE_PURGE_STATUS = {
  attempted: 0,
  completed: 0,
  failed: 0,
  pending: 0,
};

describe("App local vault recovery", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    persistence.deleteCaseLocally.mockReset();
    persistence.loadCaseById.mockReset();
    persistence.loadLocalVault.mockReset();
    persistence.reconcilePendingEvidencePurges.mockReset();
    persistence.reconcilePendingEvidencePurges.mockResolvedValue(CLEAN_EVIDENCE_PURGE_STATUS);
  });

  it("shows an actionable load error and retries instead of treating rejection as an empty vault", async () => {
    persistence.loadLocalVault
      .mockRejectedValueOnce(new Error("IndexedDB is unavailable."))
      .mockResolvedValueOnce({
        retainedRecoveryRecords: [],
        evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
      });
    persistence.loadCaseById.mockResolvedValue({
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
    });

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Local vault could not be opened");
    expect(alert).toHaveTextContent("Saved browser data was not changed");
    expect(screen.queryByRole("button", { name: /Try the demo case/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start a blank case" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry local load" }));

    expect(
      await screen.findByRole("heading", {
        name: "A shared black box for incidents that did not have one.",
      }),
    ).toBeVisible();
    expect(screen.queryByText("Local vault could not be opened")).not.toBeInTheDocument();
    expect(persistence.loadLocalVault).toHaveBeenCalledTimes(2);
    expect(persistence.loadCaseById).not.toHaveBeenCalled();
  });

  it("reloads the durable case when browser history re-enters the same case route", async () => {
    const initial = createDemoCase();
    initial.id = "case-history-reentry";
    initial.title = "Initial in-memory case";
    const durable = structuredClone(initial);
    durable.caseVersion = 2;
    durable.title = "Durable saved case";
    window.history.replaceState({}, "", `/#case/${initial.id}`);
    persistence.loadLocalVault.mockResolvedValue({
      replayCase: initial,
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
    });
    persistence.loadCaseById
      .mockResolvedValueOnce({
        replayCase: initial,
        retainedRecoveryRecords: [],
        evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
      })
      .mockResolvedValueOnce({
        replayCase: durable,
        retainedRecoveryRecords: [],
        evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
      });

    render(<App />);
    expect(await screen.findByText("Workspace version 1")).toBeVisible();

    act(() => {
      window.history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      await screen.findByRole("heading", {
        name: "A shared black box for incidents that did not have one.",
      }),
    ).toBeVisible();

    act(() => {
      window.history.pushState({}, "", `/#case/${initial.id}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByText("Workspace version 2")).toBeVisible();
    expect(screen.getByText("Durable saved case")).toBeVisible();
    expect(persistence.loadCaseById).toHaveBeenCalledTimes(2);
  });

  it("reloads the durable record instead of resuming the landing page's stale copy", async () => {
    const initial = createDemoCase();
    initial.id = "case-resume-reload";
    initial.title = "Resume target";
    const durable = structuredClone(initial);
    durable.caseVersion = 3;
    durable.title = "Resume target — saved v3";
    persistence.loadLocalVault.mockResolvedValue({
      replayCase: initial,
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
    });
    persistence.loadCaseById.mockResolvedValue({
      replayCase: durable,
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Open local case: Resume target/ }));

    expect(await screen.findByText("Workspace version 3")).toBeVisible();
    expect(screen.getByText("Resume target — saved v3")).toBeVisible();
    expect(persistence.loadCaseById).toHaveBeenCalledWith(initial.id);
  });

  it("requires visible human confirmation before deleting one local case", async () => {
    const localCase = createDemoCase();
    localCase.id = "case-delete-alpha";
    localCase.title = "Alpha local record";
    persistence.loadLocalVault.mockResolvedValue({
      replayCase: localCase,
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
    });
    persistence.loadCaseById.mockResolvedValue({
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
    });
    persistence.deleteCaseLocally.mockResolvedValue(undefined);

    render(<App />);

    const deleteButton = await screen.findByRole("button", {
      name: "Delete local case: Alpha local record",
    });
    deleteButton.focus();
    fireEvent.click(deleteButton);

    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete “Alpha local record”?",
    });
    expect(persistence.deleteCaseLocally).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Keep case" })).toHaveFocus();
    expect(dialog).toHaveTextContent("locally stored evidence");
    expect(dialog).toHaveTextContent("Site Tools cannot request or confirm this deletion");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(deleteButton).toHaveFocus();
    expect(persistence.deleteCaseLocally).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Open local case: Alpha local record/ }),
    ).toBeVisible();

    fireEvent.click(deleteButton);
    const confirmation = await screen.findByRole("alertdialog", {
      name: "Delete “Alpha local record”?",
    });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Delete local case" }));

    await waitFor(() => {
      expect(persistence.deleteCaseLocally).toHaveBeenCalledWith(localCase.id);
    });
    expect(
      screen.queryByRole("button", { name: /Open local case: Alpha local record/ }),
    ).not.toBeInTheDocument();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Deleted Alpha local record from this browser.");
    await waitFor(() => expect(status).toHaveFocus());
    expect(persistence.loadCaseById).not.toHaveBeenCalled();
  });

  it("keeps a case listed with privacy-safe retry guidance when deletion fails", async () => {
    const localCase = createDemoCase();
    localCase.id = "case-delete-retry";
    localCase.title = "Retry deletion record";
    persistence.loadLocalVault.mockResolvedValue({
      replayCase: localCase,
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
    });
    persistence.loadCaseById.mockResolvedValue({
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
    });
    persistence.deleteCaseLocally
      .mockRejectedValueOnce(new Error("case-private-token could not be deleted"))
      .mockResolvedValueOnce(undefined);

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete local case: Retry deletion record" }),
    );
    let dialog = await screen.findByRole("alertdialog", {
      name: "Delete “Retry deletion record”?",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete local case" }));

    const error = await within(dialog).findByRole("alert");
    expect(error).toHaveTextContent("could not finish removing this case");
    expect(error).not.toHaveTextContent("case-private-token");
    expect(
      screen.getByRole("button", { name: /Open local case: Retry deletion record/ }),
    ).toBeVisible();
    expect(persistence.deleteCaseLocally).toHaveBeenCalledTimes(1);

    dialog = screen.getByRole("alertdialog", { name: "Delete “Retry deletion record”?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete local case" }));

    await waitFor(() => expect(persistence.deleteCaseLocally).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: /Open local case: Retry deletion record/ }),
    ).not.toBeInTheDocument();
  });

  it("opens a retained generic case on an encoded case-specific route", async () => {
    const localCase = createDemoCase();
    localCase.id = "case/local alpha";
    localCase.title = "Encoded route case";
    persistence.loadLocalVault.mockResolvedValue({
      replayCase: localCase,
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
    });
    persistence.loadCaseById.mockResolvedValue({
      replayCase: localCase,
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
    });

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Open local case: Encoded route case/ }),
    );

    expect(await screen.findByText("Encoded route case")).toBeVisible();
    expect(window.location.hash).toBe("#case/case%2Flocal%20alpha");
  });

  it("uses generic recovery copy when a non-demo case route is missing", async () => {
    window.history.replaceState({}, "", "/#case/case-generic-missing");
    persistence.loadLocalVault.mockResolvedValue({
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
    });
    persistence.loadCaseById.mockResolvedValue({
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
    });

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Saved case unavailable");
    expect(alert).toHaveTextContent("That local case is not available in this browser");
    expect(alert).toHaveTextContent("different browser profile");
    expect(alert).not.toHaveTextContent("demo run");
  });

  it("keeps a privacy-safe cleanup warning visible until queued evidence bytes are removed", async () => {
    persistence.loadLocalVault.mockResolvedValue({
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: {
        attempted: 1,
        completed: 0,
        failed: 1,
        pending: 1,
      },
    });
    persistence.loadCaseById.mockResolvedValue({
      retainedRecoveryRecords: [],
      evidencePurgeCleanup: CLEAN_EVIDENCE_PURGE_STATUS,
    });
    persistence.reconcilePendingEvidencePurges
      .mockRejectedValueOnce(
        new Error("case-private-client evidence:private-cleanup-target could not be deleted"),
      )
      .mockResolvedValueOnce({
        attempted: 1,
        completed: 1,
        failed: 0,
        pending: 0,
      });

    render(<App />);

    const warning = await screen.findByRole("alert", {
      name: "Evidence cleanup still needs attention",
    });
    expect(warning).toHaveTextContent("bytes may still remain in this browser");
    expect(warning).toHaveTextContent("clear REPLAY’s site data");
    expect(warning).not.toHaveTextContent("case-private-client");
    expect(warning).not.toHaveTextContent("evidence:private-cleanup-target");

    fireEvent.click(screen.getByRole("button", { name: "Retry evidence cleanup" }));

    expect(await screen.findByText(/The latest retry could not finish/)).toBeVisible();
    expect(warning).not.toHaveTextContent("case-private-client");
    expect(warning).not.toHaveTextContent("evidence:private-cleanup-target");

    fireEvent.click(screen.getByRole("button", { name: "Retry evidence cleanup" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("alert", { name: "Evidence cleanup still needs attention" }),
      ).not.toBeInTheDocument();
    });
    expect(persistence.reconcilePendingEvidencePurges).toHaveBeenCalledTimes(2);
  });
});
