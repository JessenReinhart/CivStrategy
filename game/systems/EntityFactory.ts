

import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { BuildingType, UnitType, UnitState, BuildingDef } from '../../types';
import { BUILDINGS, FACTION_COLORS, TILE_SIZE } from '../../constants';
import { toIso } from '../utils/iso';

export class EntityFactory {
    private scene: MainScene;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    public spawnBuilding(type: BuildingType, x: number, y: number): Phaser.GameObjects.GameObject {
        const def = BUILDINGS[type];
        
        const b = this.scene.add.rectangle(x, y, def.width, def.height, 0x000000, 0); 
        this.scene.physics.add.existing(b, true);
        b.setData('def', def);
        b.setData('assignedWorker', null);
        this.scene.buildings.add(b);

        // Mark Navigation Grid
        this.scene.pathfinder.markGrid(x, y, def.width, def.height, true);

        // Visuals
        const visual = this.scene.add.container(0, 0);
        const gfx = this.scene.add.graphics();
        
        // Custom draw for specific buildings
        if (type === BuildingType.BONFIRE) {
            this.drawBonfire(gfx);
            // Add fire animation tween
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
            this.drawIsoBuilding(gfx, def, def.color);
        }
        
        const text = this.scene.add.text(0, -50, def.name[0], { fontSize: '16px', color: '#ffffff' });
        text.setOrigin(0.5);
        visual.add([gfx, text]);

        // VACANT SYMBOL 
        const vacantIcon = this.scene.add.text(0, -90, '⚠', { fontSize: '28px', color: '#ff0000', stroke: '#000000', strokeThickness: 4 });
        vacantIcon.setOrigin(0.5);
        vacantIcon.visible = false;
        visual.add(vacantIcon);
        visual.setData('vacantIcon', vacantIcon);

        // NO RESOURCES SYMBOL (Tree/Deer with X)
        let noResChar = '🌲🚫';
        if (type === BuildingType.HUNTERS_LODGE) noResChar = '🦌🚫';

        const noResIcon = this.scene.add.text(0, -90, noResChar, { fontSize: '20px', color: '#ff0000', stroke: '#000000', strokeThickness: 3 });
        noResIcon.setOrigin(0.5);
        noResIcon.visible = false;
        visual.add(noResIcon);
        visual.setData('noResIcon', noResIcon);
        
        // Selection Ring
        const ring = this.scene.add.graphics();
        ring.lineStyle(2, 0xffffff, 1);
        const ringWidth = Math.max(def.width, def.height) * 1.3;
        ring.strokeEllipse(0, 0, ringWidth, ringWidth * 0.5);
        ring.visible = false;
        visual.add(ring);
        visual.setData('ring', ring);

        this.scene.tweens.add({
            targets: [vacantIcon, noResIcon],
            y: '-=10',
            duration: 800,
            yoyo: true,
            repeat: -1
        });
        
        this.scene.add.existing(visual);
        (b as any).visual = visual;
        visual.setData('building', b);

        visual.setInteractive(new Phaser.Geom.Circle(0, -20, 30), Phaser.Geom.Circle.Contains);

        const iso = toIso(x, y);
        visual.setPosition(iso.x, iso.y);

        if (def.populationBonus) this.scene.maxPopulation += def.populationBonus;
        // Happiness bonus is handled in EconomySystem via tickEconomy for dynamic updates, 
        // but static bonuses can remain here if strictly one-time. 
        // However, for Parks/Tax we recalculate happiness, so we might ignore one-time adds here for those types.
        if (def.happinessBonus && type !== BuildingType.SMALL_PARK && type !== BuildingType.BONFIRE) {
             this.scene.happiness += def.happinessBonus;
        }

        return b;
    }

