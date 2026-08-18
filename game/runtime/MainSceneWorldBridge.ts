import type { MainScene } from '../MainScene';
import { WorldRuntime } from './WorldRuntime';
import { WorldRuntimeHost } from './WorldRuntimeHost';
import { createWorldServices } from './WorldServices';

/**
 * Builds the legacy MainScene adapter for the world runtime.
 *
 * Keeping this assembly in one module means the scene only needs to know
 * about the bridge when we perform the final wiring step.
 */
export function createMainSceneWorldBridge(
  scene: MainScene,
  profile: (label: string, work: () => void) => void,
): WorldRuntimeHost {
  return new WorldRuntimeHost(
    new WorldRuntime(),
    createWorldServices(scene),
    profile,
  );
}