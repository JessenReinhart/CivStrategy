import Phaser from 'phaser';

import { MainScene } from '../MainScene';
import {
  calculateDayNightState,
  DayNightState,
  SHADOW_REFRESH_INTERVAL_MS,
  shouldRefreshDayNightShadows,
} from './dayNightMath';

const STATE_PUBLISH_INTERVAL_MS = 250;
const SHADOW_CROSSFADE_MS = SHADOW_REFRESH_INTERVAL_MS;
const SHADOW_DEPTH = -1800;
const AMBIENT_DEPTH = 19000;
const VIEW_PADDING = 260;
const MIN_VISIBLE_SHADOW_ALPHA = 0.005;

interface ShadowBuildingDef {
  width: number;
  height: number;
}

type BuildingWithVisual = Phaser.GameObjects.GameObject & {
  visual?: Phaser.GameObjects.Container;
};

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
  readonly lastDrawnBuildings: number;
  readonly lastShadowAngleRad: number;
  readonly lastShadowLength: number;
  readonly ambientColor: number;
  readonly ambientAlpha: number;
  readonly state: Readonly<DayNightState>;
  readonly uiCameraIgnoresAmbient: boolean;
  readonly uiCameraIgnoresShadows: boolean;
}

/**
 * Lightweight, render-only day/night lighting for the isometric world.
 *
 * Ambient lighting is one camera-sized overlay. Building shadows are rebuilt
 * into alternating Graphics buffers no more than five times per second, then
 * crossfaded per frame so solar movement remains continuous without allocating
 * one display object per building.
 */
export class DayNightSystem {
  private readonly scene: MainScene;
  private readonly shadowBuffers: readonly [
    Phaser.GameObjects.Graphics,
    Phaser.GameObjects.Graphics,
  ];
  private readonly ambientOverlay: Phaser.GameObjects.Rectangle;
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
  private destroyed = false;

  constructor(scene: MainScene) {
    this.scene = scene;
    this.currentState = this.createStateSnapshot(scene.gameTime);

    const firstBuffer = scene.add.graphics().setDepth(SHADOW_DEPTH).setAlpha(0);
    const secondBuffer = scene.add.graphics().setDepth(SHADOW_DEPTH).setAlpha(0);
    this.shadowBuffers = [firstBuffer, secondBuffer];
    this.ambientOverlay = scene.add
      .rectangle(0, 0, 1, 1, this.currentState.ambientColor, this.currentState.ambientAlpha)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(AMBIENT_DEPTH);

    scene.worldLayer.add(firstBuffer);
    scene.worldLayer.add(secondBuffer);
    scene.worldLayer.add(this.ambientOverlay);

    const enabled = !scene.stressTestConfig;
    firstBuffer.setVisible(enabled);
    secondBuffer.setVisible(enabled);
    this.ambientOverlay.setVisible(enabled);

    scene.data.set('dayNightSystem', this);
    this.publishSnapshots();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Returns a detached, frozen snapshot suitable for UI and test consumers. */
  public getState(): Readonly<DayNightState> {
    return Object.freeze({ ...this.currentState });
  }

  /** Returns a detached, frozen diagnostics snapshot. */
  public getDiagnostics(): Readonly<DayNightDiagnostics> {
    const uiCamera = this.scene.uiCamera;
    const worldLayerIgnored = Boolean(
      uiCamera && (this.scene.worldLayer.cameraFilter & uiCamera.id) !== 0,
    );
    const ambientIgnored = worldLayerIgnored || Boolean(
      uiCamera && (this.ambientOverlay.cameraFilter & uiCamera.id) !== 0,
    );
    const shadowsIgnored = worldLayerIgnored || Boolean(
      uiCamera && this.shadowBuffers.every(buffer => (buffer.cameraFilter & uiCamera.id) !== 0),
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
      lastShadowAngleRad: this.currentState.shadowAngleRad,
      lastShadowLength: this.currentState.shadowLength,
      ambientColor: this.currentState.ambientColor,
      ambientAlpha: this.currentState.ambientAlpha,
      state: this.getState(),
      uiCameraIgnoresAmbient: ambientIgnored,
      uiCameraIgnoresShadows: shadowsIgnored,
    });
  }

  /** Called by MainScene immediately after serialized gameTime advances. */
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
      this.redrawBuildingShadows(this.currentState, sceneTimeMs);
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

  private setVisualsVisible(visible: boolean): void {
    this.ambientOverlay.setVisible(visible);
    this.shadowBuffers[0].setVisible(visible);
    this.shadowBuffers[1].setVisible(visible);
  }

