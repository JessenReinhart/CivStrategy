import type { MainScene } from '../MainScene';
import { SimulationRuntime } from './SimulationRuntime';
import { SimulationRuntimeHost } from './SimulationRuntimeHost';
import { createSimulationServices } from './SimulationServices';

/**
 * Builds the legacy MainScene adapter for the simulation runtime.
 *
 * Keeping this assembly in one module means the scene only needs to know
 * about the bridge when we perform the final wiring step.
 */
export function createMainSceneSimulationBridge(
  scene: MainScene,
  profile: (label: string, work: () => void) => void,
): SimulationRuntimeHost {
  // Speed initialization is owned by MainScene (init/create + setGameSpeed).
  // This adapter only assembles the runtime; it must not force a divergent
  // speed/value side effect on load (T1).

  return new SimulationRuntimeHost(
    new SimulationRuntime(),
    createSimulationServices(scene),
    profile,
  );
}
