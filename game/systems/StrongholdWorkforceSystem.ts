import Phaser from 'phaser';

import type { MainScene } from '../MainScene';
import { BuildingType, UnitState, type VillagerData } from '../../types';

export const WORKFORCE_EVENTS = {
  SNAPSHOT: 'workforce-snapshot',
  REQUEST_SNAPSHOT: 'request-workforce-snapshot',
  SET_TARGET: 'set-workforce-target',
} as const;

export interface WorkforceBuildingSnapshot {
  id: string;
  type: string;
  name: string;
  capacity: number;
  target: number;
  filled: number;
}

export interface WorkforceSnapshot {
  totalVillagers: number;
  assignedVillagers: number;
  idleVillagers: number;
  filledSlots: number;
  openSlots: number;
  enabledSlots: number;
  totalSlots: number;
  buildings: WorkforceBuildingSnapshot[];
}

type WorkBuilding = Phaser.GameObjects.GameObject & {
  x: number;
  y: number;
};

/**
 * Stronghold-style workforce controller.
 *
 * Villagers remain physical agents in the city, but the player no longer
 * selects or commands them directly. Production buildings expose worker
 * slots and this system fills those slots from the idle workforce pool.
 */
export class StrongholdWorkforceSystem {
  private readonly targets = new Map<WorkBuilding, number>();
  private nextBuildingId = 1;
  private lastSnapshotKey = '';

