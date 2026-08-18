import type { MainScene } from '../MainScene';

/** Capabilities consumed by the simulation coordinator. */
export interface SimulationServices {
  readonly spatial: {
    readonly shouldUpdate: boolean;
    updateUnitSpatialHash(): void;
  };

  readonly villagers: {
    update(time: number, delta: number): void;
  };

  readonly animals: {
    update(time: number, delta: number): void;
  };

  readonly liquidCombat: {
    precompute(): void;
  };

  readonly units: {
    update(time: number, delta: number): void;
  };

  readonly squads: {
    syncPositions(): void;
    update(delta: number): void;
  };
}

/**
 * Temporary scene adapter. This is the only place the simulation boundary
 * knows how the legacy MainScene-owned systems are assembled.
 *
 * Keep behavior decisions here while the scene is still the source of truth.
 * The runtime should coordinate work, not infer scene-specific modes.
 */
export function createSimulationServices(scene: MainScene): SimulationServices {
  return {
    spatial: {
      shouldUpdate: !scene.stressTestConfig || scene.units.getLength() < 2000,
      updateUnitSpatialHash: () => scene.updateUnitSpatialHash(),
    },
    villagers: scene.villagerSystem,
    animals: scene.animalSystem,
    liquidCombat: scene.liquidCombat,
    units: scene.unitSystem,
    squads: scene.squadSystem,
  };
}
