import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => ({
  deleteCaseLocally: vi.fn(),
  loadCaseById: vi.fn(),
  loadLocalVault: vi.fn(),
}));

vi.mock("../../src/persistence/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/persistence/database")>()),
  deleteCaseLocally: persistence.deleteCaseLocally,
  loadCaseById: persistence.loadCaseById,
  loadLocalVault: persistence.loadLocalVault,
}));

import { App } from "../../src/App";

describe("App local vault recovery", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    persistence.deleteCaseLocally.mockReset();
    persistence.loadCaseById.mockReset();
    persistence.loadLocalVault.mockReset();
  });

  it("shows an actionable load error and retries instead of treating rejection as an empty vault", async () => {
    persistence.loadLocalVault
      .mockRejectedValueOnce(new Error("IndexedDB is unavailable."))
      .mockResolvedValueOnce({ retainedRecoveryRecords: [] });
    persistence.loadCaseById.mockResolvedValue({ retainedRecoveryRecords: [] });

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
});
