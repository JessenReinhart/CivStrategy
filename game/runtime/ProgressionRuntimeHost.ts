import type { ProgressionContext } from './ProgressionContext';
import type { ProgressionRuntime } from './ProgressionRuntime';
import type { ProgressionServices } from './ProgressionServices';

/**
 * Owns the small amount of per-frame context construction around the pure
 * progression coordinator. The runtime is the single owner of cadence and
 * ordering; the host only supplies `now`/`dt` and the services.
 */
export class ProgressionRuntimeHost {
  constructor(
    private readonly runtime: ProgressionRuntime,
    private readonly services: ProgressionServices,
  ) {}

  update(now: number, dt: number): void {
    const context: ProgressionContext = { services: this.services, now, dt };
    this.runtime.update(context);
  }
}
