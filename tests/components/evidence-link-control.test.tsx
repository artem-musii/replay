import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EvidenceLinkControl } from "../../src/components/InspectorPanel";
import { createDemoCase, ReplayEngine } from "../../src/domain";

describe("EvidenceLinkControl", () => {
  it("offers trajectories, individual damage markers, and branch-scoped assumptions", () => {
    let idCounter = 0;
    const engine = new ReplayEngine(createDemoCase(), {
      now: () => "2026-08-27T10:00:00.000Z",
      idFactory: (prefix) => `${prefix}-component-test-${String(++idCounter)}`,
    });
    const assumptionId = "assumption-component-test";
    const annotationId = "annotation-component-test";
    expect(
      engine.execute({
        type: "hypothesis.add-assumption",
        actor: "human",
        origin: "ui",
        branchId: "branch-baseline",
        assumptionId,
        statement: "Vehicle A may have followed the inside edge before contact.",
      }).ok,
    ).toBe(true);
    expect(
      engine.execute({
        type: "evidence.update",
        actor: "human",
        origin: "ui",
        evidenceId: "evidence-overview",
        annotations: [
          {
            id: annotationId,
            kind: "point",
            x: 0.5,
            y: 0.5,
            label: "Inside edge",
          },
        ],
      }).ok,
    ).toBe(true);

    const replayCase = engine.state;
    const asset = replayCase.evidence.find((candidate) => candidate.id === "evidence-overview");
    if (!asset) throw new Error("Evidence fixture is missing");
    const onLink = vi.fn();
    render(<EvidenceLinkControl asset={asset} replayCase={replayCase} onLink={onLink} />);

    expect(
      screen.getByRole("option", { name: "Vehicle A · Baseline reconstruction" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: /Vehicle A · front left · Minor scraping at the front-left bumper/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: "Baseline reconstruction · Vehicle A may have followed the inside edge before contact.",
      }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Evidence scope" }), {
      target: { value: annotationId },
    });
    fireEvent.change(screen.getByRole("combobox", { name: /Link to case item/i }), {
      target: { value: `assumption:${assumptionId}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link as supporting evidence" }));

    expect(onLink).toHaveBeenCalledWith(
      "evidence-overview",
      "assumption",
      assumptionId,
      annotationId,
    );
  });
});
