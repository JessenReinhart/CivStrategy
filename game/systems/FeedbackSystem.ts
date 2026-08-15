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

    // ── Object pools for ephemeral damage/spark/text/impact effects ─────
    private textPool: Phaser.GameObjects.Text[] = [];
    private sparkPool: Phaser.GameObjects.Arc[] = [];
    private floatingTextPool: Phaser.GameObjects.Text[] = [];
    private deathRingPool: Phaser.GameObjects.Arc[] = [];
    private deathFlashPool: Phaser.GameObjects.Arc[] = [];

    private activeText = 0;
    private activeSpark = 0;
    private activeFloatingText = 0;
    private activeDeathRing = 0;
    private activeDeathFlash = 0;

    private static readonly MAX_ACTIVE_TEXT = 80;
    private static readonly MAX_ACTIVE_SPARK = 120;
    private static readonly MAX_ACTIVE_FLOATING_TEXT = 60;
    private static readonly MAX_ACTIVE_DEATH_RING = 40;
    private static readonly MAX_ACTIVE_DEATH_FLASH = 40;

    private static readonly MAX_POOL_TEXT = 80;
    private static readonly MAX_POOL_SPARK = 120;
    private static readonly MAX_POOL_FLOATING_TEXT = 60;
    private static readonly MAX_POOL_DEATH_RING = 40;
    private static readonly MAX_POOL_DEATH_FLASH = 40;

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

    // ── Notification helpers ─────────────────────────────────────────────

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

    // ── Pool helpers ──────────────────────────────────────────────────────

    private acquireText(): Phaser.GameObjects.Text | null {
        if (this.activeText >= FeedbackSystem.MAX_ACTIVE_TEXT) return null;
        const text = this.textPool.pop() ?? this.scene.add.text(0, 0, '', {
            fontFamily: 'Arial', fontSize: '16px', fontStyle: 'bold',
            stroke: '#000000', strokeThickness: 4
        });
        this.activeText++;
        text.setActive(true).setVisible(true).setAlpha(1).setScale(1);
        return text;
    }

    private releaseText(text: Phaser.GameObjects.Text): void {
        text.setActive(false).setVisible(false).setAlpha(0);
        this.activeText = Math.max(0, this.activeText - 1);
        if (this.textPool.length < FeedbackSystem.MAX_POOL_TEXT) this.textPool.push(text);
    }

    private acquireSpark(): Phaser.GameObjects.Arc | null {
        if (this.activeSpark >= FeedbackSystem.MAX_ACTIVE_SPARK) return null;
        const spark = this.sparkPool.pop() ?? this.scene.add.circle(0, 0, 3, 0xffffff, 1);
        this.activeSpark++;
        spark.setActive(true).setVisible(true).setAlpha(1).setScale(1);
        return spark;
    }

    private releaseSpark(spark: Phaser.GameObjects.Arc): void {
        spark.setActive(false).setVisible(false).setAlpha(0);
        this.activeSpark = Math.max(0, this.activeSpark - 1);
        if (this.sparkPool.length < FeedbackSystem.MAX_POOL_SPARK) this.sparkPool.push(spark);
    }

    private acquireFloatingText(): Phaser.GameObjects.Text | null {
        if (this.activeFloatingText >= FeedbackSystem.MAX_ACTIVE_FLOATING_TEXT) return null;
        const text = this.floatingTextPool.pop() ?? this.scene.add.text(0, 0, '', {
            fontFamily: 'Arial', fontSize: '14px', stroke: '#000000', strokeThickness: 3,
        });
        this.activeFloatingText++;
        text.setActive(true).setVisible(true).setAlpha(1).setScale(1);
        return text;
    }

    private releaseFloatingText(text: Phaser.GameObjects.Text): void {
        text.setActive(false).setVisible(false).setAlpha(0);
        this.activeFloatingText = Math.max(0, this.activeFloatingText - 1);
        if (this.floatingTextPool.length < FeedbackSystem.MAX_POOL_FLOATING_TEXT) {
            this.floatingTextPool.push(text);
        }
    }

    private acquireDeathRing(): Phaser.GameObjects.Arc | null {
        if (this.activeDeathRing >= FeedbackSystem.MAX_ACTIVE_DEATH_RING) return null;
        const ring = this.deathRingPool.pop() ?? this.scene.add.circle(0, 0, 8, 0xffffff, 0.6);
        this.activeDeathRing++;
        ring.setActive(true).setVisible(true).setAlpha(0.6).setScale(1);
        return ring;
    }

    private releaseDeathRing(ring: Phaser.GameObjects.Arc): void {
        ring.setActive(false).setVisible(false).setAlpha(0);
        this.activeDeathRing = Math.max(0, this.activeDeathRing - 1);
        if (this.deathRingPool.length < FeedbackSystem.MAX_POOL_DEATH_RING) {
            this.deathRingPool.push(ring);
        }
    }

    private acquireDeathFlash(): Phaser.GameObjects.Arc | null {
        if (this.activeDeathFlash >= FeedbackSystem.MAX_ACTIVE_DEATH_FLASH) return null;
        const flash = this.deathFlashPool.pop() ?? this.scene.add.circle(0, 0, 12, 0xffffff, 0.8);
        this.activeDeathFlash++;
        flash.setActive(true).setVisible(true).setAlpha(0.8).setScale(1);
        return flash;
    }

    private releaseDeathFlash(flash: Phaser.GameObjects.Arc): void {
        flash.setActive(false).setVisible(false).setAlpha(0);
        this.activeDeathFlash = Math.max(0, this.activeDeathFlash - 1);
        if (this.deathFlashPool.length < FeedbackSystem.MAX_POOL_DEATH_FLASH) {
            this.deathFlashPool.push(flash);
        }
    }

    // ── Damage feedback ──────────────────────────────────────────────────

    showDamageNumber(x: number, y: number, damage: number, damageType?: string): void {
        const iso = toIso(x, y);
        const colorMap: Record<string, string> = { Hack: '#ef4444', Pierce: '#f97316', Crush: '#fbbf24' };
        const text = this.acquireText();
        if (!text) return;
        text.setText(`-${damage}`).setColor(damageType ? (colorMap[damageType] || '#ef4444') : '#ef4444');
        text.setPosition(iso.x + Phaser.Math.Between(-15, 15), iso.y - 30).setOrigin(0.5).setDepth(Number.MAX_VALUE);
        this.scene.tweens.add({ targets: text, y: iso.y - 80, alpha: 0, duration: 1200, onComplete: () => this.releaseText(text) });
    }

    showHitSpark(x: number, y: number, damageType?: string): void {
        const iso = toIso(x, y);
        const colorMap: Record<string, number> = { Hack: 0xff4444, Pierce: 0xff8800, Crush: 0xffcc00 };
        const color = damageType ? (colorMap[damageType] ?? 0xff4444) : 0xffffff;
        for (let i = 0; i < 3; i++) {
            const spark = this.acquireSpark();
            if (!spark) break;
            spark.setFillStyle(color, 1).setRadius(Phaser.Math.Between(2, 4));
            spark.setPosition(iso.x + Phaser.Math.Between(-8, 8), iso.y + Phaser.Math.Between(-8, 8)).setDepth(Number.MAX_VALUE - 1);
            this.scene.tweens.add({ targets: spark, x: iso.x + Phaser.Math.Between(-20, 20), y: iso.y + Phaser.Math.Between(-30, -10), alpha: 0, scale: 0.1, duration: Phaser.Math.Between(200, 400), onComplete: () => this.releaseSpark(spark) });
        }
    }

    // ── Floating text ────────────────────────────────────────────────────

    showFloatingText(x: number, y: number, message: string, color: string = '#ffffff'): void {
        const iso = toIso(x, y);
        const text = this.acquireFloatingText();
        if (!text) return;
        text.setText(message).setColor(color);
        text.setPosition(iso.x, iso.y - 50).setOrigin(0.5).setDepth(Number.MAX_VALUE);
        this.scene.tweens.add({ targets: text, y: iso.y - 100, alpha: 0, duration: 1500, onComplete: () => this.releaseFloatingText(text) });
    }

    showFloatingResource(x: number, y: number, amount: number, type: string): void {
        const colorMap: Record<string, string> = { 'Wood': '#4ade80', 'Food': '#facc15', 'Gold': '#fbbf24' };
        this.showFloatingText(x, y, `+${amount} ${type}`, colorMap[type] || '#ffffff');
    }

    showDeathEffect(x: number, y: number, color: number = 0xff4444): void {
        const iso = toIso(x, y);

        // Expanding ring effect
        const ring = this.acquireDeathRing();
        if (ring) {
            ring.setFillStyle(color, 0.6);
            ring.setPosition(iso.x, iso.y).setScale(1, 1).setDepth(Number.MAX_VALUE - 1);
            this.scene.tweens.add({
                targets: ring,
                scaleX: 2.5,
                scaleY: 1.5,
                alpha: 0,
                duration: 500,
                onComplete: () => this.releaseDeathRing(ring),
            });
        }

        // Flash
        const flash = this.acquireDeathFlash();
        if (flash) {
            flash.setPosition(iso.x, iso.y).setScale(1).setDepth(Number.MAX_VALUE);
            this.scene.tweens.add({
                targets: flash,
                alpha: 0,
                scale: 0.3,
                duration: 200,
                onComplete: () => this.releaseDeathFlash(flash),
            });
        }
    }
}
