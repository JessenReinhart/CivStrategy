import type { MainScene } from '../MainScene';

/**
 * Narrow access boundary for simulation runtimes.
 *
 * This is intentionally introduced before wiring MainScene. Runtime modules
 * should depend on the capabilities they need, not on the entire scene API.
 * The first iteration keeps the concrete MainScene adapter in one place; later
 * extractions can replace individual fields with narrower interfaces without
 * another scene-wide rewrite.
 */
export interface SimulationContext {
  readonly scene: MainScene;

  /** Current simulation timestamp in milliseconds. */
  readonly now: number;

  /** Delta since the previous simulation step in milliseconds. */
  readonly dt: number;

  /** Execute a named operation through the scene's profiler. */
  profile(label: string, work: () => void): void;
}

/**
 * Creates the initial simulation context from the Phaser scene.
 *
 * Keeping this adapter separate gives us a single migration seam: future
 * runtime modules can stop receiving MainScene once their required
 * capabilities have been promoted onto dedicated interfaces.
 */
export function createSimulationContext(
  scene: MainScene,
  now: number,
  dt: number,
  profile: (label: string, work: () => void) => void,
): SimulationContext {
  return { scene, now, dt, profile };
}
