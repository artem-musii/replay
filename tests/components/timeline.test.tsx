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

function preparePointerDrag(element: HTMLElement): void {
  Object.defineProperty(element, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
}

function setTimelineTrackBounds(track: HTMLElement): void {
  Object.defineProperty(track, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 120,
      height: 120,
      left: 0,
      right: 1_024,
      top: 0,
      width: 1_024,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

function getTimelineTrack(container: HTMLElement): HTMLElement {
  const track = container.querySelector<HTMLElement>(".timeline__tracks");
  if (!track) throw new Error("Timeline track was not rendered.");
  setTimelineTrackBounds(track);
  return track;
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

  it("previews a multi-step event drag and commits it once on pointer up", () => {
    const onTimeChange = vi.fn();
    const onMoveEvent = vi.fn();
    const { container } = renderTimeline({ onTimeChange, onMoveEvent });
    const track = getTimelineTrack(container);
    const impact = screen.getByRole("button", { name: /Approximate contact at 0:10\.0/i });

    preparePointerDrag(impact);

    fireEvent.pointerDown(impact, { pointerId: 7, clientX: 512, buttons: 1 });
    fireEvent.pointerMove(track, { pointerId: 7, clientX: 262, buttons: 1 });
    fireEvent.pointerMove(track, { pointerId: 7, clientX: 762, buttons: 1 });

    expect(onMoveEvent).not.toHaveBeenCalled();
    expect(onTimeChange.mock.calls).toEqual([[5_000], [15_000]]);
    expect(impact.style.left).toBe("75%");

    fireEvent.pointerUp(track, { pointerId: 7, clientX: 762, buttons: 0 });

    expect(onMoveEvent).toHaveBeenCalledOnce();
    expect(onMoveEvent).toHaveBeenCalledWith("event-impact", 15_000);
  });

  it("previews a multi-step keyframe drag and commits it once on pointer up", () => {
    const onTimeChange = vi.fn();
    const onMoveKeyframe = vi.fn();
    const { container } = renderTimeline({ onTimeChange, onMoveKeyframe });
    const track = getTimelineTrack(container);
    const keyframe = screen.getByRole("button", {
      name: /Vehicle A path keyframe at 0:08\.0/i,
    });

    preparePointerDrag(keyframe);

    fireEvent.pointerDown(keyframe, { pointerId: 11, clientX: 412, buttons: 1 });
    fireEvent.pointerMove(track, { pointerId: 11, clientX: 112, buttons: 1 });
    fireEvent.pointerMove(track, { pointerId: 11, clientX: 912, buttons: 1 });

    expect(onMoveKeyframe).not.toHaveBeenCalled();
    expect(onTimeChange.mock.calls).toEqual([[2_000], [18_000]]);
    expect(keyframe.style.left).toBe("90%");

    fireEvent.pointerUp(track, { pointerId: 11, clientX: 912, buttons: 0 });

    expect(onMoveKeyframe).toHaveBeenCalledOnce();
    expect(onMoveKeyframe).toHaveBeenCalledWith(
      "trajectory-a-baseline",
      "trajectory-a-baseline-keyframe-3",
      18_000,
    );
  });

  it("rolls back a transient drag preview without committing on pointer cancel", () => {
    const onTimeChange = vi.fn();
    const onMoveKeyframe = vi.fn();
    const { container } = renderTimeline({ onTimeChange, onMoveKeyframe });
    const track = getTimelineTrack(container);
    const keyframe = screen.getByRole("button", {
      name: /Vehicle A path keyframe at 0:08\.0/i,
    });

    preparePointerDrag(keyframe);

    fireEvent.pointerDown(keyframe, { pointerId: 13, clientX: 412, buttons: 1 });
    fireEvent.pointerMove(track, { pointerId: 13, clientX: 612, buttons: 1 });

    expect(onTimeChange).toHaveBeenCalledWith(12_000);
    expect(keyframe.style.left).toBe("60%");

    fireEvent.pointerCancel(track, { pointerId: 13 });

    expect(onMoveKeyframe).not.toHaveBeenCalled();
    expect(keyframe.style.left).toBe("40%");
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

  it("traps add-event focus, closes on Escape, and restores the invoking control", () => {
    const onAddEvent = vi.fn();
    renderTimeline({ onAddEvent });

    const invoker = screen.getByRole("button", { name: "Add timeline event" });
    invoker.focus();
    fireEvent.click(invoker);

    const dialog = screen.getByRole("dialog", { name: "Add timeline event" });
    const title = screen.getByRole("textbox", { name: "Event title" });
    const close = screen.getByRole("button", { name: "Close event editor" });
    const submit = screen.getByRole("button", { name: "Add at 0:10.0" });
    expect(title).toHaveFocus();

    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(submit).toHaveFocus();
    fireEvent.keyDown(submit, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Add timeline event" })).not.toBeInTheDocument();
    expect(invoker).toHaveFocus();
    expect(onAddEvent).not.toHaveBeenCalled();
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
      requestId: "request-question-lane",
      undoable: true,
      createdAt: "2026-08-27T10:01:00.000Z",
    },
  ];

  it("distinguishes authors and only offers agent reversion", () => {
    const onRevert = vi.fn();
    render(
      <ActivityPanel
        activities={activities}
        revertibleActivityIds={["activity-agent"]}
        onRevert={onRevert}
      />,
    );

    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Revert agent action/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Revert agent action/i }));
    expect(onRevert).toHaveBeenCalledWith("activity-agent");
  });

  it("hides stale historical revert actions when the engine has no live undo entry", () => {
    render(<ActivityPanel activities={activities} onRevert={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /Revert agent action/i })).not.toBeInTheDocument();
  });
});
