import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { TILE_SIZE, GOLD_MINE_COUNT, MAP_PRESETS } from '../../constants';
import { MapMode, AnimalSpecies } from '../../types';
import { toIso } from '../utils/iso';
import { randomBetween } from '../utils/seededRandom';

export class MapGenerationSystem {
    private scene: MainScene;
    private rng: () => number;

    constructor(scene: MainScene, rng?: () => number) {
        this.scene = scene;
        this.rng = rng ?? Math.random;
    }

    createEnvironment() {
        const p1 = toIso(0, 0);
        const p2 = toIso(this.scene.mapWidth, 0);
        const p3 = toIso(this.scene.mapWidth, this.scene.mapHeight);
        const p4 = toIso(0, this.scene.mapHeight);

        const border = this.scene.add.graphics();
        border.lineStyle(8, 0x000000, 0.25);
        border.beginPath();
        border.moveTo(p1.x, p1.y);
        border.lineTo(p2.x, p2.y);
        border.lineTo(p3.x, p3.y);
        border.lineTo(p4.x, p4.y);
        border.closePath();
        border.strokePath();
        border.setDepth(-19000);

        const grid = this.scene.add.graphics();
        grid.lineStyle(1, 0x000000, 0.08);
        const gridSpacing = TILE_SIZE * 4;
        for (let x = 0; x <= this.scene.mapWidth; x += gridSpacing) {
            const gp1 = toIso(x, 0);
            const gp2 = toIso(x, this.scene.mapHeight);
            grid.moveTo(gp1.x, gp1.y);
            grid.lineTo(gp2.x, gp2.y);
        }
        for (let y = 0; y <= this.scene.mapHeight; y += gridSpacing) {
            const gp1 = toIso(0, y);
            const gp2 = toIso(this.scene.mapWidth, y);
            grid.moveTo(gp1.x, gp1.y);
            grid.lineTo(gp2.x, gp2.y);
        }
        grid.strokePath();
        grid.setDepth(-9999);
    }

    generateFertileZones() {
        const mult = MAP_PRESETS[this.scene.mapPreset]?.resourceMultiplier ?? 1.0;
        const zoneCount = Math.floor(((this.scene.mapWidth * this.scene.mapHeight) / (500 * 500)) * mult);
        for (let i = 0; i < zoneCount; i++) {
            const x = randomBetween(this.rng, 150, this.scene.mapWidth - 150);
            const y = randomBetween(this.rng, 150, this.scene.mapHeight - 150);
            const radius = randomBetween(this.rng, 100, 180);
            this.scene.fertileZones.push(new Phaser.Geom.Circle(x, y, radius));
            const iso = toIso(x, y);
            const graphics = this.scene.add.graphics();
            graphics.setDepth(-9500);
            graphics.fillStyle(0x5d4037, 0.12);
            graphics.fillEllipse(iso.x, iso.y, radius * 2, radius);
        }
    }

    generateForestsAndAnimals() {
        const mult = MAP_PRESETS[this.scene.mapPreset]?.resourceMultiplier ?? 1.0;
        const forestCount = Math.floor(((this.scene.mapWidth * this.scene.mapHeight) / (800 * 800)) * mult);
        for (let i = 0; i < forestCount; i++) {
            const fx = randomBetween(this.rng, 100, this.scene.mapWidth - 100);
            const fy = randomBetween(this.rng, 100, this.scene.mapHeight - 100);
            const fRadius = randomBetween(this.rng, 200, 450);
            const treeCount = Math.floor(fRadius * 0.4);
            for (let j = 0; j < treeCount; j++) {
                const angle = this.rng() * Math.PI * 2;
                const dist = Math.sqrt(this.rng()) * fRadius;
                const tx = fx + Math.cos(angle) * dist;
                const ty = fy + Math.sin(angle) * dist;
                if (Phaser.Math.Distance.Between(tx, ty, this.scene.mapWidth / 2, this.scene.mapHeight / 2) > 250) {
                    if (tx > 50 && tx < this.scene.mapWidth - 50 && ty > 50 && ty < this.scene.mapHeight - 50) {
                        this._trySpawnTreeAt(tx, ty);
                    }
                }
            }
            const animalCount = Math.floor(randomBetween(this.rng, 2, 5) * mult);
            for (let k = 0; k < animalCount; k++) {
                const angle = this.rng() * Math.PI * 2;
                const ax = fx + Math.cos(angle) * (fRadius * 0.8);
                const ay = fy + Math.sin(angle) * (fRadius * 0.8);
                if (Phaser.Math.Distance.Between(ax, ay, this.scene.mapWidth / 2, this.scene.mapHeight / 2) > 300) {
                    if (ax > 50 && ax < this.scene.mapWidth - 50 && ay > 50 && ay < this.scene.mapHeight - 50) {
                        // Pick species deterministically for seeded maps
                        const species = this.pickRandomSpecies();
                        this.scene.animalSystem.spawnAnimal(ax, ay, species);
                    }
                }
            }
        }
    }

