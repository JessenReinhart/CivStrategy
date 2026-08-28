import Phaser from 'phaser';

import { EVENTS } from '../../constants';
import { BuildingDef, UnitType, VillagerData } from '../../types';
import { MainScene } from '../MainScene';
import { toCartesian } from '../utils/iso';

const VILLAGER_PICK_RADIUS = 22;

type WorkforceBuilding = Phaser.GameObjects.Rectangle & {
  visual?: Phaser.GameObjects.Container;
};

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
    if (selectedVillager.visual?.active) setSelectionRing(selectedVillager, false);
    selectedVillager = null;
  };

  const emitWorkforceSelection = () => {
    scene.game.events.emit(EVENTS.SELECTION_CHANGED, {
      count: selectedVillager ? 1 : 0,
      counts: selectedVillager ? { [UnitType.VILLAGER]: 1 } : {},
    });
  };

  const clearWorkforceAndEmit = () => {
    if (!selectedVillager) return;
    clearWorkforceSelection();
    emitWorkforceSelection();
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

  const isAssignableWorkerBuilding = (building: WorkforceBuilding | undefined): building is WorkforceBuilding => {
    if (!building?.active || building.getData('owner') !== 0) return false;
    const def = building.getData('def') as BuildingDef | undefined;
    return Boolean(def?.workerNeeds && building.visual?.active && building.visual.visible);
  };

  const findWorkerBuildingAtPointer = (pointer: Phaser.Input.Pointer): WorkforceBuilding | null => {
    const directHit = scene.input.hitTestPointer(pointer)
      .map((target) => target.getData?.('building') as WorkforceBuilding | undefined)
      .find(isAssignableWorkerBuilding);
    if (directHit) return directHit;

    // Building art is intentionally larger than its simulation footprint. If
    // Phaser misses the container hit area for one frame, keep a real click on
    // the visible owned worker building from degrading into a ground rally.
    let nearest: WorkforceBuilding | null = null;
    let nearestScore = Infinity;
    for (const child of scene.buildings.getChildren()) {
      const building = child as WorkforceBuilding;
      if (!isAssignableWorkerBuilding(building)) continue;
      const def = building.getData('def') as BuildingDef;
      const visual = building.visual!;

      const halfWidth = Math.max(18, def.width * 0.75);
      const upwardReach = Math.max(24, def.height);
      const downwardReach = Math.max(10, def.height * 0.35);
      const dx = Math.abs(pointer.worldX - visual.x);
      const dy = pointer.worldY - visual.y;
      if (dx > halfWidth || dy < -upwardReach || dy > downwardReach) continue;

      const normalizedY = dy < 0 ? Math.abs(dy) / upwardReach : dy / downwardReach;
      const score = (dx / halfWidth) ** 2 + normalizedY ** 2;
      if (score < nearestScore) {
        nearest = building;
        nearestScore = score;
      }
    }

    return nearest;
  };

  const handleLeftPointerUp = (pointer: Phaser.Input.Pointer) => {
    if (pointer.button !== 0) return;
    if (scene.buildingManager.isDemolishMode || scene.buildingManager.previewBuildingType) return;

    const targets = scene.input.hitTestPointer(pointer);
    const hitsUnitOrBuilding = targets.some((target) => (
      Boolean(target.getData?.('unit')) || Boolean(target.getData?.('building'))
    ));

    const villager = hitsUnitOrBuilding ? null : findVillagerAtPointer(pointer);
    if (!villager) {
      clearWorkforceAndEmit();
      return;
    }

    clearWorkforceSelection();
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
      clearWorkforceAndEmit();
      return;
    }

    const building = findWorkerBuildingAtPointer(pointer);

    if (building) {
      const assignedWorker = building.getData('assignedWorker') as VillagerData | undefined;

      if (assignedWorker && assignedWorker !== selectedVillager) {
        scene.feedbackSystem.showFloatingText(
          building.x,
          building.y,
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

    const cart = toCartesian(pointer.worldX, pointer.worldY);
    scene.villagerSystem.sendToRallyPoint(selectedVillager, cart.x, cart.y);
    scene.proceduralSound.playCommandAck(pointer.worldX, pointer.worldY);
  };

  const keyboard = scene.input.keyboard;
  scene.input.on('pointerup', handleLeftPointerUp);
  scene.input.on('pointerdown', handleRightPointerDown);
  scene.game.events.on('clear-selection', clearWorkforceAndEmit);
  keyboard?.on('keydown-ESC', clearWorkforceAndEmit);
  // Load replaces live villager objects. Capture the player event before React
  // forwards it to Phaser so workforce ownership is released before replacement.
  window.addEventListener('load-game', clearWorkforceAndEmit, { capture: true });

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    clearWorkforceSelection();
    scene.input.off('pointerup', handleLeftPointerUp);
    scene.input.off('pointerdown', handleRightPointerDown);
    scene.game.events.off('clear-selection', clearWorkforceAndEmit);
    keyboard?.off('keydown-ESC', clearWorkforceAndEmit);
    window.removeEventListener('load-game', clearWorkforceAndEmit, { capture: true });
  });
}
