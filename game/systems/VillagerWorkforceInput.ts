import Phaser from 'phaser';

import { EVENTS } from '../../constants';
import { BuildingDef, UnitType, VillagerData } from '../../types';
import { MainScene } from '../MainScene';
import { toCartesian } from '../utils/iso';
import { getVillagerCarryCommandPolicy } from './villagerCommandPolicy';

const VILLAGER_PICK_RADIUS = 22;
const VILLAGER_DIRECT_PICK_RADIUS = 8;
const LEFT_DRAG_THRESHOLD = 5;

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
  let leftPointerStart: Phaser.Math.Vector2 | null = null;
  let leftDragMoved = false;

  const getPointerWorld = (pointer: Phaser.Input.Pointer) => (
    scene.cameras.main.getWorldPoint(pointer.x, pointer.y)
  );

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
    const world = getPointerWorld(pointer);
    let nearest: VillagerData | null = null;
    let nearestDistance = VILLAGER_PICK_RADIUS;

    for (const villager of scene.villagerSystem.getVillagersByOwner(0)) {
      const visual = villager.visual;
      if (!visual?.active || !visual.visible) continue;
      const distance = Phaser.Math.Distance.Between(world.x, world.y, visual.x, visual.y);
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
    const world = getPointerWorld(pointer);
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
      const dx = Math.abs(world.x - visual.x);
      const dy = world.y - visual.y;
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

  const handleLeftPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (pointer.button !== 0) return;
    leftPointerStart = new Phaser.Math.Vector2(pointer.x, pointer.y);
    leftDragMoved = false;
  };

  const handleLeftPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (!leftPointerStart || leftDragMoved) return;
    if (Phaser.Math.Distance.Between(leftPointerStart.x, leftPointerStart.y, pointer.x, pointer.y) <= LEFT_DRAG_THRESHOLD) return;

    leftDragMoved = true;
    // Drag selection belongs to InputManager. Release any prior workforce-only
    // selection without emitting a competing zero-count event on pointerup.
    clearWorkforceSelection();
  };

  const handleLeftPointerUp = (pointer: Phaser.Input.Pointer) => {
    if (pointer.button !== 0) return;
    const wasDrag = leftDragMoved || Boolean(
      leftPointerStart
      && Phaser.Math.Distance.Between(leftPointerStart.x, leftPointerStart.y, pointer.x, pointer.y) > LEFT_DRAG_THRESHOLD
    );
    leftPointerStart = null;
    leftDragMoved = false;
    if (wasDrag) return;
    if (scene.buildingManager.isDemolishMode || scene.buildingManager.previewBuildingType) return;

    const targets = scene.input.hitTestPointer(pointer);
    const hitsMilitaryUnit = targets.some((target) => Boolean(target.getData?.('unit')));
    const candidate = findVillagerAtPointer(pointer);
    const world = getPointerWorld(pointer);
    const directVillagerHit = Boolean(
      candidate?.visual
      && Phaser.Math.Distance.Between(world.x, world.y, candidate.visual.x, candidate.visual.y) <= VILLAGER_DIRECT_PICK_RADIUS
    );

    // Civilians use a proximity pick rather than Phaser's interactive unit hit
    // target. A military hit normally wins an ambiguous overlap, but a click on
    // the villager's actual visual center must still select that villager. This
    // keeps workers controllable in dense post-load formations without making a
    // loose proximity pick steal intentional military clicks.
    const villager = hitsMilitaryUnit && !directVillagerHit ? null : candidate;
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

  const showPendingCarryFeedback = () => {
    if (!selectedVillager) return;
    scene.feedbackSystem.showFloatingText(
      selectedVillager.x,
      selectedVillager.y,
      'Finish current load first',
      '#facc15',
    );
  };

  const handleRightPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (!pointer.rightButtonDown() || !selectedVillager) return;
    if (!scene.villagerSystem.getAllVillagers().includes(selectedVillager)) {
      clearWorkforceAndEmit();
      return;
    }

    const building = findWorkerBuildingAtPointer(pointer);
    const world = getPointerWorld(pointer);

    if (building) {
      const carryPolicy = getVillagerCarryCommandPolicy(selectedVillager, building);
      if (carryPolicy === 'keep-current') {
        scene.proceduralSound.playCommandAck(world.x, world.y);
        return;
      }
      if (carryPolicy === 'defer') {
        showPendingCarryFeedback();
        return;
      }

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
      scene.proceduralSound.playCommandAck(world.x, world.y);
      scene.economySystem.updateStats();
      return;
    }

    if (getVillagerCarryCommandPolicy(selectedVillager, null) === 'defer') {
      showPendingCarryFeedback();
      return;
    }

    const cart = toCartesian(world.x, world.y);
    scene.villagerSystem.sendToRallyPoint(selectedVillager, cart.x, cart.y);
    scene.proceduralSound.playCommandAck(world.x, world.y);
  };

  const keyboard = scene.input.keyboard;
  scene.input.on('pointerdown', handleLeftPointerDown);
  scene.input.on('pointermove', handleLeftPointerMove);
  scene.input.on('pointerup', handleLeftPointerUp);
  scene.input.on('pointerdown', handleRightPointerDown);
  scene.game.events.on('clear-selection', clearWorkforceAndEmit);
  keyboard?.on('keydown-ESC', clearWorkforceAndEmit);
  // Load replaces live villager objects. Capture the player event before React
  // forwards it to Phaser so workforce ownership is released before replacement.
  window.addEventListener('load-game', clearWorkforceAndEmit, { capture: true });

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    leftPointerStart = null;
    leftDragMoved = false;
    clearWorkforceSelection();
    scene.input.off('pointerdown', handleLeftPointerDown);
    scene.input.off('pointermove', handleLeftPointerMove);
    scene.input.off('pointerup', handleLeftPointerUp);
    scene.input.off('pointerdown', handleRightPointerDown);
    scene.game.events.off('clear-selection', clearWorkforceAndEmit);
    keyboard?.off('keydown-ESC', clearWorkforceAndEmit);
    window.removeEventListener('load-game', clearWorkforceAndEmit, { capture: true });
  });
}