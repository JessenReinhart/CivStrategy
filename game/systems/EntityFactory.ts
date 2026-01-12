
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { BuildingType, UnitType, UnitState, BuildingDef, FactionType, FormationType, UnitStance } from '../../types';
import { BUILDINGS, UNIT_STATS, FORMATION_BONUSES } from '../../constants';
import { toIso } from '../utils/iso';

export class EntityFactory {
    private scene: MainScene;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    public spawnBuilding(type: BuildingType, x: number, y: number, owner: number = 0): Phaser.GameObjects.GameObject {
        const def = BUILDINGS[type];
        const b = this.scene.add.rectangle(x, y, def.width, def.height, 0x000000, 0);
        this.scene.physics.add.existing(b, true);
        b.setData('def', def);
        b.setData('owner', owner);
        b.setData('hp', def.maxHp);
        b.setData('maxHp', def.maxHp);
        this.scene.buildings.add(b);

        this.scene.pathfinder.markGrid(x, y, def.width, def.height, true);

        const visual = this.scene.add.container(0, 0);
        const gfx = this.scene.add.graphics();
        const baseColor = owner === 1 ? 0x3f3f46 : def.color; // Keep dark base for enemy buildings for contrast, or maybe subtle tint? Let's keep it but make banner colorful.
        // ACTUALLY plan says "Update the enemy banner creation to use this.scene.getFactionColor(owner)".
        // And "Update spawnUnit to use this.scene.getFactionColor(owner)".
        // Let's stick to the plan.

        let spriteUsed = false;

        const setupSprite = (key: string, scaleMultiplier: number = 2.2, originY: number = 0.75) => {
            if (!this.scene.textures.exists(key)) return false;
            const sprite = this.scene.add.image(0, 0, key);
            sprite.setOrigin(0.5, originY);
            const targetWidth = def.width * scaleMultiplier;
            const scale = targetWidth / sprite.width;
            sprite.setScale(scale);
            visual.add(sprite);
            return true;
        };

        if (type === BuildingType.FARM) { if (setupSprite('field', 2.0, 0.5)) spriteUsed = true; }
        else if (type === BuildingType.HOUSE) { if (setupSprite('house', 2.5, 0.85)) spriteUsed = true; }
        else if (type === BuildingType.HUNTERS_LODGE) { if (setupSprite('lodge', 2.5, 0.75)) spriteUsed = true; }

        if (!spriteUsed && owner === 0 && this.scene.faction === FactionType.ROMANS) {
            if (type === BuildingType.TOWN_CENTER) { if (setupSprite('townhall', 1.5, 0.75)) spriteUsed = true; }
            else if (type === BuildingType.LUMBER_CAMP) { if (setupSprite('lumber', 2.6, 0.75)) spriteUsed = true; }
        }

        if (!spriteUsed) {
            if (type === BuildingType.BONFIRE) {
                this.drawBonfire(gfx);
                this.scene.tweens.add({ targets: gfx, scaleX: 1.05, scaleY: 1.05, alpha: 0.9, yoyo: true, repeat: -1, duration: 150 });
            } else if (type === BuildingType.SMALL_PARK) {
                this.drawPark(gfx);
            } else {
                this.drawIsoBuilding(gfx, def, baseColor);
            }
        }

        if (owner === 1) {
            const banner = this.scene.add.rectangle(0, -40, 16, 8, this.scene.getFactionColor(owner));
            visual.add(banner);
        }

        if (!spriteUsed || type === BuildingType.BONFIRE || type === BuildingType.SMALL_PARK) {
            const text = this.scene.add.text(0, -def.height * 0.5 - 10, def.name[0], { fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
            visual.add([gfx, text]);
        } else {
            visual.add(gfx);
        }

        const hpBar = this.createHealthBar(visual, def.width, -def.height * 0.8 - 35);
        visual.setData('hpBar', hpBar);

        this.scene.add.existing(visual);
        (b as any).visual = visual; // eslint-disable-line @typescript-eslint/no-explicit-any
        const iso = toIso(x, y);
        visual.setPosition(iso.x, iso.y).setDepth(iso.y);
        visual.setInteractive(new Phaser.Geom.Rectangle(-def.width / 2, -def.height, def.width, def.height), Phaser.Geom.Rectangle.Contains);
        visual.setData('building', b);

        // Building selection method with pulsing glow effect
        (b as any).setSelected = (selected: boolean) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            (b as any).isSelected = selected; // eslint-disable-line @typescript-eslint/no-explicit-any
            const hpBar = visual.getData('hpBar') as Phaser.GameObjects.Container;
            if (hpBar) hpBar.setVisible(selected || b.getData('hp') < b.getData('maxHp'));

            if (selected) {
                this.startGlowEffect(visual);
            } else {
                this.stopGlowEffect(visual);
            }
        };

        if (owner === 0) {
            if (def.populationBonus) this.scene.maxPopulation += def.populationBonus;
            if (def.happinessBonus) this.scene.happiness += def.happinessBonus;
        }

        (b as any).takeDamage = (amount: number) => this.handleDamage(b, amount, false); // eslint-disable-line @typescript-eslint/no-explicit-any

        // Waypoint Logic for Barracks
        if (type === BuildingType.BARRACKS) {
            const waypointGfx = this.scene.add.graphics().setDepth(iso.y - 1);
            visual.add(waypointGfx);
            (b as any).setWaypoint = (cx: number, cy: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                const isoDest = toIso(cx, cy);
                const isoStart = toIso(b.x, b.y);
                b.setData('waypoint', { x: cx, y: cy });

                waypointGfx.clear();
                waypointGfx.lineStyle(2, 0xffffff, 0.5);
                // Points relative to visual container
                const relDest = { x: isoDest.x - isoStart.x, y: isoDest.y - isoStart.y };
                waypointGfx.moveTo(0, 0).lineTo(relDest.x, relDest.y);
                // Draw a small flag or circle at dest
                waypointGfx.fillStyle(0xffffff, 0.8).fillCircle(relDest.x, relDest.y, 4);

                // Show floating text confirmation
                this.scene.feedbackSystem.showFloatingText(isoDest.x, isoDest.y, "Waypoint Set", "#ffffff");
            };

            // Hide waypoint if not selected? Or always show? 
            // In many RTS it shows only when selected.
            waypointGfx.setVisible(false);
            const originalSetSelected = (b as any).setSelected; // eslint-disable-line @typescript-eslint/no-explicit-any
            (b as any).setSelected = (sel: boolean) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                originalSetSelected(sel);
                waypointGfx.setVisible(sel);
            };
        }

        return b;
    }

