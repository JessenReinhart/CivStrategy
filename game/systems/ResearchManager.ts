import { MainScene } from '../MainScene';
import {
  Age,
  ActiveResearch,
  BuildingType,
  PlayerTechSnapshot,
  TechDef,
  TechId,
} from '../../types';
import { EVENTS, TECH_DEFS } from '../../constants';

/**
 * Sole mutator for per-player tech state.
 * Ages stay on MainScene; this owns research timers, escrow, and snapshots.
 */
export class ResearchManager {
  private scene: MainScene;
  private completed = new Map<number, Set<TechId>>();
  private active = new Map<number, ActiveResearch>();
  private snapshots = new Map<number, PlayerTechSnapshot>();

  constructor(scene: MainScene) {
    this.scene = scene;
  }

  public getSnapshot(playerId: number): PlayerTechSnapshot {
    const existing = this.snapshots.get(playerId);
    if (existing) return existing;
    const snap: PlayerTechSnapshot = {
      completed: new Set(this.completedOf(playerId)),
      active: this.active.get(playerId) ?? null,
      gatherMult: { wood: 1, food: 1, gold: 1 },
      damageMult: 1,
      armorAdd: 0,
      movementSpeedMult: 1,
      buildingHpMult: 1,
    };
    this.snapshots.set(playerId, snap);
    return snap;
  }

  public isCompleted(playerId: number, techId: TechId): boolean {
    return this.completedOf(playerId).has(techId);
  }

  public getActive(playerId: number): ActiveResearch | null {
    return this.active.get(playerId) ?? null;
  }

  /** Techs the player can start at this age on this host building type. */
  public getAvailableTechs(playerId: number, age: Age, hostType: BuildingType): TechDef[] {
    return Object.values(TECH_DEFS).filter((def) => this.canStart(playerId, def.id, age, hostType, false).ok);
  }

  public tryStart(
    playerId: number,
    techId: TechId,
    age: Age,
    hostType: BuildingType,
    hostBuildingKey: string | null = null,
    resources: { wood: number; food: number; gold: number } | null = null
  ): { ok: true } | { ok: false; reason: string } {
    const check = this.canStart(playerId, techId, age, hostType, true);
    if (!check.ok) return check;

    const def = TECH_DEFS[techId];
    const res = resources ?? this.scene.resources;
    res.wood -= def.cost.wood;
    res.food -= def.cost.food;
    res.gold -= def.cost.gold;

    this.active.set(playerId, {
      techId: def.id,
      remainingMs: def.researchTimeMs,
      totalMs: def.researchTimeMs,
      hostBuildingKey,
      escrow: { ...def.cost },
    });
    this.rebuildSnapshot(playerId);
    return { ok: true };
  }

  public cancel(playerId: number): boolean {
    const active = this.active.get(playerId);
    if (!active) return false;
    if (playerId === 0) {
      this.scene.resources.wood += active.escrow.wood;
      this.scene.resources.food += active.escrow.food;
      this.scene.resources.gold += active.escrow.gold;
    }
    this.active.delete(playerId);
    this.rebuildSnapshot(playerId);
    return true;
  }

  /** Tick all active research by dt ms. Completes when remainingMs hits 0.
   *  Does not rebuild snapshots while only remainingMs changes — UI reads active live.
   *  Returns true if any player still has active research (for UI progress refresh).
   */
  public tick(dt: number): boolean {
    if (dt <= 0) return this.active.size > 0;
    for (const playerId of [...this.active.keys()]) {
      const active = this.active.get(playerId);
      if (!active) continue;
      active.remainingMs -= dt;
      if (active.remainingMs <= 0) {
        this.complete(playerId);
      }
    }
    return this.active.size > 0;
  }

  private complete(playerId: number): void {
    const active = this.active.get(playerId);
    if (!active) return;
    this.completedOf(playerId).add(active.techId);
    this.active.delete(playerId);
    this.rebuildSnapshot(playerId);
    this.scene.events.emit(EVENTS.RESEARCH_COMPLETED, { playerId, techId: active.techId });
  }

