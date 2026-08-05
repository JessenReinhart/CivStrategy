import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { toIso } from '../utils/iso';
import { EVENTS } from '../../constants';

export interface Notification {
    id: number;
    text: string;
    severity: 'info' | 'warning' | 'danger' | 'success';
    timestamp: number;
    duration: number;
    personality?: string;
    senderName?: string;
}

export class FeedbackSystem {
    private scene: MainScene;
    private notifications: Notification[] = [];
    private nextId = 1;
    private static readonly MAX_NOTIFICATIONS = 50;

    constructor(scene: MainScene) {
        this.scene = scene;
        this.scene.events.on(EVENTS.NOTIFICATION, (data: { text: string; severity?: Notification['severity']; duration?: number }) => {
            this.addNotification(data.text, data.severity ?? 'info', data.duration);
        });
    }

    addNotification(text: string, severity: Notification['severity'] = 'info', duration = 4000, personality?: string, senderName?: string): number {
        const id = this.nextId++;
        this.notifications.push({ id, text, severity, timestamp: Date.now(), duration, personality, senderName });
        if (this.notifications.length > FeedbackSystem.MAX_NOTIFICATIONS) {
            this.notifications.shift();
        }
        return id;
    }

    getNotifications(): readonly Notification[] {
        return this.notifications;
    }

    dismissNotification(id: number): void {
        this.notifications = this.notifications.filter(n => n.id !== id);
    }

    update(_time: number, _delta: number): void {
        const now = Date.now();
        this.notifications = this.notifications.filter(n => now - n.timestamp < n.duration);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    notifyResearchComplete(techName: string): void {
        this.addNotification(`Research complete: ${techName}`, 'success');
    }

    notifyEnemyApproaching(): void {
        this.addNotification('Enemy forces are approaching!', 'danger');
    }

    notifyAnimalDepleted(species: string): void {
        this.addNotification(`${species} population depleted`, 'warning');
    }

    notifySeasonChanged(season: string): void {
        this.addNotification(`Season changed to ${season}`, 'info');
    }

    notifyHappinessCritical(): void {
        this.addNotification('Happiness critically low — revolt risk!', 'danger');
    }

    notifyBuildingDestroyed(buildingName: string): void {
        const isCritical = buildingName === 'Town Center';
        this.addNotification(
            isCritical ? '⚠️ Town Center destroyed!' : `⚠️ ${buildingName} destroyed!`,
            'danger',
            isCritical ? 10000 : 6000,
        );
    }

    notifyBuildingComplete(buildingName: string): void {
        this.addNotification(`${buildingName} built`, 'success', 3000);
    }

    notifyUnitKilled(unitName: string, isPlayer: boolean): void {
        if (isPlayer) {
            this.addNotification(`💀 ${unitName} lost!`, 'danger', 4000);
        }
    }

    notifyBuildingDamaged(buildingName: string, hpPercent: number): void {
        this.addNotification(`⚠️ ${buildingName} under attack! (${Math.round(hpPercent * 100)}% HP)`, 'warning', 5000);
    }

    /** Notify the player of an AI taunt with personality context. */
    notifyAITaunt(personality: string, senderName: string, message: string): void {
        this.addNotification(`💬 ${message}`, 'warning', 6000, personality, senderName);
    }

    showDamageNumber(x: number, y: number, damage: number, damageType?: string): void {
        const iso = toIso(x, y);
        const colorMap: Record<string, string> = {
            'Hack': '#ef4444',    // red
            'Pierce': '#f97316',  // orange
            'Crush': '#fbbf24',   // amber
        };
        const color = damageType ? (colorMap[damageType] || '#ef4444') : '#ef4444';
        const text = this.scene.add.text(
            iso.x + Phaser.Math.Between(-15, 15),
            iso.y - 30,
            `-${damage}`,
            {
                fontFamily: 'Arial', fontSize: '16px', fontStyle: 'bold',
                color: color, stroke: '#000000', strokeThickness: 4
            }
        );
        text.setOrigin(0.5).setDepth(Number.MAX_VALUE);
        this.scene.tweens.add({
            targets: text,
            y: iso.y - 80,
            alpha: 0,
            duration: 1200,
            onComplete: () => text.destroy()
        });
    }

    showHitSpark(x: number, y: number, damageType?: string): void {
        const iso = toIso(x, y);
        const colorMap: Record<string, number> = {
            'Hack': 0xff4444,
            'Pierce': 0xff8800,
            'Crush': 0xffcc00,
        };
        const color = damageType ? (colorMap[damageType] ?? 0xff4444) : 0xffffff;

        const count = 3;
        for (let i = 0; i < count; i++) {
            const spark = this.scene.add.circle(
                iso.x + Phaser.Math.Between(-8, 8),
                iso.y + Phaser.Math.Between(-8, 8),
                Phaser.Math.Between(2, 4),
                color, 1
            );
            spark.setDepth(Number.MAX_VALUE - 1);
            this.scene.tweens.add({
                targets: spark,
                x: iso.x + Phaser.Math.Between(-20, 20),
                y: iso.y + Phaser.Math.Between(-30, -10),
                alpha: 0,
                scale: 0.1,
                duration: Phaser.Math.Between(200, 400),
                onComplete: () => spark.destroy()
            });
        }
     }

    // ── Floating text (unchanged) ───────────────────────────────────────

    showFloatingText(x: number, y: number, message: string, color: string = '#ffffff') {
        const iso = toIso(x, y);
        const text = this.scene.add.text(iso.x, iso.y - 50, message, {
            fontFamily: 'Arial', fontSize: '14px', color: color, stroke: '#000000', strokeThickness: 3
        });
        text.setOrigin(0.5).setDepth(Number.MAX_VALUE);
        this.scene.tweens.add({ targets: text, y: iso.y - 100, alpha: 0, duration: 1500, onComplete: () => text.destroy() });
    }

    showFloatingResource(x: number, y: number, amount: number, type: string) {
        const colorMap: Record<string, string> = { 'Wood': '#4ade80', 'Food': '#facc15', 'Gold': '#fbbf24' };
        this.showFloatingText(x, y, `+${amount} ${type}`, colorMap[type] || '#ffffff');
    }
    showDeathEffect(x: number, y: number, color: number = 0xff4444): void {
        const iso = toIso(x, y);

        // Expanding ring effect
        const ring = this.scene.add.circle(iso.x, iso.y, 8, color, 0.6);
        ring.setDepth(Number.MAX_VALUE - 1);
        this.scene.tweens.add({
            targets: ring,
            scaleX: 2.5,
            scaleY: 1.5, // Compressed for isometric perspective
            alpha: 0,
            duration: 500,
            onComplete: () => ring.destroy()
        });

        // Flash
        const flash = this.scene.add.circle(iso.x, iso.y, 12, 0xffffff, 0.8);
        flash.setDepth(Number.MAX_VALUE);
        this.scene.tweens.add({
            targets: flash,
            alpha: 0,
            scale: 0.3,
            duration: 200,
            onComplete: () => flash.destroy()
        });
    }
}
