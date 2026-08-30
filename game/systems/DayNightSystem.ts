import Phaser from 'phaser';

import { MainScene } from '../MainScene';
import { BuildingDef } from '../../types';
import {
  BUILDING_SPRITE_VISUALS,
  type BuildingSpriteVisualConfig,
} from './BuildingSpriteVisuals';
import {
  calculateDayNightState,
  DayNightState,
  SHADOW_REFRESH_INTERVAL_MS,
  shouldRefreshDayNightShadows,
} from './dayNightMath';
import {
  detectShadowEmitterProfile,
  type ShadowEmitterProfile,
} from './shadowEmitterMath';
import { calculateShadowProjection } from './shadowProjectionMath';

const STATE_PUBLISH_INTERVAL_MS = 250;
const SHADOW_CROSSFADE_MS = SHADOW_REFRESH_INTERVAL_MS;
const SHADOW_DEPTH = -1800;
const AMBIENT_DEPTH = 19000;
const SHADOW_BUFFER_PADDING_PX = 192;
const SHADOW_BUFFER_RESOLUTION = 0.5;
const MIN_VISIBLE_SHADOW_ALPHA = 0.005;
const BUILDING_CONTACT_ALPHA = 0.20;
const TREE_CONTACT_ALPHA = 0.11;
const CONTACT_SHADOW_KEY = 'day-night-contact-shadow';
const SHADOW_BUFFER_PREFIX = 'day-night-shadow-buffer-';
const SHADOW_RGB = '8, 12, 18';

type BuildingWithVisual = Phaser.GameObjects.GameObject & {
  visual?: Phaser.GameObjects.Container;
};

interface ShadowBufferLayout {
  left: number;
  top: number;
  right: number;
  bottom: number;
  pixelsPerWorld: number;
}

interface ShadowBuffer {
  image: Phaser.GameObjects.Image;
  texture: Phaser.Textures.CanvasTexture;
}

interface ShadowPoint {
  x: number;
  y: number;
}

interface BuildingShadowBase {
  startA: ShadowPoint;
  startB: ShadowPoint;
  centerX: number;
  centerY: number;
  contactWidth: number;
  contactHeight: number;
}

export interface DayNightDiagnostics {
  readonly enabled: boolean;
  readonly shadowRefreshMs: number;
  readonly shadowRefreshCount: number;
  readonly totalShadowRenderMs: number;
  readonly averageShadowRenderMs: number;
  readonly lastShadowRenderMs: number;
  readonly maxShadowRenderMs: number;
  readonly minShadowRefreshGapMs: number;
  readonly lastShadowRefreshGapMs: number;
  readonly lastScannedBuildings: number;
  /** Number of buildings with a daylight cast shadow on the latest refresh. */
  readonly lastDrawnBuildings: number;
  readonly lastStampedBuildingSilhouettes: number;
  readonly lastStampedBuildingContacts: number;
  readonly lastScannedTreeVisuals: number;
  readonly lastStampedTreeContacts: number;
  readonly shadowBufferWidth: number;
  readonly shadowBufferHeight: number;
  readonly shadowBufferResolution: number;
  readonly lastShadowAngleRad: number;
  readonly lastShadowLength: number;
  readonly ambientColor: number;
  readonly ambientAlpha: number;
  readonly state: Readonly<DayNightState>;
  readonly uiCameraIgnoresAmbient: boolean;
  readonly uiCameraIgnoresShadows: boolean;
}

/**
 * Render-only day/night lighting for the isometric world.
 *
 * Each building texture is alpha-scanned once to find the widest useful row in
 * its ground-facing band. That asymmetric row becomes the fixed emitter line;
 * only the far edge moves with the solar projection. This matches the painted
 * sprite instead of assuming the shadow starts at centerX or at the PNG bottom.
 */