  constructor(private readonly scene: MainScene) {
    // MainScene already calls economySystem.assignJobs() once per economy tick.
    // Replace that legacy one-villager-per-building allocator with the slot
    // controller while preserving the existing simulation cadence.
    scene.economySystem.assignJobs = () => this.reconcile();

    scene.game.events.on(WORKFORCE_EVENTS.SET_TARGET, this.handleSetTarget, this);
    scene.game.events.on(WORKFORCE_EVENTS.REQUEST_SNAPSHOT, this.handleSnapshotRequest, this);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.game.events.off(WORKFORCE_EVENTS.SET_TARGET, this.handleSetTarget, this);
      scene.game.events.off(WORKFORCE_EVENTS.REQUEST_SNAPSHOT, this.handleSnapshotRequest, this);
      this.targets.clear();
    });
  }

  public reconcile(): void {
    const buildings = this.getWorkBuildings();
    this.removeDestroyedBuildings(buildings);

    // First normalize all existing assignments and release workers from slots
    // the player has disabled.
    for (const building of buildings) {
      const capacity = this.getCapacity(building);
      const target = this.ensureTarget(building, capacity);
      const workers = this.getWorkersFor(building);

      if (workers.length > target) {
        for (const worker of workers.slice(target)) {
          this.releaseWorker(worker);
        }
      }
    }

    // Then fill enabled vacancies from the shared idle workforce pool.
    const idle = this.scene.villagerSystem
      .getIdleVillagers(0)
      .filter((villager) => !villager.jobBuilding);

    for (const building of buildings) {
      const capacity = this.getCapacity(building);
      const target = this.ensureTarget(building, capacity);
      const workers = this.getWorkersFor(building);
      const needed = Math.max(0, target - workers.length);

      for (let i = 0; i < needed && idle.length > 0; i++) {
        const nearestIndex = this.findNearestWorkerIndex(idle, building);
        const worker = idle.splice(nearestIndex, 1)[0];
        this.scene.villagerSystem.assignJob(worker, building);
      }

      // Keep the old EconomySystem's production/vacancy checks compatible.
      const currentWorkers = this.getWorkersFor(building);
      building.setData('assignedWorker', currentWorkers[0]);
    }

    this.publishSnapshot();
  }

  public publishSnapshot(force = false): void {
    const snapshot = this.createSnapshot();
    const key = JSON.stringify(snapshot);
    if (!force && key === this.lastSnapshotKey) return;
    this.lastSnapshotKey = key;
    this.scene.game.events.emit(WORKFORCE_EVENTS.SNAPSHOT, snapshot);
  }

  private handleSnapshotRequest(): void {
    this.publishSnapshot(true);
  }

  private handleSetTarget(payload: { buildingId?: string; target?: number }): void {
    if (!payload?.buildingId || !Number.isFinite(payload.target)) return;

    const building = this.getWorkBuildings().find(
      (candidate) => this.getBuildingId(candidate) === payload.buildingId,
    );
    if (!building) return;

    const capacity = this.getCapacity(building);
    const target = Phaser.Math.Clamp(Math.round(payload.target as number), 0, capacity);
    this.targets.set(building, target);
    this.reconcile();
    this.scene.economySystem.updateStats();
  }

  private createSnapshot(): WorkforceSnapshot {
    const buildings = this.getWorkBuildings();
    const villagers = this.scene.villagerSystem.getAllVillagers().filter((villager) => villager.owner === 0);

    const rows = buildings.map((building) => {
      const capacity = this.getCapacity(building);
      const target = this.ensureTarget(building, capacity);
      const filled = Math.min(capacity, this.getWorkersFor(building).length);
      const def = building.getData('def');
      return {
        id: this.getBuildingId(building),
        type: String(def?.type ?? 'Workplace'),
        name: String(def?.name ?? def?.type ?? 'Workplace'),
        capacity,
        target,
        filled,
      } satisfies WorkforceBuildingSnapshot;
    });

    const assignedVillagers = villagers.filter((villager) => Boolean(villager.jobBuilding)).length;
    const totalSlots = rows.reduce((sum, row) => sum + row.capacity, 0);
    const enabledSlots = rows.reduce((sum, row) => sum + row.target, 0);
    const filledSlots = rows.reduce((sum, row) => sum + Math.min(row.filled, row.target), 0);

    return {
      totalVillagers: villagers.length,
      assignedVillagers,
      idleVillagers: Math.max(0, villagers.length - assignedVillagers),
      filledSlots,
      openSlots: Math.max(0, enabledSlots - filledSlots),
      enabledSlots,
      totalSlots,
      buildings: rows,
    };
  }

  private getWorkBuildings(): WorkBuilding[] {
    return this.scene.buildings.getChildren().filter((candidate) => {
      const def = candidate.getData('def');
      const isGoldDropsite = def?.type === BuildingType.TOWN_CENTER;
      return candidate.getData('owner') === 0
        && ((def?.workerNeeds ?? 0) > 0 || isGoldDropsite)
        && candidate.getData('hp') > 0;
    }) as WorkBuilding[];
  }

  private getCapacity(building: WorkBuilding): number {
    const def = building.getData('def');
    // Gold gathering is already implemented as a Town Center anchored villager
    // job. Surface that legacy job as a real workforce slot instead of letting
    // gold production bypass the management model.
    if (def?.type === BuildingType.TOWN_CENTER) return 1;
    return Math.max(0, Math.floor(def?.workerNeeds ?? 0));
  }

  private ensureTarget(building: WorkBuilding, capacity: number): number {
    const existing = this.targets.get(building);
    if (existing !== undefined) return Phaser.Math.Clamp(existing, 0, capacity);

    // Stronghold behavior: newly available workplaces request all of their
    // worker slots automatically. The player can close slots from the UI.
    this.targets.set(building, capacity);
    return capacity;
  }

  private getWorkersFor(building: WorkBuilding): VillagerData[] {
    return this.scene.villagerSystem
      .getAllVillagers()
      .filter((villager) => villager.owner === 0 && villager.jobBuilding === building);
  }

  private releaseWorker(villager: VillagerData): void {
    const rally = this.findNearestBonfire(villager);
    this.scene.villagerSystem.sendToRallyPoint(
      villager,
      rally?.x ?? villager.x,
      rally?.y ?? villager.y,
    );

    // If pathfinding rejects even the rally/current-position request, force a
    // safe idle state so a disabled slot can never be silently refilled.
    if (villager.jobBuilding) {
      villager.jobBuilding = undefined;
      villager.targetResource = undefined;
      villager.path = undefined;
      villager.pathStep = 0;
      villager.rallyPoint = undefined;
      villager.state = UnitState.IDLE;
    }
  }

  private findNearestBonfire(villager: VillagerData): WorkBuilding | undefined {
    let nearest: WorkBuilding | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of this.scene.buildings.getChildren() as WorkBuilding[]) {
      if (candidate.getData('owner') !== villager.owner) continue;
      if (candidate.getData('def')?.type !== BuildingType.BONFIRE) continue;
      const distance = Phaser.Math.Distance.Squared(villager.x, villager.y, candidate.x, candidate.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = candidate;
      }
    }

    return nearest;
  }

  private findNearestWorkerIndex(villagers: VillagerData[], building: WorkBuilding): number {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < villagers.length; i++) {
      const villager = villagers[i];
      const distance = Phaser.Math.Distance.Squared(villager.x, villager.y, building.x, building.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  private getBuildingId(building: WorkBuilding): string {
    let id = building.getData('workforceId') as string | undefined;
    if (!id) {
      id = `workplace-${this.nextBuildingId++}`;
      building.setData('workforceId', id);
    }
    return id;
  }

  private removeDestroyedBuildings(current: WorkBuilding[]): void {
    const live = new Set(current);
    for (const building of this.targets.keys()) {
      if (!live.has(building)) this.targets.delete(building);
    }
  }
}
