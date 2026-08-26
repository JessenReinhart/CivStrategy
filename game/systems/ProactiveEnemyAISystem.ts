import Phaser from 'phaser';

import type { MainScene } from '../MainScene';
import { BUILDINGS, TERRAIN_CONFIG } from '../../constants';
import { Age, BuildingDef, BuildingType, GameResult, MapMode } from '../../types';
import { EnemyAISystem } from './EnemyAISystem';
import {
  canAffordBuilding,
  generateBuildSearchOffsets,
  isBuildingUnlockedForAI,
} from './EnemyAIBuildRules';

const PROACTIVE_BUILD_INTERVAL_MS = 4000;
const BUILD_CLEARANCE = 8;

/**
 * EnemyAISystem with a resilient town-building director.
 *
 * The legacy AI's combat/economy/research behavior stays intact. Only its build
 * cadence is replaced because the legacy serial blueprint walker can retry one
 * invalid slot forever and its terrain check does not recognize the `deep`
 * water biome returned by TerrainSystem.
 */
export class ProactiveEnemyAISystem extends EnemyAISystem {
  private lastProactiveBuildTick = 0;

  constructor(private readonly mainScene: MainScene) {
    super(mainScene);
  }

  override update(time: number, delta: number): void {
    // EnemyAISystem.tickBuild() is private, but TypeScript `private` is runtime
    // accessible. Keep its timer current so the rest of super.update() runs
    // unchanged while this class owns building decisions.
    const legacyInternals = this as unknown as { lastBuildTick: number };
    legacyInternals.lastBuildTick = time;
    super.update(time, delta);

    if (this.mainScene.aiDisabled || this.mainScene.gameResult !== GameResult.PLAYING) return;
    if (time - this.lastProactiveBuildTick < PROACTIVE_BUILD_INTERVAL_MS) return;

    this.lastProactiveBuildTick = time;
    this.tickTownBuild();
  }

  private tickTownBuild(): void {
    const state = this.serializeState();
    const blueprint = state.selectedBlueprint ?? [];
    const age = state.aiCurrentAge ?? state.currentAge;

    // Clear destroyed tracked slots before choosing the next build.
    for (let i = 0; i < this.buildings.length; i++) {
      const existing = this.buildings[i];
      if (existing && (!existing.scene || existing.getData('hp') <= 0)) {
        this.buildings[i] = null;
      }
    }

    // Scan the whole unlocked blueprint, not just one serial buildIndex. An
    // expensive or terrain-blocked slot therefore cannot freeze later growth.
    for (let i = 0; i < blueprint.length; i++) {
      if (this.buildings[i]) continue;
      const item = blueprint[i];
      if (!isBuildingUnlockedForAI(item.type, age)) continue;

      const def = BUILDINGS[item.type];
      if (!canAffordBuilding(this.resources, def)) continue;

      const site = this.findBuildSite(item.type, this.baseX + item.x, this.baseY + item.y);
      if (!site) continue;

      const building = this.mainScene.entityFactory.spawnBuilding(item.type, site.x, site.y, 1);
      if (!building) continue;

      this.pay(def);
      this.buildings[i] = building;
      this.syncBuildIndex(blueprint.length, age, blueprint);
      return; // At most one structure per build tick.
    }

    this.syncBuildIndex(blueprint.length, age, blueprint);
    this.tryTownExpansion(age, state.personality ?? 'balanced');
  }

  private syncBuildIndex(
    blueprintLength: number,
    age: Age,
    blueprint: Array<{ type: BuildingType; x: number; y: number }>,
  ): void {
    const firstMissingUnlocked = blueprint.findIndex(
      (item, index) => !this.buildings[index] && isBuildingUnlockedForAI(item.type, age),
    );
    this.buildIndex = firstMissingUnlocked >= 0
      ? firstMissingUnlocked
      : Math.max(0, blueprintLength - 1);
  }

  private tryTownExpansion(age: Age, personality: string): void {
    const owned = this.getOwnedBuildings();
    const targetCount = this.getExpansionTarget(age, personality);
    if (owned.length >= targetCount) return;

    const pool = this.getExpansionPool(age, personality);
    if (pool.length === 0) return;

    // Rotate through the personality pool. If one type is unaffordable, try the
    // others so one expensive structure cannot stall the whole town.
    const start = owned.length % pool.length;
    for (let step = 0; step < pool.length; step++) {
      const type = pool[(start + step) % pool.length];
      if (!isBuildingUnlockedForAI(type, age)) continue;

      const def = BUILDINGS[type];
      if (!canAffordBuilding(this.resources, def)) continue;

      const ordinal = owned.length + step;
      const goldenAngle = 2.399963229728653;
      const angle = ordinal * goldenAngle;
      const ring = 190 + (ordinal % 5) * 72;
      const desiredX = this.baseX + Math.cos(angle) * ring;
      const desiredY = this.baseY + Math.sin(angle) * ring;
      const site = this.findBuildSite(type, desiredX, desiredY);
      if (!site) continue;

      const building = this.mainScene.entityFactory.spawnBuilding(type, site.x, site.y, 1);
      if (!building) continue;

      building.setData('aiExpansion', true);
      this.pay(def);
      return;
    }
  }