export class DayNightSystem {
  private readonly scene: MainScene;
  private readonly shadowBuffers: readonly [ShadowBuffer, ShadowBuffer];
  private readonly ambientOverlay: Phaser.GameObjects.Rectangle;
  private readonly generatedTextureKeys: string[] = [];
  private readonly shadowEmitterProfiles = new Map<string, ShadowEmitterProfile>();
  private currentBufferIndex = 0;
  private previousBufferIndex = 1;
  private crossfadeStartedAt = Number.NEGATIVE_INFINITY;
  private hasRenderedShadows = false;
  private lastShadowRefresh = Number.NEGATIVE_INFINITY;
  private lastStatePublish = Number.NEGATIVE_INFINITY;
  private currentState: Readonly<DayNightState>;
  private shadowRefreshCount = 0;
  private totalShadowRenderMs = 0;
  private lastShadowRenderMs = 0;
  private maxShadowRenderMs = 0;
  private minShadowRefreshGapMs = 0;
  private lastShadowRefreshGapMs = 0;
  private lastScannedBuildings = 0;
  private lastDrawnBuildings = 0;
  private lastStampedBuildingSilhouettes = 0;
  private lastStampedBuildingContacts = 0;
  private lastScannedTreeVisuals = 0;
  private lastStampedTreeContacts = 0;
  private shadowBufferWidth = 2;
  private shadowBufferHeight = 2;
  private destroyed = false;

