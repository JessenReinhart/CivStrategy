import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { toIso, toIsoElev, toCartesian } from '../utils/iso';

/** Tree logic entity with optional pooled visual (set by this system). */
type TreeEntity = Phaser.GameObjects.Image & {
  visual?: TreeVisual;
};

/** Pooled tree sprite with optional in-flight fade tween. */
type TreeVisual = Phaser.GameObjects.Image & {
  fadeTween?: Phaser.Tweens.Tween;
};

/** Unit/squad visual that can fade on cull. */
type Fadeable = Phaser.GameObjects.GameObject &
  Phaser.GameObjects.Components.Visible &
  Phaser.GameObjects.Components.Alpha &
  Phaser.GameObjects.Components.Transform & {
    fadeTween?: Phaser.Tweens.Tween;
  };

type UnitEntity = Phaser.GameObjects.GameObject & {
  visual?: Fadeable;
};

const FADE_IN_MS = 280;
const FADE_OUT_MS = 180;
const SWAY_TABLE_SIZE = 256;

export class CullingSystem {
  private scene: MainScene;
  private visibleTrees: Set<Phaser.GameObjects.GameObject> = new Set();
  private cullTimer = 0;
  private lastScrollX = 0;
  private lastScrollY = 0;
  private lastZoom = 0;
  // R14: reusable view frustum / far cull bounds (no per-tick Rectangle allocation).
  private viewBounds = new Phaser.Geom.Rectangle();
  private farBounds = new Phaser.Geom.Rectangle();
  // R21: precomputed sway phase table (single sin per visible tree per frame).
  private swayPhases = new Float32Array(SWAY_TABLE_SIZE);

  constructor(scene: MainScene) {
    this.scene = scene;
    for (let i = 0; i < SWAY_TABLE_SIZE; i++) {
      this.swayPhases[i] = Math.sin(i * 0.0245436926) * 0.05;
    }
  }

  update(time: number, delta: number) {
    // Skip expensive culling in stress test mode (all units visible)
    if (this.scene.stressTestConfig) {
      // Only do tree animations
      this.animateTrees(time);
      return;
    }

    // R12: cull on camera movement (scroll/zoom) instead of only the 200ms timer.
    const cam = this.scene.cameras.main;
    const cameraMoved =
      Math.abs(cam.scrollX - this.lastScrollX) > 1 ||
      Math.abs(cam.scrollY - this.lastScrollY) > 1 ||
      Math.abs(cam.zoom - this.lastZoom) > 0.001;

    this.cullTimer += delta;
    if (cameraMoved || this.cullTimer > 200) {
      this.cullObjects();
      this.cullTimer = 0;
      this.lastScrollX = cam.scrollX;
      this.lastScrollY = cam.scrollY;
      this.lastZoom = cam.zoom;
    }

    this.animateTrees(time);
  }

  private stopFade(visual: { fadeTween?: Phaser.Tweens.Tween }) {
    if (visual.fadeTween) {
      visual.fadeTween.stop();
      visual.fadeTween = undefined;
    }
    this.scene.tweens.killTweensOf(visual);
  }

  private fadeInTree(visual: TreeVisual) {
    this.stopFade(visual);
    visual.setAlpha(0);
    visual.setVisible(true);
    visual.setActive(true);
    visual.fadeTween = this.scene.tweens.add({
      targets: visual,
      alpha: 1,
      duration: FADE_IN_MS,
      ease: 'Sine.easeOut',
      onComplete: () => {
        visual.fadeTween = undefined;
      },
    });
  }

  private fadeOutAndRelease(tree: TreeEntity, visual: TreeVisual) {
    this.stopFade(visual);
    // R13: release the pooled visual immediately on leave; no fade-hold slot.
    if (tree.visual === visual) {
      tree.visual = undefined;
    }
    visual.fadeTween = undefined;
    visual.setVisible(false);
    visual.setActive(false);
    visual.setAlpha(1);
    tree.setData('fadingOut', false);
    tree.setData('fadingIn', false);
    this.scene.treeVisuals.killAndHide(visual);
  }