  private updateAmbientOverlay(state: Readonly<DayNightState>): void {
    const camera = this.scene.cameras.main;
    const inverseZoom = 1 / Math.max(0.01, camera.zoom);

    // Scroll factor zero fixes the rectangle to the main camera. Countering
    // zoom keeps it viewport-sized while leaving the UI camera unaffected.
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
    this.shadowBuffers[this.currentBufferIndex].setAlpha(progress);
    this.shadowBuffers[this.previousBufferIndex].setAlpha(1 - progress);

    if (progress >= 1) {
      this.shadowBuffers[this.previousBufferIndex].setAlpha(0);
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

  private redrawBuildingShadows(state: Readonly<DayNightState>, sceneTimeMs: number): void {
    const startedAt = performance.now();
    const nextBufferIndex = this.hasRenderedShadows ? 1 - this.currentBufferIndex : this.currentBufferIndex;
    const nextBuffer = this.shadowBuffers[nextBufferIndex];
    nextBuffer.clear();

    const buildings = this.scene.buildings.getChildren();
    this.lastScannedBuildings = buildings.length;
    this.lastDrawnBuildings = 0;

    if (state.shadowAlpha > MIN_VISIBLE_SHADOW_ALPHA && state.shadowLength > 0) {
      this.drawVisibleBuildingShadows(nextBuffer, buildings, state);
    }

    this.shadowRefreshCount++;
    const elapsed = performance.now() - startedAt;
    this.lastShadowRenderMs = elapsed;
    this.totalShadowRenderMs += elapsed;
    this.maxShadowRenderMs = Math.max(this.maxShadowRenderMs, elapsed);

    if (!this.hasRenderedShadows) {
      this.hasRenderedShadows = true;
      this.currentBufferIndex = nextBufferIndex;
      this.previousBufferIndex = 1 - nextBufferIndex;
      nextBuffer.setAlpha(1);
      this.shadowBuffers[this.previousBufferIndex].setAlpha(0);
      return;
    }

    this.previousBufferIndex = this.currentBufferIndex;
    this.currentBufferIndex = nextBufferIndex;
    this.shadowBuffers[this.currentBufferIndex].setAlpha(0);
    this.shadowBuffers[this.previousBufferIndex].setAlpha(1);
    this.crossfadeStartedAt = sceneTimeMs;
  }

  private drawVisibleBuildingShadows(
    graphics: Phaser.GameObjects.Graphics,
    buildings: Phaser.GameObjects.GameObject[],
    state: Readonly<DayNightState>,
  ): void {
    const cameraView = this.scene.cameras.main.worldView;
    const minX = cameraView.left - VIEW_PADDING;
    const maxX = cameraView.right + VIEW_PADDING;
    const minY = cameraView.top - VIEW_PADDING;
    const maxY = cameraView.bottom + VIEW_PADDING;

    const angle = state.shadowAngleRad;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle) * 0.55;
    const perpendicularX = -Math.sin(angle);
    const perpendicularY = Math.cos(angle) * 0.35;

    graphics.fillStyle(0x07101d, state.shadowAlpha);

    for (const building of buildings) {
      if (!building.active || building.getData('hp') <= 0) continue;

      const visual = (building as BuildingWithVisual).visual;
      if (!visual?.active || !visual.visible) continue;
      if (visual.x < minX || visual.x > maxX || visual.y < minY || visual.y > maxY) continue;

      const def = building.getData('def') as ShadowBuildingDef | undefined;
      if (!def) continue;

      const footprint = Math.max(16, Math.max(def.width, def.height));
      const widthScale = Phaser.Math.Clamp(footprint / 80, 0.55, 1.55);
      const halfWidth = Phaser.Math.Clamp(footprint * 0.30, 7, 42);
      const length = state.shadowLength * widthScale;
      const dx = directionX * length;
      const dy = directionY * length;
      const px = perpendicularX * halfWidth;
      const py = perpendicularY * halfWidth;
      const endTaper = 0.62;
      const baseX = visual.x;
      const baseY = visual.y + 4;

      graphics.fillPoints([
        { x: baseX + px, y: baseY + py },
        { x: baseX - px, y: baseY - py },
        { x: baseX + dx - px * endTaper, y: baseY + dy - py * endTaper },
        { x: baseX + dx + px * endTaper, y: baseY + dy + py * endTaper },
      ], true);
      this.lastDrawnBuildings++;
    }
  }

  private publishSnapshots(): void {
    this.scene.data.set('dayNightState', this.getState());
    this.scene.data.set('dayNightDiagnostics', this.getDiagnostics());
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.shadowBuffers[0].destroy();
    this.shadowBuffers[1].destroy();
    this.ambientOverlay.destroy();

    if (this.scene.data.get('dayNightSystem') === this) {
      this.scene.data.remove('dayNightSystem');
      this.scene.data.remove('dayNightState');
      this.scene.data.remove('dayNightDiagnostics');
    }
  }
}