  constructor(scene: MainScene) {
    this.scene = scene;
    this.currentState = this.createStateSnapshot(scene.gameTime);
    this.createContactShadowTexture();
    this.primeShadowEmitterProfiles();

    const firstBuffer = this.createShadowBuffer(0);
    const secondBuffer = this.createShadowBuffer(1);
    this.shadowBuffers = [firstBuffer, secondBuffer];

    this.ambientOverlay = scene.add
      .rectangle(0, 0, 1, 1, this.currentState.ambientColor, this.currentState.ambientAlpha)
      .setOrigin(0, 0)
      .setScrollFactor(1)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(AMBIENT_DEPTH);

    scene.worldLayer.add(firstBuffer.image);
    scene.worldLayer.add(secondBuffer.image);
    scene.worldLayer.add(this.ambientOverlay);

    const enabled = !scene.stressTestConfig;
    firstBuffer.image.setVisible(enabled);
    secondBuffer.image.setVisible(enabled);
    this.ambientOverlay.setVisible(enabled);

    scene.data.set('dayNightSystem', this);
    this.publishSnapshots();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  public getState(): Readonly<DayNightState> {
    return Object.freeze({ ...this.currentState });
  }

  public getDiagnostics(): Readonly<DayNightDiagnostics> {
    const uiCamera = this.scene.uiCamera;
    const worldLayerIgnored = Boolean(
      uiCamera && (this.scene.worldLayer.cameraFilter & uiCamera.id) !== 0,
    );
    const ambientIgnored = worldLayerIgnored || Boolean(
      uiCamera && (this.ambientOverlay.cameraFilter & uiCamera.id) !== 0,
    );
    const shadowsIgnored = worldLayerIgnored || Boolean(
      uiCamera && this.shadowBuffers.every(buffer => (buffer.image.cameraFilter & uiCamera.id) !== 0),
    );

    return Object.freeze({
      enabled: !this.scene.stressTestConfig,
      shadowRefreshMs: SHADOW_REFRESH_INTERVAL_MS,
      shadowRefreshCount: this.shadowRefreshCount,
      totalShadowRenderMs: this.totalShadowRenderMs,
      averageShadowRenderMs: this.shadowRefreshCount > 0
        ? this.totalShadowRenderMs / this.shadowRefreshCount
        : 0,
      lastShadowRenderMs: this.lastShadowRenderMs,
      maxShadowRenderMs: this.maxShadowRenderMs,
      minShadowRefreshGapMs: this.minShadowRefreshGapMs,
      lastShadowRefreshGapMs: this.lastShadowRefreshGapMs,
      lastScannedBuildings: this.lastScannedBuildings,
      lastDrawnBuildings: this.lastDrawnBuildings,
      lastStampedBuildingSilhouettes: this.lastStampedBuildingSilhouettes,
      lastStampedBuildingContacts: this.lastStampedBuildingContacts,
      lastScannedTreeVisuals: this.lastScannedTreeVisuals,
      lastStampedTreeContacts: this.lastStampedTreeContacts,
      shadowBufferWidth: this.shadowBufferWidth,
      shadowBufferHeight: this.shadowBufferHeight,
      shadowBufferResolution: SHADOW_BUFFER_RESOLUTION,
      lastShadowAngleRad: this.currentState.shadowAngleRad,
      lastShadowLength: this.currentState.shadowLength,
      ambientColor: this.currentState.ambientColor,
      ambientAlpha: this.currentState.ambientAlpha,
      state: this.getState(),
      uiCameraIgnoresAmbient: ambientIgnored,
      uiCameraIgnoresShadows: shadowsIgnored,
    });
  }

  /** Called by MainScene after serialized game time advances. */
  public update(sceneTimeMs: number, gameTimeMs: number): void {
    if (this.destroyed) return;

    if (this.scene.stressTestConfig) {
      this.setVisualsVisible(false);
      return;
    }

    this.setVisualsVisible(true);
    this.currentState = this.createStateSnapshot(gameTimeMs);
    this.updateAmbientOverlay(this.currentState);
    this.updateShadowCrossfade(sceneTimeMs);

    if (shouldRefreshDayNightShadows(sceneTimeMs, this.lastShadowRefresh)) {
      this.recordRefreshGap(sceneTimeMs);
      this.lastShadowRefresh = sceneTimeMs;
      this.redrawShadows(this.currentState, sceneTimeMs);
    }

    if (
      this.lastStatePublish === Number.NEGATIVE_INFINITY
      || sceneTimeMs - this.lastStatePublish >= STATE_PUBLISH_INTERVAL_MS
    ) {
      this.lastStatePublish = sceneTimeMs;
      this.publishSnapshots();
    }
  }

  private createStateSnapshot(gameTimeMs: number): Readonly<DayNightState> {
    return Object.freeze({ ...calculateDayNightState(gameTimeMs) });
  }

  private emitterCacheKey(config: BuildingSpriteVisualConfig): string {
    const band = config.shadowEmitterScanBand;
    return `${config.key}:${band.minYNorm}:${band.maxYNorm}`;
  }

  private primeShadowEmitterProfiles(): void {
    for (const config of Object.values(BUILDING_SPRITE_VISUALS)) {
      this.getShadowEmitterProfile(config);
    }
  }

  private getShadowEmitterProfile(config: BuildingSpriteVisualConfig): ShadowEmitterProfile {
    if (config.shadowEmitterOverride) return config.shadowEmitterOverride;

    const cacheKey = this.emitterCacheKey(config);
    const cached = this.shadowEmitterProfiles.get(cacheKey);
    if (cached) return cached;

    const detected = this.detectEmitterFromTexture(config);
    const profile = detected ?? this.createEmitterFallback(config);
    this.shadowEmitterProfiles.set(cacheKey, profile);
    return profile;
  }

  private detectEmitterFromTexture(config: BuildingSpriteVisualConfig): ShadowEmitterProfile | null {
    if (!this.scene.textures.exists(config.key)) return null;

    const texture = this.scene.textures.get(config.key);
    const frame = texture.get();
    const width = Math.max(1, Math.round(frame.cutWidth));
    const height = Math.max(1, Math.round(frame.cutHeight));
    const source = frame.source.image as CanvasImageSource;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;

      context.clearRect(0, 0, width, height);
      context.drawImage(
        source,
        frame.cutX,
        frame.cutY,
        frame.cutWidth,
        frame.cutHeight,
        0,
        0,
        width,
        height,
      );
      const rgba = context.getImageData(0, 0, width, height).data;
      return detectShadowEmitterProfile(rgba, width, height, {
        ...config.shadowEmitterScanBand,
        alphaThreshold: 24,
        minSpanNorm: 0.18,
      });
    } catch {
      return null;
    }
  }

  private createEmitterFallback(config: BuildingSpriteVisualConfig): ShadowEmitterProfile {
    const { minYNorm, maxYNorm } = config.shadowEmitterScanBand;
    return {
      leftNorm: 0.02,
      rightNorm: 0.98,
      yNorm: (minYNorm + maxYNorm) * 0.5,
    };
  }

