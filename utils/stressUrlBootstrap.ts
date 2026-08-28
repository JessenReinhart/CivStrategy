export interface StressUrlConfig {
  unitCount?: number;
  enableEnemies?: boolean;
  city?: boolean;
  density?: 'high' | 'medium' | 'low';
}

const STRESS_QUERY_KEYS = ['stress', 'enableEnemies', 'enemies', 'density'] as const;

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
    removeProductionStressParams();
    return () => undefined;
  }

  const params = new URLSearchParams(search);
  const stressParam = params.get('stress') ?? '';
  if (stressParam.toLowerCase() === 'city') {
    const requestedDensity = params.get('density');
    const density: 'high' | 'medium' | 'low' = requestedDensity === 'low' || requestedDensity === 'medium' || requestedDensity === 'high'
      ? requestedDensity
      : 'high';
    const timeoutId = setTimeout(() => onStart({ city: true, density }), 0);
    return () => clearTimeout(timeoutId);
  }

  const stressCount = parseInt(stressParam, 10);
  if (Number.isNaN(stressCount) || stressCount <= 0) return () => undefined;

  const timeoutId = setTimeout(() => {
    onStart({
      unitCount: stressCount,
      enableEnemies: params.get('enableEnemies') === 'true' || params.get('enemies') === 'true',
    });
  }, 0);

  return () => clearTimeout(timeoutId);
};
