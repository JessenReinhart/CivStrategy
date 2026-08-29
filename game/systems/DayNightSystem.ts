import Phaser from 'phaser';

import { MainScene } from '../MainScene';
import { BuildingDef } from '../../types';
import { BUILDING_SPRITE_VISUALS } from './BuildingSpriteVisuals';
import {
  calculateDayNightState,
  DayNightState,
  SHADOW_REFRESH_INTERVAL_MS,
  shouldRefreshDayNightShadows,
} from './dayNightMath';
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
 * Building cast shadows deliberately use the painted foundation's broad left
 * and right corners as a stable root, then shear that edge along the solar
 * direction. The fake stays visually consistent with the isometric art instead
 * of rotating the shadow root with the sun and collapsing into diamond blobs.
 */
export class DayNightSystem {
  private readonly scene: MainScene;
  private readonly shadowBuffers: readonly [ShadowBuffer, ShadowBuffer];
  private readonly ambientOverlay: Phaser.GameObjects.Rectangle;
  private readonly generatedTextureKeys: string[] = [];
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

    const firstBuffer = this.createShadowBuffer(0);
    const secondBuffer = this.createShadowBuffer(1);
    this.shadowBuffers = [firstBuffer, secondBuffer];

    this.ambientOverlay = scene.add
      .rectangle(0, 0, 1, 1, this.currentState.ambientColor, this.currentState.ambientAlpha)
      .setOrigin(0, 0)
      .setScrollFactor(0)
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

  /** Called by MainScene after serialized gameTime advances. */
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
    const inverseZoom = 1 / Math.max(0.01, camera.zoom);
    this.ambientOverlay.setPosition(-2 * inverseZoom, -2 * inverseZoom);
    this.ambientOverlay.setDisplaySize(
      (camera.width + 4) * inverseZoom,
      (camera.height + 4) * inverseZoom,
    );
    this.ambientOverlay.setFillStyle(state.ambientColor, state.ambientAlpha);
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

      const shadowBase = this.resolveBuildingShadowBase(
        visual,
        def,
        config.scaleMultiplier,
        config.shadowFootprintScale,
        config.shadowFootprintDepthScale,
        config.shadowAnchorOffsetY,
      );

      this.stampContact(
        buffer,
        layout,
        shadowBase.centerX,
        shadowBase.centerY + 1,
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
      const minimumVisibleLength = Math.min(
        150,
        shadowBase.contactWidth * config.shadowHeightScale * 1.5,
      );

      this.stampBuildingProjection(
        buffer,
        layout,
        shadowBase,
        projection,
        minimumVisibleLength,
        state.shadowAlpha * visual.alpha,
        config.shadowEndWidthScale,
      );
      this.lastStampedBuildingSilhouettes++;
      this.lastDrawnBuildings++;
    }
  }

  private resolveBuildingShadowBase(
    visual: Phaser.GameObjects.Container,
    def: BuildingDef,
    scaleMultiplier: number,
    footprintScale: number,
    footprintDepthScale: number,
    anchorOffsetY: number,
  ): BuildingShadowBase {
    const renderedSpriteWidth = Math.max(16, def.width * scaleMultiplier);
    const footprintWidth = Math.max(12, renderedSpriteWidth * footprintScale);
    const footprintDepth = Math.max(8, footprintWidth * footprintDepthScale);
    const halfWidth = footprintWidth * 0.5;
    const centerX = visual.x;
    const centerY = visual.y + anchorOffsetY;

    return {
      startA: { x: centerX - halfWidth, y: centerY },
      startB: { x: centerX + halfWidth, y: centerY },
      centerX,
      centerY,
      contactWidth: footprintWidth,
      contactHeight: Math.max(5, footprintDepth * 0.42),
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
    minimumVisibleLength: number,
    alpha: number,
    endWidthScale: number,
  ): void {
    if (projection.length <= 0 || alpha <= 0) return;

    const startCenterX = shadowBase.centerX;
    const startCenterY = shadowBase.centerY;
    const effectiveLength = Math.max(projection.length, minimumVisibleLength);
    const endCenterX = startCenterX + projection.directionX * effectiveLength;
    const endCenterY = startCenterY + projection.directionY * effectiveLength;
    const edgeDx = shadowBase.startB.x - shadowBase.startA.x;
    const edgeDy = shadowBase.startB.y - shadowBase.startA.y;
    const endHalfDx = edgeDx * 0.5 * endWidthScale;
    const endHalfDy = edgeDy * 0.5 * endWidthScale;

    const endA = {
      x: endCenterX - endHalfDx,
      y: endCenterY - endHalfDy,
    };
    const endB = {
      x: endCenterX + endHalfDx,
      y: endCenterY + endHalfDy,
    };

    this.fillGradientGroundPolygon(
      buffer,
      layout,
      [shadowBase.startA, shadowBase.startB, endB, endA],
      { x: startCenterX, y: startCenterY },
      { x: endCenterX, y: endCenterY },
      alpha,
    );
  }

  private fillGradientGroundPolygon(
    buffer: ShadowBuffer,
    layout: ShadowBufferLayout,
    points: readonly { x: number; y: number }[],
    gradientStart: { x: number; y: number },
    gradientEnd: { x: number; y: number },
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