  private createShadowBuffer(index: number): ShadowBuffer {
    const key = `${SHADOW_BUFFER_PREFIX}${index}`;
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const texture = this.scene.textures.createCanvas(key, 2, 2);
    if (!texture) throw new Error(`Unable to create shadow buffer texture: ${key}`);
    this.generatedTextureKeys.push(key);

    const image = this.scene.add.image(0, 0, key)
      .setOrigin(0, 0)
      .setDepth(SHADOW_DEPTH)
      .setBlendMode(Phaser.BlendModes.NORMAL)
      .setAlpha(0);

    return { image, texture };
  }

  private createContactShadowTexture(): void {
    if (this.scene.textures.exists(CONTACT_SHADOW_KEY)) return;

    const width = 128;
    const height = 64;
    const canvas = this.scene.textures.createCanvas(CONTACT_SHADOW_KEY, width, height);
    if (!canvas) return;

    const ctx = canvas.context;
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 2, width / 2, height / 2, width / 2);
    gradient.addColorStop(0, 'rgba(8, 12, 18, 0.88)');
    gradient.addColorStop(0.42, 'rgba(8, 12, 18, 0.46)');
    gradient.addColorStop(1, 'rgba(8, 12, 18, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    canvas.refresh();
    this.generatedTextureKeys.push(CONTACT_SHADOW_KEY);
  }

  private setVisualsVisible(visible: boolean): void {
    this.ambientOverlay.setVisible(visible);
    this.shadowBuffers[0].image.setVisible(visible);
    this.shadowBuffers[1].image.setVisible(visible);
  }

  private updateAmbientOverlay(state: Readonly<DayNightState>): void {
    const camera = this.scene.cameras.main;
    const zoom = Math.max(0.01, camera.zoom);
    const padding = 4 / zoom;
    const worldView = camera.worldView;

    this.ambientOverlay
      .setPosition(worldView.left - padding, worldView.top - padding)
      .setDisplaySize(worldView.width + padding * 2, worldView.height + padding * 2)
      .setFillStyle(state.ambientColor, state.ambientAlpha);
  }

  private updateShadowCrossfade(sceneTimeMs: number): void {
    if (!this.hasRenderedShadows || this.crossfadeStartedAt === Number.NEGATIVE_INFINITY) return;

    const progress = Phaser.Math.Clamp(
      (sceneTimeMs - this.crossfadeStartedAt) / SHADOW_CROSSFADE_MS,
      0,
      1,
    );
    this.shadowBuffers[this.currentBufferIndex].image.setAlpha(progress);
    this.shadowBuffers[this.previousBufferIndex].image.setAlpha(1 - progress);

    if (progress >= 1) {
      this.shadowBuffers[this.previousBufferIndex].image.setAlpha(0);
      this.crossfadeStartedAt = Number.NEGATIVE_INFINITY;
    }
  }

  private recordRefreshGap(sceneTimeMs: number): void {
    if (this.lastShadowRefresh === Number.NEGATIVE_INFINITY) return;
    const gap = sceneTimeMs - this.lastShadowRefresh;
    this.lastShadowRefreshGapMs = gap;
    this.minShadowRefreshGapMs = this.minShadowRefreshGapMs === 0
      ? gap
      : Math.min(this.minShadowRefreshGapMs, gap);
  }

