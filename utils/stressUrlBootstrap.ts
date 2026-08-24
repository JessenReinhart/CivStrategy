export interface StressUrlConfig {
  unitCount: number;
  enableEnemies?: boolean;
}

export const scheduleStressUrlBootstrap = (
  search: string,
  onStart: (config: StressUrlConfig) => void,
): (() => void) => {
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