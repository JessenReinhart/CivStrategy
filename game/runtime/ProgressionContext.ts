import type { ProgressionServices } from './ProgressionServices';

/** Context passed to the progression coordinator for one frame. */
export interface ProgressionContext {
  readonly services: ProgressionServices;
  readonly now: number;
  readonly dt: number;
}
