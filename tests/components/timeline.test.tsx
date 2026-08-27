import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActivityPanel } from "../../src/components/ActivityPanel";
import { Timeline, type TimelineProps } from "../../src/components/Timeline";
import { createDemoCase } from "../../src/domain/seed";
import type { ActivityEvent } from "../../src/domain/models";

function renderTimeline(overrides: Partial<TimelineProps> = {}) {
  const replayCase = createDemoCase();
  const props: TimelineProps = {
    timeRangeMs: replayCase.timeRangeMs,
    currentTimeMs: 10_000,
    isPlaying: false,
    playbackSpeed: 1,
    activeBranchId: replayCase.activeBranchId,
    actors: replayCase.actors,
    trajectories: replayCase.trajectories,
    events: replayCase.timelineEvents,
    onTimeChange: vi.fn(),
    onPlayingChange: vi.fn(),
    onPlaybackSpeedChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<Timeline {...props} />), props };
}

describe("Timeline", () => {
  it("reports scrub, playback, and speed changes through controlled callbacks", () => {
    const onTimeChange = vi.fn();
    const onPlayingChange = vi.fn();
    const onPlaybackSpeedChange = vi.fn();
    renderTimeline({ onTimeChange, onPlayingChange, onPlaybackSpeedChange });

    fireEvent.change(screen.getByRole("slider", { name: "Timeline position" }), {
      target: { value: "12500" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Play reconstruction" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Playback speed" }), {
      target: { value: "2" },
    });

    expect(onTimeChange).toHaveBeenCalledWith(12_500);
    expect(onPlayingChange).toHaveBeenCalledWith(true);
    expect(onPlaybackSpeedChange).toHaveBeenCalledWith(2);
  });

  it("supports timeline and editable marker keyboard controls", () => {
    const onTimeChange = vi.fn();
    const onMoveEvent = vi.fn();
    renderTimeline({ onTimeChange, onMoveEvent });

    fireEvent.keyDown(screen.getByRole("region", { name: "Incident timeline" }), {
      key: "ArrowRight",
      shiftKey: true,
    });
    const impact = screen.getByRole("button", { name: /Approximate contact at 0:10\.0/i });
    fireEvent.keyDown(impact, { key: "ArrowLeft" });

    expect(onTimeChange).toHaveBeenCalledWith(11_000);
    expect(onMoveEvent).toHaveBeenCalledWith("event-impact", 9_900);
  });

  it("shows and exits comparison mode", () => {
    const onExit = vi.fn();
    renderTimeline({
      comparison: {
        branchIds: ["branch-alternative"],
        branchNames: {
          "branch-baseline": "Baseline",
          "branch-alternative": "Vehicle B lane change",
        },
        onExit,
      },
    });

    expect(screen.getByText(/Vehicle B lane change/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Exit compare" }));
    expect(onExit).toHaveBeenCalledOnce();
  });
});

describe("ActivityPanel", () => {
  const activities: ActivityEvent[] = [
    {
      id: "activity-human",
      caseVersion: 2,
      author: "human",
      origin: "ui",
      actionType: "actor.update-pose",
      summary: "Moved Vehicle A.",
      affectedIds: ["actor-a"],
      undoable: true,
      createdAt: "2026-08-27T10:00:00.000Z",
    },
    {
      id: "activity-agent",
      caseVersion: 3,
      author: "agent",
      origin: "webmcp",
      actionType: "question.add",
      summary: "Added an unresolved lane question.",
      affectedIds: ["question-lane"],
      undoable: true,
      createdAt: "2026-08-27T10:01:00.000Z",
    },
  ];

  it("distinguishes authors and only offers agent reversion", () => {
    const onRevert = vi.fn();
    render(<ActivityPanel activities={activities} onRevert={onRevert} />);

    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Revert agent action/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Revert agent action/i }));
    expect(onRevert).toHaveBeenCalledWith("activity-agent");
  });
});
