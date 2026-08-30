import Phaser from 'phaser';

import { AmbientRole, BuildingType, MapMode } from '../../types';
import type { MainScene } from '../MainScene';
import { toIso, toIsoElev } from '../utils/iso';

const MAX_CITIZENS = 220;
const MIN_CITIZENS = 8;
const DENSITY_FACTOR = 0.75;
const ANCHOR_REFRESH_MS = 1000;
const OFFSCREEN_POS = -100000;
const VIEW_PADDING = 96;
const NEARBY_ANCHOR_DISTANCE = 320;
const LOD_NEAR_DISTANCE = 900;
const LOD_MID_DISTANCE = 1800;

const TEXTURE_KEY = 'civilian-atlas';
const FRAME_NEAR = 'civilian.mid';

interface AmbientAnchor {
  x: number;
  y: number;
  owner: number;
  weight: number;
  radius: number;
  type: BuildingType;
}

interface ActivityProfile {
  jitterRadius: number;
  pauseChance: number;
  retargetMs: [number, number];
}

interface AmbientCitizen {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  speed: number;
  owner: number;
  anchorIndex: number;
  retargetAt: number;
  active: boolean;
  bob: Phaser.GameObjects.Bob;
  role: AmbientRole;
  tier: number;
  frameKey: string;
}

interface AnchorConfig {
  weight: number;
  radius: number;
  profile: ActivityProfile;
}

const ROLE_TINTS: Record<AmbientRole, number[]> = {
  [AmbientRole.CIVILIAN]: [0xd8c7a2, 0xb88a62, 0x8c7055, 0xc2b7a3, 0x9c8064, 0xe0d2b8],
  [AmbientRole.WORKER]: [0x9a8a72, 0x7a6a55, 0x6b5d4a, 0x8a7a62],
  [AmbientRole.MERCHANT]: [0xa05a4a, 0x4a6a8a, 0x7a4a5a, 0x5a7a6a],
  [AmbientRole.FARMER]: [0x8a9a5a, 0x7a8a4a, 0x6a7a4a, 0x9aaa6a],
};

