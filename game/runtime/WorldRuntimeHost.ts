import type { WorldServices } from './WorldServices';
import type { WorldRuntime } from './WorldRuntime';

/**
 * Owns the small amount of per-frame context construction around the pure
 * world coordinator. Scene-specific profiling and fog throttle state can be
 * supplied by the caller without leaking Phaser/MainScene into the runtime layer.
 */
export class WorldRuntimeHost {
  private lastFogUpdateTime = -Infinity;

  constructor(
    private readonly runtime: WorldRuntime,
    private readonly services: WorldServices,
    private readonly profile: (label: string, work: () => void) => void,
  ) {}

  update(now: number, dt: number): void {
    // The runtime delegates throttle logic to the host so the pure coordinator
    // stays free of frame-time state.
    const fogOfWar = this.services.fogOfWar;
    const shouldUpdateFog = fogOfWar && now - this.lastFogUpdateTime >= 100;

    this.runtime.update({
      services: this.services,
      now,
      dt,
      profile: (label, work) => {
        // Fog throttle: skip the profile/closure entirely when throttled
        if (label === 'fogOfWar' && !shouldUpdateFog) {
          return;
        }
        this.profile(label, work);
      },
    });

    if (shouldUpdateFog) {
      this.lastFogUpdateTime = now;
    }
  }
}