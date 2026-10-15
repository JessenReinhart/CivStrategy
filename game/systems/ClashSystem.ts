/**
 * ClashSystem - Triggers epic "meatgrinder" visual effects when armies clash
 */

import Phaser from 'phaser';
import { EVENTS } from '../../constants';
import { triggerMeatGrinder } from '../utils/MeatGrinderEffect';

export interface ClashAlert {
    x: number;
    y: number;
    timestamp: number;
}

export class ClashSystem {
    private scene: Phaser.Scene;
    private static readonly MAX_ALERTS = 16;
    private static activeAlerts: ClashAlert[] = [];

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
        ClashSystem.recordClashAlert(x, y, Date.now());
        triggerMeatGrinder(this.scene, x, y);
    }

    public static recordClashAlert(x: number, y: number, timestamp: number): void {
        this.activeAlerts.push({ x, y, timestamp });
        if (this.activeAlerts.length > this.MAX_ALERTS) {
            this.activeAlerts.shift();
        }
    }

    public static getActiveClashAlerts(currentTimeMs: number, maxAgeMs: number = 3000): ClashAlert[] {
        return this.activeAlerts.filter(alert => (currentTimeMs - alert.timestamp) <= maxAgeMs);
    }

    public static clearClashAlerts(): void {
        this.activeAlerts = [];
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