  private canStart(
    playerId: number,
    techId: TechId,
    age: Age,
    hostType: BuildingType,
    checkResources: boolean
  ): { ok: true } | { ok: false; reason: string } {
    const def = TECH_DEFS[techId];
    if (!def) return { ok: false, reason: 'Unknown tech' };
    if (this.isCompleted(playerId, techId)) return { ok: false, reason: 'Already researched' };
    if (this.active.has(playerId)) return { ok: false, reason: 'Research already in progress' };

    const ageOrder: Age[] = [Age.VILLAGE, Age.TOWN, Age.CITY_STATE];
    if (ageOrder.indexOf(age) < ageOrder.indexOf(def.requiredAge)) {
      return { ok: false, reason: 'Age requirement not met' };
    }
    if (!def.hostBuildingTypes.includes(hostType)) {
      return { ok: false, reason: 'Wrong building' };
    }
    for (const pre of def.prereqs) {
      if (!this.isCompleted(playerId, pre)) return { ok: false, reason: 'Missing prerequisite: ' + pre };
    }
    if (checkResources && playerId === 0) {
      const res = this.scene.resources;
      if (res.wood < def.cost.wood || res.food < def.cost.food || res.gold < def.cost.gold) {
        return { ok: false, reason: 'Not enough resources' };
      }
    }
    return { ok: true };
  }

  private completedOf(playerId: number): Set<TechId> {
    let set = this.completed.get(playerId);
    if (!set) {
      set = new Set();
      this.completed.set(playerId, set);
    }
    return set;
  }

  private rebuildSnapshot(playerId: number): void {
    const completed = this.completedOf(playerId);
    const active = this.active.get(playerId) ?? null;
    const snap: PlayerTechSnapshot = {
      completed: new Set(completed),
      active,
      gatherMult: { wood: 1, food: 1, gold: 1 },
      damageMult: 1,
      armorAdd: 0,
      movementSpeedMult: 1,
      buildingHpMult: 1,
    };

    for (const techId of completed) {
      const def = TECH_DEFS[techId];
      if (!def) continue;
      for (const mod of def.modifications) {
        if (mod.path === 'Gather/Wood') {
          if (mod.multiply !== undefined) snap.gatherMult.wood *= mod.multiply;
          if (mod.add !== undefined) snap.gatherMult.wood += mod.add;
        } else if (mod.path === 'Gather/Food') {
          if (mod.multiply !== undefined) snap.gatherMult.food *= mod.multiply;
          if (mod.add !== undefined) snap.gatherMult.food += mod.add;
        } else if (mod.path === 'Gather/Gold') {
          if (mod.multiply !== undefined) snap.gatherMult.gold *= mod.multiply;
          if (mod.add !== undefined) snap.gatherMult.gold += mod.add;
        } else if (mod.path === 'Combat/Damage') {
          if (mod.multiply !== undefined) snap.damageMult *= mod.multiply;
          if (mod.add !== undefined) snap.damageMult += mod.add;
        } else if (mod.path === 'Combat/Armor') {
          if (mod.add !== undefined) snap.armorAdd += mod.add;
        } else if (mod.path === 'Gather/All') {
          if (mod.multiply !== undefined) {
            snap.gatherMult.wood *= mod.multiply;
            snap.gatherMult.food *= mod.multiply;
            snap.gatherMult.gold *= mod.multiply;
          }
        } else if (mod.path === 'Movement/Speed') {
          if (mod.multiply !== undefined) snap.movementSpeedMult *= mod.multiply;
        } else if (mod.path === 'Building/HP') {
          if (mod.multiply !== undefined) snap.buildingHpMult *= mod.multiply;
        }
        // Unknown paths: fail-soft
      }
    }
    // Custom tech effects not expressible via modification paths
    if (completed.has(TechId.SIEGE_ENGINEERING)) snap.siegeBuildingDmgMult = 1.25;
    if (completed.has(TechId.CIVIL_SERVICE)) {
      snap.popGrowthMult = 1.5;
      snap.happinessDecayMult = 0.7;
    }
    this.snapshots.set(playerId, snap);
  }

  // ─── Save/Load public accessors ─────────────────────────────────────
  public getCompleted(playerId: number): TechId[] {
    return [...this.completedOf(playerId)];
  }

  public setCompleted(playerId: number, techs: TechId[]): void {
    const set = this.completed.get(playerId) ?? new Set();
    set.clear();
    for (const t of techs) set.add(t);
    this.completed.set(playerId, set);
  }

  public setActiveResearch(playerId: number, techId: TechId, remainingMs: number): void {
    const def = TECH_DEFS[techId];
    if (!def) return;
    this.active.set(playerId, {
      techId,
      remainingMs,
      totalMs: def.researchTimeMs,
      hostBuildingKey: null,
      escrow: { ...def.cost },
    });
  }

  /** Clear active research during state restoration without refunding escrow. */
  public clearActiveResearch(playerId: number): void {
    this.active.delete(playerId);
  }

  public rebuildSnapshotPublic(playerId: number): void {
    this.rebuildSnapshot(playerId);
  }
}
