export const GAME_LOADING_EVENTS = {
  PROGRESS: 'game-load-progress',
  COMPLETE: 'game-world-ready',
} as const;

const ASSET_PROGRESS_WEIGHT = 0.16;

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

export const normalizeGameLoadProgress = (detail: unknown): GameLoadProgressDetail => {
  if (typeof detail === 'number') {
    const assetProgress = clampProgress(detail);
    return {
      progress: assetProgress * ASSET_PROGRESS_WEIGHT,
      phase: 'Loading assets',
      detail: assetProgress >= 1 ? 'Textures and sprites loaded' : 'Loading textures and sprites',
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

export const yieldToBrowser = (): Promise<void> => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => resolve());
    return;
  }
  setTimeout(resolve, 0);
});

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
