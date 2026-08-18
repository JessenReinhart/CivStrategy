import type { WorldServices } from './WorldServices';

/** Context passed to the world coordinator for one frame. */
export interface WorldContext {
  readonly services: WorldServices;
  readonly now: number;
  readonly dt: number;
  readonly profile: (label: string, work: () => void) => void;
}
