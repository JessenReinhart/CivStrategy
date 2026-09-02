import type { MainScene } from '../MainScene';
import { EVENTS } from '../../constants';
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
  // Establish the same 1x baseline that the player-facing speed control shows.
  // Use the normal speed event so scene time, physics, and tweens stay aligned.
  scene.game.events.emit(EVENTS.SET_GAME_SPEED, 1);

  return new SimulationRuntimeHost(
    new SimulationRuntime(),
    createSimulationServices(scene),
    profile,
  );
}
