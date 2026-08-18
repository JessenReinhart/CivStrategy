import type { SimulationServices } from './SimulationServices';

/** Context passed to the simulation coordinator for one frame. */
export interface SimulationContext {
  readonly services: SimulationServices;
  readonly now: number;
  readonly dt: number;
  readonly profile: (label: string, work: () => void) => void;
}
