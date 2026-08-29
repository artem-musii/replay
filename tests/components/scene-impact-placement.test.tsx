import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { SceneCanvas } from "../../src/components/SceneCanvas";
import { createBlankCase, type ReplayCase } from "../../src/domain";

function blankCase(vehicleCount: 2 | 3): ReplayCase {
  return createBlankCase(
    {
      title: `${String(vehicleCount)} vehicle contact test`,
      incidentDate: "2026-08-29",
      sceneType: "intersection",
      roadCondition: "dry",
      vehicleCount,
    },
    {
      caseId: `case-impact-placement-${String(vehicleCount)}`,
      now: "2026-08-29T10:00:00.000Z",
    },
  );
}

function sceneProps(
  replayCase: ReplayCase,
  currentTimeMs: number,
  onMarkImpact = vi.fn(() => true),
): ComponentProps<typeof SceneCanvas> {
  return {
    replayCase,
    currentTimeMs,
    comparisonBranchIds: [],
    activeAgentIds: [],
    onSelect: vi.fn(),
    onSelectKeyframe: vi.fn(),
    onEditStart: vi.fn(),
    onMoveActor: vi.fn(),
    onMoveKeyframe: vi.fn(),
    onCreateTrajectory: vi.fn(),
    onMarkDamage: vi.fn(() => true),
    onMarkImpact,
    onToggleActorLock: vi.fn(),
    onToggleTrajectoryLock: vi.fn(),
    onToggleEventLock: vi.fn(),
    onUpdateEnvironment: vi.fn(),
  };
}

describe("scene impact placement", () => {
  it("does not paint a template parking limit as a recorded fact", () => {
    const replayCase = createBlankCase(
      {
        title: "Parking review",
        incidentDate: "2026-08-29",
        sceneType: "parking-area",
        roadCondition: "dry",
        vehicleCount: 2,
      },
      { caseId: "case-parking-speed-marking", now: "2026-08-29T10:00:00.000Z" },
    );
    const { container, rerender } = render(<SceneCanvas {...sceneProps(replayCase, 0)} />);

    expect(container.querySelector(".parking-speed-label")).toBeNull();

    rerender(
      <SceneCanvas
        {...sceneProps(
          {
            ...replayCase,
            environment: { ...replayCase.environment, postedSpeedLimitKph: 15 },
          },
          0,
        )}
      />,
    );
    expect(container.querySelector(".parking-speed-label")).toHaveTextContent("15");
  });

  it("captures a distinct actor pair together with the original branch and time", () => {
    const replayCase = blankCase(3);
    const onMarkImpact = vi.fn(() => true);
    const props = sceneProps(replayCase, 1_250, onMarkImpact);
    const { rerender } = render(<SceneCanvas {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark impact" }));
    expect(
      screen.getByRole("form", {
        name: "Place approximate impact by coordinates for Vehicle A and Vehicle B",
      }),
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText("Second vehicle"), {
      target: { value: "actor-vehicle-c" },
    });
    fireEvent.change(screen.getByLabelText("First vehicle"), {
      target: { value: "actor-vehicle-b" },
    });

    const reorderedCase = {
      ...replayCase,
      actors: [...replayCase.actors].reverse(),
    };
    rerender(<SceneCanvas {...props} replayCase={reorderedCase} currentTimeMs={9_000} />);

    const form = screen.getByRole("form", {
      name: "Place approximate impact by coordinates for Vehicle B and Vehicle C",
    });
    fireEvent.change(within(form).getByRole("spinbutton", { name: "X" }), {
      target: { value: "42.5" },
    });
    fireEvent.change(within(form).getByRole("spinbutton", { name: "Y" }), {
      target: { value: "57.5" },
    });
    fireEvent.click(
      within(form).getByRole("button", {
        name: "Place contact between Vehicle B and Vehicle C",
      }),
    );

    expect(onMarkImpact).toHaveBeenCalledWith(
      { x: 42.5, y: 57.5 },
      {
        branchId: replayCase.activeBranchId,
        timeMs: 1_250,
        actorIds: ["actor-vehicle-b", "actor-vehicle-c"],
      },
    );
  });

  it("keeps the two-vehicle flow free of redundant pair controls", () => {
    const replayCase = blankCase(2);
    render(<SceneCanvas {...sceneProps(replayCase, 0)} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark impact" }));

    expect(
      screen.getByRole("form", {
        name: "Place approximate impact by coordinates for Vehicle A and Vehicle B",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("group", { name: "Vehicles involved" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("First vehicle")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Second vehicle")).not.toBeInTheDocument();
  });
});
