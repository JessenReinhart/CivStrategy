import Phaser from 'phaser';

import { BuildingType } from '../../types';
import { MainScene } from '../MainScene';
import { toIso, toIsoElev } from '../utils/iso';

const MAX_CITIZENS = 220;
const ANCHOR_REFRESH_MS = 1000;
const OFFSCREEN_POS = -100000;
const VIEW_PADDING = 96;
const NEARBY_ANCHOR_DISTANCE = 320;

interface AmbientAnchor {
  x: number;
  y: number;
  owner: number;
  weight: number;
  radius: number;
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

  constructor(scene: MainScene) {
    this.scene = scene;
    this.ensureTexture();

    this.blitter = scene.add.blitter(0, 0, 'ambient_citizen');
    this.blitter.setDepth(-9998);
    scene.worldLayer?.add(this.blitter);

    scene.events.on(Phaser.Scenes.Events.UPDATE, this.handleUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private ensureTexture(): void {
    if (this.scene.textures.exists('ambient_citizen')) return;

    const graphics = this.scene.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0xffffff, 0.92);
    graphics.fillCircle(3, 2, 1.6);
    graphics.fillRect(1.5, 3.5, 3, 4.5);
    graphics.generateTexture('ambient_citizen', 6, 8);
    graphics.destroy();
  }

  private handleUpdate(_time: number, delta: number): void {
    if (this.scene.stressTestConfig) {
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

    const dtSeconds = Math.min(0.05, Math.max(0, delta * this.scene.gameSpeed) / 1000);
    const cam = this.scene.cameras.main;
    const view = cam.worldView;

    for (let i = 0; i < this.desiredCitizenCount; i++) {
      const citizen = this.citizens[i];
      if (!citizen.active) continue;

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

      const height = this.scene.terrainSystem.getHeightAt(citizen.x, citizen.y);
      const iso = toIsoElev(citizen.x, citizen.y, height);
      citizen.bob.x = iso.x;
      citizen.bob.y = iso.y;
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
      });
    }

    this.anchors = anchors;
    this.desiredCitizenCount = Math.min(
      MAX_CITIZENS,
      anchors.reduce((sum, anchor) => sum + anchor.weight, 0),
    );
  }

  private reconcileCitizenCount(): void {
    while (this.citizens.length < this.desiredCitizenCount) {
      const bob = this.blitter.create(OFFSCREEN_POS, OFFSCREEN_POS);
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
    citizen.bob.tint = this.pickCitizenTint(anchor.owner);

    const point = this.pickDryPoint(anchor);
    citizen.x = point.x;
    citizen.y = point.y;
    citizen.targetX = point.x;
    citizen.targetY = point.y;
    this.assignTarget(citizen, now);
  }

  private assignTarget(citizen: AmbientCitizen, now: number): void {
    if (this.anchors.length === 0) return;

    // Most movement stays local, but occasionally hop to another nearby civic
    // anchor so streets between houses/markets feel occupied without invoking
    // pathfinding for decorative people.
    let anchorIndex = citizen.anchorIndex;
    if (anchorIndex < 0 || anchorIndex >= this.anchors.length || Math.random() < 0.18) {
      anchorIndex = this.pickNearbyAnchor(citizen);
    }

    const anchor = this.anchors[anchorIndex] ?? this.anchors[this.pickWeightedAnchor()];
    citizen.anchorIndex = this.anchors.indexOf(anchor);
    citizen.owner = anchor.owner;

    const point = this.pickDryPoint(anchor);
    citizen.targetX = point.x;
    citizen.targetY = point.y;
    citizen.retargetAt = now + 1800 + Math.random() * 4200;
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
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = anchor.radius * (0.45 + Math.random() * 0.55);
      const x = anchor.x + Math.cos(angle) * distance;
      const y = anchor.y + Math.sin(angle) * distance;

      if (this.scene.mapMode === 'Fixed Map') {
        if (x < 0 || y < 0 || x > this.scene.mapWidth || y > this.scene.mapHeight) continue;
      }
      if (this.scene.terrainSystem.getHeightAt(x, y) > waterLevel + 0.01) {
        return { x, y };
      }
    }
    return { x: anchor.x, y: anchor.y };
  }

  private pickCitizenTint(owner: number): number {
    const clothPalette = [0xd8c7a2, 0xb88a62, 0x8c7055, 0xc2b7a3, 0x9c8064, 0xe0d2b8];
    if (Math.random() < 0.2) return this.scene.getFactionColor(owner);
    return clothPalette[Math.floor(Math.random() * clothPalette.length)];
  }

  private getAnchorConfig(type: BuildingType): { weight: number; radius: number } | null {
    switch (type) {
      case BuildingType.TOWN_CENTER: return { weight: 18, radius: 92 };
      case BuildingType.HOUSE: return { weight: 8, radius: 54 };
      case BuildingType.MARKET: return { weight: 18, radius: 100 };
      case BuildingType.SMALL_PARK: return { weight: 10, radius: 78 };
      case BuildingType.BONFIRE: return { weight: 8, radius: 64 };
      case BuildingType.CATHEDRAL: return { weight: 14, radius: 96 };
      case BuildingType.CASTLE: return { weight: 6, radius: 112 };
      case BuildingType.BARRACKS: return { weight: 5, radius: 76 };
      case BuildingType.FARM: return { weight: 3, radius: 72 };
      case BuildingType.LUMBER_CAMP:
      case BuildingType.HUNTERS_LODGE:
        return { weight: 4, radius: 68 };
      case BuildingType.WALL:
      default:
        return null;
    }
  }

  public getActiveCount(): number {
    return this.desiredCitizenCount;
  }

  public destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.handleUpdate, this);
    this.citizens.length = 0;
    this.anchors = [];
    this.blitter.destroy();
  }
}