  private getExpansionTarget(age: Age, personality: string): number {
    const baseTarget = age === Age.CITY_STATE ? 28 : age === Age.TOWN ? 20 : 12;
    if (personality === 'economist') return baseTarget + 3;
    if (personality === 'defender') return baseTarget + 2;
    if (personality === 'aggressor') return baseTarget + 1;
    return baseTarget;
  }

  private getExpansionPool(age: Age, personality: string): BuildingType[] {
    const byPersonality: Record<string, BuildingType[]> = {
      aggressor: [BuildingType.BARRACKS, BuildingType.HOUSE, BuildingType.WALL, BuildingType.FARM],
      defender: [BuildingType.WALL, BuildingType.HOUSE, BuildingType.WALL, BuildingType.FARM, BuildingType.BARRACKS],
      economist: [BuildingType.FARM, BuildingType.LUMBER_CAMP, BuildingType.HOUSE, BuildingType.MARKET],
      balanced: [BuildingType.HOUSE, BuildingType.FARM, BuildingType.LUMBER_CAMP, BuildingType.BARRACKS, BuildingType.WALL],
    };

    return (byPersonality[personality] ?? byPersonality.balanced)
      .filter(type => isBuildingUnlockedForAI(type, age));
  }

  private findBuildSite(type: BuildingType, desiredX: number, desiredY: number): { x: number; y: number } | null {
    const def = BUILDINGS[type];
    let best: { x: number; y: number; score: number } | null = null;

    for (const offset of generateBuildSearchOffsets()) {
      const x = desiredX + offset.x;
      const y = desiredY + offset.y;
      if (!this.isBuildableTerrain(x, y, def)) continue;
      if (this.overlapsExistingBuilding(x, y, def)) continue;

      const height = this.mainScene.terrainSystem.getHeightAt(x, y);
      const distancePenalty = Math.hypot(offset.x, offset.y);
      let terrainBonus = 0;

      // Farms prefer low/fertile ground. Barracks prefer a little elevation.
      if (type === BuildingType.FARM) terrainBonus = Math.max(0, 0.66 - height) * 120;
      if (type === BuildingType.BARRACKS) terrainBonus = Math.max(0, height - 0.5) * 80;

      const score = distancePenalty - terrainBonus;
      if (!best || score < best.score) best = { x, y, score };
    }

    return best ? { x: best.x, y: best.y } : null;
  }

  private isBuildableTerrain(x: number, y: number, def: BuildingDef): boolean {
    if (this.mainScene.mapMode === MapMode.FIXED) {
      const halfW = def.width / 2 + BUILD_CLEARANCE;
      const halfH = def.height / 2 + BUILD_CLEARANCE;
      if (x < halfW || y < halfH || x > this.mainScene.mapWidth - halfW || y > this.mainScene.mapHeight - halfH) {
        return false;
      }
    }

    const terrain = this.mainScene.terrainSystem;
    const height = terrain.getHeightAt(x, y);
    if (height <= terrain.getWaterLevel() + 0.005) return false;

    const biome = terrain.getBiomeAt(x, y);
    if (biome === 'deep' || biome === 'stone') return false;

    const slope = terrain.getSlopeAt(x, y).slope;
    return slope <= TERRAIN_CONFIG.MAX_BUILDABLE_SLOPE;
  }

  private overlapsExistingBuilding(x: number, y: number, def: BuildingDef): boolean {
    const existing = this.mainScene.buildings.getChildren() as Phaser.GameObjects.Rectangle[];
    for (const building of existing) {
      if (!building.scene || building.getData('hp') <= 0) continue;
      const otherDef = building.getData('def') as BuildingDef | undefined;
      if (!otherDef) continue;

      const xLimit = (def.width + otherDef.width) / 2 + BUILD_CLEARANCE;
      const yLimit = (def.height + otherDef.height) / 2 + BUILD_CLEARANCE;
      if (Math.abs(building.x - x) < xLimit && Math.abs(building.y - y) < yLimit) return true;
    }
    return false;
  }

  private getOwnedBuildings(): Phaser.GameObjects.GameObject[] {
    return this.mainScene.buildings.getChildren().filter(
      building => building.getData('owner') === 1 && building.getData('hp') > 0,
    );
  }

  private pay(def: BuildingDef): void {
    this.resources.wood -= def.cost.wood;
    this.resources.food -= def.cost.food;
    this.resources.gold -= def.cost.gold;
  }
}
