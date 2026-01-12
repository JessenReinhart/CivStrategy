
/**
 * Simple Perlin Noise generator for cloud shadows.
 */
export class Noise {
    private p: number[] = new Array(512);

    constructor(seed: number = Math.random()) {
        const permutation = new Array(256).fill(0).map((_, i) => i);

        // Shuffle based on seed
        const random = () => {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };

        for (let i = 255; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
        }

        for (let i = 0; i < 512; i++) {
            this.p[i] = permutation[i & 255];
        }
    }

    private fade(t: number) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    private lerp(t: number, a: number, b: number) {
        return a + t * (b - a);
    }

    private grad(hash: number, x: number, y: number, z: number) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    public perlin2(x: number, y: number): number {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);

        const u = this.fade(x);
        const v = this.fade(y);

        const A = this.p[X] + Y;
        const AA = this.p[A];
        const AB = this.p[A + 1];
        const B = this.p[X + 1] + Y;
        const BA = this.p[B];
        const BB = this.p[B + 1];

        return this.lerp(v,
            this.lerp(u, this.grad(this.p[AA], x, y, 0), this.grad(this.p[BA], x - 1, y, 0)),
            this.lerp(u, this.grad(this.p[AB], x, y - 1, 0), this.grad(this.p[BB], x - 1, y - 1, 0))
        );
    }
}
