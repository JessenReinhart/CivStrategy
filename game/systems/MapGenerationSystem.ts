import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { TILE_SIZE } from '../../constants';
import { toIso } from '../utils/iso';
import { UnitType } from '../../types';

export class MapGenerationSystem {
    private scene: MainScene;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    createEnvironment() {
        const p1 = toIso(0, 0);
        const p2 = toIso(this.scene.mapWidth, 0);
        const p3 = toIso(this.scene.mapWidth, this.scene.mapHeight);
        const p4 = toIso(0, this.scene.mapHeight);

        const border = this.scene.add.graphics();
        border.lineStyle(8, 0x000000, 0.4);
        border.beginPath();
        border.moveTo(p1.x, p1.y);
        border.lineTo(p2.x, p2.y);
        border.lineTo(p3.x, p3.y);
        border.lineTo(p4.x, p4.y);
        border.closePath();
        border.strokePath();
        border.setDepth(-19000);

        const grid = this.scene.add.graphics();
        grid.lineStyle(2, 0x000000, 0.15);
        const gridSpacing = TILE_SIZE * 4;
        for (let x = 0; x <= this.scene.mapWidth; x += gridSpacing) {
            const start = toIso(x, 0);
            const end = toIso(x, this.scene.mapHeight);
            grid.moveTo(start.x, start.y);
            grid.lineTo(end.x, end.y);
        }
        for (let y = 0; y <= this.scene.mapHeight; y += gridSpacing) {
            const start = toIso(0, y);
            const end = toIso(this.scene.mapWidth, y);
            grid.moveTo(start.x, start.y);
            grid.lineTo(end.x, end.y);
        }
        grid.strokePath();
        grid.setDepth(-9999);
    }

    generateFertileZones() {
        const zoneCount = Math.floor((this.scene.mapWidth * this.scene.mapHeight) / (500 * 500));
        for (let i = 0; i < zoneCount; i++) {
            const x = Phaser.Math.Between(150, this.scene.mapWidth - 150);
            const y = Phaser.Math.Between(150, this.scene.mapHeight - 150);
            const radius = Phaser.Math.Between(100, 180);
            this.scene.fertileZones.push(new Phaser.Geom.Circle(x, y, radius));
            const iso = toIso(x, y);
            const graphics = this.scene.add.graphics();
            graphics.setDepth(-9500);
            graphics.fillStyle(0x3e2723, 0.4);
            graphics.fillEllipse(iso.x, iso.y, radius * 2, radius);
        }
    }

    generateForestsAndAnimals() {
        const forestCount = Math.floor((this.scene.mapWidth * this.scene.mapHeight) / (800 * 800));
        for (let i = 0; i < forestCount; i++) {
            const fx = Phaser.Math.Between(100, this.scene.mapWidth - 100);
            const fy = Phaser.Math.Between(100, this.scene.mapHeight - 100);
            const fRadius = Phaser.Math.Between(200, 450);
            const treeCount = Math.floor(fRadius * 0.4);
            for (let j = 0; j < treeCount; j++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.sqrt(Math.random()) * fRadius;
                const tx = fx + Math.cos(angle) * dist;
                const ty = fy + Math.sin(angle) * dist;
                if (Phaser.Math.Distance.Between(tx, ty, this.scene.mapWidth / 2, this.scene.mapHeight / 2) > 250) {
                    if (tx > 50 && tx < this.scene.mapWidth - 50 && ty > 50 && ty < this.scene.mapHeight - 50) {
                        this.scene.entityFactory.spawnTree(tx, ty);
                    }
                }
            }
            const animalCount = Phaser.Math.Between(2, 5);
            for (let k = 0; k < animalCount; k++) {
                const angle = Math.random() * Math.PI * 2;
                const ax = fx + Math.cos(angle) * (fRadius * 0.8);
                const ay = fy + Math.sin(angle) * (fRadius * 0.8);
                if (Phaser.Math.Distance.Between(ax, ay, this.scene.mapWidth / 2, this.scene.mapHeight / 2) > 300) {
                    if (ax > 50 && ax < this.scene.mapWidth - 50 && ay > 50 && ay < this.scene.mapHeight - 50) {
                        this.scene.entityFactory.spawnUnit(UnitType.ANIMAL, ax, ay, -1);
                    }
                }
            }
        }
    }
}
