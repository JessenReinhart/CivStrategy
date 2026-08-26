import Phaser from 'phaser';

import { MainScene } from '../MainScene';
import { calculateDayNightState, DayNightState } from './dayNightMath';

const SHADOW_REFRESH_MS = 200;
const STATE_PUBLISH_MS = 250;
const SHADOW_DEPTH = -1800;
const AMBIENT_DEPTH = 19000;
const VIEW_PADDING = 260;

interface ShadowBuildingDef {
  width: number;
  height: number;
}

type BuildingWithVisual = Phaser.GameObjects.GameObject & {
  visual?: Phaser.GameObjects.Container;
};

/**
 * Lightweight 2D day/night renderer.
 *
 * It deliberately avoids Phaser Lights and per-building shadow objects. All
 * visible building shadows are batched into one Graphics object and redrawn at
 * a low cadence. Ambient darkness is one camera-fixed rectangle inside the
 * world layer, so the UI camera remains unaffected.
 */
export class DayNightSystem {
  private readonly scene: MainScene;
  private readonly shadowGraphics: Phaser.GameObjects.Graphics;
  private readonly ambientOverlay: Phaser.GameObjects.Rectangle;
  private lastShadowRefresh = Number.NEGATIVE_INFINITY;
  private lastStatePublish = Number.NEGATIVE_INFINITY;
  private currentState: DayNightState;
  private destroyed = false;

  constructor(scene: MainScene) {
    this.scene = scene;
    this.currentState = calculateDayNightState(scene.gameTime);

    this.shadowGraphics = scene.add.graphics().setDepth(SHADOW_DEPTH);
    this.ambientOverlay = scene.add
      .rectangle(0, 0, 1, 1, this.currentState.ambientColor, this.currentState.ambientAlpha)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(AMBIENT_DEPTH);

    scene.worldLayer.add(this.shadowGraphics);
    scene.worldLayer.add(this.ambientOverlay);

    // Stress mode intentionally strips non-critical world rendering.
    if (scene.stressTestConfig) {
      this.shadowGraphics.setVisible(false);
      this.ambientOverlay.setVisible(false);
    }

    // Match the render-only AmbientPopulationSystem pattern: this system owns
    // its own scene update hook instead of adding more orchestration to MainScene.
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);

    // Expose the instance for diagnostics and future HUD/gameplay bridges
    // without coupling the first visual slice into MainScene's public API.
    scene.data.set('dayNightSystem', this);
  }

  public getState(): DayNightState {
    return { ...this.currentState };
  }

  private update(time: number): void {
    if (this.destroyed || this.scene.stressTestConfig) return;

    this.currentState = calculateDayNightState(this.scene.gameTime);
    this.updateAmbientOverlay(this.currentState);

    if (time - this.lastShadowRefresh >= SHADOW_REFRESH_MS) {
      this.lastShadowRefresh = time;
      this.redrawBuildingShadows(this.currentState);
    }

    if (time - this.lastStatePublish >= STATE_PUBLISH_MS) {
      this.lastStatePublish = time;
      this.scene.data.set('dayNightState', { ...this.currentState });
    }
  }

  private updateAmbientOverlay(state: DayNightState): void {
    const camera = this.scene.cameras.main;
    const inverseZoom = 1 / Math.max(0.01, camera.zoom);

    // Scroll factor 0 keeps this rectangle fixed to the camera. Counter the
    // camera zoom so it always covers the viewport without a full-screen FX pass.
    this.ambientOverlay.setPosition(-2 * inverseZoom, -2 * inverseZoom);
    this.ambientOverlay.setDisplaySize(
      (camera.width + 4) * inverseZoom,
      (camera.height + 4) * inverseZoom,
    );
    this.ambientOverlay.setFillStyle(state.ambientColor, state.ambientAlpha);
  }

  private redrawBuildingShadows(state: DayNightState): void {
    this.shadowGraphics.clear();
    if (state.shadowAlpha <= 0.005 || state.shadowLength <= 0) return;

    const cameraView = this.scene.cameras.main.worldView;
    const minX = cameraView.left - VIEW_PADDING;
    const maxX = cameraView.right + VIEW_PADDING;
    const minY = cameraView.top - VIEW_PADDING;
    const maxY = cameraView.bottom + VIEW_PADDING;

    const angle = state.shadowAngleRad;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle) * 0.55; // isometric vertical compression
    const perpendicularX = -Math.sin(angle);
    const perpendicularY = Math.cos(angle) * 0.35;

    this.shadowGraphics.fillStyle(0x07101d, state.shadowAlpha);

    for (const building of this.scene.buildings.getChildren()) {
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
      this.shadowGraphics.fillPoints([
        { x: baseX + px, y: baseY + py },
        { x: baseX - px, y: baseY - py },
        { x: baseX + dx - px * endTaper, y: baseY + dy - py * endTaper },
        { x: baseX + dx + px * endTaper, y: baseY + dy + py * endTaper },
      ], true);
    }
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    this.shadowGraphics.destroy();
    this.ambientOverlay.destroy();
    if (this.scene.data.get('dayNightSystem') === this) {
      this.scene.data.remove('dayNightSystem');
      this.scene.data.remove('dayNightState');
    }
  }
}
