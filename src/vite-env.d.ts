/// <reference types="vite/client" />
export {};


declare global {
  interface PerfSnapshot {
    timestamp: number;
    fps: number;
    frameMs: number;
    updateMs: number;
    renderMs: number;
    wallMs: number; // True rAF wall time between updates (includes Phaser overhead)
    phaserDeltaMs: number; // Phaser delta per-frame (may differ from wall due to loop capping)
    units: number;
    hogs: { name: string; ms: number; pct: number }[];
  }
  interface PerfAPI {
    readonly maxSamples: number;
    buffer: PerfSnapshot[];
    latest: PerfSnapshot | null;
    bind(scene: { gameTime: number; atmosphericSystem?: { setPostFXEnabled(enabled: boolean): void }; waterAnimationEnabled: boolean }): void;
    reset(): void;
    setPostFX(enabled: boolean): void;
    setWaterAnimation(enabled: boolean): void;
    report(): { buffer: PerfSnapshot[]; summary: PerfSnapshot | null; elapsedS: number };
  }
  interface Window { __perf: PerfAPI; }
}
