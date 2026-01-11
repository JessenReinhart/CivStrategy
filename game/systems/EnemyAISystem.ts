
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { BuildingType, UnitType, BuildingDef, Resources, UnitState, MapMode } from '../../types';
import { BUILDINGS } from '../../constants';

interface BlueprintItem {
    type: BuildingType;
    x: number;
    y: number;
}

const AI_BLUEPRINT: BlueprintItem[] = [
    { type: BuildingType.TOWN_CENTER, x: 0, y: 0 },
    { type: BuildingType.HOUSE, x: -80, y: 0 },
    { type: BuildingType.HOUSE, x: 80, y: 0 },
    { type: BuildingType.HOUSE, x: 0, y: -80 },
    { type: BuildingType.HOUSE, x: 0, y: 80 },
    { type: BuildingType.LUMBER_CAMP, x: -150, y: -150 },
    { type: BuildingType.LUMBER_CAMP, x: 150, y: 150 },
    { type: BuildingType.FARM, x: 150, y: -150 },
    { type: BuildingType.FARM, x: -150, y: 150 },
    { type: BuildingType.BARRACKS, x: 100, y: 100 },
    { type: BuildingType.BARRACKS, x: -100, y: -100 },
    { type: BuildingType.BONFIRE, x: 250, y: 0 },
    { type: BuildingType.BONFIRE, x: -250, y: 0 },
    { type: BuildingType.BONFIRE, x: 0, y: 250 },
    { type: BuildingType.BONFIRE, x: 0, y: -250 },
];

export class EnemyAISystem {
    private scene: MainScene;

    // AI State
    private resources: Resources = { wood: 500, food: 500, gold: 500 };
    private baseX: number = 200;
    private baseY: number = 200;
    private buildings: (Phaser.GameObjects.GameObject | null)[] = new Array(AI_BLUEPRINT.length).fill(null);

    // Personality
    private aggressionThreshold = 8;
    private unitPreference = UnitType.SOLDIER;
    private attackTarget: Phaser.GameObjects.GameObject | null = null; // Changed to GameObject for Entity targeting

    private lastTick: number = 0;
    private buildIndex: number = 0;

    constructor(scene: MainScene) {
        this.scene = scene;

        if (this.scene.mapMode === MapMode.INFINITE) {
            // Spawn far away in infinite mode
            this.baseX = 4000;
            this.baseY = 4000;
        } else {
            // Fixed mode: Player is at center (e.g. 1024,1024), spawn enemy at top-left
            this.baseX = this.scene.mapWidth * 0.15;
            this.baseY = this.scene.mapHeight * 0.15;
        }
    }

    public update(time: number, delta: number) {
        if (time - this.lastTick > 1000) {
            this.lastTick = time;
            this.tickEconomy();
            this.tickBuild();
            this.tickRecruit();
            this.tickAttack();
        }
    }

    private tickEconomy() {
        this.resources.wood += 20;
        this.resources.food += 20;
        this.resources.gold += 10;
    }

    private tickBuild() {
        for (let i = 0; i <= Math.min(this.buildIndex, AI_BLUEPRINT.length - 1); i++) {
            const existing = this.buildings[i];
            if (existing && !existing.scene) {
                this.buildings[i] = null;
            }

            if (!this.buildings[i]) {
                this.tryConstruct(i);
                if (i < this.buildIndex) return;
            }
        }

        if (this.buildings[this.buildIndex] && this.buildIndex < AI_BLUEPRINT.length - 1) {
            this.buildIndex++;
        }
    }

    private tryConstruct(index: number) {
        const item = AI_BLUEPRINT[index];
        const def = BUILDINGS[item.type];

        if (this.canAfford(def.cost)) {
            const bx = this.baseX + item.x;
            const by = this.baseY + item.y;

            this.resources.wood -= def.cost.wood;
            this.resources.food -= def.cost.food;
            this.resources.gold -= def.cost.gold;

            const b = this.scene.entityFactory.spawnBuilding(item.type, bx, by, 1);
            this.buildings[index] = b;
        }
    }

    private tickRecruit() {
        const hasBarracks = this.buildings.some(b => b && b.scene && (b as any).getData('def').type === BuildingType.BARRACKS);
        if (!hasBarracks) return;

        if (this.resources.food >= 100 && this.resources.gold >= 50) {
            this.resources.food -= 100;
            this.resources.gold -= 50;

            const spawnX = this.baseX + Phaser.Math.Between(-50, 50);
            const spawnY = this.baseY + Phaser.Math.Between(-50, 50);

            this.scene.entityFactory.spawnUnit(this.unitPreference, spawnX, spawnY, 1);
        }
    }

    private tickAttack() {
        // DIPLOMACY CHECKS
        // Strictly check boolean true
        if (this.scene.peacefulMode === true) return;

        // Check treaty timer
        if (this.scene.gameTime < this.scene.treatyLength) return;

        // Get all AI units
        const army = this.scene.units.getChildren().filter((u: any) => u.getData('owner') === 1) as Phaser.GameObjects.GameObject[];

        if (army.length > this.aggressionThreshold) {
            // Find Target (Player Town Center or any building)
            if (!this.attackTarget || !this.attackTarget.scene) {
                const playerTC = this.scene.buildings.getChildren().find((b: any) => {
                    return b.getData('owner') === 0 && b.getData('def').type === BuildingType.TOWN_CENTER;
                });

                if (playerTC) {
                    this.attackTarget = playerTC;

                    const leader = army[0] as any;
                    this.scene.showFloatingText(leader.x, leader.y, "The Boar: CRUSH THEM!", "#ef4444");
                }
            }

            if (this.attackTarget && this.attackTarget.scene) {
                // Command all idle units to attack
                const idleTroops = army.filter((u: any) => (u as any).state === UnitState.IDLE);
                if (idleTroops.length > 0) {
                    this.scene.unitSystem.commandAttack(idleTroops, this.attackTarget);
                }
            }
        } else {
            if (army.length < 2) {
                this.attackTarget = null;
            }
        }
    }

    private canAfford(cost: { wood: number, food: number, gold: number }): boolean {
        return this.resources.wood >= cost.wood &&
            this.resources.food >= cost.food &&
            this.resources.gold >= cost.gold;
    }

    public getDebugInfo(): string {
        const armySize = this.scene.units.getChildren().filter((u: any) => u.getData('owner') === 1).length;
        const target = this.attackTarget ? (this.attackTarget as any).getData('def')?.name || "Unit" : "None";
        return `Army: ${armySize}/${this.aggressionThreshold} | Res: ${this.resources.food}F | Target: ${target}`;
    }
}
