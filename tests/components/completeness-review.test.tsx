import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CompletenessReview } from "../../src/components/InspectorPanel";
import { createBlankCase, ReplayEngine, type CompletenessAttestationInput } from "../../src/domain";

const NOW = "2026-08-29T10:00:00.000Z";

function blankCase() {
  return createBlankCase(
    {
      title: "No supplied evidence review",
      incidentDate: "2026-08-29",
      approximateTime: "10:00",
      sceneType: "straight-road",
      roadCondition: "unknown",
      vehicleCount: 2,
      initialStatement: "Two vehicles were involved.",
    },
    { now: NOW, caseId: "case-completeness-component" },
  );
}

function attestedCase() {
  let sequence = 0;
  const engine = new ReplayEngine(blankCase(), {
    now: () => NOW,
    idFactory: (prefix) => `${prefix}-component-${String(++sequence)}`,
  });
  const attest = (attestation: CompletenessAttestationInput) =>
    engine.execute({
      type: "completeness.attest",
      actor: "human",
      origin: "ui",
      expectedVersion: engine.state.caseVersion,
      attestation,
    });
  expect(attest({ kind: "no-evidence-supplied" })).toMatchObject({ ok: true });
  expect(
    attest({
      kind: "actor-damage",
      actorId: "actor-vehicle-a",
      outcome: "unknown",
    }),
  ).toMatchObject({ ok: true });
  expect(
    attest({
      kind: "actor-damage",
      actorId: "actor-vehicle-b",
      outcome: "not-assessed",
    }),
  ).toMatchObject({ ok: true });
  expect(attest({ kind: "uncertainty-review-completed" })).toMatchObject({ ok: true });
  return engine.state;
}

describe("CompletenessReview", () => {
  it("offers precise human actions without implying absence of evidence or damage", () => {
    const onAttest = vi.fn(() => true);
    render(
      <CompletenessReview replayCase={blankCase()} onAttest={onAttest} onWithdraw={vi.fn()} />,
    );

    expect(screen.getByText("Human actions only")).toBeVisible();
    expect(screen.getByText(/it does not mean evidence does not exist/i)).toBeVisible();
    expect(
      screen.getAllByText(/Choose “unknown” when available information does not establish damage/),
    ).toHaveLength(2);
    expect(
      screen.queryByText(/This record does not make unknown information certain/i),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Record no evidence supplied" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Vehicle A damage as unknown" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Record Vehicle B damage as not assessed" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Record uncertainty review complete" }));

    expect(onAttest.mock.calls).toEqual([
      [{ kind: "no-evidence-supplied" }],
      [{ kind: "actor-damage", actorId: "actor-vehicle-a", outcome: "unknown" }],
      [{ kind: "actor-damage", actorId: "actor-vehicle-b", outcome: "not-assessed" }],
      [{ kind: "uncertainty-review-completed" }],
    ]);
  });

  it("shows auditable outcomes and lets a person withdraw each record", () => {
    const replayCase = attestedCase();
    const onWithdraw = vi.fn(() => true);
    render(
      <CompletenessReview replayCase={replayCase} onAttest={vi.fn()} onWithdraw={onWithdraw} />,
    );

    const vehicleA = screen.getByRole("region", { name: "Vehicle A damage review" });
    const vehicleB = screen.getByRole("region", { name: "Vehicle B damage review" });
    expect(within(vehicleA).getByText(/damage as/)).toHaveTextContent("unknown");
    expect(within(vehicleB).getByText(/damage as/)).toHaveTextContent("not assessed");
    expect(screen.getByText(/This does not establish that evidence does not exist/i)).toBeVisible();
    expect(
      screen.getByText(/This record does not make unknown information certain/i),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Withdraw no-evidence record" }));
    fireEvent.click(
      within(vehicleA).getByRole("button", { name: "Withdraw Vehicle A damage record" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Withdraw uncertainty review" }));

    expect(onWithdraw).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^completeness-attestation-/),
    );
    expect(onWithdraw).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^completeness-attestation-/),
    );
    expect(onWithdraw).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/^completeness-attestation-/),
    );
  });

  it("labels an untrusted imported record as needing fresh local review", () => {
    const replayCase = attestedCase();
    replayCase.completenessAttestations.forEach((attestation) => {
      attestation.humanAttestationTrusted = false;
    });

    render(<CompletenessReview replayCase={replayCase} onAttest={vi.fn()} onWithdraw={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Review and record again" })).toBeVisible();
    expect(screen.getAllByText(/fresh local review/i)).toHaveLength(2);
    expect(screen.getAllByText(/again locally/i)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Withdraw/ })).not.toBeInTheDocument();
  });
});