    public spawnUnit(type: UnitType, x: number, y: number, owner: number = 0) {
        const stats = UNIT_STATS[type];
        const radius = 8;
        const unit = this.scene.add.circle(x, y, radius, 0x000000, 0);
        this.scene.physics.add.existing(unit);
        const body = unit.body as Phaser.Physics.Arcade.Body;
        body.setCircle(radius);
        unit.setData({
            owner,
            unitType: type,
            hp: stats.maxHp,
            maxHp: stats.maxHp,
            attack: stats.attack,
            range: stats.range,
            attackSpeed: stats.attackSpeed,
            stance: UnitStance.AGGRESSIVE, // Default stance
            anchor: { x: x, y: y }         // Default anchor
        });
        (unit as any).lastAttackTime = 0; // eslint-disable-line @typescript-eslint/no-explicit-any
        this.scene.units.add(unit);

        // Increment population for player-owned units (but not animals)
        if (owner === 0 && type !== UnitType.ANIMAL) {
            this.scene.population++;
        }

        const visual = this.scene.add.container(0, 0);
        const gfx = this.scene.add.graphics();
        const primaryColor = this.scene.getFactionColor(owner);

        if (type === UnitType.VILLAGER) {
            gfx.fillStyle(primaryColor, 1).fillEllipse(0, 0, 10, 6);
            visual.add([gfx, this.scene.add.rectangle(0, -6, 4, 8, owner === 1 ? 0x18181b : 0x7CB342), this.scene.add.circle(0, -11, 2.5, 0xffcccc)]);
        } else if (type === UnitType.ANIMAL) {
            gfx.fillStyle(0x795548, 1).fillEllipse(0, 0, 12, 7);
            visual.add(gfx);
            visual.setScale(0.8);
        } else {
            // visual.setVisible(false);
        }

        if (stats.squadSize === 1) {
            visual.setData('hpBar', this.createHealthBar(visual, 24, -20));
        }

        this.scene.add.existing(visual);
        (unit as any).visual = visual; // eslint-disable-line @typescript-eslint/no-explicit-any
        (unit as any).unitType = type; // eslint-disable-line @typescript-eslint/no-explicit-any

        // CRITICAL FIX: Make unit visual click-able for selection/targeting
        visual.setInteractive(new Phaser.Geom.Circle(0, -10, 15), Phaser.Geom.Circle.Contains);
        visual.setData('unit', unit);

        (unit as any).state = UnitState.IDLE; // eslint-disable-line @typescript-eslint/no-explicit-any
        (unit as any).setSelected = (selected: boolean) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            (unit as any).isSelected = selected; // eslint-disable-line @typescript-eslint/no-explicit-any
            const hpBar = visual.getData('hpBar');
            if (hpBar) hpBar.setVisible(selected || unit.getData('hp') < unit.getData('maxHp'));
        };