function distanceBetween(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Decorative city population rendered as lightweight Blitter bobs.
 *
 * These citizens are deliberately NOT gameplay entities: they have no Arcade
 * bodies, spatial-hash entries, selection state, combat state, or pathfinder
 * requests. Real workers remain VillagerSystem units; this system only creates
 * the visual impression of civilians moving through settlements.
 */
export class AmbientPopulationSystem {
  private readonly scene: MainScene;
  private readonly blitter: Phaser.GameObjects.Blitter;
  private readonly citizens: AmbientCitizen[] = [];
  private anchors: AmbientAnchor[] = [];
  private desiredCitizenCount = 0;
  private lastAnchorRefresh = -Infinity;
  private frameCounter = 0;

  constructor(scene: MainScene) {
    this.scene = scene;
    this.ensureTextures();

    this.blitter = scene.add.blitter(0, 0, TEXTURE_KEY);
    this.blitter.setDepth(-9998);
    scene.worldLayer?.add(this.blitter);

    scene.events.on(Phaser.Scenes.Events.UPDATE, this.handleUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /**
   * Read-only: number of ambient citizens the system currently wants to show.
   */
  public getDesiredCitizenCount(): number {
    return this.desiredCitizenCount;
  }

  /**
   * Read-only: number of currently active ambient citizens.
   */
  public getCitizenCount(): number {
    let count = 0;
    for (const citizen of this.citizens) {
      if (citizen.active) count++;
    }
    return count;
  }

  /**
   * Visits only active, on-screen bobs without allocating a position array.
   * DayNightSystem uses this during its budgeted 5 Hz shadow redraw.
   */
  public forEachVisibleCitizen(visitor: (x: number, y: number, alpha: number) => void): void {
    for (const citizen of this.citizens) {
      if (!citizen.active || citizen.bob.x === OFFSCREEN_POS || citizen.bob.y === OFFSCREEN_POS) continue;
      visitor(citizen.bob.x, citizen.bob.y, citizen.bob.alpha);
    }
  }

  /**
   * Read-only: role the system would assign to a citizen tied to a given
   * building type. Exported for deterministic testing only.
   */
  public getRoleForAnchor(type: BuildingType): AmbientRole {
    return this.roleForAnchor(type);
  }
  /** Read-only activity profile for deterministic tests and telemetry. */
  public getActivityProfile(type: BuildingType): ActivityProfile | null {
    return this.getAnchorConfig(type)?.profile ?? null;
  }

  /**
   * Read-only: current texture frame name for the citizen at the given index.
   * Exported for deterministic testing only.
   */
  public getCitizenFrame(i: number): string | undefined {
    return this.citizens[i]?.frameKey;
  }

  /**
   * Read-only: current LOD tier for the citizen at the given index.
   * Exported for deterministic testing only.
   */
  public getCitizenTier(i: number): number {
    return this.citizens[i]?.tier ?? 0;
  }

  private ensureTextures(): void {
    if (this.scene.textures.exists(TEXTURE_KEY)) {
      this.addCivilianFrames(this.scene.textures.get(TEXTURE_KEY));
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 14;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = 'rgba(255,255,255,0.92)';

    // Near: 6x8 colored person.
    ctx.beginPath();
    ctx.arc(3, 2, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(1.5, 3.5, 3, 4.5);

    // Mid: 4x4 rounded silhouette.
    ctx.beginPath();
    ctx.arc(10, 2, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Far: 2x2 dot.
    ctx.fillRect(8, 4, 2, 2);

    const texture = this.scene.textures.addCanvas(TEXTURE_KEY, canvas);
    if (!texture) return;
    for (const role of Object.values(AmbientRole)) {
      texture.add(`${role}.near`, 0, 0, 0, 6, 8);
      texture.add(`${role}.mid`, 0, 8, 0, 4, 4);
      texture.add(`${role}.far`, 0, 8, 4, 2, 2);
    }
  }

  /** Register the three LOD frames for every role in the generated citizen atlas. */
  private addCivilianFrames(texture: Phaser.Textures.Texture): void {
    const roleOffsets: Record<AmbientRole, number> = {
      [AmbientRole.CIVILIAN]: 0,
      [AmbientRole.WORKER]: 32,
      [AmbientRole.MERCHANT]: 64,
      [AmbientRole.FARMER]: 96,
    };
    for (const [role, y] of Object.entries(roleOffsets) as Array<[AmbientRole, number]>) {
      texture.add(`${role}.near`, 0, 0, y, 32, 32);
      texture.add(`${role}.mid`, 0, 32, y + 8, 16, 16);
      texture.add(`${role}.far`, 0, 48, y + 12, 8, 8);
    }
  }

  private handleUpdate(_time: number, delta: number): void {
    const stressConfig = this.scene.stressTestConfig as { city?: boolean; density?: string } | null | undefined;
    if (stressConfig && !stressConfig.city) {
      this.blitter.setVisible(false);
      return;
    }
    this.blitter.setVisible(true);

    const now = this.scene.gameTime;
    if (now - this.lastAnchorRefresh >= ANCHOR_REFRESH_MS) {
      this.lastAnchorRefresh = now;
      this.refreshAnchors();
      this.reconcileCitizenCount();
    }

    if (this.desiredCitizenCount === 0) return;

    this.frameCounter++;
    const dtSeconds = Math.min(0.05, Math.max(0, delta * this.scene.gameSpeed) / 1000);
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    const cameraCenterX = view.centerX;
    const cameraCenterY = view.centerY;

    for (let i = 0; i < this.desiredCitizenCount; i++) {
      const citizen = this.citizens[i];
      if (!citizen.active) continue;

      // Cull before the terrain lookup: cartesian -> iso is cheap, heightmap
      // sampling is not. Inactive/off-screen bobs live far outside the viewport.
      const flatIso = toIso(citizen.x, citizen.y);
      if (
        flatIso.x < view.left - VIEW_PADDING ||
        flatIso.x > view.right + VIEW_PADDING ||
        flatIso.y < view.top - VIEW_PADDING ||
        flatIso.y > view.bottom + VIEW_PADDING
      ) {
        citizen.bob.x = OFFSCREEN_POS;
        citizen.bob.y = OFFSCREEN_POS;
        continue;
      }

      const screenDistance = distanceBetween(flatIso.x, flatIso.y, cameraCenterX, cameraCenterY);
      let tier = 2;
      if (screenDistance < LOD_NEAR_DISTANCE) tier = 0;
      else if (screenDistance < LOD_MID_DISTANCE) tier = 1;
      if (citizen.tier !== tier) {
        citizen.tier = tier;
        this.applyTextureForTier(citizen);
      }

      let shouldMove = true;
      if (tier === 1 && this.frameCounter % 2 !== 0) shouldMove = false;
      if (tier === 2 && this.frameCounter % 4 !== 0) shouldMove = false;

      if (shouldMove) {
        const dx = citizen.targetX - citizen.x;
        const dy = citizen.targetY - citizen.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < 16 || now >= citizen.retargetAt) {
          this.assignTarget(citizen, now);
        } else if (dtSeconds > 0) {
          const distance = Math.sqrt(distSq);
          const step = Math.min(distance, citizen.speed * dtSeconds);
          citizen.x += (dx / distance) * step;
          citizen.y += (dy / distance) * step;
        }
      }

      if (tier === 2 && this.frameCounter % 4 !== 0) {
        // Far tier: keep previous position, skip height sampling.
        continue;
      }

      const height = this.scene.terrainSystem.getHeightAt(citizen.x, citizen.y);
      const iso = toIsoElev(citizen.x, citizen.y, height);
      citizen.bob.x = iso.x;
      citizen.bob.y = iso.y;
    }
  }

  private applyTextureForTier(citizen: AmbientCitizen): void {
    if (citizen.tier === 0) {
      citizen.frameKey = `${citizen.role}.mid`;
      citizen.bob.setFrame(citizen.frameKey);
    } else if (citizen.tier === 1) {
      citizen.frameKey = `${citizen.role}.far`;
      citizen.bob.setFrame(citizen.frameKey);
    } else {
      citizen.frameKey = `${citizen.role}.far`;
      citizen.bob.setFrame(citizen.frameKey);
    }
  }

  private refreshAnchors(): void {
    const anchors: AmbientAnchor[] = [];
    const buildings = this.scene.buildings.getChildren();

    for (let i = 0; i < buildings.length; i++) {
      const building = buildings[i] as Phaser.GameObjects.Image;
      if ((building.getData('hp') as number) <= 0) continue;

      const type = building.getData('def')?.type as BuildingType | undefined;
      if (!type) continue;
      const config = this.getAnchorConfig(type);
      if (!config || config.weight <= 0) continue;

      anchors.push({
        x: building.x,
        y: building.y,
        owner: (building.getData('owner') as number) ?? 0,
        weight: config.weight,
        radius: config.radius,
        type,
      });
    }

    this.anchors = anchors;

    const anchorCapacity = anchors.reduce((sum, anchor) => sum + anchor.weight, 0);
    const populationRatio = this.scene.population / Math.max(1, this.scene.maxPopulation);
    const fromPopulation = Math.min(
      MAX_CITIZENS,
      Math.max(0, Math.floor(MAX_CITIZENS * populationRatio * DENSITY_FACTOR)),
    );
    let target = Math.min(fromPopulation, anchorCapacity);
    if (this.scene.population <= 0) {
      target = Math.max(target, Math.min(MIN_CITIZENS, anchorCapacity));
    }
    this.desiredCitizenCount = Math.max(0, Math.min(MAX_CITIZENS, target));
  }

  private reconcileCitizenCount(): void {
    while (this.citizens.length < this.desiredCitizenCount) {
      const bob = this.blitter.create(OFFSCREEN_POS, OFFSCREEN_POS, FRAME_NEAR);
      const citizen: AmbientCitizen = {
        x: 0,
        y: 0,
        targetX: 0,
        targetY: 0,
        speed: 0,
        owner: 0,
        anchorIndex: -1,
        retargetAt: 0,
        active: false,
        bob,
        role: AmbientRole.CIVILIAN,
        tier: 0,
        frameKey: FRAME_NEAR,
      };
      this.citizens.push(citizen);
    }

    for (let i = 0; i < this.citizens.length; i++) {
      const citizen = this.citizens[i];
      const shouldBeActive = i < this.desiredCitizenCount && this.anchors.length > 0;
      if (shouldBeActive && !citizen.active) {
        citizen.active = true;
        this.resetCitizen(citizen, this.scene.gameTime);
      } else if (!shouldBeActive && citizen.active) {
        citizen.active = false;
        citizen.bob.x = OFFSCREEN_POS;
        citizen.bob.y = OFFSCREEN_POS;
      }
    }
  }

  private resetCitizen(citizen: AmbientCitizen, now: number): void {
    const anchorIndex = this.pickWeightedAnchor();
    const anchor = this.anchors[anchorIndex];
    if (!anchor) return;

    citizen.owner = anchor.owner;
    citizen.anchorIndex = anchorIndex;
    citizen.speed = 13 + Math.random() * 13;
    citizen.role = this.roleForAnchor(anchor.type);
    this.applyTextureForTier(citizen);
    citizen.bob.tint = this.pickCitizenTint(citizen.role, citizen.owner);

    const point = this.pickDryPoint(anchor);
    citizen.x = point.x;
    citizen.y = point.y;
    citizen.targetX = point.x;
    citizen.targetY = point.y;
    this.assignTarget(citizen, now);
  }

  private assignTarget(citizen: AmbientCitizen, now: number): void {
    if (this.anchors.length === 0) return;

    let anchorIndex = citizen.anchorIndex;
    if (anchorIndex < 0 || anchorIndex >= this.anchors.length || Math.random() < 0.18) {
      anchorIndex = this.pickNearbyAnchor(citizen);
    }

    const anchor = this.anchors[anchorIndex] ?? this.anchors[this.pickWeightedAnchor()];
    citizen.anchorIndex = this.anchors.indexOf(anchor);
    citizen.owner = anchor.owner;
    citizen.role = this.roleForAnchor(anchor.type);
    this.applyTextureForTier(citizen);

    const config = this.getAnchorConfig(anchor.type);
    const profile = config?.profile;

    if (profile && Math.random() < profile.pauseChance) {
      citizen.retargetAt = now + 2000 + Math.random() * 3000;
      citizen.targetX = citizen.x;
      citizen.targetY = citizen.y;
      return;
    }

    const point = this.pickDryPoint(anchor);
    citizen.targetX = point.x;
    citizen.targetY = point.y;

    if (profile) {
      const [minMs, maxMs] = profile.retargetMs;
      citizen.retargetAt = now + minMs + Math.random() * (maxMs - minMs);
    } else {
      citizen.retargetAt = now + 1800 + Math.random() * 4200;
    }
  }

  private pickNearbyAnchor(citizen: AmbientCitizen): number {
    const current = this.anchors[citizen.anchorIndex];
    if (!current) return this.pickWeightedAnchor();

    const maxDistSq = NEARBY_ANCHOR_DISTANCE * NEARBY_ANCHOR_DISTANCE;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidateIndex = Math.floor(Math.random() * this.anchors.length);
      const candidate = this.anchors[candidateIndex];
      if (candidate.owner !== citizen.owner) continue;
      const dx = candidate.x - current.x;
      const dy = candidate.y - current.y;
      if (dx * dx + dy * dy <= maxDistSq) return candidateIndex;
    }
    return citizen.anchorIndex;
  }

  private pickWeightedAnchor(): number {
    if (this.anchors.length <= 1) return 0;

    let total = 0;
    for (const anchor of this.anchors) total += anchor.weight;
    let roll = Math.random() * total;
    for (let i = 0; i < this.anchors.length; i++) {
      roll -= this.anchors[i].weight;
      if (roll <= 0) return i;
    }
    return this.anchors.length - 1;
  }

  private pickDryPoint(anchor: AmbientAnchor): { x: number; y: number } {
    const waterLevel = this.scene.terrainSystem.getWaterLevel();
    const config = this.getAnchorConfig(anchor.type);
    const profile = config?.profile;
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = profile ? profile.jitterRadius : anchor.radius;
      const distance = radius * (0.45 + Math.random() * 0.55);
      const x = anchor.x + Math.cos(angle) * distance;
      const y = anchor.y + Math.sin(angle) * distance;

      if (this.scene.mapMode === MapMode.FIXED) {
        if (x < 0 || y < 0 || x > this.scene.mapWidth || y > this.scene.mapHeight) continue;
      }
      if (this.scene.terrainSystem.getHeightAt(x, y) > waterLevel + 0.01) {
        return { x, y };
      }
    }
    return { x: anchor.x, y: anchor.y };
  }

  private pickCitizenTint(role: AmbientRole, owner: number): number {
    if (Math.random() < 0.2) return this.scene.getFactionColor(owner);
    const palette = ROLE_TINTS[role] ?? ROLE_TINTS[AmbientRole.CIVILIAN];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  private roleForAnchor(type: BuildingType): AmbientRole {
    switch (type) {
      case BuildingType.FARM:
        return AmbientRole.FARMER;
      case BuildingType.MARKET:
        return AmbientRole.MERCHANT;
      case BuildingType.LUMBER_CAMP:
      case BuildingType.HUNTERS_LODGE:
      case BuildingType.BARRACKS:
        return AmbientRole.WORKER;
      default:
        return AmbientRole.CIVILIAN;
    }
  }

  private getAnchorConfig(type: BuildingType): AnchorConfig | null {
    switch (type) {
      case BuildingType.TOWN_CENTER:
        return { weight: 18, radius: 92, profile: { jitterRadius: 70, pauseChance: 0.18, retargetMs: [2400, 5000] } };
      case BuildingType.HOUSE:
        return { weight: 8, radius: 54, profile: { jitterRadius: 50, pauseChance: 0.15, retargetMs: [2000, 4200] } };
      case BuildingType.MARKET:
        return { weight: 18, radius: 100, profile: { jitterRadius: 34, pauseChance: 0.25, retargetMs: [900, 2200] } };
      case BuildingType.SMALL_PARK:
        return { weight: 10, radius: 78, profile: { jitterRadius: 50, pauseChance: 0.15, retargetMs: [2000, 4200] } };
      case BuildingType.BONFIRE:
        return { weight: 8, radius: 64, profile: { jitterRadius: 50, pauseChance: 0.15, retargetMs: [2000, 4200] } };
      case BuildingType.CATHEDRAL:
        return { weight: 14, radius: 96, profile: { jitterRadius: 70, pauseChance: 0.18, retargetMs: [2400, 5000] } };
      case BuildingType.CASTLE:
        return { weight: 6, radius: 112, profile: { jitterRadius: 50, pauseChance: 0.15, retargetMs: [2000, 4200] } };
      case BuildingType.BARRACKS:
        return { weight: 5, radius: 76, profile: { jitterRadius: 42, pauseChance: 0.12, retargetMs: [1600, 3600] } };
      case BuildingType.FARM:
        return { weight: 3, radius: 72, profile: { jitterRadius: 60, pauseChance: 0.05, retargetMs: [2600, 5200] } };
      case BuildingType.LUMBER_CAMP:
      case BuildingType.HUNTERS_LODGE:
        return { weight: 4, radius: 68, profile: { jitterRadius: 42, pauseChance: 0.12, retargetMs: [1600, 3600] } };
      case BuildingType.WALL:
      default:
        return null;
    }
  }

  public destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.handleUpdate, this);
    this.citizens.length = 0;
    this.anchors = [];
    this.blitter.destroy();
  }
}
