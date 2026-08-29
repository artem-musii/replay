import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { evidenceCurrentLinks } from "../../src/components/evidenceRelationships";
import { EvidenceLinkControl } from "../../src/components/InspectorPanel";
import { isoDateTimeToLocalInput } from "../../src/components/localDateTime";
import { createDemoCase, ReplayEngine } from "../../src/domain";

describe("EvidenceLinkControl", () => {
  it("round-trips capture instants through the local date-time editor without shifting zones", () => {
    const capturedAt = "2026-05-17T15:44:23.417Z";

    expect(new Date(isoDateTimeToLocalInput(capturedAt)).toISOString()).toBe(capturedAt);
  });

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

  it("falls back to the whole asset when the chosen annotation is removed", () => {
    const replayCase = createDemoCase();
    const original = replayCase.evidence.find((candidate) => candidate.id === "evidence-overview");
    if (!original) throw new Error("Evidence fixture is missing");
    const annotationId = "annotation-removed-during-linking";
    const withAnnotation = {
      ...original,
      annotations: [
        {
          id: annotationId,
          kind: "point" as const,
          x: 0.5,
          y: 0.5,
          label: "Temporary point",
        },
      ],
    };
    const onLink = vi.fn(() => true);
    const { rerender } = render(
      <EvidenceLinkControl asset={withAnnotation} replayCase={replayCase} onLink={onLink} />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Evidence scope" }), {
      target: { value: annotationId },
    });
    rerender(
      <EvidenceLinkControl
        asset={{ ...withAnnotation, annotations: [] }}
        replayCase={replayCase}
        onLink={onLink}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: /Link to case item/i }), {
      target: { value: `claim:${replayCase.claims[0]?.id ?? ""}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));

    expect(onLink).toHaveBeenCalledWith(original.id, "claim", replayCase.claims[0]?.id, undefined);
  });

  it("lists cited, contextual, and annotation relationships as separately removable scopes", () => {
    const replayCase = createDemoCase();
    const asset = replayCase.evidence.find((candidate) => candidate.id === "evidence-road");
    if (!asset) throw new Error("Evidence fixture is missing");
    asset.annotations = [
      { id: "annotation-current-links", kind: "point", x: 0.4, y: 0.5, label: "Road" },
    ];
    asset.annotationLinks = [
      {
        annotationId: "annotation-current-links",
        targetType: "claim",
        targetId: "claim-road-wet",
      },
    ];

    expect(evidenceCurrentLinks(asset, replayCase)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: "claim",
          targetId: "claim-road-wet",
          scope: "Cited source",
        }),
        expect.objectContaining({
          targetType: "claim",
          targetId: "claim-road-wet",
          annotationId: "annotation-current-links",
          scope: "Annotation · Road",
        }),
      ]),
    );
  });
});
