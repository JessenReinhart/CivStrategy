import type { SimulationServices } from './SimulationServices';
import type { SimulationRuntime } from './SimulationRuntime';

/**
 * Owns the small amount of per-frame context construction around the pure
 * simulation coordinator. Scene-specific profiling can be supplied by the
 * caller without leaking Phaser/MainScene into the runtime layer.
 */
export class SimulationRuntimeHost {
  constructor(
    private readonly runtime: SimulationRuntime,
    private readonly services: SimulationServices,
    private readonly profile: (label: string, work: () => void) => void,
  ) {}

  update(now: number, dt: number): void {
    this.runtime.update({
      services: this.services,
      now,
      dt,
      profile: this.profile,
    });
  }
}
