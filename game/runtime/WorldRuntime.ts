import type { WorldContext } from './WorldContext';

/** Coordinates the per-frame world pipeline without depending on MainScene. */
export class WorldRuntime {
  update(context: WorldContext): void {
    const { services, profile } = context;

    // Infinite map chunk streaming. Stress gating is the host's job; the
    // service is null for non-infinite maps. Hoist the alias before the
    // guard so the narrowing persists into the profiling closure.
    const infiniteMap = services.infiniteMap;
    if (infiniteMap) {
      profile('infiniteMapSystem', () => {
        infiniteMap.update();
      });
    }
    // Minimap. Null in stress mode (world systems are non-critical).
    const minimap = services.minimap;
    if (minimap) {
      profile('minimapSystem', () => {
        minimap.update();
      });
    }

    // Fog of war. Throttle gating is the host's job.
    const fogOfWar = services.fogOfWar;
    if (fogOfWar) {
      profile('fogOfWar', () => {
        fogOfWar.update();
      });
    }
  }
}
