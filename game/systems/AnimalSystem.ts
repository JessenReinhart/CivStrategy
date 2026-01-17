
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { AnimalData, UnitState } from '../../types';
import { toIso } from '../utils/iso';
import { MAP_WIDTH, MAP_HEIGHT } from '../../constants';

export class AnimalSystem {
    private scene: MainScene;
    private animals: AnimalData[] = [];
    private nextId: number = 0;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    public spawnAnimal(x: number, y: number): AnimalData {
        const id = `animal_${this.nextId++}`;

        // Create visual container
        const visual = this.scene.add.container(0, 0);
        this.scene.worldVisuals.add(visual);
        if (this.scene.worldLayer) this.scene.worldLayer.add(visual);
        if (this.scene.uiCamera) this.scene.uiCamera.ignore(visual);

        const gfx = this.scene.add.graphics();
        // Animal Visual: Brown Ellipse
        gfx.fillStyle(0x795548, 1).fillEllipse(0, 0, 12, 7);
        visual.add(gfx);
        visual.setScale(0.8);

        if (!this.scene.worldLayer) this.scene.add.existing(visual);

        const iso = toIso(x, y);
        visual.setPosition(iso.x, iso.y).setDepth(iso.y);

        // Enable interaction for selection/hover (optional, but good for consistency)
        visual.setInteractive(new Phaser.Geom.Circle(0, 0, 10), Phaser.Geom.Circle.Contains);

        const animal: AnimalData = {
            id,
            x,
            y,
            state: UnitState.IDLE,
            visual
        };

        // attach data to visual for interaction
        visual.setData('type', 'animal');
        visual.setData('data', animal);
        // Some systems might look for 'unitType' on the object
        visual.setData('unitType', 'Animal');

        this.animals.push(animal);
        return animal;
    }

    public update(time: number, delta: number) {
        for (const animal of this.animals) {
            this.updateAnimalLogic(animal, delta);
        }
    }

    private updateAnimalLogic(animal: AnimalData, delta: number) {
        if (animal.state === UnitState.IDLE) {
            // Randomly start wandering
            if (Math.random() < 0.005) {
                const wanderRadius = 100;
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * wanderRadius;
                const tx = Phaser.Math.Clamp(animal.x + Math.cos(angle) * dist, 50, MAP_WIDTH - 50);
                const ty = Phaser.Math.Clamp(animal.y + Math.sin(angle) * dist, 50, MAP_HEIGHT - 50);

                animal.wanderDest = new Phaser.Math.Vector2(tx, ty);
                animal.state = UnitState.WANDERING;
            }
        } else if (animal.state === UnitState.WANDERING && animal.wanderDest) {
            const speed = 20; // Slow wander speed
            const dist = Phaser.Math.Distance.Between(animal.x, animal.y, animal.wanderDest.x, animal.wanderDest.y);

            if (dist < 5) {
                animal.state = UnitState.IDLE;
                animal.wanderDest = undefined;
            } else {
                const angle = Phaser.Math.Angle.Between(animal.x, animal.y, animal.wanderDest.x, animal.wanderDest.y);
                const dx = Math.cos(angle) * speed * (delta / 1000);
                const dy = Math.sin(angle) * speed * (delta / 1000);

                animal.x += dx;
                animal.y += dy;

                if (animal.visual) {
                    const iso = toIso(animal.x, animal.y);
                    animal.visual.setPosition(iso.x, iso.y);
                    animal.visual.setDepth(iso.y);
                }
            }
        }
    }

    public getAnimals(): AnimalData[] {
        return this.animals;
    }

    public destroyAnimal(animal: AnimalData) {
        const index = this.animals.indexOf(animal);
        if (index !== -1) {
            this.animals.splice(index, 1);
        }
        if (animal.visual) {
            animal.visual.destroy();
        }
    }
}
