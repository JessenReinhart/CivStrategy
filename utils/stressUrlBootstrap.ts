export interface StressUrlConfig {
  unitCount: number;
  enableEnemies?: boolean;
}

const STRESS_QUERY_KEYS = ['stress', 'enableEnemies', 'enemies'] as const;

export const stripStressUrlParams = (search: string): string => {
  const params = new URLSearchParams(search);
  STRESS_QUERY_KEYS.forEach((key) => params.delete(key));
  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : '';
};

const removeProductionStressParams = (): void => {
  if (typeof window === 'undefined') return;

  const nextSearch = stripStressUrlParams(window.location.search);
  if (nextSearch === window.location.search) return;

  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${nextSearch}${window.location.hash}`,
  );
};

export const scheduleStressUrlBootstrap = (
  search: string,
  onStart: (config: StressUrlConfig) => void,
  enabled: boolean = import.meta.env.DEV,
): (() => void) => {
  if (!enabled) {
    // Stress URLs are profiling/debug tooling. Strip them before MainScene can
    // observe its legacy URL fallback during a later production game start.
    removeProductionStressParams();
    return () => undefined;
  }

  const params = new URLSearchParams(search);
  const stressCount = parseInt(params.get('stress') || '0', 10);

  if (stressCount <= 0) return () => undefined;

  const timeoutId = setTimeout(() => {
    onStart({
      unitCount: stressCount,
      // `enableEnemies` is the documented stress-mode flag used by MainScene.
      // Keep the shorter `enemies` spelling as a compatibility alias for links
      // created while the React bootstrap briefly used that parameter instead.
      enableEnemies:
        params.get('enableEnemies') === 'true' || params.get('enemies') === 'true',
    });
  }, 0);

  return () => clearTimeout(timeoutId);
};
