import { GUIDE_SECTION_IDS, type GuideSectionId } from "./content";

export const REPLAY_GUIDE_PROGRESS_KEY = "replay:guide-progress:v1";
export const REPLAY_GUIDE_PROGRESS_VERSION = 1 as const;
export const WORKSPACE_TOUR_STEP_COUNT = 6;

export interface ReplayGuideProgress {
  version: typeof REPLAY_GUIDE_PROGRESS_VERSION;
  lastSectionId: GuideSectionId;
  completedSectionIds: GuideSectionId[];
  dismissedHintIds: string[];
  workspaceTour: {
    step: number;
    completed: boolean;
  };
}

type ProgressStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultProgress(): ReplayGuideProgress {
  return {
    version: REPLAY_GUIDE_PROGRESS_VERSION,
    lastSectionId: "quick-start",
    completedSectionIds: [],
    dismissedHintIds: [],
    workspaceTour: { step: 0, completed: false },
  };
}

function browserStorage(): ProgressStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGuideSectionId(value: unknown): value is GuideSectionId {
  return typeof value === "string" && GUIDE_SECTION_IDS.some((id) => id === value);
}

function uniqueSectionIds(value: unknown): GuideSectionId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isGuideSectionId))];
}

function uniqueHintIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string" && item.trim().length > 0),
    ),
  ];
}

function normalizedTourStep(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return 0;
  return Math.max(0, Math.min(WORKSPACE_TOUR_STEP_COUNT - 1, value));
}

function normalizeProgress(value: unknown): ReplayGuideProgress {
  const fallback = defaultProgress();
  if (!isRecord(value) || value.version !== REPLAY_GUIDE_PROGRESS_VERSION) return fallback;

  const workspaceTour = isRecord(value.workspaceTour) ? value.workspaceTour : {};
  return {
    version: REPLAY_GUIDE_PROGRESS_VERSION,
    lastSectionId: isGuideSectionId(value.lastSectionId)
      ? value.lastSectionId
      : fallback.lastSectionId,
    completedSectionIds: uniqueSectionIds(value.completedSectionIds),
    dismissedHintIds: uniqueHintIds(value.dismissedHintIds),
    workspaceTour: {
      step: normalizedTourStep(workspaceTour.step),
      completed: workspaceTour.completed === true,
    },
  };
}

export function readReplayGuideProgress(
  storage: ProgressStorage | undefined = browserStorage(),
): ReplayGuideProgress {
  if (!storage) return defaultProgress();
  try {
    const serialized = storage.getItem(REPLAY_GUIDE_PROGRESS_KEY);
    if (!serialized) return defaultProgress();
    return normalizeProgress(JSON.parse(serialized) as unknown);
  } catch {
    return defaultProgress();
  }
}

export function writeReplayGuideProgress(
  progress: ReplayGuideProgress,
  storage: ProgressStorage | undefined = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(REPLAY_GUIDE_PROGRESS_KEY, JSON.stringify(normalizeProgress(progress)));
    return true;
  } catch {
    return false;
  }
}

export function updateReplayGuideProgress(
  update: (current: ReplayGuideProgress) => ReplayGuideProgress,
  storage: ProgressStorage | undefined = browserStorage(),
): ReplayGuideProgress {
  const next = normalizeProgress(update(readReplayGuideProgress(storage)));
  writeReplayGuideProgress(next, storage);
  return next;
}

export function recordGuideSectionVisit(
  sectionId: GuideSectionId,
  storage?: ProgressStorage,
): ReplayGuideProgress {
  return updateReplayGuideProgress(
    (current) => ({ ...current, lastSectionId: sectionId }),
    storage,
  );
}

export function markGuideSectionComplete(
  sectionId: GuideSectionId,
  storage?: ProgressStorage,
): ReplayGuideProgress {
  return updateReplayGuideProgress(
    (current) => ({
      ...current,
      lastSectionId: sectionId,
      completedSectionIds: [...new Set([...current.completedSectionIds, sectionId])],
    }),
    storage,
  );
}

export function dismissOnboardingHint(
  hintId: string,
  storage?: ProgressStorage,
): ReplayGuideProgress {
  return updateReplayGuideProgress(
    (current) => ({
      ...current,
      dismissedHintIds: hintId.trim()
        ? [...new Set([...current.dismissedHintIds, hintId])]
        : current.dismissedHintIds,
    }),
    storage,
  );
}

export function recordWorkspaceTourStep(
  step: number,
  storage?: ProgressStorage,
): ReplayGuideProgress {
  return updateReplayGuideProgress(
    (current) => ({
      ...current,
      workspaceTour: {
        step: normalizedTourStep(step),
        completed: current.workspaceTour.completed,
      },
    }),
    storage,
  );
}

export function markWorkspaceTourComplete(storage?: ProgressStorage): ReplayGuideProgress {
  return updateReplayGuideProgress(
    (current) => ({
      ...current,
      workspaceTour: { step: WORKSPACE_TOUR_STEP_COUNT - 1, completed: true },
    }),
    storage,
  );
}

export function resetReplayGuideProgress(
  storage: ProgressStorage | undefined = browserStorage(),
): ReplayGuideProgress {
  if (storage) {
    try {
      storage.removeItem(REPLAY_GUIDE_PROGRESS_KEY);
    } catch {
      // A blocked preference store must never block the case workspace.
    }
  }
  return defaultProgress();
}