  private isFadeable(obj: unknown): obj is Fadeable {
    if (!obj || typeof obj !== 'object') return false;
    const v = obj as Partial<Fadeable>;
    return typeof v.setVisible === 'function'
      && typeof v.setAlpha === 'function'
      && typeof v.x === 'number'
      && typeof v.y === 'number';
  }

  private fadeToggle(obj: unknown, shouldShow: boolean) {
    if (!this.isFadeable(obj)) return;
    const visual = obj;

    const fadingOut = visual.getData('fadingOut') === true;
    const fadingIn = visual.getData('fadingIn') === true;
    const currentlyShown = visual.visible && visual.alpha > 0.05 && !fadingOut;

    if (shouldShow === currentlyShown && !fadingOut && !fadingIn) {
      if (shouldShow && !visual.visible) visual.setVisible(true);
      return;
    }

    this.stopFade(visual);

    if (shouldShow) {
      visual.setData('fadingOut', false);
      visual.setData('fadingIn', true);
      if (!visual.visible || visual.alpha < 0.05) {
        visual.setAlpha(0);
        visual.setVisible(true);
      }
      visual.fadeTween = this.scene.tweens.add({
        targets: visual,
        alpha: 1,
        duration: FADE_IN_MS,
        ease: 'Sine.easeOut',
        onComplete: () => {
          visual.fadeTween = undefined;
          visual.setData('fadingIn', false);
        },
      });
    } else {
      visual.setData('fadingIn', false);
      visual.setData('fadingOut', true);
      visual.fadeTween = this.scene.tweens.add({
        targets: visual,
        alpha: 0,
        duration: FADE_OUT_MS,
        ease: 'Sine.easeIn',
        onComplete: () => {
          visual.fadeTween = undefined;
          visual.setData('fadingOut', false);
          visual.setVisible(false);
          visual.setAlpha(1);
        },
      });
    }
  }

