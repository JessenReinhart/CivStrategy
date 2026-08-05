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

export class CullingSystem {
  private scene: MainScene;
  private visibleTrees: Set<Phaser.GameObjects.GameObject> = new Set();
  private cullTimer = 0;

  constructor(scene: MainScene) {
    this.scene = scene;
  }

  update(time: number, delta: number) {
    this.cullTimer += delta;
    if (this.cullTimer > 200) {
      this.cullObjects();
      this.cullTimer = 0;
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
    visual.fadeTween = this.scene.tweens.add({
      targets: visual,
      alpha: 0,
      duration: FADE_OUT_MS,
      ease: 'Sine.easeIn',
      onComplete: () => {
        visual.fadeTween = undefined;
        // Only release if this visual is still the tree's current one
        if (tree.visual === visual) {
          tree.visual = undefined;
        }
        visual.setVisible(false);
        visual.setActive(false);
        visual.setAlpha(1);
        this.scene.treeVisuals.killAndHide(visual);
      },
    });
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

    const cullBounds = new Phaser.Geom.Rectangle(
      view.x - padding,
      view.y - padding,
      view.width + padding * 2,
      view.height + padding * 2,
    );

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
    this.scene.units.getChildren().forEach(uObj => {
      const unit = uObj as UnitEntity;
      const squad = uObj.getData('squadContainer') as Fadeable | undefined;

      if (unit.visual) {
        this.fadeToggle(unit.visual, cullBounds.contains(unit.visual.x, unit.visual.y));
      }
      if (squad && this.isFadeable(squad)) {
        this.fadeToggle(squad, cullBounds.contains(squad.x, squad.y));
      }
    });
  }

  private animateTrees(time: number) {
    this.visibleTrees.forEach(treeObj => {
      if (treeObj.getData('isChopped')) return;
      const tree = treeObj as TreeEntity;
      const visual = tree.visual;
      if (visual && visual.visible) {
        const sway = this.scene.atmosphericSystem.getWindSway(visual.x, visual.y, time);
        visual.setRotation(sway);
      }
    });
  }
}
