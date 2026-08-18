import type { MainScene } from '../MainScene';
import { ProgressionRuntime } from './ProgressionRuntime';
import { ProgressionRuntimeHost } from './ProgressionRuntimeHost';
import { createProgressionServices } from './ProgressionServices';

/**
 * Builds the legacy MainScene adapter for the progression runtime.
 *
 * Keeping this assembly in one module means the scene only needs to know
 * about the bridge when we perform the final wiring step.
 */
export function createMainSceneProgressionBridge(scene: MainScene): ProgressionRuntimeHost {
  return new ProgressionRuntimeHost(
    new ProgressionRuntime(),
    createProgressionServices(scene),
  );
}
