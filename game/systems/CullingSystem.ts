import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { toIso, toCartesian } from '../utils/iso';

export class CullingSystem {
    private scene: MainScene;
    private visibleTrees: Set<any> = new Set();
    private cullTimer = 0;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    update(delta: number) {
        this.cullTimer += delta;
        if (this.cullTimer > 200) {
            this.cullObjects();
            this.cullTimer = 0;
        }
    }

    private cullObjects() {
        const cam = this.scene.cameras.main;
        const view = cam.worldView;
        const padding = 100; // Extra buffer outside viewport

        // 1. Cull Trees using SpatialHash + Virtualization

        // Convert Camera View (ISO) to Cartesian for SpatialHash query
        const isoTopLeft = { x: view.x - padding, y: view.y - padding };
        const isoBottomRight = { x: view.right + padding, y: view.bottom + padding };
        const isoTopRight = { x: view.right + padding, y: view.y - padding };
        const isoBottomLeft = { x: view.x - padding, y: view.bottom + padding };

        const c1 = toCartesian(isoTopLeft.x, isoTopLeft.y);
        const c2 = toCartesian(isoBottomRight.x, isoBottomRight.y);
        const c3 = toCartesian(isoTopRight.x, isoTopRight.y);
        const c4 = toCartesian(isoBottomLeft.x, isoBottomLeft.y);

        // Fine check bounds
        const cullBounds = new Phaser.Geom.Rectangle(
            view.x - padding,
            view.y - padding,
            view.width + padding * 2,
            view.height + padding * 2
        );

        // Calculate Cartesian AABB of readability
        const minX = Math.min(c1.x, c2.x, c3.x, c4.x);
        const maxX = Math.max(c1.x, c2.x, c3.x, c4.x);
        const minY = Math.min(c1.y, c2.y, c3.y, c4.y);
        const maxY = Math.max(c1.y, c2.y, c3.y, c4.y);

        // Center and check radius (approximate is fine for SpatialHash)
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        const searchRadius = Math.max(maxX - minX, maxY - minY) / 2;

        const candidates = this.scene.treeSpatialHash.query(midX, midY, searchRadius);

        const treesInView = new Set<any>();
        candidates.forEach(tree => {
            // Optimization: Convert tree Pos to Iso, then check Rect
            const isoPos = toIso(tree.x, tree.y);
            if (cullBounds.contains(isoPos.x, isoPos.y)) {
                treesInView.add(tree);
            }
        });

        // 1A. Handle Exiting Trees (Visible -> Hidden)
        // Trees that were visible but are NO LONGER in view
        this.visibleTrees.forEach(tree => {
            if (!treesInView.has(tree)) {
                // Release visual back to pool
                const visual = tree.visual;
                if (visual) {
                    visual.setVisible(false);
                    visual.setActive(false);
                    this.scene.treeVisuals.killAndHide(visual);
                    tree.visual = undefined; // Detach
                }
                this.visibleTrees.delete(tree);
            }
        });

        // 1B. Handle Entering Trees (Hidden -> Visible)
        // Trees that are NOW in view but weren't before
        treesInView.forEach(tree => {
            if (!this.visibleTrees.has(tree)) {
                // Acquire visual from pool
                let visual = this.scene.treeVisuals.getFirstDead(false) as Phaser.GameObjects.Image;
                if (!visual) {
                    visual = this.scene.treeVisuals.create(0, 0, 'tree');
                    // Ensure depth sorting works by default
                }

                visual.setActive(true);
                visual.setVisible(true);

                // Hydrate visual from tree data
                const iso = toIso(tree.x, tree.y);
                visual.setPosition(iso.x, iso.y);
                visual.setDepth(iso.y); // Manual depth sort

                visual.setTexture(tree.getData('visualTexture') || 'tree');
                visual.setScale(tree.getData('visualScale') || 0.08);
                visual.setOrigin(0.5, tree.getData('visualOriginY') || 0.95);

                tree.visual = visual;
                this.visibleTrees.add(tree);
            }
        });

        // 2. Cull Units (Keep brute force for now as units move and count is lower than trees)
        this.scene.units.getChildren().forEach((uObj: any) => {
            const visual = uObj.visual;
            const squad = uObj.getData('squadContainer');
            // Fix: Cast visual and squad to any to access/set 'visible' property as GameObjects might not expose it directly in all TS configs
            if (visual && (visual as any).visible !== undefined) {
                (visual as any).visible = cullBounds.contains(visual.x, visual.y);
            }
            if (squad) {
                (squad as any).visible = cullBounds.contains(squad.x, squad.y);
            }
        });
    }
}
