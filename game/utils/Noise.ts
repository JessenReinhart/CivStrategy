
/**
 * Perlin Noise generator with mulberry32 PRNG and positive floor wrapping (R23, R34).
 */
export class Noise {
    private p: number[] = new Array(512);

    constructor(seed: number = Math.random()) {
        const permutation = new Array(256).fill(0).map((_, i) => i);

        // R34: mulberry32 32-bit PRNG replaces low-period LCG (mod 233280)
        let s = (Math.floor(Math.abs(seed) * 1000000) ^ 0xa5a5a5a5) >>> 0;
        if (s === 0) s = 1;
        const random = () => {
            s = (s + 0x6d2b79f5) >>> 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };

        // Fisher-Yates shuffle with unbiased uniform integer selection
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            const tmp = permutation[i];
            permutation[i] = permutation[j];
            permutation[j] = tmp;
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
        // R23: mathematically sound floor that correctly handles negative coordinates
        const fx = Math.floor(x);
        const fy = Math.floor(y);
        const X = ((fx % 256) + 256) & 255;
        const Y = ((fy % 256) + 256) & 255;

        x -= fx;
        y -= fy;

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