  private redrawShadows(state: Readonly<DayNightState>, sceneTimeMs: number): void {
    const startedAt = performance.now();
    const nextBufferIndex = this.hasRenderedShadows ? 1 - this.currentBufferIndex : this.currentBufferIndex;
    const nextBuffer = this.shadowBuffers[nextBufferIndex];
    const layout = this.layoutShadowBuffer(nextBuffer);
    const ctx = nextBuffer.texture.context;

    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillRect(0, 0, nextBuffer.texture.width, nextBuffer.texture.height);
    ctx.restore();

    this.lastScannedBuildings = this.scene.buildings.getLength();
    this.lastDrawnBuildings = 0;
    this.lastStampedBuildingSilhouettes = 0;
    this.lastStampedBuildingContacts = 0;
    this.lastScannedTreeVisuals = 0;
    this.lastStampedTreeContacts = 0;

    this.drawBuildingShadows(nextBuffer, layout, state);
    this.drawTreeContacts(nextBuffer, layout);
    nextBuffer.texture.refresh();

    this.shadowRefreshCount++;
    const elapsed = performance.now() - startedAt;
    this.lastShadowRenderMs = elapsed;
    this.totalShadowRenderMs += elapsed;
    this.maxShadowRenderMs = Math.max(this.maxShadowRenderMs, elapsed);

    if (!this.hasRenderedShadows) {
      this.hasRenderedShadows = true;
      this.currentBufferIndex = nextBufferIndex;
      this.previousBufferIndex = 1 - nextBufferIndex;
      nextBuffer.image.setAlpha(1);
      this.shadowBuffers[this.previousBufferIndex].image.setAlpha(0);
      return;
    }

    this.previousBufferIndex = this.currentBufferIndex;
    this.currentBufferIndex = nextBufferIndex;
    this.shadowBuffers[this.currentBufferIndex].image.setAlpha(0);
    this.shadowBuffers[this.previousBufferIndex].image.setAlpha(1);
    this.crossfadeStartedAt = sceneTimeMs;
  }

  private layoutShadowBuffer(buffer: ShadowBuffer): ShadowBufferLayout {
    const camera = this.scene.cameras.main;
    const zoom = Math.max(0.01, camera.zoom);
    const worldPadding = SHADOW_BUFFER_PADDING_PX / zoom;
    const worldWidth = camera.width / zoom + worldPadding * 2;
    const worldHeight = camera.height / zoom + worldPadding * 2;
    const width = Math.max(
      2,
      Math.ceil((camera.width + SHADOW_BUFFER_PADDING_PX * 2) * SHADOW_BUFFER_RESOLUTION),
    );
    const height = Math.max(
      2,
      Math.ceil((camera.height + SHADOW_BUFFER_PADDING_PX * 2) * SHADOW_BUFFER_RESOLUTION),
    );

    if (buffer.texture.width !== width || buffer.texture.height !== height) {
      buffer.texture.setSize(width, height);
    }

    const left = camera.worldView.left - worldPadding;
    const top = camera.worldView.top - worldPadding;
    buffer.image.setPosition(left, top).setDisplaySize(worldWidth, worldHeight);
    this.shadowBufferWidth = width;
    this.shadowBufferHeight = height;

    return {
      left,
      top,
      right: left + worldWidth,
      bottom: top + worldHeight,
      pixelsPerWorld: zoom * SHADOW_BUFFER_RESOLUTION,
    };
  }

  private drawBuildingShadows(
    buffer: ShadowBuffer,
    layout: ShadowBufferLayout,
    state: Readonly<DayNightState>,
  ): void {
    for (const building of this.scene.buildings.getChildren()) {
      if (!building.active || building.getData('hp') <= 0) continue;

      const visual = (building as BuildingWithVisual).visual;
      if (!visual?.active || !visual.visible || visual.alpha <= 0.01) continue;
      if (!this.contains(layout, visual.x, visual.y)) continue;

      const def = building.getData('def') as BuildingDef | undefined;
      if (!def) continue;

      const config = BUILDING_SPRITE_VISUALS[def.type];
      if (!config) continue;
      const sprite = this.findBuildingSprite(visual, config.key);
      if (!sprite) continue;

      const profile = this.getShadowEmitterProfile(config);
      const shadowBase = this.resolveBuildingShadowBase(visual, sprite, profile);

      this.stampContact(
        buffer,
        layout,
        shadowBase.centerX,
        shadowBase.centerY + 2,
        shadowBase.contactWidth,
        shadowBase.contactHeight,
        BUILDING_CONTACT_ALPHA * visual.alpha,
      );
      this.lastStampedBuildingContacts++;

      if (state.shadowAlpha <= MIN_VISIBLE_SHADOW_ALPHA || state.shadowLength <= 0) continue;

      const projection = calculateShadowProjection({
        shadowAngleRad: state.shadowAngleRad,
        shadowLength: state.shadowLength,
        shadowHeightScale: config.shadowHeightScale,
      });

      this.stampBuildingProjection(
        buffer,
        layout,
        shadowBase,
        projection,
        state.shadowAlpha * visual.alpha,
        config.shadowEndWidthScale,
      );
      this.lastStampedBuildingSilhouettes++;
      this.lastDrawnBuildings++;
    }
  }

