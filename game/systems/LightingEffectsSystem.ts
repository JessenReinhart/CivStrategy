import Phaser from 'phaser';

import { BuildingType } from '../../types';
import { MainScene } from '../MainScene';
import { calculateLocalLightAlpha, calculateSunlightStyle } from './lightingMath';

// Fog composites at depth 10000. Keep every light below it so unexplored terrain
// stays dark instead of being re-exposed by the SCREEN pass.
const SUN_SHADE_DEPTH = 8950;
const SUNLIGHT_DEPTH = 8960;
const SUN_GLARE_DEPTH = 8945;
const LOCAL_LIGHT_DEPTH = 8970;
const LIGHT_GLOW_KEY = 'day-night-light-glow';
const BONFIRE_SYNC_INTERVAL_MS = 250;
const SUN_SHADE_COLOR = 0x343a31;

type BuildingWithVisual = Phaser.GameObjects.GameObject & {
  visual?: Phaser.GameObjects.Container;
};

interface BonfireLight {
  readonly image: Phaser.GameObjects.Image;
  readonly seed: number;
}

/**
 * Cheap art-directed world lighting layered after ambient + cast shadows.
 *
 * Direct sun and shade are two oversized opposing radial fields. Their centers
 * follow the serialized solar azimuth, producing one coherent light source
 * instead of a camera-centered stripe pattern. Terrain, vegetation, units and
 * buildings are graded together without a full-screen exposure wash.
 */
export class LightingEffectsSystem {
  private readonly scene: MainScene;
  private readonly directionalLight: Phaser.GameObjects.Image;
  private readonly directionalShade: Phaser.GameObjects.Image;
  private readonly sunFlare: Phaser.GameObjects.Image;
  private readonly sunRays: readonly Phaser.GameObjects.Image[];
  private readonly bonfireLights = new Map<Phaser.GameObjects.GameObject, BonfireLight>();
  private readonly generatedTextureKeys: string[] = [];
  private lastBonfireSync = Number.NEGATIVE_INFINITY;
  private destroyed = false;

