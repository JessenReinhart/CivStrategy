
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { CHUNK_SIZE, TILE_SIZE } from '../../constants';
import { toIso } from '../utils/iso';
import { UnitType } from '../../types';

export class InfiniteMapSystem {
    private scene: MainScene;
    private generatedChunks: Set<string> = new Set();
    private lastUpdate = 0;

    constructor(scene: MainScene) {
        this.scene = scene;
        this.update();
    }

    public update() {
        const now = this.scene.time.now;
        if (now - this.lastUpdate < 500) return; // Only check chunks twice a second
        this.lastUpdate = now;

        const cam = this.scene.cameras.main;
        const chunkX = Math.floor(cam.worldView.centerX / CHUNK_SIZE);
        const chunkY = Math.floor(cam.worldView.centerY / (CHUNK_SIZE / 2));

        // Reduced range for immediate generation to 2 chunks around cam
        for (let y = chunkY - 2; y <= chunkY + 2; y++) {
            for (let x = chunkX - 2; x <= chunkX + 2; x++) {
                this.generateChunk(x, y);
            }
        }
    }

    private generateChunk(cx: number, cy: number) {
        const key = `${cx},${cy}`;
        if (this.generatedChunks.has(key)) return;
        this.generatedChunks.add(key);

        const startX = cx * CHUNK_SIZE;
        const startY = cy * CHUNK_SIZE;

        const gfx = this.scene.add.graphics();
        gfx.fillStyle(0x2d6a4f, 1);
        const p1 = toIso(startX, startY);
        const p2 = toIso(startX + CHUNK_SIZE, startY);
        const p3 = toIso(startX + CHUNK_SIZE, startY + CHUNK_SIZE);
        const p4 = toIso(startX, startY + CHUNK_SIZE);
        
        gfx.beginPath();
        gfx.moveTo(p1.x, p1.y);
        gfx.lineTo(p2.x, p2.y);
        gfx.lineTo(p3.x, p3.y);
        gfx.lineTo(p4.x, p4.y);
        gfx.closePath();
        gfx.fillPath();
        gfx.setDepth(-10000);

        const seed = cx * 1000 + cy;
        const rng = new Phaser.Math.RandomDataGenerator([seed.toString()]);

        const treeCount = rng.between(4, 12); // Reduced density slightly for infinite mode performance
        for(let i=0; i<treeCount; i++) {
            const tx = startX + rng.between(20, CHUNK_SIZE - 20);
            const ty = startY + rng.between(20, CHUNK_SIZE - 20);
            if (Phaser.Math.Distance.Between(tx, ty, 400, 400) > 300) {
                this.scene.entityFactory.spawnTree(tx, ty);
            }
        }

        if (rng.frac() < 0.2) {
            const ax = startX + rng.between(50, CHUNK_SIZE - 50);
            const ay = startY + rng.between(50, CHUNK_SIZE - 50);
            if (Phaser.Math.Distance.Between(ax, ay, 400, 400) > 400) {
                this.scene.entityFactory.spawnUnit(UnitType.ANIMAL, ax, ay);
            }
        }
        
        if (rng.frac() < 0.08) {
            const fx = startX + CHUNK_SIZE/2;
            const fy = startY + CHUNK_SIZE/2;
            const radius = rng.between(80, 150);
            this.scene.fertileZones.push(new Phaser.Geom.Circle(fx, fy, radius));
            
            const fGfx = this.scene.add.graphics();
            fGfx.setDepth(-9500);
            const iso = toIso(fx, fy);
            fGfx.fillStyle(0x3e2723, 0.4);
            fGfx.fillEllipse(iso.x, iso.y, radius * 2, radius);
        }
    }
}
