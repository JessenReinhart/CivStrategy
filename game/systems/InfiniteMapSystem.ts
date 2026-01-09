
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { CHUNK_SIZE, TILE_SIZE } from '../../constants';
import { toIso, toCartesian } from '../utils/iso';
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
        
        // Convert Camera Center (Iso) to Logic (Cartesian) to find the correct chunk
        const center = toCartesian(cam.worldView.centerX, cam.worldView.centerY);
        
        const chunkX = Math.floor(center.x / CHUNK_SIZE);
        const chunkY = Math.floor(center.y / CHUNK_SIZE);

        // Range for immediate generation
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

        const seed = cx * 1000 + cy;
        const rng = new Phaser.Math.RandomDataGenerator([seed.toString()]);

        const treeCount = rng.between(4, 12); 
        for(let i=0; i<treeCount; i++) {
            const tx = startX + rng.between(20, CHUNK_SIZE - 20);
            const ty = startY + rng.between(20, CHUNK_SIZE - 20);
            // Don't spawn on top of initial spawn area
            if (Phaser.Math.Distance.Between(tx, ty, 400, 400) > 300) {
                this.scene.entityFactory.spawnTree(tx, ty);
            }
        }

        if (rng.frac() < 0.2) {
            const ax = startX + rng.between(50, CHUNK_SIZE - 50);
            const ay = startY + rng.between(50, CHUNK_SIZE - 50);
            if (Phaser.Math.Distance.Between(ax, ay, 400, 400) > 400) {
                // FIX: Spawn animals as Owner -1 (Neutral) to avoid counting as population
                this.scene.entityFactory.spawnUnit(UnitType.ANIMAL, ax, ay, -1);
            }
        }
        
        if (rng.frac() < 0.08) {
            const fx = startX + CHUNK_SIZE/2;
            const fy = startY + CHUNK_SIZE/2;
            const radius = rng.between(80, 150);
            this.scene.fertileZones.push(new Phaser.Geom.Circle(fx, fy, radius));
            
            // Draw fertile zone
            const fGfx = this.scene.add.graphics();
            fGfx.setDepth(-9500);
            const iso = toIso(fx, fy);
            fGfx.fillStyle(0x3e2723, 0.4);
            fGfx.fillEllipse(iso.x, iso.y, radius * 2, radius);
        }
    }
}