  private cullObjects() {
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    const padding = 100;

    const isoTopLeft = { x: view.x - padding, y: view.y - padding };
    const isoBottomRight = { x: view.right + padding, y: view.bottom + padding };
    const isoTopRight = { x: view.right + padding, y: view.y - padding };
    const isoBottomLeft = { x: view.x - padding, y: view.bottom + padding };

    const c1 = toCartesian(isoTopLeft.x, isoTopLeft.y);
    const c2 = toCartesian(isoBottomRight.x, isoBottomRight.y);
    const c3 = toCartesian(isoTopRight.x, isoTopRight.y);
    const c4 = toCartesian(isoBottomLeft.x, isoBottomLeft.y);

    this.viewBounds.setTo(
      view.x - padding,
      view.y - padding,
      view.width + padding * 2,
      view.height + padding * 2,
    );
    const cullBounds = this.viewBounds;

    const minX = Math.min(c1.x, c2.x, c3.x, c4.x);
    const maxX = Math.max(c1.x, c2.x, c3.x, c4.x);
    const minY = Math.min(c1.y, c2.y, c3.y, c4.y);
    const maxY = Math.max(c1.y, c2.y, c3.y, c4.y);

    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const searchRadius = Math.max(maxX - minX, maxY - minY) / 2;

    const candidates = this.scene.treeSpatialHash.query(midX, midY, searchRadius);

    const treesInView = new Set<Phaser.GameObjects.GameObject>();
    candidates.forEach(tree => {
      const t = tree as TreeEntity;
      const isoPos = toIso(t.x, t.y);
      if (cullBounds.contains(isoPos.x, isoPos.y)) {
        treesInView.add(tree);
      }
    });

    // Exiting: fade out then return to pool
    this.visibleTrees.forEach(treeObj => {
      if (!treesInView.has(treeObj)) {
        const tree = treeObj as TreeEntity;
        if (tree.visual) {
          this.fadeOutAndRelease(tree, tree.visual);
        }
        this.visibleTrees.delete(treeObj);
      }
    });

    // Entering: acquire + fade in
    treesInView.forEach(treeObj => {
      if (this.visibleTrees.has(treeObj)) return;

      const tree = treeObj as TreeEntity;

      // Re-entering while fade-out still running — reverse it
      if (tree.visual && tree.visual.active) {
        this.stopFade(tree.visual);
        this.fadeInTree(tree.visual);
        this.visibleTrees.add(treeObj);
        return;
      }

      let visual = this.scene.treeVisuals.getFirstDead(false) as TreeVisual | null;
      if (!visual) {
        visual = this.scene.treeVisuals.create(0, 0, 'tree') as TreeVisual;
        if (this.scene.uiCamera) this.scene.uiCamera.ignore(visual);
        if (this.scene.worldLayer) this.scene.worldLayer.add(visual);
      }

      const iso = toIsoElev(tree.x, tree.y, this.scene.terrainSystem.getHeightAt(tree.x, tree.y));
      visual.setPosition(iso.x, iso.y);
      visual.setDepth(iso.y);
      visual.setTexture(tree.getData('visualTexture') || 'tree');
      visual.setScale(tree.getData('visualScale') || 0.08);
      visual.setOrigin(0.5, tree.getData('visualOriginY') || 0.95);
      visual.setTint(tree.getData('visualTint') || 0xffffff);

      tree.visual = visual;
      this.fadeInTree(visual);
      this.visibleTrees.add(treeObj);
    });

    // Units / squads: fade instead of hard toggle
    // Optimization: skip units already invisible and far from viewport
    const farPad = 800; // extra padding for "definitely out" check
    this.farBounds.setTo(
      view.x - farPad, view.y - farPad,
      view.width + farPad * 2, view.height + farPad * 2
    );
    const farBounds = this.farBounds;
    this.scene.units.getChildren().forEach(uObj => {
      const unit = uObj as UnitEntity;
      const squad = uObj.getData('squadContainer') as Fadeable | undefined;
      const squadVisible = squad && this.isFadeable(squad) && squad.visible;
      const visualVisible = unit.visual && this.isFadeable(unit.visual) && unit.visual.visible;

      // Skip if both are already hidden and position is far from viewport
      if (!squadVisible && !visualVisible) {
        const ux = uObj.getData('isoX') ?? (uObj as unknown as Phaser.GameObjects.Components.Transform).x;
        const uy = uObj.getData('isoY') ?? (uObj as unknown as Phaser.GameObjects.Components.Transform).y;
        if (!farBounds.contains(ux, uy)) return;
      }

      if (unit.visual) {
        this.fadeToggle(unit.visual, cullBounds.contains(unit.visual.x, unit.visual.y));
      }
      if (squad && this.isFadeable(squad)) {
        this.fadeToggle(squad, cullBounds.contains(squad.x, squad.y));
      }
    });
  }

  private animateTrees(time: number) {
    const windMult = this.scene.atmosphericSystem.getSeasonalWindMultiplier?.() ?? 1;
    const base = Math.sin(time * 0.0005);
    const gust = Math.sin(time * 0.002 * windMult) * (0.3 * windMult);
    const frameSway = (base + gust) * 0.05 * (0.7 + 0.3 * windMult);

    this.visibleTrees.forEach(treeObj => {
      if (treeObj.getData('isChopped')) return;
      const tree = treeObj as TreeEntity;
      const visual = tree.visual;
      if (visual && visual.visible) {
        const idx = ((Math.floor(tree.x) + Math.floor(tree.y) * 2654435761) >>> 0) % SWAY_TABLE_SIZE;
        visual.setRotation(frameSway + this.swayPhases[idx]);
      }
    });
  }
}
