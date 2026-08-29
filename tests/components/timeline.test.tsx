import { fireEvent, render, screen, within } from "@testing-library/react";
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

function createTrajectoryWithKeyframeTimes(times: readonly number[]) {
  const source = createDemoCase().trajectories[0];
  if (!source || source.keyframes.length < times.length) {
    throw new Error("Demo trajectory cannot supply the requested keyframe fixture.");
  }
  return {
    ...source,
    keyframes: times.map((timeMs, index) => {
      const keyframe = source.keyframes[index];
      if (!keyframe) {
        throw new Error("Demo trajectory cannot supply the requested keyframe fixture.");
      }
      return { ...keyframe, timeMs };
    }),
  };
}

function timelinePercent(timeMs: number, range: TimelineProps["timeRangeMs"]): string {
  return `${String(((timeMs - range.start) / (range.end - range.start)) * 100)}%`;
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

  it("emits one selection transition for an editable marker pointer click", () => {
    const onSelectEvent = vi.fn();
    const onSelectKeyframe = vi.fn();
    renderTimeline({
      onSelectEvent,
      onSelectKeyframe,
      onMoveEvent: vi.fn(),
      onMoveKeyframe: vi.fn(),
    });
    const impact = screen.getByRole("button", { name: /Approximate contact at 0:10\.0/i });
    const keyframe = screen.getByRole("button", {
      name: /Vehicle A path keyframe at 0:08\.0/i,
    });
    preparePointerDrag(impact);
    preparePointerDrag(keyframe);

    fireEvent.pointerDown(impact, { pointerId: 21, buttons: 1 });
    fireEvent.click(impact);
    fireEvent.pointerDown(keyframe, { pointerId: 22, buttons: 1 });
    fireEvent.click(keyframe);

    expect(onSelectEvent).toHaveBeenCalledOnce();
    expect(onSelectEvent).toHaveBeenCalledWith("event-impact");
    expect(onSelectKeyframe).toHaveBeenCalledOnce();
    expect(onSelectKeyframe).toHaveBeenCalledWith(
      "trajectory-a-baseline",
      "trajectory-a-baseline-keyframe-5",
    );
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
    const fixtureTimes = [6_000, 8_000, 9_000] as const;
    const trajectory = createTrajectoryWithKeyframeTimes(fixtureTimes);
    const target = trajectory.keyframes[1];
    if (!target) throw new Error("Editable keyframe fixture was not created.");
    const minimumTime = fixtureTimes[0] + 100;
    const maximumTime = fixtureTimes[2] - 100;
    const onTimeChange = vi.fn();
    const onMoveKeyframe = vi.fn();
    const { container, props } = renderTimeline({
      trajectories: [trajectory],
      onTimeChange,
      onMoveKeyframe,
    });
    const track = getTimelineTrack(container);
    const keyframe = within(
      screen.getByRole("group", { name: "Vehicle A path keyframes" }),
    ).getAllByRole("button")[1];
    if (!keyframe) throw new Error("Editable keyframe control was not rendered.");

    preparePointerDrag(keyframe);

    fireEvent.pointerDown(keyframe, { pointerId: 11, clientX: 412, buttons: 1 });
    fireEvent.pointerMove(track, { pointerId: 11, clientX: 112, buttons: 1 });
    fireEvent.pointerMove(track, { pointerId: 11, clientX: 912, buttons: 1 });

    expect(onMoveKeyframe).not.toHaveBeenCalled();
    expect(onTimeChange.mock.calls).toEqual([[minimumTime], [maximumTime]]);
    expect(keyframe.style.left).toBe(timelinePercent(maximumTime, props.timeRangeMs));

    fireEvent.pointerUp(track, { pointerId: 11, clientX: 912, buttons: 0 });

    expect(onMoveKeyframe).toHaveBeenCalledOnce();
    expect(onMoveKeyframe).toHaveBeenCalledWith(trajectory.id, target.id, maximumTime);
  });

  it("rolls back a transient drag preview without committing on pointer cancel", () => {
    const fixtureTimes = [6_000, 8_000, 9_000] as const;
    const trajectory = createTrajectoryWithKeyframeTimes(fixtureTimes);
    const target = trajectory.keyframes[1];
    if (!target) throw new Error("Editable keyframe fixture was not created.");
    const maximumTime = fixtureTimes[2] - 100;
    const onTimeChange = vi.fn();
    const onMoveKeyframe = vi.fn();
    const { container, props } = renderTimeline({
      trajectories: [trajectory],
      onTimeChange,
      onMoveKeyframe,
    });
    const track = getTimelineTrack(container);
    const keyframe = within(
      screen.getByRole("group", { name: "Vehicle A path keyframes" }),
    ).getAllByRole("button")[1];
    if (!keyframe) throw new Error("Editable keyframe control was not rendered.");

    preparePointerDrag(keyframe);

    fireEvent.pointerDown(keyframe, { pointerId: 13, clientX: 412, buttons: 1 });
    fireEvent.pointerMove(track, { pointerId: 13, clientX: 612, buttons: 1 });

    expect(onTimeChange).toHaveBeenCalledWith(maximumTime);
    expect(keyframe.style.left).toBe(timelinePercent(maximumTime, props.timeRangeMs));

    fireEvent.pointerCancel(track, { pointerId: 13 });

    expect(onMoveKeyframe).not.toHaveBeenCalled();
    expect(onTimeChange).toHaveBeenLastCalledWith(10_000);
    expect(keyframe.style.left).toBe(timelinePercent(target.timeMs, props.timeRangeMs));
  });

  it("separates dense event and keyframe hit targets into aligned rows", () => {
    const trajectory = createTrajectoryWithKeyframeTimes([9_600, 10_000, 10_300]);
    const { container } = renderTimeline({ trajectories: [trajectory] });
    const firstStart = screen.getByRole("button", {
      name: /Vehicle A enters the reviewed interval at 0:00\.0/i,
    });
    const secondStart = screen.getByRole("button", {
      name: /Vehicle B enters the reviewed interval at 0:00\.0/i,
    });
    expect(firstStart.dataset.timelineRow).not.toBe(secondStart.dataset.timelineRow);

    const lane = screen.getByRole("group", { name: "Vehicle A path keyframes" });
    const denseKeyframes = within(lane).getAllByRole("button");
    expect(denseKeyframes).toHaveLength(3);
    expect(new Set(denseKeyframes.map((marker) => marker.dataset.timelineRow)).size).toBe(3);

    const laneLabel = container.querySelector<HTMLElement>(".timeline__lane-labels > div");
    expect(lane.style.getPropertyValue("--timeline-keyframe-dense-height")).toBe("72px");
    expect(laneLabel?.style.getPropertyValue("--timeline-keyframe-dense-height")).toBe("72px");
  });

  it("preserves millisecond timing for close imported keyframes", () => {
    const replayCase = createDemoCase();
    const source = replayCase.trajectories[0];
    if (!source) throw new Error("Demo trajectory is unavailable.");
    const closeTrajectory = {
      ...source,
      keyframes: source.keyframes.slice(0, 3).map((frame, index) => ({
        ...frame,
        timeMs: [0, 25, 50][index] ?? frame.timeMs,
      })),
    };
    const onTimeChange = vi.fn();
    const onMoveKeyframe = vi.fn();
    const { container } = renderTimeline({
      timeRangeMs: { start: 0, end: 50 },
      currentTimeMs: 25,
      trajectories: [closeTrajectory],
      events: [],
      onTimeChange,
      onMoveKeyframe,
    });
    const track = getTimelineTrack(container);
    const keyframe = container.querySelectorAll<HTMLButtonElement>(".timeline-keyframe")[1];
    const middleFrame = closeTrajectory.keyframes[1];
    if (!keyframe || !middleFrame) throw new Error("Close imported keyframe was not rendered.");
    preparePointerDrag(keyframe);

    expect(keyframe.style.left).toBe("50%");
    expect(keyframe).toHaveAccessibleName(/0:00\.025/);
    expect(screen.getByLabelText("Current timeline position")).toHaveTextContent(
      "0:00.025/ 0:00.050",
    );
    expect(
      [...container.querySelectorAll(".timeline__tick")].map((tick) => tick.textContent),
    ).toEqual(["0:00.0", "0:00.010", "0:00.020", "0:00.030", "0:00.040", "0:00.050"]);
    fireEvent.pointerDown(keyframe, { pointerId: 19, clientX: 512, buttons: 1 });
    fireEvent.pointerMove(track, { pointerId: 19, clientX: 512, buttons: 1 });
    fireEvent.pointerUp(track, { pointerId: 19, clientX: 512, buttons: 0 });

    expect(onTimeChange).toHaveBeenLastCalledWith(25);
    expect(onMoveKeyframe).toHaveBeenCalledWith(closeTrajectory.id, middleFrame.id, 25);
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

  it("pauses playback and keeps the branch and time captured when add-event opens", () => {
    const onAddEvent = vi.fn(() => true);
    const onPlayingChange = vi.fn();
    const { props, rerender } = renderTimeline({
      isPlaying: true,
      onAddEvent,
      onPlayingChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "Add timeline event" }));
    expect(onPlayingChange).toHaveBeenCalledWith(false);
    fireEvent.change(screen.getByRole("textbox", { name: "Event title" }), {
      target: { value: "Captured playback observation" },
    });

    rerender(
      <Timeline
        {...props}
        currentTimeMs={12_500}
        activeBranchId="branch-alternative"
        isPlaying={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add at 0:10.0" }));

    expect(onAddEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: "branch-baseline",
        timeMs: 10_000,
        title: "Captured playback observation",
      }),
    );
  });

  it("discards add-event fields on cancel and after a successful submission", () => {
    const onAddEvent = vi.fn(() => true);
    renderTimeline({ onAddEvent, events: [], trajectories: [] });

    const openButton = screen.getByRole("button", { name: "Add timeline event" });
    const open = () => {
      fireEvent.click(openButton);
      const dialog = screen.getByRole("dialog", { name: "Add timeline event" });
      return {
        dialog,
        title: within(dialog).getByRole("textbox", { name: "Event title" }),
        type: within(dialog).getByRole("combobox", { name: "Event type" }),
        certainty: within(dialog).getByRole("combobox", { name: "Certainty" }),
        actor: within(dialog).getByRole("combobox", { name: "Linked actor" }),
      };
    };
    const populate = (editor: ReturnType<typeof open>) => {
      fireEvent.change(editor.title, {
        target: { value: "Context-specific draft" },
      });
      fireEvent.change(editor.type, {
        target: { value: "maneuver" },
      });
      fireEvent.change(editor.certainty, {
        target: { value: "disputed" },
      });
      fireEvent.change(editor.actor, {
        target: { value: "actor-vehicle-b" },
      });
    };
    const expectDefaults = (editor: ReturnType<typeof open>) => {
      expect(editor.title).toHaveValue("");
      expect(editor.type).toHaveValue("observation");
      expect(editor.certainty).toHaveValue("reported");
      expect(editor.actor).toHaveValue("all");
    };

    let editor = open();
    populate(editor);
    fireEvent.click(within(editor.dialog).getByRole("button", { name: "Cancel" }));
    editor = open();
    expectDefaults(editor);

    populate(editor);
    fireEvent.click(within(editor.dialog).getByRole("button", { name: "Add at 0:10.0" }));
    editor = open();
    expectDefaults(editor);
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

  it("separates session-only Site Tool calls from durable case changes", () => {
    const sessionActivities: ActivityEvent[] = [
      {
        id: "activity-tool-read",
        caseVersion: 3,
        author: "agent",
        origin: "webmcp",
        actionType: "webmcp.get_workspace_state",
        summary: "Ran get workspace state: Read the current scene.",
        affectedIds: [],
        undoable: false,
        createdAt: "2026-08-27T10:02:00.000Z",
      },
    ];

    render(<ActivityPanel activities={activities} sessionActivities={sessionActivities} />);

    expect(screen.getByRole("region", { name: "Case changes" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Site Tool calls" })).toBeInTheDocument();
    expect(screen.getByText("Session only")).toBeInTheDocument();
    expect(screen.getByText("No case change · observed v3")).toBeInTheDocument();
    expect(screen.getByLabelText("Durable case changes")).toBeInTheDocument();
    expect(screen.getByLabelText("Session-only Site Tool calls")).toBeInTheDocument();
  });
});
