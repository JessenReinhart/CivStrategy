/**
 * ClashSystem - Triggers epic "meatgrinder" visual effects when armies clash
 */

import Phaser from 'phaser';
import { EVENTS } from '../../constants';
import { triggerMeatGrinder } from '../utils/MeatGrinderEffect';

export class ClashSystem {
    private scene: Phaser.Scene;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.registerListeners();
    }

    private registerListeners(): void {
        this.scene.events.on(EVENTS.CLASH_START, (data: { x: number; y: number }) => {
            this.handleClash(data.x, data.y);
        });
    }

    private handleClash(x: number, y: number): void {
        // Trigger the epic meatgrinder effect
        triggerMeatGrinder(this.scene, x, y);
    }

    update(): void {
        // No per-frame logic needed
    }
}
