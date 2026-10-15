import Phaser from 'phaser';
import { FormationType } from '../../types';

export class FormationSystem {
    public static getFormationOffsets(
        type: FormationType,
        count: number,
        spacing: number,
        facingAngleRad?: number,
    ): Phaser.Math.Vector2[] {
        let offsets: Phaser.Math.Vector2[];

        switch (type) {
            case FormationType.LINE:
                offsets = this.getLineOffsets(count, spacing);
                break;
            case FormationType.CIRCLE:
                offsets = this.getCircleOffsets(count, spacing);
                break;
            case FormationType.SKIRMISH:
                offsets = this.getSkirmishOffsets(count, spacing);
                break;
            case FormationType.WEDGE:
                offsets = this.getWedgeOffsets(count, spacing);
                break;
            case FormationType.BOX:
            default:
                offsets = this.getBoxOffsets(count, spacing);
                break;
        }

        if (facingAngleRad !== undefined && facingAngleRad !== 0) {
            return this.rotateFormationOffsets(offsets, facingAngleRad);
        }
        return offsets;
    }

    /**
     * Rotates formation offsets around the group centroid so rank and file
     * align perpendicularly or along the unit movement heading.
     */
    public static rotateFormationOffsets(
        offsets: Phaser.Math.Vector2[],
        facingAngleRad: number,
    ): Phaser.Math.Vector2[] {
        const cos = Math.cos(facingAngleRad);
        const sin = Math.sin(facingAngleRad);
        return offsets.map(o => new Phaser.Math.Vector2(
            o.x * cos - o.y * sin,
            o.x * sin + o.y * cos,
        ));
    }

    private static getBoxOffsets(count: number, spacing: number): Phaser.Math.Vector2[] {
        const offsets: Phaser.Math.Vector2[] = [];
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);

        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = (col - cols / 2 + 0.5) * spacing;
            const y = (row - rows / 2 + 0.5) * spacing;
            offsets.push(new Phaser.Math.Vector2(x, y));
        }
        return offsets;
    }

    private static getLineOffsets(count: number, spacing: number): Phaser.Math.Vector2[] {
        const offsets: Phaser.Math.Vector2[] = [];
        // Center the line on 0
        const totalWidth = (count - 1) * spacing;
        const startX = -totalWidth / 2;

        for (let i = 0; i < count; i++) {
            offsets.push(new Phaser.Math.Vector2(startX + i * spacing, 0));
        }
        return offsets;
    }

    private static getCircleOffsets(count: number, spacing: number): Phaser.Math.Vector2[] {
        const offsets: Phaser.Math.Vector2[] = [];
        // Radius depends on count to avoid cramping
        // Circumference ~= count * spacing => 2*pi*r = count*spacing => r = (count*spacing) / (2*pi)
        // Minimum radius for small counts
        const radius = Math.max(spacing, (count * spacing) / (2 * Math.PI));

        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            offsets.push(new Phaser.Math.Vector2(
                Math.cos(angle) * radius,
                Math.sin(angle) * radius
            ));
        }
        return offsets;
    }

    private static getSkirmishOffsets(count: number, spacing: number): Phaser.Math.Vector2[] {
        const offsets: Phaser.Math.Vector2[] = [];
        // Deterministic pseudo-randomness or just random if it's generated once?
        // Better to be deterministic so dragging doesn't jitter
        // We'll use a simple spiral or seeded random feel

        for (let i = 0; i < count; i++) {
            // Golden angle spiral for natural distribution
            const angle = i * 2.39996; // ~137.5 degrees
            const r = spacing * Math.sqrt(i);
            offsets.push(new Phaser.Math.Vector2(
                Math.cos(angle) * r,
                Math.sin(angle) * r
            ));
        }
        return offsets;
    }

    private static getWedgeOffsets(count: number, spacing: number): Phaser.Math.Vector2[] {
        const offsets: Phaser.Math.Vector2[] = [];
        let currentRow = 0;
        let inRow = 0;

        for (let i = 0; i < count; i++) {
            const capacity = currentRow + 1; // 1, 2, 3...

            // X center for this row
            const rowWidth = (capacity - 1) * spacing;
            const startX = -rowWidth / 2;

            const x = startX + inRow * spacing;
            const y = currentRow * spacing;

            offsets.push(new Phaser.Math.Vector2(x, y));

            inRow++;
            if (inRow >= capacity) {
                inRow = 0;
                currentRow++;
            }
        }

        // Recenter logic: Compute centroid
        let sumX = 0;
        let sumY = 0;
        offsets.forEach(o => { sumX += o.x; sumY += o.y; });
        const avgX = sumX / count;
        const avgY = sumY / count;

        return offsets.map(o => new Phaser.Math.Vector2(o.x - avgX, o.y - avgY));
    }
}
