import Phaser from 'phaser';

import { BuildingType } from '../../types';
import { MainScene } from '../MainScene';
import { calculateLocalLightAlpha, calculateSunlightStyle } from './lightingMath';

// Ambient sits at depth 19000 in DayNightSystem. These world-space passes sit
// above it so terrain, water, vegetation, units and buildings all receive the
// same art-directed sunlight pattern.
const SUN_SHADE_DEPTH = 19020;
const SUNLIGHT_DEPTH = 19030;
const LOCAL_LIGHT_DEPTH = 19100;
const LIGHT_GLOW_KEY = 'day-night-light-glow';
const SUN_BANDS_KEY = 'day-night-sun-bands';
const SUN_GAPS_KEY = 'day-night-sun-gaps';
const BONFIRE_SYNC_INTERVAL_MS = 250;
const SUN_SHADE_COLOR = 0x66758f;

type BuildingWithVisual = Phaser.GameObjects.GameObject & {
  visual?: Phaser.GameObjects.Container;
};

interface BonfireLight {
  readonly image: Phaser.GameObjects.Image;
  readonly seed: number;
}

interface SoftBand {
  readonly center: number;
  readonly halfWidth: number;
  readonly peak: number;
}

/**
 * Cheap art-directed world lighting layered after ambient + cast shadows.
 *
 * Instead of a full-screen exposure wash, direct sun is represented by several
 * broad, soft, parallel shafts. The shafts rotate with the solar axis and cover
 * the entire visible world, so terrain and sprites are lit together. Cooler
 * multiply bands fill the gaps to preserve the dramatic light/shade separation
 * from the visual target without requiring normal maps or a custom shader.
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
    this.createDirectionalTextures();

    this.directionalShade = scene.add
      .image(0, 0, SUN_GAPS_KEY)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(SUN_SHADE_DEPTH)
      .setTint(SUN_SHADE_COLOR)
      .setAlpha(0);

    this.directionalLight = scene.add
      .image(0, 0, SUN_BANDS_KEY)
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

  private createDirectionalTextures(): void {
    const size = 1024;

    if (!this.scene.textures.exists(SUN_BANDS_KEY)) {
      const canvas = this.scene.textures.createCanvas(SUN_BANDS_KEY, size, size);
      if (!canvas) throw new Error(`Unable to create lighting texture: ${SUN_BANDS_KEY}`);

      this.paintSoftBands(canvas.context, size, [
        { center: 0.10, halfWidth: 0.095, peak: 0.88 },
        { center: 0.34, halfWidth: 0.115, peak: 0.74 },
        { center: 0.61, halfWidth: 0.135, peak: 0.92 },
        { center: 0.88, halfWidth: 0.09, peak: 0.78 },
      ]);
      canvas.refresh();
      this.generatedTextureKeys.push(SUN_BANDS_KEY);
    }

    if (!this.scene.textures.exists(SUN_GAPS_KEY)) {
      const canvas = this.scene.textures.createCanvas(SUN_GAPS_KEY, size, size);
      if (!canvas) throw new Error(`Unable to create lighting texture: ${SUN_GAPS_KEY}`);

      this.paintSoftBands(canvas.context, size, [
        { center: 0.22, halfWidth: 0.075, peak: 0.68 },
        { center: 0.48, halfWidth: 0.085, peak: 0.58 },
        { center: 0.75, halfWidth: 0.085, peak: 0.70 },
        { center: 0.985, halfWidth: 0.06, peak: 0.56 },
      ]);
      canvas.refresh();
      this.generatedTextureKeys.push(SUN_GAPS_KEY);
    }
  }

  private paintSoftBands(
    ctx: CanvasRenderingContext2D,
    size: number,
    bands: readonly SoftBand[],
  ): void {
    ctx.clearRect(0, 0, size, size);

    for (const band of bands) {
      const center = band.center * size;
      const halfWidth = band.halfWidth * size;
      const left = center - halfWidth;
      const right = center + halfWidth;
      const gradient = ctx.createLinearGradient(left, 0, right, 0);

      gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
      gradient.addColorStop(0.18, `rgba(255, 255, 255, ${band.peak * 0.26})`);
      gradient.addColorStop(0.38, `rgba(255, 255, 255, ${band.peak * 0.72})`);
      gradient.addColorStop(0.5, `rgba(255, 255, 255, ${band.peak})`);
      gradient.addColorStop(0.64, `rgba(255, 255, 255, ${band.peak * 0.76})`);
      gradient.addColorStop(0.84, `rgba(255, 255, 255, ${band.peak * 0.24})`);
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(Math.max(0, left), 0, Math.min(size, right) - Math.max(0, left), size);
    }
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

    // The texture is deliberately much larger than the rotated viewport so its
    // edges never become visible while zooming or panning. Local Y is aligned to
    // the sun/shadow axis, leaving the bright lanes elongated along the rays.
    const fieldSize = diagonal * 1.9;
    const bandRotation = state.shadowAngleRad - Math.PI * 0.5;

    // A tiny deterministic phase shift prevents the lighting pattern from feeling
    // glued to the camera while remaining slow enough to read as moving sunlight.
    const phase = Math.sin(state.normalizedDay * Math.PI * 2) * diagonal * 0.055;
    const phaseX = Math.cos(bandRotation) * phase;
    const phaseY = Math.sin(bandRotation) * phase;

    this.directionalLight
      .setPosition(centerX + phaseX, centerY + phaseY)
      .setDisplaySize(fieldSize, fieldSize)
      .setRotation(bandRotation)
      .setTint(style.color)
      .setAlpha(style.directionalAlpha);

    this.directionalShade
      .setPosition(centerX + phaseX, centerY + phaseY)
      .setDisplaySize(fieldSize, fieldSize)
      .setRotation(bandRotation)
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