    public spawnUnit(type: UnitType, x: number, y: number) {
        const unit = this.scene.add.circle(x, y, 10, 0x000000, 0);
        this.scene.physics.add.existing(unit);
        const body = unit.body as Phaser.Physics.Arcade.Body;
        body.setCollideWorldBounds(true);
        body.setCircle(10);
        this.scene.units.add(unit);
        
        (unit as any).unitType = type;
        (unit as any).state = UnitState.IDLE;
        (unit as any).jobBuilding = null;

        if (type === UnitType.VILLAGER) {
            this.scene.population++;
        } else if (type === UnitType.SOLDIER) {
            this.scene.population++;
        }
        // Animals do not count towards population

        const visual = this.scene.add.container(0, 0);
        const gfx = this.scene.add.graphics();
        
        if (type === UnitType.VILLAGER) {
            gfx.fillStyle(0x5D4037, 1);
            gfx.fillEllipse(0, 0, 15, 8); 
            
            const torso = this.scene.add.rectangle(0, -8, 6, 12, 0x7CB342);
            const head = this.scene.add.circle(0, -15, 3.5, 0xffcccc);
            visual.add([gfx, torso, head]);
        } else if (type === UnitType.SOLDIER) {
            gfx.fillStyle(FACTION_COLORS[this.scene.faction], 1);
            gfx.fillEllipse(0, 0, 20, 10);
            gfx.lineStyle(1, 0xffffff, 0.5);
            gfx.strokeEllipse(0, 0, 20, 10);
            
            const ring = this.scene.add.graphics();
            ring.lineStyle(2, 0xffffff, 1); 
            ring.strokeEllipse(0, 0, 30, 15);
            ring.visible = false;
            visual.setData('ring', ring);
            
            const hoverRing = this.scene.add.graphics();
            hoverRing.lineStyle(2, 0xffffff, 0.5);
            hoverRing.strokeEllipse(0, 0, 30, 15);
            hoverRing.visible = false;

            const torso = this.scene.add.rectangle(0, -8, 8, 12, FACTION_COLORS[this.scene.faction]);
            const head = this.scene.add.circle(0, -16, 4, 0x9e9e9e); 
            
            visual.add([hoverRing, ring, gfx, torso, head]);

            visual.setSize(30, 30);
            visual.setInteractive(new Phaser.Geom.Circle(0, 0, 20), Phaser.Geom.Circle.Contains);
            visual.on('pointerover', () => { hoverRing.visible = true; this.scene.input.setDefaultCursor('pointer'); });
            visual.on('pointerout', () => { hoverRing.visible = false; this.scene.input.setDefaultCursor('default'); });
        } else if (type === UnitType.ANIMAL) {
            // Deer Representation
            gfx.fillStyle(0x795548, 1); // Brown body
            gfx.fillEllipse(0, 0, 18, 10); 
            
            // Head
            gfx.fillStyle(0x8D6E63, 1);
            gfx.fillCircle(-8, -8, 5); 

            // Antlers
            gfx.lineStyle(1, 0xD7CCC8, 0.8);
            gfx.beginPath(); gfx.moveTo(-8, -10); gfx.lineTo(-12, -16); gfx.strokePath();
            gfx.beginPath(); gfx.moveTo(-8, -10); gfx.lineTo(-4, -16); gfx.strokePath();

            visual.add(gfx);
            visual.setScale(0.8);
        }

        this.scene.add.existing(visual);
        (unit as any).visual = visual;
        visual.setData('unit', unit);

        const u = unit as any;
        u.path = null;
        u.pathStep = 0;
        u.isSelected = false;

        u.setSelected = (selected: boolean) => {
            if (type === UnitType.SOLDIER) u.isSelected = selected;
        };
    }

    public spawnTree(x: number, y: number) {
        const tree = this.scene.add.circle(x, y, 10, 0x000000, 0);
        this.scene.physics.add.existing(tree, true);
        (tree.body as Phaser.Physics.Arcade.Body).setCircle(10);
        this.scene.trees.add(tree);
        
        // Mark grid for tree
        const gx = Math.floor(x / TILE_SIZE);
        const gy = Math.floor(y / TILE_SIZE);
        if (this.scene.pathfinder.navGrid[gy] && this.scene.pathfinder.navGrid[gy][gx] !== undefined) {
            this.scene.pathfinder.navGrid[gy][gx] = true;
        }

        const visual = this.scene.add.container(0, 0);
        
        // Full Tree Graphics
        const treeGfx = this.scene.add.graphics();
        this.drawIsoTree(treeGfx);
        treeGfx.setName('treeGfx');
        
        // Stump Graphics
        const stumpGfx = this.scene.add.graphics();
        this.drawIsoStump(stumpGfx);
        stumpGfx.setName('stumpGfx');
        stumpGfx.visible = false;

        visual.add([stumpGfx, treeGfx]);
        visual.setScale(Phaser.Math.FloatBetween(0.85, 1.15));
        
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
        const height = 40; 
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
        gfx.fillStyle(Phaser.Display.Color.GetColor((color >> 16) & 0xFF * 0.8, (color >> 8) & 0xFF * 0.8, color & 0xFF * 0.8), alpha);
        gfx.beginPath();
        gfx.moveTo(isoCorners[2].x, isoCorners[2].y - height);
        gfx.lineTo(isoCorners[1].x, isoCorners[1].y - height);
        gfx.lineTo(isoCorners[1].x, isoCorners[1].y);
        gfx.lineTo(isoCorners[2].x, isoCorners[2].y);
        gfx.closePath();
        gfx.fillPath();
        gfx.fillStyle(Phaser.Display.Color.GetColor((color >> 16) & 0xFF * 0.6, (color >> 8) & 0xFF * 0.6, color & 0xFF * 0.6), alpha);
        gfx.beginPath();
        gfx.moveTo(isoCorners[3].x, isoCorners[3].y - height);
        gfx.lineTo(isoCorners[2].x, isoCorners[2].y - height);
        gfx.lineTo(isoCorners[2].x, isoCorners[2].y);
        gfx.lineTo(isoCorners[3].x, isoCorners[3].y);
        gfx.closePath();
        gfx.fillPath();
    }

