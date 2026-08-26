export const GAME_LOADING_EVENTS = {
  PROGRESS: 'game-load-progress',
  COMPLETE: 'game-load-complete',
} as const;

export interface GameLoadProgressDetail {
  progress: number;
  phase: string;
  detail: string;
  processed?: number;
  total?: number;
}

export interface LoadingWorkProgress {
  processed: number;
  total: number;
  detail?: string;
}

export const INITIAL_GAME_LOAD_PROGRESS: GameLoadProgressDetail = {
  progress: 0,
  phase: 'Preparing realm',
  detail: 'Starting world generation',
};

const clampProgress = (progress: number): number => Math.min(1, Math.max(0, progress));

/**
 * Accept both the new structured payload and the legacy numeric payload so
 * loading remains compatible with older scene code while the bootstrap is
 * progressively decomposed.
 */
export const normalizeGameLoadProgress = (detail: unknown): GameLoadProgressDetail => {
  if (typeof detail === 'number') {
    return {
      progress: clampProgress(detail),
      phase: detail >= 1 ? 'Finalizing realm' : 'Loading assets',
      detail: detail >= 1 ? 'Preparing simulation' : 'Loading textures and sprites',
    };
  }

  if (detail && typeof detail === 'object') {
    const candidate = detail as Partial<GameLoadProgressDetail>;
    const progress = typeof candidate.progress === 'number' ? clampProgress(candidate.progress) : 0;
    return {
      progress,
      phase: candidate.phase || 'Preparing realm',
      detail: candidate.detail || 'Working…',
      processed: typeof candidate.processed === 'number' ? candidate.processed : undefined,
      total: typeof candidate.total === 'number' ? candidate.total : undefined,
    };
  }

  return INITIAL_GAME_LOAD_PROGRESS;
};

export const dispatchGameLoadProgress = (detail: GameLoadProgressDetail): void => {
  window.dispatchEvent(new CustomEvent(GAME_LOADING_EVENTS.PROGRESS, { detail }));
};

export const dispatchGameLoadComplete = (): void => {
  window.dispatchEvent(new CustomEvent(GAME_LOADING_EVENTS.COMPLETE));
};

/** Yield to the browser so React can paint loading progress and input stays responsive. */
export const yieldToBrowser = (): Promise<void> => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => resolve());
    return;
  }
  setTimeout(resolve, 0);
});

/**
 * Consume incremental world-generation work while yielding whenever the
 * current main-thread slice exceeds the budget. A work item should be small
 * (normally one terrain/water row), which caps the longest blocking chunk.
 */
export async function runBudgetedWork(
  work: Iterator<LoadingWorkProgress>,
  onProgress?: (progress: LoadingWorkProgress) => void,
  yieldControl: () => Promise<void> = yieldToBrowser,
  budgetMs = 8,
  now: () => number = () => performance.now(),
): Promise<void> {
  let sliceStartedAt = now();
  let latest: LoadingWorkProgress | undefined;

  while (true) {
    const next = work.next();
    if (next.done) break;
    latest = next.value;

    if (now() - sliceStartedAt >= budgetMs) {
      onProgress?.(latest);
      await yieldControl();
      sliceStartedAt = now();
    }
  }

  if (latest) onProgress?.(latest);
}