  private findBuildingSprite(
    visual: Phaser.GameObjects.Container,
    textureKey: string,
  ): Phaser.GameObjects.Image | null {
    for (const child of visual.list) {
      if (child instanceof Phaser.GameObjects.Image && child.texture.key === textureKey) {
        return child;
      }
    }
    return null;
  }

  private resolveBuildingShadowBase(
    visual: Phaser.GameObjects.Container,
    sprite: Phaser.GameObjects.Image,
    profile: ShadowEmitterProfile,
  ): BuildingShadowBase {
    let leftNorm = profile.leftNorm;
    let rightNorm = profile.rightNorm;
    if (sprite.flipX) {
      leftNorm = 1 - profile.rightNorm;
      rightNorm = 1 - profile.leftNorm;
    }

    const displayWidth = Math.abs(sprite.displayWidth);
    const displayHeight = Math.abs(sprite.displayHeight);
    const localLeft = sprite.x - displayWidth * sprite.originX;
    const localTop = sprite.y - displayHeight * sprite.originY;
    const emitterY = visual.y + localTop + profile.yNorm * displayHeight;
    const startAX = visual.x + localLeft + leftNorm * displayWidth;
    const startBX = visual.x + localLeft + rightNorm * displayWidth;
    const startA = { x: Math.min(startAX, startBX), y: emitterY };
    const startB = { x: Math.max(startAX, startBX), y: emitterY };
    const centerX = (startA.x + startB.x) * 0.5;
    const width = Math.max(8, startB.x - startA.x);

    return {
      startA,
      startB,
      centerX,
      centerY: emitterY,
      contactWidth: width,
      contactHeight: Math.max(5, displayHeight * 0.055),
    };
  }

  private drawTreeContacts(buffer: ShadowBuffer, layout: ShadowBufferLayout): void {
    const visuals = this.scene.treeVisuals.getChildren() as Phaser.GameObjects.Image[];
    for (const visual of visuals) {
      this.lastScannedTreeVisuals++;
      if (!visual.active || !visual.visible || visual.alpha <= 0.01) continue;
      if (visual.texture.key !== 'tree' && visual.texture.key !== 'stump') continue;
      if (!this.contains(layout, visual.x, visual.y)) continue;

      const width = Math.max(12, visual.displayWidth * 0.65);
      this.stampContact(
        buffer,
        layout,
        visual.x,
        visual.y + 2,
        width,
        width * 0.24,
        TREE_CONTACT_ALPHA * visual.alpha,
      );
      this.lastStampedTreeContacts++;
    }
  }

  private stampBuildingProjection(
    buffer: ShadowBuffer,
    layout: ShadowBufferLayout,
    shadowBase: BuildingShadowBase,
    projection: ReturnType<typeof calculateShadowProjection>,
    alpha: number,
    endWidthScale: number,
  ): void {
    if (projection.length <= 0 || alpha <= 0) return;

    const endCenterX = shadowBase.centerX + projection.directionX * projection.length;
    const endCenterY = shadowBase.centerY + projection.directionY * projection.length;
    const edgeDx = shadowBase.startB.x - shadowBase.startA.x;
    const edgeDy = shadowBase.startB.y - shadowBase.startA.y;
    const endHalfDx = edgeDx * 0.5 * endWidthScale;
    const endHalfDy = edgeDy * 0.5 * endWidthScale;
    const endA = { x: endCenterX - endHalfDx, y: endCenterY - endHalfDy };
    const endB = { x: endCenterX + endHalfDx, y: endCenterY + endHalfDy };

    this.fillGradientGroundPolygon(
      buffer,
      layout,
      [shadowBase.startA, shadowBase.startB, endB, endA],
      { x: shadowBase.centerX, y: shadowBase.centerY },
      { x: endCenterX, y: endCenterY },
      alpha,
    );
  }

