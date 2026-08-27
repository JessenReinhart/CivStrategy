import Phaser from 'phaser';

import { EVENTS } from '../../constants';
import { BuildingDef, UnitType, VillagerData } from '../../types';
import { MainScene } from '../MainScene';
import { toCartesian } from '../utils/iso';

const VILLAGER_PICK_RADIUS = 22;

/**
 * Player-input owner for the civilian workforce.
 *
 * Villagers intentionally live outside UnitSystem because their gather/carry
 * state machine is different from combat movement. Keep that separation while
 * still making the workforce directly controllable through normal RTS input.
 */
export function installVillagerWorkforceInput(scene: MainScene): void {
  let selectedVillager: VillagerData | null = null;

  const setSelectionRing = (villager: VillagerData, selected: boolean) => {
    const visual = villager.visual;
    if (!visual) return;

    const existing = visual.getData('workforceSelectionRing') as Phaser.GameObjects.Ellipse | undefined;
    if (!selected) {
      existing?.destroy();
      visual.setData('workforceSelectionRing', undefined);
      return;
    }

    if (existing) return;
    const ring = scene.add.ellipse(0, 4, 22, 11, 0x4ade80, 0.18)
      .setStrokeStyle(2, 0x4ade80, 0.95);
    visual.addAt(ring, 0);
    visual.setData('workforceSelectionRing', ring);
  };

  const clearWorkforceSelection = () => {
    if (!selectedVillager) return;
    setSelectionRing(selectedVillager, false);
    selectedVillager = null;
  };

  const emitWorkforceSelection = () => {
    scene.game.events.emit(EVENTS.SELECTION_CHANGED, {
      count: selectedVillager ? 1 : 0,
      counts: selectedVillager ? { [UnitType.VILLAGER]: 1 } : {},
    });
  };

  const findVillagerAtPointer = (pointer: Phaser.Input.Pointer): VillagerData | null => {
    let nearest: VillagerData | null = null;
    let nearestDistance = VILLAGER_PICK_RADIUS;

    for (const villager of scene.villagerSystem.getVillagersByOwner(0)) {
      const visual = villager.visual;
      if (!visual?.active || !visual.visible) continue;
      const distance = Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, visual.x, visual.y);
      if (distance <= nearestDistance) {
        nearest = villager;
        nearestDistance = distance;
      }
    }

    return nearest;
  };

  const handleLeftPointerUp = (pointer: Phaser.Input.Pointer) => {
    if (pointer.event.button !== 0) return;
    if (scene.buildingManager.isDemolishMode || scene.buildingManager.previewBuildingType) return;

    const targets = scene.input.hitTestPointer(pointer);
    const hitsUnitOrBuilding = targets.some((target) => (
      Boolean(target.getData?.('unit')) || Boolean(target.getData?.('building'))
    ));

    const villager = hitsUnitOrBuilding ? null : findVillagerAtPointer(pointer);
    clearWorkforceSelection();
    if (!villager) return;

    // Workforce selection and military/building selection are mutually exclusive.
    scene.inputManager.clearSelection();
    scene.inputManager.deselectBuilding();
    selectedVillager = villager;
    setSelectionRing(villager, true);
    scene.proceduralSound.playUIClick();
    emitWorkforceSelection();
  };

  const handleRightPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (!pointer.rightButtonDown() || !selectedVillager) return;
    if (!scene.villagerSystem.getAllVillagers().includes(selectedVillager)) {
      clearWorkforceSelection();
      emitWorkforceSelection();
      return;
    }

    const targets = scene.input.hitTestPointer(pointer);
    const buildingVisual = targets.find((target) => Boolean(target.getData?.('building')));
    const building = buildingVisual?.getData('building') as Phaser.GameObjects.GameObject | undefined;

    if (building) {
      const owner = building.getData('owner') as number;
      const def = building.getData('def') as BuildingDef | undefined;
      const assignedWorker = building.getData('assignedWorker') as VillagerData | undefined;

      if (owner === 0 && def?.workerNeeds) {
        if (assignedWorker && assignedWorker !== selectedVillager) {
          scene.feedbackSystem.showFloatingText(
            (building as Phaser.GameObjects.Image).x,
            (building as Phaser.GameObjects.Image).y,
            'Already staffed',
            '#facc15',
          );
          return;
        }

        scene.villagerSystem.assignJob(selectedVillager, building);
        scene.proceduralSound.playCommandAck(pointer.worldX, pointer.worldY);
        scene.economySystem.updateStats();
        return;
      }
    }

    const cart = toCartesian(pointer.worldX, pointer.worldY);
    scene.villagerSystem.sendToRallyPoint(selectedVillager, cart.x, cart.y);
    scene.proceduralSound.playCommandAck(pointer.worldX, pointer.worldY);
  };

  scene.input.on('pointerup', handleLeftPointerUp);
  scene.input.on('pointerdown', handleRightPointerDown);

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    clearWorkforceSelection();
    scene.input.off('pointerup', handleLeftPointerUp);
    scene.input.off('pointerdown', handleRightPointerDown);
  });
}