    private drawBonfire(gfx: Phaser.GameObjects.Graphics) {
        // Stones base
        gfx.fillStyle(0x78716c);
        const iso = toIso(0, 0); // Center
        // Draw stones in circle
        gfx.fillEllipse(0, 0, 40, 20);
        
        // Logs
        gfx.lineStyle(4, 0x3e2723);
        gfx.beginPath(); gfx.moveTo(-10, -5); gfx.lineTo(10, -15); gfx.strokePath();
        gfx.beginPath(); gfx.moveTo(10, -5); gfx.lineTo(-10, -15); gfx.strokePath();
        
        // Fire
        gfx.fillStyle(0xf97316, 0.8);
        gfx.beginPath();
        gfx.moveTo(-10, -10);
        gfx.lineTo(0, -35);
        gfx.lineTo(10, -10);
        gfx.closePath();
        gfx.fillPath();
        
        gfx.fillStyle(0xfacc15, 0.8);
        gfx.beginPath();
        gfx.moveTo(-5, -10);
        gfx.lineTo(0, -25);
        gfx.lineTo(5, -10);
        gfx.closePath();
        gfx.fillPath();
    }

    private drawPark(gfx: Phaser.GameObjects.Graphics) {
        // Grass base
        gfx.fillStyle(0x86efac);
        gfx.beginPath();
        const pts = [toIso(-16, -16), toIso(16, -16), toIso(16, 16), toIso(-16, 16)];
        gfx.moveTo(pts[0].x, pts[0].y);
        gfx.lineTo(pts[1].x, pts[1].y);
        gfx.lineTo(pts[2].x, pts[2].y);
        gfx.lineTo(pts[3].x, pts[3].y);
        gfx.closePath();
        gfx.fillPath();

        // Bush
        gfx.fillStyle(0x15803d);
        gfx.fillCircle(0, -5, 8);
        
        // Flowers
        gfx.fillStyle(0xf472b6);
        gfx.fillCircle(-5, -5, 2);
        gfx.fillCircle(5, -8, 2);
        gfx.fillCircle(0, -2, 2);
    }

    private drawIsoTree(gfx: Phaser.GameObjects.Graphics) {
        gfx.fillStyle(0x000000, 0.2);
        gfx.fillEllipse(0, 0, 20, 10);
        gfx.fillStyle(0x3e2723);
        gfx.fillRect(-4, -10, 8, 10);
        const leafColor = 0x1b5e20;
        gfx.fillStyle(leafColor);
        gfx.beginPath(); gfx.moveTo(-20, -10); gfx.lineTo(20, -10); gfx.lineTo(0, -40); gfx.fillPath();
        gfx.beginPath(); gfx.moveTo(-16, -25); gfx.lineTo(16, -25); gfx.lineTo(0, -50); gfx.fillPath();
        gfx.beginPath(); gfx.moveTo(-12, -40); gfx.lineTo(12, -40); gfx.lineTo(0, -60); gfx.fillPath();
        gfx.fillStyle(0xffffff, 0.1);
        gfx.beginPath(); gfx.moveTo(0, -60); gfx.lineTo(-12, -40); gfx.lineTo(0, -40); gfx.fillPath();
    }

    private drawIsoStump(gfx: Phaser.GameObjects.Graphics) {
        gfx.fillStyle(0x000000, 0.2);
        gfx.fillEllipse(0, 0, 18, 9);
        
        // Stump body
        gfx.fillStyle(0x5D4037);
        gfx.fillRect(-5, -6, 10, 6);
        
        // Stump top
        gfx.fillStyle(0x8D6E63);
        gfx.fillEllipse(0, -6, 10, 5);
        
        // Rings
        gfx.lineStyle(1, 0x5D4037, 0.5);
        gfx.strokeEllipse(0, -6, 6, 3);
    }
}
