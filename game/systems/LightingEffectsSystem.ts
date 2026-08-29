import Phaser from 'phaser';

import { BuildingType } from '../../types';
import { MainScene } from '../MainScene';
import { calculateLocalLightAlpha, calculateSunlightStyle } from './lightingMath';

// Ambient sits at depth 19000 in DayNightSystem. Directional contrast must be
// composed after it or the ambient wash flattens the lighting back out.
const SUN_SHADE_DEPTH = 19020;
const SUNLIGHT_DEPTH = 19030;
const LOCAL_LIGHT_DEPTH = 19100;
const LIGHT_GLOW_KEY = 'day-night-light-glow';
const DIRECTIONAL_LIGHT_KEY = 'day-night-directional-light';
const BONFIRE_SYNC_INTERVAL_MS = 250;
const SUN_SHADE_COLOR = 0x34445d;

type BuildingWithVisual = Phaser.GameObjects.GameObject & {
  visual?: Phaser.GameObjects.Container;
};

interface BonfireLight {
  readonly image: Phaser.GameObjects.Image;
  readonly seed: number;
}

/**
 * Cheap directional lighting layered after ambient + cast shadows.
 *
 * The light side gets only a restrained warm SCREEN lift. Most of the readable
 * direction comes from a cool MULTIPLY falloff on the opposite edge, preserving
 * contrast instead of raising exposure across the whole viewport.
 */
export class LightingEffectsSystem {
  private readonly scene: MainScene;
  private readonly directionalLight: Phaser.GameObjects.Image;
  private readonly directionalShade: Phaser.GameObjects.Image;
  private readonly bonfireLights = new Map<Phaser.GameObjects.GameObject, BonfireLight>();
  private readonly generatedTextureKeys: string[] = [];
  private lastBonfireSync = Number.NEGATIVE_INFINITY;
  private destroyed = false;

  constructor(scene: MainScene) {
    this.scene = scene;
    this.createGlowTexture();
    this.createDirectionalLightTexture();

    this.directionalShade = scene.add
      .image(0, 0, DIRECTIONAL_LIGHT_KEY)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(SUN_SHADE_DEPTH)
      .setTint(SUN_SHADE_COLOR)
      .setAlpha(0);

    this.directionalLight = scene.add
      .image(0, 0, DIRECTIONAL_LIGHT_KEY)
      .setBlendMode(Phaser.BlendModes.SCREEN)
      .setDepth(SUNLIGHT_DEPTH)
      .setAlpha(0);

    scene.worldLayer.add(this.directionalShade);
    scene.worldLayer.add(this.directionalLight);

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
    gradient.addColorStop(0.18, 'rgba(255, 255, 255, 0.72)');
    gradient.addColorStop(0.48, 'rgba(255, 255, 255, 0.25)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    canvas.refresh();
    this.generatedTextureKeys.push(LIGHT_GLOW_KEY);
  }

  private createDirectionalLightTexture(): void {
    if (this.scene.textures.exists(DIRECTIONAL_LIGHT_KEY)) return;

    const size = 512;
    const canvas = this.scene.textures.createCanvas(DIRECTIONAL_LIGHT_KEY, size, size);
    if (!canvas) throw new Error(`Unable to create directional light texture: ${DIRECTIONAL_LIGHT_KEY}`);

    const ctx = canvas.context;
    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    // Keep most of the viewport neutral. The effect ramps only near the edge so
    // it reads as light coming from a direction rather than a full-screen filter.
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gradient.addColorStop(0.58, 'rgba(255, 255, 255, 0)');
    gradient.addColorStop(0.72, 'rgba(255, 255, 255, 0.12)');
    gradient.addColorStop(0.84, 'rgba(255, 255, 255, 0.46)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.92)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    canvas.refresh();
    this.generatedTextureKeys.push(DIRECTIONAL_LIGHT_KEY);
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
    const fieldSize = diagonal * 1.05;
    const sunAngle = state.sunAzimuthRad;
    const sunAngleDeg = Phaser.Math.RadToDeg(sunAngle);

    this.directionalLight
      .setPosition(centerX, centerY)
      .setDisplaySize(fieldSize, fieldSize)
      .setRotation(sunAngle)
      .setTint(style.color)
      .setAlpha(style.directionalAlpha);

    this.directionalShade
      .setPosition(centerX, centerY)
      .setDisplaySize(fieldSize, fieldSize)
      .setAngle(sunAngleDeg + 180)
      .setTint(SUN_SHADE_COLOR)
      .setAlpha(style.shadeAlpha);
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
    for (const light of this.bonfireLights.values()) light.image.setVisible(visible);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);

    this.directionalLight.destroy();
    this.directionalShade.destroy();
    for (const light of this.bonfireLights.values()) light.image.destroy();
    this.bonfireLights.clear();

    for (const textureKey of this.generatedTextureKeys) {
      if (this.scene.textures.exists(textureKey)) this.scene.textures.remove(textureKey);
    }
  }
}
