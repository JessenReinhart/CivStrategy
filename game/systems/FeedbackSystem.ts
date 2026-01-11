import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { toIso } from '../utils/iso';

export class FeedbackSystem {
    private scene: MainScene;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

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
}
