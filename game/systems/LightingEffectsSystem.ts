import Phaser from 'phaser';

import { BuildingType } from '../../types';
import { MainScene } from '../MainScene';
import { calculateLocalLightAlpha, calculateSunlightStyle } from './lightingMath';

const SUNLIGHT_DEPTH = 18400;
const SUN_GLOW_DEPTH = 18450;
const LOCAL_LIGHT_DEPTH = 19100;
const LIGHT_GLOW_KEY = 'day-night-light-glow';
const BONFIRE_SYNC_INTERVAL_MS = 250;

type BuildingWithVisual = Phaser.GameObjects.GameObject & {
  visual?: Phaser.GameObjects.Container;
};

interface BonfireLight {
  readonly image: Phaser.GameObjects.Image;
  readonly seed: number;
}

/**
 * Cheap additive lighting layered on top of the existing ambient + cast-shadow
 * system. It intentionally stays art-directed: a restrained global sunlight
 * pass, one soft directional sun bloom, and pooled local emissive glows.
 */
export class LightingEffectsSystem {
  private readonly scene: MainScene;
  private readonly sunlightOverlay: Phaser.GameObjects.Rectangle;
  private readonly sunGlow: Phaser.GameObjects.Image;
  private readonly bonfireLights = new Map<Phaser.GameObjects.GameObject, BonfireLight>();
  private readonly generatedTextureKeys: string[] = [];
  private lastBonfireSync = Number.NEGATIVE_INFINITY;
  private destroyed = false;

  constructor(scene: MainScene) {
    this.scene = scene;
    this.createGlowTexture();

    this.sunlightOverlay = scene.add
      .rectangle(0, 0, 1, 1, 0xffffff, 0)
      .setOrigin(0, 0)
      .setScrollFactor(1)
      .setBlendMode(Phaser.BlendModes.SCREEN)
      .setDepth(SUNLIGHT_DEPTH);

    this.sunGlow = scene.add
      .image(0, 0, LIGHT_GLOW_KEY)
      .setBlendMode(Phaser.BlendModes.SCREEN)
      .setDepth(SUN_GLOW_DEPTH)
      .setAlpha(0);

    scene.worldLayer.add(this.sunlightOverlay);
    scene.worldLayer.add(this.sunGlow);

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
    const camera = this.scene.cameras.main;
    const zoom = Math.max(0.01, camera.zoom);
    const padding = 6 / zoom;
    const view = camera.worldView;
    const style = calculateSunlightStyle(state.hour, state.sunIntensity, state.sunElevation);

    this.sunlightOverlay
      .setPosition(view.left - padding, view.top - padding)
      .setDisplaySize(view.width + padding * 2, view.height + padding * 2)
      .setFillStyle(style.color, style.overlayAlpha);

    const centerX = view.left + view.width * 0.5;
    const directionX = Math.cos(state.sunAzimuthRad);
    const lowSunDrop = (1 - state.sunElevation) * view.height * 0.16;
    const glowX = centerX + directionX * view.width * 0.47;
    const glowY = view.top + view.height * 0.09 + lowSunDrop;

    this.sunGlow
      .setPosition(glowX, glowY)
      .setDisplaySize(view.width * 0.95, view.height * 0.78)
      .setTint(style.color)
      .setAlpha(style.glowAlpha);
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
    this.sunlightOverlay.setVisible(visible);
    this.sunGlow.setVisible(visible);
    for (const light of this.bonfireLights.values()) light.image.setVisible(visible);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);

    this.sunlightOverlay.destroy();
    this.sunGlow.destroy();
    for (const light of this.bonfireLights.values()) light.image.destroy();
    this.bonfireLights.clear();

    for (const textureKey of this.generatedTextureKeys) {
      if (this.scene.textures.exists(textureKey)) this.scene.textures.remove(textureKey);
    }
  }
}