    /** Pick a random animal species using the seeded RNG, matching SPECIES_WEIGHTS. */
    private pickRandomSpecies(): AnimalSpecies {
        const roll = this.rng() * 100;
        const SPECIES_WEIGHTS: { species: AnimalSpecies; weight: number }[] = [
            { species: AnimalSpecies.DEER, weight: 40 },
            { species: AnimalSpecies.RABBIT, weight: 30 },
            { species: AnimalSpecies.BOAR, weight: 20 },
            { species: AnimalSpecies.WOLF, weight: 10 },
        ];
        let cumulative = 0;
        for (const entry of SPECIES_WEIGHTS) {
            cumulative += entry.weight;
            if (roll < cumulative) return entry.species;
        }
        return AnimalSpecies.DEER;
    }

    /** Density multiplier per biome for tree spawning. */
    private static readonly TREE_DENSITY: Record<string, number> = {
        deep: 0,    // water — no trees
        sand: 0,    // shore — no trees
        grass: 0.15,// sparse
        forest: 1.0,// dense
        scrub: 0.7, // thick
        stone: 0,   // bare rock — no trees
    };

    /** Check biome at (tx,ty) and spawn tree only if the RNG passes density threshold. */
    private _trySpawnTreeAt(tx: number, ty: number): void {
        const biome = this.scene.terrainSystem.getBiomeAt(tx, ty);
        const density = MapGenerationSystem.TREE_DENSITY[biome] ?? 0;
        if (density > 0 && this.rng() < density) {
            this.scene.entityFactory.spawnTree(tx, ty);
        }
    }

    /**
     * Spawn a guaranteed cluster of trees near a faction's starting Town Center.
     * Trees are placed in a ring between innerRadius (80px) and outerRadius (300px)
     * so they don't overlap building footprints but are within Lumber Camp harvesting range.
     */
    public spawnStartingForest(cx: number, cy: number, count: number = 20): void {
        const mult = MAP_PRESETS[this.scene.mapPreset]?.resourceMultiplier ?? 1.0;
        const adjustedCount = Math.max(5, Math.floor(count * mult));
        const innerRadius = 80;   // Avoid overlapping TC and initial buildings
        const outerRadius = 300;  // Within range of a Lumber Camp (effectRadius 200)
        const isInfinite = this.scene.mapMode === MapMode.INFINITE;
        const mapW = this.scene.mapWidth;
        const mapH = this.scene.mapHeight;

        for (let i = 0; i < adjustedCount; i++) {
            const angle = this.rng() * Math.PI * 2;
            // Use sqrt distribution to bias toward outer ring (more natural-looking)
            const dist = innerRadius + Math.sqrt(this.rng()) * (outerRadius - innerRadius);
            const tx = cx + Math.cos(angle) * dist;
            const ty = cy + Math.sin(angle) * dist;

            // Bounds check for fixed maps; infinite maps have no bounds
            if (isInfinite || (tx > 50 && tx < mapW - 50 && ty > 50 && ty < mapH - 50)) {
                this._trySpawnTreeAt(tx, ty);
            }
        }
    }

    /**
     * Spawn gold mine nodes near a faction's starting Town Center.
     * Placed in a ring between 100-280px so they don't overlap the TC
     * but are reachable without a dedicated building.
     */
    public spawnStartingGoldMines(cx: number, cy: number, count: number = GOLD_MINE_COUNT): void {
        const mult = MAP_PRESETS[this.scene.mapPreset]?.resourceMultiplier ?? 1.0;
        const adjustedCount = Math.max(2, Math.floor(count * mult));
        const innerRadius = 100;
        const outerRadius = 280;
        const isInfinite = this.scene.mapMode === MapMode.INFINITE;
        const mapW = this.scene.mapWidth;
        const mapH = this.scene.mapHeight;

        for (let i = 0; i < adjustedCount; i++) {
            const angle = (i / adjustedCount) * Math.PI * 2 + this.rng() * 0.5;
            const dist = innerRadius + this.rng() * (outerRadius - innerRadius);
            const tx = cx + Math.cos(angle) * dist;
            const ty = cy + Math.sin(angle) * dist;

            if (isInfinite || (tx > 50 && tx < mapW - 50 && ty > 50 && ty < mapH - 50)) {
                this.scene.entityFactory.spawnGoldMine(tx, ty);
            }
        }
    }
}
