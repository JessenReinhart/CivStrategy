/**
 * ClashSystem - Triggers epic "meatgrinder" visual effects when armies clash
 */

import Phaser from 'phaser';
import { EVENTS } from '../../constants';
import { triggerMeatGrinder } from '../utils/MeatGrinderEffect';

export class ClashSystem {
    private scene: Phaser.Scene;
    private readonly clashStartHandler = (data: { x: number; y: number }): void => {
        this.handleClash(data.x, data.y);
    };

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.registerListeners();
    }

    private registerListeners(): void {
        this.scene.events.on(EVENTS.CLASH_START, this.clashStartHandler);
    }

    private handleClash(x: number, y: number): void {
        // Trigger the epic meatgrinder effect
        triggerMeatGrinder(this.scene, x, y);
    }

    update(): void {
        // No per-frame logic needed
    }

    /**
     * Remove only this system's CLASH_START listener so other event consumers survive teardown.
     */
    public destroy(): void {
        this.scene.events.off(EVENTS.CLASH_START, this.clashStartHandler);
    }
}
