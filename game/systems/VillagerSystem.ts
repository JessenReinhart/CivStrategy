
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitState, VillagerData } from '../../types';
import { UNIT_SPEED } from '../../constants';
import { toIso } from '../utils/iso';

export class VillagerSystem {
    private scene: MainScene;
    private villagers: VillagerData[] = [];
    private nextId: number = 0;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    public spawnVillager(x: number, y: number, owner: number = 0): VillagerData {
        const id = `villager_${this.nextId++}`;

        // Create visual container
        const visual = this.scene.add.container(0, 0);
        this.scene.worldVisuals.add(visual);
        if (this.scene.worldLayer) this.scene.worldLayer.add(visual); // Add to layer
        if (this.scene.uiCamera) this.scene.uiCamera.ignore(visual);
        const gfx = this.scene.add.graphics();
        const primaryColor = this.scene.getFactionColor(owner);

        gfx.fillStyle(primaryColor, 1).fillEllipse(0, 0, 10, 6);
        visual.add([
            gfx,
            this.scene.add.rectangle(0, -6, 4, 8, owner === 1 ? 0x18181b : 0x7CB342),
            this.scene.add.circle(0, -11, 2.5, 0xffcccc)
        ]);

        if (!this.scene.worldLayer) this.scene.add.existing(visual);

        // Position visual
        const iso = toIso(x, y);
        visual.setPosition(iso.x, iso.y).setDepth(iso.y);

        // Create villager data
        const villager: VillagerData = {
            id,
            x,
            y,
            owner,
            state: UnitState.IDLE,
            visual,
            path: undefined,
            pathStep: 0,
            jobBuilding: undefined
        };

        this.villagers.push(villager);

        // Increment population for player-owned villagers
        if (owner === 0) {
            this.scene.population++;
        }

        return villager;
    }

    public update(_time: number, _delta: number): void {
        for (const villager of this.villagers) {
            this.updateVillagerLogic(villager);
        }
    }

    private updateVillagerLogic(villager: VillagerData): void {
        // PATH FOLLOWING
        if (villager.path && villager.path.length > 0) {
            if (villager.pathStep !== undefined && villager.pathStep >= villager.path.length) {
                // Reached destination
                villager.path = undefined;
                villager.pathStep = 0;

                if (villager.state === UnitState.MOVING_TO_WORK) {
                    villager.state = UnitState.WORKING;
                } else if (villager.state === UnitState.MOVING_TO_RALLY) {
                    villager.state = UnitState.IDLE;
                }
                return;
            }

            const nextPoint = villager.path[villager.pathStep!];
            const dist = Phaser.Math.Distance.Between(villager.x, villager.y, nextPoint.x, nextPoint.y);

            if (dist < 4) {
                villager.pathStep!++;
            } else {
                // Move towards next point
                const speed = UNIT_SPEED.Villager || 80;
                const angle = Phaser.Math.Angle.Between(villager.x, villager.y, nextPoint.x, nextPoint.y);
                const dx = Math.cos(angle) * speed * (1 / 60); // Assuming 60 FPS
                const dy = Math.sin(angle) * speed * (1 / 60);

                villager.x += dx;
                villager.y += dy;

                // Update visual position
                if (villager.visual) {
                    const iso = toIso(villager.x, villager.y);
                    villager.visual.setPosition(iso.x, iso.y);
                    villager.visual.setDepth(iso.y);
                }
            }
        }
    }

    public assignJob(villager: VillagerData, building: Phaser.GameObjects.GameObject): void {
        villager.state = UnitState.MOVING_TO_WORK;
        villager.jobBuilding = building;

        const b = building as Phaser.GameObjects.Image;
        const path = this.scene.pathfinder.findPath(
            new Phaser.Math.Vector2(villager.x, villager.y),
            new Phaser.Math.Vector2(b.x, b.y)
        );

        if (path) {
            villager.path = path;
            villager.pathStep = 0;
        }
    }

    public getIdleVillagers(owner: number): VillagerData[] {
        return this.villagers.filter(v =>
            v.owner === owner &&
            (v.state === UnitState.IDLE || v.state === UnitState.MOVING_TO_RALLY)
        );
    }

    public getVillagersByOwner(owner: number): VillagerData[] {
        return this.villagers.filter(v => v.owner === owner);
    }

    public getAllVillagers(): VillagerData[] {
        return [...this.villagers];
    }

    public destroyVillager(villager: VillagerData): void {
        // Remove from array
        const index = this.villagers.indexOf(villager);
        if (index !== -1) {
            this.villagers.splice(index, 1);
        }

        // Destroy visual
        if (villager.visual) {
            villager.visual.destroy();
        }

        // Decrement population
        if (villager.owner === 0) {
            this.scene.population--;
        }
    }

    public sendToRallyPoint(villager: VillagerData, rallyX: number, rallyY: number): void {
        villager.state = UnitState.MOVING_TO_RALLY;

        const path = this.scene.pathfinder.findPath(
            new Phaser.Math.Vector2(villager.x, villager.y),
            new Phaser.Math.Vector2(rallyX, rallyY)
        );

        if (path) {
            villager.path = path;
            villager.pathStep = 0;
        }
    }
}