  private fillGradientGroundPolygon(
    buffer: ShadowBuffer,
    layout: ShadowBufferLayout,
    points: readonly ShadowPoint[],
    gradientStart: ShadowPoint,
    gradientEnd: ShadowPoint,
    alpha: number,
  ): void {
    if (alpha <= 0 || points.length < 3) return;

    const ctx = buffer.texture.context;
    const toBufferX = (worldX: number) => (worldX - layout.left) * layout.pixelsPerWorld;
    const toBufferY = (worldY: number) => (worldY - layout.top) * layout.pixelsPerWorld;
    const startX = toBufferX(gradientStart.x);
    const startY = toBufferY(gradientStart.y);
    const endX = toBufferX(gradientEnd.x);
    const endY = toBufferY(gradientEnd.y);
    const rootAlpha = Phaser.Math.Clamp(alpha * 1.45, 0, 0.72);
    const dx = endX - startX;
    const dy = endY - startY;
    const gradientLength2 = dx * dx + dy * dy;

    ctx.save();
    ctx.globalAlpha = 1;

    if (gradientLength2 > 0.001) {
      const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
      gradient.addColorStop(0, `rgba(${SHADOW_RGB}, ${rootAlpha})`);
      gradient.addColorStop(0.22, `rgba(${SHADOW_RGB}, ${rootAlpha * 0.92})`);
      gradient.addColorStop(0.52, `rgba(${SHADOW_RGB}, ${rootAlpha * 0.68})`);
      gradient.addColorStop(0.82, `rgba(${SHADOW_RGB}, ${rootAlpha * 0.22})`);
      gradient.addColorStop(1, `rgba(${SHADOW_RGB}, 0)`);
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = `rgba(${SHADOW_RGB}, ${rootAlpha})`;
    }

    ctx.beginPath();
    ctx.moveTo(toBufferX(points[0].x), toBufferY(points[0].y));
    for (let index = 1; index < points.length; index++) {
      ctx.lineTo(toBufferX(points[index].x), toBufferY(points[index].y));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private stampContact(
    buffer: ShadowBuffer,
    layout: ShadowBufferLayout,
    worldX: number,
    worldY: number,
    width: number,
    height: number,
    alpha: number,
  ): void {
    if (alpha <= 0 || !this.scene.textures.exists(CONTACT_SHADOW_KEY)) return;

    const source = this.scene.textures
      .get(CONTACT_SHADOW_KEY)
      .getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const ctx = buffer.texture.context;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(
      (worldX - layout.left) * layout.pixelsPerWorld,
      (worldY - layout.top) * layout.pixelsPerWorld,
    );
    ctx.scale(
      (width / source.width) * layout.pixelsPerWorld,
      (height / source.height) * layout.pixelsPerWorld,
    );
    ctx.drawImage(source, -source.width * 0.5, -source.height * 0.5);
    ctx.restore();
  }

  private contains(layout: ShadowBufferLayout, x: number, y: number): boolean {
    return x >= layout.left && x <= layout.right && y >= layout.top && y <= layout.bottom;
  }

  private publishSnapshots(): void {
    this.scene.data.set('dayNightState', this.getState());
    this.scene.data.set('dayNightDiagnostics', this.getDiagnostics());
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.shadowBuffers[0].image.destroy();
    this.shadowBuffers[1].image.destroy();
    this.ambientOverlay.destroy();
    this.shadowEmitterProfiles.clear();

    for (const textureKey of this.generatedTextureKeys) {
      if (this.scene.textures.exists(textureKey)) this.scene.textures.remove(textureKey);
    }

    if (this.scene.data.get('dayNightSystem') === this) {
      this.scene.data.remove('dayNightSystem');
      this.scene.data.remove('dayNightState');
      this.scene.data.remove('dayNightDiagnostics');
    }
  }
}