  constructor(scene: MainScene) {
    this.scene = scene;
    this.createGlowTexture();

    this.directionalShade = scene.add
      .image(0, 0, LIGHT_GLOW_KEY)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(SUN_SHADE_DEPTH)
      .setTint(SUN_SHADE_COLOR)
      .setAlpha(0);

    this.directionalLight = scene.add
      .image(0, 0, LIGHT_GLOW_KEY)
      .setBlendMode(Phaser.BlendModes.SCREEN)
      .setDepth(SUNLIGHT_DEPTH)
      .setAlpha(0);

    this.sunRays = [0, 1].map(() => scene.add
      .image(0, 0, LIGHT_GLOW_KEY)
      .setBlendMode(Phaser.BlendModes.SCREEN)
      .setDepth(SUN_GLARE_DEPTH)
      .setAlpha(0));

    this.sunFlare = scene.add
      .image(0, 0, LIGHT_GLOW_KEY)
      .setBlendMode(Phaser.BlendModes.SCREEN)
      .setDepth(SUN_GLARE_DEPTH)
      .setAlpha(0);

    scene.worldLayer.add(this.directionalShade);
    scene.worldLayer.add(this.directionalLight);
    for (const ray of this.sunRays) scene.worldLayer.add(ray);
    scene.worldLayer.add(this.sunFlare);

    scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private createGlowTexture(): void {
    if (this.scene.textures.exists(LIGHT_GLOW_KEY)) return;

    const size = 256;
    const canvas = this.scene.textures.createCanvas(LIGHT_GLOW_KEY, size, size);
    if (!canvas) throw new Error(`Unable to create lighting texture: ${LIGHT_GLOW_KEY}`);

    const ctx = canvas.context;
    const center = size * 0.5;
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    gradient.addColorStop(0.22, 'rgba(255, 255, 255, 0.78)');
    gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.36)');
    gradient.addColorStop(0.82, 'rgba(255, 255, 255, 0.10)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    canvas.refresh();
    this.generatedTextureKeys.push(LIGHT_GLOW_KEY);
  }

  private update(timeMs: number): void {
    if (this.destroyed) return;

    if (this.scene.stressTestConfig) {
      this.setVisible(false);
      return;
    }

    this.setVisible(true);
    const state = this.scene.dayNightSystem.getState();
    this.updateSunlight(state);

    if (
      this.lastBonfireSync === Number.NEGATIVE_INFINITY
      || timeMs - this.lastBonfireSync >= BONFIRE_SYNC_INTERVAL_MS
    ) {
      this.lastBonfireSync = timeMs;
      this.syncBonfireLights();
    }

    this.updateBonfireLights(timeMs, state.sunIntensity, state.ambientAlpha);
  }

  private updateSunlight(state: ReturnType<MainScene['dayNightSystem']['getState']>): void {
    const view = this.scene.cameras.main.worldView;
    const style = calculateSunlightStyle(state.hour, state.sunIntensity, state.sunElevation);
    const centerX = view.left + view.width * 0.5;
    const centerY = view.top + view.height * 0.5;
    const diagonal = Math.max(1, Math.hypot(view.width, view.height));
    const sunDirectionX = Math.cos(state.sunAzimuthRad);
    const sunDirectionY = Math.sin(state.sunAzimuthRad);
    const fieldSize = diagonal * 1.34;
    const fieldRotation = state.sunAzimuthRad + Math.PI * 0.5;
    const lightOffset = diagonal * 0.38;
    const shadeOffset = diagonal * 0.35;

    this.directionalLight
      .setPosition(
        centerX + sunDirectionX * lightOffset,
        centerY + sunDirectionY * lightOffset,
      )
      .setDisplaySize(fieldSize * 1.08, fieldSize * 0.82)
      .setRotation(fieldRotation)
      .setTint(style.color)
      .setAlpha(style.directionalAlpha);

    this.directionalShade
      .setPosition(
        centerX - sunDirectionX * shadeOffset,
        centerY - sunDirectionY * shadeOffset,
      )
      .setDisplaySize(fieldSize * 1.18, fieldSize * 0.94)
      .setRotation(fieldRotation)
      .setTint(SUN_SHADE_COLOR)
      .setAlpha(style.shadeAlpha);

    this.updateSunGlare(
      state,
      centerX,
      centerY,
      diagonal,
      sunDirectionX,
      sunDirectionY,
    );
  }

  private updateSunGlare(
    state: ReturnType<MainScene['dayNightSystem']['getState']>,
    centerX: number,
    centerY: number,
    diagonal: number,
    sunDirectionX: number,
    sunDirectionY: number,
  ): void {
    if (state.sunIntensity <= 0.001) {
      this.sunFlare.setAlpha(0);
      for (const ray of this.sunRays) ray.setAlpha(0);
      return;
    }

    const horizonWarmth = 1 - Phaser.Math.Clamp(state.sunElevation, 0, 1);
    const horizonEnergy = state.sunIntensity * horizonWarmth;
    const flareDistance = diagonal * 0.47;
    const flareX = centerX + sunDirectionX * flareDistance;
    const flareY = centerY + sunDirectionY * flareDistance;
    const inwardAngle = Math.atan2(centerY - flareY, centerX - flareX);
    const inwardX = Math.cos(inwardAngle);
    const inwardY = Math.sin(inwardAngle);
    const perpendicularX = -Math.sin(inwardAngle);
    const perpendicularY = Math.cos(inwardAngle);
    const flareAlpha = Math.min(0.13, horizonEnergy * 0.42);

    this.sunFlare
      .setPosition(flareX, flareY)
      .setDisplaySize(diagonal * 0.68, diagonal * 0.48)
      .setRotation(inwardAngle)
      .setTint(0xffd39a)
      .setAlpha(flareAlpha);

    const rayOffsets = [-0.018, 0.035] as const;
    const rayCenterScales = [0.43, 0.50] as const;
    const rayLengthScales = [1, 1.18] as const;
    const rayThicknessScales = [0.09, 0.20] as const;
    const rayAngleOffsets = [0, -0.035] as const;
    const rayAlphas = [
      Math.min(0.075, horizonEnergy * 0.24),
      Math.min(0.035, horizonEnergy * 0.11),
    ] as const;
    const rayTints = [0xffdda6, 0xffe7bd] as const;

    for (let index = 0; index < this.sunRays.length; index++) {
      const offset = diagonal * rayOffsets[index];
      const centerDistance = diagonal * rayCenterScales[index];
      this.sunRays[index]
        .setPosition(
          flareX + inwardX * centerDistance + perpendicularX * offset,
          flareY + inwardY * centerDistance + perpendicularY * offset,
        )
        .setDisplaySize(
          diagonal * rayLengthScales[index],
          diagonal * rayThicknessScales[index],
        )
        .setRotation(inwardAngle + rayAngleOffsets[index])
        .setTint(rayTints[index])
        .setAlpha(rayAlphas[index]);
    }
  }

  private syncBonfireLights(): void {
    const activeBonfires = new Set<Phaser.GameObjects.GameObject>();

    for (const building of this.scene.buildings.getChildren()) {
      if (!building.active || building.getData('hp') <= 0) continue;
      const def = building.getData('def') as { type?: BuildingType } | undefined;
      if (def?.type !== BuildingType.BONFIRE) continue;

      activeBonfires.add(building);
      if (this.bonfireLights.has(building)) continue;

      const visual = (building as BuildingWithVisual).visual;
      const seed = visual ? visual.x * 0.017 + visual.y * 0.011 : this.bonfireLights.size * 1.73;
      const image = this.scene.add
        .image(0, 0, LIGHT_GLOW_KEY)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(LOCAL_LIGHT_DEPTH)
        .setTint(0xff9b4d)
        .setAlpha(0);

      this.scene.worldLayer.add(image);
      this.bonfireLights.set(building, { image, seed });
    }

    for (const [building, light] of this.bonfireLights) {
      if (activeBonfires.has(building)) continue;
      light.image.destroy();
      this.bonfireLights.delete(building);
    }
  }

  private updateBonfireLights(timeMs: number, sunIntensity: number, ambientAlpha: number): void {
    const baseAlpha = calculateLocalLightAlpha(sunIntensity, ambientAlpha);

    for (const [building, light] of this.bonfireLights) {
      const visual = (building as BuildingWithVisual).visual;
      if (!visual?.active || !visual.visible || visual.alpha <= 0.01) {
        light.image.setVisible(false);
        continue;
      }

      const sprite = this.findBonfireSprite(visual);
      if (!sprite) {
        light.image.setVisible(false);
        continue;
      }

      const fireX = visual.x + sprite.x;
      const fireY = visual.y + sprite.y - Math.abs(sprite.displayHeight) * 0.23;
      const phase = timeMs * 0.012 + light.seed;
      const flicker = 1
        + Math.sin(phase) * 0.035
        + Math.sin(timeMs * 0.029 + light.seed * 1.7) * 0.018;
      const alphaFlicker = 0.92 + Math.sin(timeMs * 0.021 + light.seed) * 0.08;
      const width = Math.max(170, Math.abs(sprite.displayWidth) * 2.35) * flicker;
      const height = Math.max(105, Math.abs(sprite.displayHeight) * 1.25) * flicker;

      light.image
        .setVisible(true)
        .setPosition(fireX, fireY)
        .setDisplaySize(width, height)
        .setAlpha(baseAlpha * alphaFlicker * visual.alpha);
    }
  }

  private findBonfireSprite(
    visual: Phaser.GameObjects.Container,
  ): Phaser.GameObjects.Image | null {
    for (const child of visual.list) {
      if (child instanceof Phaser.GameObjects.Image && child.texture.key === 'bonfire') {
        return child;
      }
    }
    return null;
  }

  private setVisible(visible: boolean): void {
    this.directionalLight.setVisible(visible);
    this.directionalShade.setVisible(visible);
    this.sunFlare.setVisible(visible);
    for (const ray of this.sunRays) ray.setVisible(visible);
    for (const light of this.bonfireLights.values()) light.image.setVisible(visible);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);

    this.directionalLight.destroy();
    this.directionalShade.destroy();
    this.sunFlare.destroy();
    for (const ray of this.sunRays) ray.destroy();
    for (const light of this.bonfireLights.values()) light.image.destroy();
    this.bonfireLights.clear();

    for (const textureKey of this.generatedTextureKeys) {
      if (this.scene.textures.exists(textureKey)) this.scene.textures.remove(textureKey);
    }
  }
}
