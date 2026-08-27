import { MainScene } from '../MainScene';
import { UnitType } from '../../types';
import { installVillagerWorkforceInput } from '../systems/VillagerWorkforceInput';

/**
 * Transitional compatibility bridge for older callers that still request a
 * villager through EntityFactory.spawnUnit(). Villagers are no longer generic
 * Phaser unit entities, so route only that unit type into VillagerSystem while
 * preserving EntityFactory behavior for every combat/animal unit.
 */
export function installLegacyVillagerSpawnBridge(scene: MainScene): void {
  const spawnEntityUnit = scene.entityFactory.spawnUnit.bind(scene.entityFactory);

  scene.entityFactory.spawnUnit = ((type: UnitType, x: number, y: number, owner: number = 0) => {
    if (type === UnitType.VILLAGER) {
      scene.villagerSystem.spawnVillager(x, y, owner);
      return undefined;
    }

    return spawnEntityUnit(type, x, y, owner);
  }) as typeof scene.entityFactory.spawnUnit;

  installVillagerWorkforceInput(scene);
}