        if (stats.squadSize > 1) this.scene.squadSystem.createSquad(unit, type, owner);
        (unit as any).takeDamage = (amount: number) => this.handleDamage(unit, amount, true); // eslint-disable-line @typescript-eslint/no-explicit-any
        return unit;
    }

    private createHealthBar(visual: Phaser.GameObjects.Container, width: number, y: number): Phaser.GameObjects.Container {
        const bar = this.scene.add.container(0, y);
        const fg = this.scene.add.rectangle(-width / 2, 0, width, 2, 0x22c55e).setOrigin(0, 0.5).setName('barFill');
        bar.add([this.scene.add.rectangle(0, 0, width, 4, 0x000000), fg]);
        bar.setVisible(false);
        visual.add(bar);
        return bar;
    }

    private handleDamage(entity: Phaser.GameObjects.GameObject, amount: number, isUnit: boolean) {
        let hp = entity.getData('hp');
        const maxHp = entity.getData('maxHp');

        // Apply Formation Defense Bonus (Damage Reduction)
        if (isUnit) {
            const formation = entity.getData('formation') as FormationType || FormationType.BOX;
            const defBonus = FORMATION_BONUSES[formation]?.defense || 0;
            // E.g., 0.25 -> amount * 0.75
            amount = Math.max(1, amount * (1 - defBonus));
        }

        hp -= amount;
        entity.setData('hp', hp);
        const visual = (entity as any).visual as Phaser.GameObjects.Container; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (visual && visual.getData('hpBar')) {
            const hpBar = visual.getData('hpBar') as Phaser.GameObjects.Container;
            hpBar.setVisible(true);
            const fill = hpBar.getByName('barFill') as Phaser.GameObjects.Rectangle;
            fill.scaleX = Math.max(0, hp / maxHp);
            fill.fillColor = fill.scaleX < 0.3 ? 0xef4444 : 0x22c55e;
        }
        if (hp <= 0) {
            if (isUnit) { this.scene.squadSystem.destroySquad(entity); if (entity.getData('owner') === 0) this.scene.population--; }
            else {
                const def = entity.getData('def');
                this.scene.pathfinder.markGrid((entity as any).x, (entity as any).y, def.width, def.height, false); // eslint-disable-line @typescript-eslint/no-explicit-any
                if (entity.getData('owner') === 0 && def.populationBonus) this.scene.maxPopulation -= def.populationBonus;

                // Trigger explosion effect
                const iso = toIso((entity as any).x, (entity as any).y); // eslint-disable-line @typescript-eslint/no-explicit-any
                this.scene.buildingManager.emitExplosionParticles(iso.x, iso.y, def.width);
            }
            if (visual) visual.destroy();
            entity.destroy();
        }
    }

    public spawnTree(x: number, y: number) {
        // Optimization: Use single Image instead of Container + 2 Images
        // VIRTUALIZATON: Do NOT create visual here. Store data for pool.
        const treeBase = this.scene.add.circle(x, y, 6, 0x000000, 0);
        treeBase.setVisible(false); // Invisible, logic only
        this.scene.physics.add.existing(treeBase, true);
        this.scene.trees.add(treeBase);
        this.scene.treeSpatialHash.insert(treeBase);

        // Store visual properties for later hydration
        treeBase.setData('visualScale', Phaser.Math.FloatBetween(0.8, 1.1) * 0.075);
        treeBase.setData('visualTexture', 'tree');
        treeBase.setData('visualOriginY', 0.95);
        treeBase.setData('isChopped', false);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public updateTreeVisual(tree: any, isChopped: boolean) {
        tree.setData('isChopped', isChopped);

        // Update data
        if (isChopped) {
            tree.setData('visualTexture', 'stump');
            tree.setData('visualScale', 0.075);
            tree.setData('visualOriginY', 0.5);
        } else {
            tree.setData('visualTexture', 'tree');
            // Keep original random scale? simplified for now
            tree.setData('visualOriginY', 0.95);
        }

        // If currently visible (has visual), update it immediately
        const visual = tree.visual as Phaser.GameObjects.Image;
        if (visual) {
            visual.setTexture(tree.getData('visualTexture'));
            visual.setScale(tree.getData('visualScale'));
            visual.setOrigin(0.5, tree.getData('visualOriginY'));
        }
    }

    public drawIsoBuilding(gfx: Phaser.GameObjects.Graphics, def: BuildingDef, color: number, alpha = 1) {
        const w = def.width, h = def.height, height = Math.min(w, h) * 0.45;
        const corners = [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];
        const isoCorners = corners.map(c => toIso(c.x, c.y));
        gfx.fillStyle(color, alpha).beginPath();
        gfx.moveTo(isoCorners[0].x, isoCorners[0].y - height).lineTo(isoCorners[1].x, isoCorners[1].y - height)
            .lineTo(isoCorners[2].x, isoCorners[2].y - height).lineTo(isoCorners[3].x, isoCorners[3].y - height).closePath().fillPath();
        gfx.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(20).color, alpha).beginPath()
            .moveTo(isoCorners[2].x, isoCorners[2].y - height).lineTo(isoCorners[1].x, isoCorners[1].y - height)
            .lineTo(isoCorners[1].x, isoCorners[1].y).lineTo(isoCorners[2].x, isoCorners[2].y).closePath().fillPath();
    }

    private drawBonfire(gfx: Phaser.GameObjects.Graphics) {
        gfx.fillStyle(0x78716c).fillEllipse(0, 0, 24, 12);
        gfx.fillStyle(0xf97316, 0.8).beginPath().moveTo(-6, -6).lineTo(0, -20).lineTo(6, -6).closePath().fillPath();
    }

    private drawPark(gfx: Phaser.GameObjects.Graphics) {
        gfx.fillStyle(0x86efac).beginPath();
        const pts = [toIso(-14, -14), toIso(14, -14), toIso(14, 14), toIso(-14, 14)];
        gfx.moveTo(pts[0].x, pts[0].y).lineTo(pts[1].x, pts[1].y).lineTo(pts[2].x, pts[2].y).lineTo(pts[3].x, pts[3].y).closePath().fillPath();
        gfx.fillStyle(0x15803d).fillCircle(0, -4, 6);
    }

    private startGlowEffect(visual: Phaser.GameObjects.Container) {
        // Remove any existing glow
        this.stopGlowEffect(visual);

        // Find all sprites/images in the container and create additive overlays
        const glowOverlays: Phaser.GameObjects.Image[] = [];
        visual.each((child: Phaser.GameObjects.GameObject) => {
            if (child instanceof Phaser.GameObjects.Image) {
                // Create a duplicate sprite on top with ADD blend mode
                const overlay = this.scene.add.image(child.x, child.y, child.texture.key);
                overlay.setOrigin(child.originX, child.originY);
                overlay.setScale(child.scaleX, child.scaleY);
                overlay.setBlendMode(Phaser.BlendModes.ADD);
                overlay.setAlpha(0);
                visual.add(overlay);
                glowOverlays.push(overlay);
            }
        });

        if (glowOverlays.length === 0) return;

        visual.setData('glowOverlays', glowOverlays);

        // Create pulsing tween on the overlay alphas
        const tween = this.scene.tweens.add({
            targets: glowOverlays,
            alpha: { from: 0, to: 0.35 },
            duration: 600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
        visual.setData('glowTween', tween);
    }

    private stopGlowEffect(visual: Phaser.GameObjects.Container) {
        const tween = visual.getData('glowTween') as Phaser.Tweens.Tween;
        if (tween) {
            tween.stop();
            tween.destroy();
            visual.setData('glowTween', null);
        }

        // Destroy overlay sprites
        const glowOverlays = visual.getData('glowOverlays') as Phaser.GameObjects.Image[];
        if (glowOverlays) {
            glowOverlays.forEach(overlay => overlay.destroy());
            visual.setData('glowOverlays', null);
        }
    }
}
