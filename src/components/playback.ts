export const DEFAULT_PLAYBACK_SPEED = 1.25;

export const PLAYBACK_SPEED_OPTIONS = [0.5, 1, DEFAULT_PLAYBACK_SPEED, 2] as const;

export interface AutomaticImpactPause {
  eventId: string;
  timeMs: number;
}

const IMPACT_RESUME_TOLERANCE_MS = 2;
const IMPACT_RESUME_OFFSET_MS = 1;

/**
 * A deliberate Play action after an automatic impact pause consumes that
 * boundary. Moving one millisecond beyond it prevents the same impact from
 * being rediscovered before the next animation frame advances the playhead.
 */
export function resumedPlayheadTime(
  currentTimeMs: number,
  automaticPause: AutomaticImpactPause | undefined,
  endTimeMs: number,
): number | undefined {
  if (
    !automaticPause ||
    Math.abs(currentTimeMs - automaticPause.timeMs) > IMPACT_RESUME_TOLERANCE_MS
  ) {
    return undefined;
  }

  return Math.min(
    endTimeMs,
    Math.max(currentTimeMs, automaticPause.timeMs + IMPACT_RESUME_OFFSET_MS),
  );
}

export function remainsAtAutomaticImpactPause(
  timeMs: number,
  automaticPause: AutomaticImpactPause | undefined,
): boolean {
  return Boolean(
    automaticPause && Math.abs(timeMs - automaticPause.timeMs) <= IMPACT_RESUME_TOLERANCE_MS,
  );
}
