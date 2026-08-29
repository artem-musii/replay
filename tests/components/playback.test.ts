import { describe, expect, it } from "vitest";

import {
  DEFAULT_PLAYBACK_SPEED,
  PLAYBACK_SPEED_OPTIONS,
  remainsAtAutomaticImpactPause,
  resumedPlayheadTime,
} from "../../src/components/playback";

describe("playback boundary handling", () => {
  const pause = { eventId: "impact-1", timeMs: 10_000 };

  it("moves a resumed playhead beyond the automatically paused impact", () => {
    expect(resumedPlayheadTime(10_000, pause, 20_000)).toBe(10_001);
    expect(resumedPlayheadTime(9_999, pause, 20_000)).toBe(10_001);
  });

  it("does not consume a pause after the user moves away from its boundary", () => {
    expect(remainsAtAutomaticImpactPause(10_000, pause)).toBe(true);
    expect(remainsAtAutomaticImpactPause(10_003, pause)).toBe(false);
    expect(resumedPlayheadTime(9_900, pause, 20_000)).toBeUndefined();
  });

  it("uses a modestly faster default while preserving deliberate rate choices", () => {
    expect(DEFAULT_PLAYBACK_SPEED).toBe(1.25);
    expect(PLAYBACK_SPEED_OPTIONS).toEqual([0.5, 1, 1.25, 2]);
  });
});
