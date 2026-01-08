
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { BuildingType, UnitType, UnitState, BuildingDef, FactionType } from '../../types';
import { BUILDINGS, FACTION_COLORS, TILE_SIZE, UNIT_STATS } from '../../constants';
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
        b.setData('assignedWorker', null);
        b.setData('owner', owner);
        b.setData('hp', def.maxHp);
        b.setData('maxHp', def.maxHp);
        this.scene.buildings.add(b);

        this.scene.pathfinder.markGrid(x, y, def.width, def.height, true);

        // Visuals
        const visual = this.scene.add.container(0, 0);
        const gfx = this.scene.add.graphics();
        
        const baseColor = owner === 1 ? 0x3f3f46 : def.color;

        let spriteUsed = false;
        
        // Helper to apply consistent sprite scaling and positioning
        const setupSprite = (key: string, scaleMultiplier: number = 2.2, originY: number = 0.75) => {
            if (!this.scene.textures.exists(key)) return false;
            
            const sprite = this.scene.add.image(0, 0, key);
            sprite.setOrigin(0.5, originY);
            
            // Dynamic scaling: Fit the sprite to the logical width with a multiplier for visual overhang
            // logical width * multiplier = target visual width
            const targetWidth = def.width * scaleMultiplier;
            const scale = targetWidth / sprite.width;
            
            sprite.setScale(scale);
            visual.add(sprite);
            return true;
        };
        
        // Use Sprites for Farms (All Factions)
        if (type === BuildingType.FARM) {
             // Farms are flat, so we use a different scale/origin logic
             // Increased scale from 1.0 to 2.0
             if (setupSprite('field', 2.0, 0.5)) {
                 spriteUsed = true;
             }
        } else if (type === BuildingType.HOUSE) {
             // Increased scale from 1.25 to 2.5
             if (setupSprite('house', 2.5, 0.85)) { 
                 spriteUsed = true;
             }
        }

        // Use Sprites for Romans if available (Faction Specific)
        if (!spriteUsed && owner === 0 && this.scene.faction === FactionType.ROMANS) {
            if (type === BuildingType.TOWN_CENTER) {
                if (setupSprite('townhall', 1.5, 0.75)) spriteUsed = true;
            } else if (type === BuildingType.LUMBER_CAMP) {
                // Increased scale from 1.3 to 2.6
                if (setupSprite('lumber', 2.6, 0.75)) spriteUsed = true;
            }
        }

        if (!spriteUsed) {
            if (type === BuildingType.BONFIRE) {
                this.drawBonfire(gfx);
                this.scene.tweens.add({
                    targets: gfx,
                    scaleX: 1.05,
                    scaleY: 1.05,
                    alpha: 0.9,
                    yoyo: true,
                    repeat: -1,
                    duration: 100 + Math.random() * 100
                });
            } else if (type === BuildingType.SMALL_PARK) {
                this.drawPark(gfx);
            } else {
                this.drawIsoBuilding(gfx, def, baseColor);
            }
        }
        
        if (owner === 1) {
             const banner = this.scene.add.rectangle(0, -40, 16, 8, 0xef4444);
             visual.add(banner);
        }

        if (!spriteUsed || type === BuildingType.BONFIRE || type === BuildingType.SMALL_PARK) {
            // Keep text for non-sprites or small buildings
            const textOffset = -def.height * 0.5 - 10;
            const text = this.scene.add.text(0, textOffset, def.name[0], { fontSize: '14px', color: '#ffffff' });
            text.setOrigin(0.5);
            visual.add([gfx, text]);
        } else {
             visual.add(gfx); // Empty gfx but keeps container structure for consistency
        }

        // Symbols - Dynamic positioning based on building height
        // For sprites, we adjust based on the logical height to keep icons above the roof
        // Increased offset to accommodate larger sprites
        const iconOffset = spriteUsed ? -def.width * 1.5 : -def.height * 0.8 - 20;
        
        const vacantIcon = this.scene.add.text(0, iconOffset, '⚠', { fontSize: '20px', color: '#ff0000', stroke: '#000000', strokeThickness: 3 });
        vacantIcon.setOrigin(0.5);
        vacantIcon.visible = false;
        visual.add(vacantIcon);
        visual.setData('vacantIcon', vacantIcon);

        let noResChar = '🌲🚫';
        if (type === BuildingType.HUNTERS_LODGE) noResChar = '🦌🚫';

        const noResIcon = this.scene.add.text(0, iconOffset, noResChar, { fontSize: '16px', color: '#ff0000', stroke: '#000000', strokeThickness: 2 });
        noResIcon.setOrigin(0.5);
        noResIcon.visible = false;
        visual.add(noResIcon);
        visual.setData('noResIcon', noResIcon);
        
        const ring = this.scene.add.graphics();
        ring.lineStyle(2, 0xffffff, 1);
        const ringWidth = Math.max(def.width, def.height) * 1.3;
        ring.strokeEllipse(0, 0, ringWidth, ringWidth * 0.5);
        ring.visible = false;
        visual.add(ring);
        visual.setData('ring', ring);

        // --- HEALTH BAR ---
        const hpBarOffset = iconOffset - 15;
        const hpBar = this.createHealthBar(visual, def.width, hpBarOffset);
        visual.setData('hpBar', hpBar);

        this.scene.tweens.add({
            targets: [vacantIcon, noResIcon],
            y: '-=5',
            duration: 800,
            yoyo: true,
            repeat: -1
        });
        
        this.scene.add.existing(visual);
        (b as any).visual = visual;
        visual.setData('building', b);

        visual.setInteractive(new Phaser.Geom.Circle(0, -10, Math.max(def.width/2, 20)), Phaser.Geom.Circle.Contains);
        const iso = toIso(x, y);
        visual.setPosition(iso.x, iso.y);

        if (owner === 0) {
            if (def.populationBonus) this.scene.maxPopulation += def.populationBonus;
            if (def.happinessBonus && type !== BuildingType.SMALL_PARK && type !== BuildingType.BONFIRE) {
                this.scene.happiness += def.happinessBonus;
            }
        }

        // Damage Handler
        (b as any).takeDamage = (amount: number) => this.handleDamage(b, amount, false);

        return b;
    }

    public spawnUnit(type: UnitType, x: number, y: number, owner: number = 0) {
        const stats = UNIT_STATS[type];
        
        if (!stats) {
            console.error(`Missing stats for unit type: ${type}`);
            const dummy = this.scene.add.circle(x, y, 10, 0xff0000);
            return dummy;
        }

        const radius = 6; 
        const unit = this.scene.add.circle(x, y, radius, 0x000000, 0);
        this.scene.physics.add.existing(unit);
        const body = unit.body as Phaser.Physics.Arcade.Body;
        body.setCollideWorldBounds(true);
        body.setCircle(radius);
        
        unit.setData('owner', owner);
        unit.setData('unitType', type);
        unit.setData('hp', stats.maxHp);
        unit.setData('maxHp', stats.maxHp);
        unit.setData('attack', stats.attack);
        unit.setData('range', stats.range);
        unit.setData('attackSpeed', stats.attackSpeed);
        
        this.scene.units.add(unit);
        
        (unit as any).unitType = type;
        (unit as any).state = UnitState.IDLE;
        (unit as any).jobBuilding = null;
        (unit as any).owner = owner;
        (unit as any).lastAttackTime = 0;
        (unit as any).target = null;

        if (owner === 0) {
            if (type === UnitType.VILLAGER) {
                this.scene.population++;
            } else if (type === UnitType.SOLDIER || type === UnitType.CAVALRY) {
                this.scene.population++;
            }
        }

        const visual = this.scene.add.container(0, 0);
        const gfx = this.scene.add.graphics();
        
        const primaryColor = owner === 1 ? 0xef4444 : (type === UnitType.SOLDIER ? FACTION_COLORS[this.scene.faction] : 0x5D4037);
        const secondaryColor = owner === 1 ? 0x000000 : 0xffffff;

        if (type === UnitType.VILLAGER) {
            gfx.fillStyle(primaryColor, 1);
            gfx.fillEllipse(0, 0, 10, 6); 
            const torso = this.scene.add.rectangle(0, -6, 4, 8, owner === 1 ? 0x18181b : 0x7CB342);
            const head = this.scene.add.circle(0, -11, 2.5, 0xffcccc);
            visual.add([gfx, torso, head]);
        } else if (type === UnitType.SOLDIER) {
            gfx.fillStyle(primaryColor, 1);
            gfx.fillEllipse(0, 0, 14, 8); 
            gfx.lineStyle(1, secondaryColor, 0.5);
            gfx.strokeEllipse(0, 0, 14, 8);
            
            const ring = this.scene.add.graphics();
            ring.lineStyle(1.5, 0xffffff, 1); 
            ring.strokeEllipse(0, 0, 20, 12);
            ring.visible = false;
            visual.setData('ring', ring);
            
            const hoverRing = this.scene.add.graphics();
            hoverRing.lineStyle(1.5, 0xffffff, 0.5);
            hoverRing.strokeEllipse(0, 0, 20, 12);
            hoverRing.visible = false;

            const torso = this.scene.add.rectangle(0, -6, 6, 8, primaryColor);
            const head = this.scene.add.circle(0, -11, 3, 0x9e9e9e); 
            visual.add([hoverRing, ring, gfx, torso, head]);
            visual.setSize(20, 20);
            visual.setInteractive(new Phaser.Geom.Circle(0, 0, 12), Phaser.Geom.Circle.Contains);
            visual.on('pointerover', () => { if(owner===0) hoverRing.visible = true; this.scene.input.setDefaultCursor('pointer'); });
            visual.on('pointerout', () => { hoverRing.visible = false; this.scene.input.setDefaultCursor('default'); });
        } else if (type === UnitType.CAVALRY) {
            gfx.fillStyle(0x8D6E63, 1); 
            gfx.fillEllipse(0, 4, 24, 8); 
            gfx.lineStyle(1, 0x5D4037, 1);
            gfx.strokeEllipse(0, 4, 24, 8);
            const horseHead = this.scene.add.graphics();
            horseHead.fillStyle(0x8D6E63, 1);
            horseHead.fillEllipse(8, -4, 10, 6); 
            const riderColor = primaryColor;
            const rider = this.scene.add.graphics();
            rider.fillStyle(riderColor, 1);
            rider.fillEllipse(0, -4, 8, 8); 
            rider.lineStyle(1, secondaryColor, 0.5);
            rider.strokeEllipse(0, -4, 8, 8);
            const riderHead = this.scene.add.circle(0, -10, 3, 0xeeeeee);
            const ring = this.scene.add.graphics();
            ring.lineStyle(1.5, 0xffffff, 1); 
            ring.strokeEllipse(0, 4, 35, 18);
            ring.visible = false;
            visual.setData('ring', ring);
            const hoverRing = this.scene.add.graphics();
            hoverRing.lineStyle(1.5, 0xffffff, 0.5);
            hoverRing.strokeEllipse(0, 4, 35, 18);
            hoverRing.visible = false;
            visual.add([hoverRing, ring, gfx, horseHead, rider, riderHead]);
            visual.setSize(35, 25);
            visual.setInteractive(new Phaser.Geom.Circle(0, 0, 18), Phaser.Geom.Circle.Contains);
            visual.on('pointerover', () => { if(owner===0) hoverRing.visible = true; this.scene.input.setDefaultCursor('pointer'); });
            visual.on('pointerout', () => { hoverRing.visible = false; this.scene.input.setDefaultCursor('default'); });
        } else if (type === UnitType.ANIMAL) {
            gfx.fillStyle(0x795548, 1);
            gfx.fillEllipse(0, 0, 12, 7); 
            gfx.fillStyle(0x8D6E63, 1);
            gfx.fillCircle(-5, -5, 3.5); 
            gfx.lineStyle(1, 0xD7CCC8, 0.8);
            gfx.beginPath(); gfx.moveTo(-5, -6); gfx.lineTo(-8, -10); gfx.strokePath();
            gfx.beginPath(); gfx.moveTo(-5, -6); gfx.lineTo(-2, -10); gfx.strokePath();
            visual.add(gfx);
            visual.setScale(0.8);
        }

        // --- HEALTH BAR ---
        const barY = type === UnitType.CAVALRY ? -30 : -20;
        const hpBar = this.createHealthBar(visual, 24, barY);
        visual.setData('hpBar', hpBar);

        this.scene.add.existing(visual);
        (unit as any).visual = visual;
        visual.setData('unit', unit);

        const u = unit as any;
        u.path = null;
        u.pathStep = 0;
        u.isSelected = false;

        u.setSelected = (selected: boolean) => {
            if (owner === 0 && (type === UnitType.SOLDIER || type === UnitType.CAVALRY)) {
                 u.isSelected = selected;
                 hpBar.setVisible(selected || u.getData('hp') < u.getData('maxHp'));
                 const ring = visual.getData('ring');
                 if (ring) ring.visible = selected;
            }
        };

        // Damage Handler
        u.takeDamage = (amount: number) => this.handleDamage(u, amount, true);

        return unit;
    }

    private createHealthBar(visual: Phaser.GameObjects.Container, width: number, y: number): Phaser.GameObjects.Container {
        const bar = this.scene.add.container(0, y);
        const bg = this.scene.add.rectangle(0, 0, width, 4, 0x000000);
        const fg = this.scene.add.rectangle(-width/2, 0, width, 2, 0x22c55e); // Green
        fg.setOrigin(0, 0.5);
        fg.setName('barFill');
        bar.add([bg, fg]);
        bar.setVisible(false);
        visual.add(bar);
        return bar;
    }

    private handleDamage(entity: Phaser.GameObjects.GameObject, amount: number, isUnit: boolean) {
        if (!entity.scene) return;
        
        let hp = entity.getData('hp');
        const maxHp = entity.getData('maxHp');
        hp -= amount;
        entity.setData('hp', hp);

        // Update Visuals
        const visual = (entity as any).visual as Phaser.GameObjects.Container;
        if (visual) {
            const hpBar = visual.getData('hpBar') as Phaser.GameObjects.Container;
            if (hpBar) {
                hpBar.setVisible(true);
                const fill = hpBar.getByName('barFill') as Phaser.GameObjects.Rectangle;
                const pct = Math.max(0, hp / maxHp);
                fill.scaleX = pct;
                fill.fillColor = pct < 0.3 ? 0xef4444 : 0x22c55e;
            }
            
            // Flash Effect
            this.scene.tweens.add({
                targets: visual,
                alpha: 0.5,
                yoyo: true,
                duration: 50
            });
        }

        if (hp <= 0) {
            this.handleDeath(entity, isUnit);
        }
    }

    private handleDeath(entity: Phaser.GameObjects.GameObject, isUnit: boolean) {
        if (isUnit) {
            const type = entity.getData('unitType');
            const owner = entity.getData('owner');
            if (owner === 0 && (type === UnitType.VILLAGER || type === UnitType.SOLDIER || type === UnitType.CAVALRY)) {
                this.scene.population--;
            }
        } else {
            // Building Destruction
            const def = entity.getData('def') as BuildingDef;
            this.scene.pathfinder.markGrid((entity as any).x, (entity as any).y, def.width, def.height, false);
        }

        // Particle/Visual Death
        const visual = (entity as any).visual;
        if (visual) {
             const iso = toIso((entity as any).x, (entity as any).y);
             // Use texture flare if loaded, else fallback
             const texture = this.scene.textures.exists('flare') ? 'flare' : null;
             
             if (texture) {
                 const particles = this.scene.add.particles(iso.x, iso.y, texture, {
                    speed: 100,
                    scale: { start: 0.5, end: 0 },
                    blendMode: 'ADD',
                    lifespan: 500
                 });
                 this.scene.time.delayedCall(500, () => particles.destroy());
             } else {
                 const pRect = this.scene.add.rectangle(iso.x, iso.y, 10, 10, 0xff0000);
                 this.scene.tweens.add({targets: pRect, alpha: 0, scale: 2, duration: 500, onComplete: () => pRect.destroy()});
             }
             visual.destroy();
        }

        entity.destroy();
    }

    public spawnTree(x: number, y: number) {
        const tree = this.scene.add.circle(x, y, 6, 0x000000, 0); // Reduced radius
        this.scene.physics.add.existing(tree, true);
        (tree.body as Phaser.Physics.Arcade.Body).setCircle(6);
        this.scene.trees.add(tree);
        
        const gx = Math.floor(x / TILE_SIZE);
        const gy = Math.floor(y / TILE_SIZE);
        if (this.scene.pathfinder.navGrid[gy] && this.scene.pathfinder.navGrid[gy][gx] !== undefined) {
            this.scene.pathfinder.navGrid[gy][gx] = true;
        }

        const visual = this.scene.add.container(0, 0);
        
        // Use Sprites
        const stump = this.scene.add.image(0, 0, 'stump');
        stump.setOrigin(0.5, 0.5); 
        // Reduced scale from 0.15 to 0.075
        stump.setScale(0.075); 
        stump.setName('stumpSprite');
        stump.visible = false;

        const treeSprite = this.scene.add.image(0, 0, 'tree');
        treeSprite.setOrigin(0.5, 0.95); // Anchor at bottom trunk
        // Reduced scale from 0.15 to 0.075
        treeSprite.setScale(0.075); 
        treeSprite.setName('treeSprite');

        visual.add([stump, treeSprite]);
        
        // Random slight scale variation for natural look
        const randomScale = Phaser.Math.FloatBetween(0.8, 1.1);
        visual.setScale(randomScale);
        
        this.scene.add.existing(visual);
        const iso = toIso(x, y);
        visual.setPosition(iso.x, iso.y);
        visual.setDepth(iso.y);
        (tree as any).visual = visual;
        tree.setData('isChopped', false);
    }

    public updateTreeVisual(tree: Phaser.GameObjects.GameObject, isChopped: boolean) {
        const visual = (tree as any).visual as Phaser.GameObjects.Container;
        if (!visual) return;
        
        // Handle Sprite version
        const treeSprite = visual.getByName('treeSprite') as Phaser.GameObjects.Image;
        const stumpSprite = visual.getByName('stumpSprite') as Phaser.GameObjects.Image;
        
        if (treeSprite && stumpSprite) {
            treeSprite.visible = !isChopped;
            stumpSprite.visible = isChopped;
            return;
        }

        // Fallback for legacy graphics
        const treeGfx = visual.getByName('treeGfx') as Phaser.GameObjects.Graphics;
        const stumpGfx = visual.getByName('stumpGfx') as Phaser.GameObjects.Graphics;
        if (treeGfx && stumpGfx) {
            treeGfx.visible = !isChopped;
            stumpGfx.visible = isChopped;
        }
        tree.setData('isChopped', isChopped);
    }

    public drawIsoBuilding(gfx: Phaser.GameObjects.Graphics, def: BuildingDef, color: number, alpha = 1) {
        const w = def.width;
        const h = def.height;
        // Proportional height instead of fixed
        const height = Math.min(w, h) * 0.45; 
        
        const corners = [
            { x: -w/2, y: -h/2 },
            { x: w/2, y: -h/2 },
            { x: w/2, y: h/2 },
            { x: -w/2, y: h/2 }
        ];
        const isoCorners = corners.map(c => toIso(c.x, c.y));
        gfx.fillStyle(color, alpha);
        gfx.beginPath();
        gfx.moveTo(isoCorners[0].x, isoCorners[0].y - height);
        gfx.lineTo(isoCorners[1].x, isoCorners[1].y - height);
        gfx.lineTo(isoCorners[2].x, isoCorners[2].y - height);
        gfx.lineTo(isoCorners[3].x, isoCorners[3].y - height);
        gfx.closePath();
        gfx.fillPath();
        gfx.lineStyle(1, 0xffffff, 0.5);
        gfx.strokePath();
        
        const shade1 = Phaser.Display.Color.IntegerToColor(color).darken(20).color;
        gfx.fillStyle(shade1, alpha);
        gfx.beginPath();
        gfx.moveTo(isoCorners[2].x, isoCorners[2].y - height);
        gfx.lineTo(isoCorners[1].x, isoCorners[1].y - height);
        gfx.lineTo(isoCorners[1].x, isoCorners[1].y);
        gfx.lineTo(isoCorners[2].x, isoCorners[2].y);
        gfx.closePath();
        gfx.fillPath();
        
        const shade2 = Phaser.Display.Color.IntegerToColor(color).darken(40).color;
        gfx.fillStyle(shade2, alpha);
        gfx.beginPath();
        gfx.moveTo(isoCorners[3].x, isoCorners[3].y - height);
        gfx.lineTo(isoCorners[2].x, isoCorners[2].y - height);
        gfx.lineTo(isoCorners[2].x, isoCorners[2].y);
        gfx.lineTo(isoCorners[3].x, isoCorners[3].y);
        gfx.closePath();
        gfx.fillPath();
    }

    private drawBonfire(gfx: Phaser.GameObjects.Graphics) {
        // Scaled for 32x32 size
        gfx.fillStyle(0x78716c);
        gfx.fillEllipse(0, 0, 24, 12);
        
        gfx.lineStyle(2, 0x3e2723);
        gfx.beginPath(); gfx.moveTo(-6, -3); gfx.lineTo(6, -8); gfx.strokePath();
        gfx.beginPath(); gfx.moveTo(6, -3); gfx.lineTo(-6, -8); gfx.strokePath();
        
        gfx.fillStyle(0xf97316, 0.8);
        gfx.beginPath(); gfx.moveTo(-6, -6); gfx.lineTo(0, -20); gfx.lineTo(6, -6); gfx.closePath(); gfx.fillPath();
        gfx.fillStyle(0xfacc15, 0.8);
        gfx.beginPath(); gfx.moveTo(-3, -6); gfx.lineTo(0, -15); gfx.lineTo(3, -6); gfx.closePath(); gfx.fillPath();
    }

    private drawPark(gfx: Phaser.GameObjects.Graphics) {
        // Fits 32x32
        gfx.fillStyle(0x86efac);
        gfx.beginPath();
        const pts = [toIso(-14, -14), toIso(14, -14), toIso(14, 14), toIso(-14, 14)];
        gfx.moveTo(pts[0].x, pts[0].y); gfx.lineTo(pts[1].x, pts[1].y); gfx.lineTo(pts[2].x, pts[2].y); gfx.lineTo(pts[3].x, pts[3].y);
        gfx.closePath(); gfx.fillPath();
        gfx.fillStyle(0x15803d); gfx.fillCircle(0, -4, 6);
        gfx.fillStyle(0xf472b6); gfx.fillCircle(-4, -4, 1.5); gfx.fillCircle(4, -6, 1.5); gfx.fillCircle(0, -2, 1.5);
    }
}
