/**
 * PathCritic Profiling Harness
 * Paste into browser console or eval via puppeteer.
 * Requires: DEV-ONLY-PROBE in PhaserGame.tsx (window.__civStrategyGame)
 *
 * Usage:
 *   await runProfiler({ unitCount: 500, phases: ['idle','flow','jps'] })
 *   await runProfiler({ unitCount: 1000, phases: ['idle','flow','jps'] })
 *   await takeHeapSnapshot('label')
 */

// ── Helpers ────────────────────────────────────────────────────────────────

function getScene() {
  const game = window.__civStrategyGame;
  if (!game) throw new Error('__civStrategyGame not found on window');
  const scene = game.scene.getScene('MainScene');
  if (!scene) throw new Error('MainScene not active');
  return scene;
}

function delay(ms) {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(resolve, ms);
  return promise;
}

function sampleFrameMetrics(scene, durationMs) {
  const samples = [];
  const start = performance.now();
  return new Promise(resolve => {
    const interval = setInterval(() => {
      const now = performance.now();
      const elapsed = now - start;
      samples.push({
        t: Math.round(elapsed),
        fps: Math.round(scene.game.loop.actualFps),
        units: scene.units.getLength(),
        frameCount: scene.profileFrameCount,
        timings: JSON.parse(JSON.stringify(scene.profileTimings)),
      });
      if (elapsed >= durationMs) {
        clearInterval(interval);
        resolve(samples);
      }
    }, 100);
  });
}

function computeStats(samples) {
  const fpsValues = samples.map(s => s.fps).filter(f => f > 0);
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const lastTimings = samples[samples.length - 1]?.timings || {};
  return {
    fps: { avg: avg(fpsValues), min: Math.min(...fpsValues), max: Math.max(...fpsValues) },
    sampleCount: samples.length,
    unitCount: samples[0]?.units || 0,
    systemTimings: lastTimings,
  };
}

// ── Main Profiler ──────────────────────────────────────────────────────────

async function runProfiler({ unitCount = 500, phases = ['idle', 'flow', 'jps'], phaseDurationMs = 15000 }) {
  const scene = getScene();
  const results = {};

  // Trigger stress test if not already running
  const currentUnits = scene.units.getLength();
  if (currentUnits < unitCount * 0.8) {
    console.warn(`[PROBE] Triggering stress test for ${unitCount} units...`);
    window.dispatchEvent(new CustomEvent('stressTestStart', {
      detail: { unitCount, enableEnemies: false }
    }));
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (scene.units.getLength() >= unitCount * 0.9) {
          clearInterval(check);
          resolve();
        }
      }, 200);
    });
    await delay(3000); // let scene settle
  }

  const actualUnits = scene.units.getLength();
  console.warn(`[PROBE] ${actualUnits} units ready. Phases: ${phases.join(', ')}`);

  // ── Phase: IDLE ──
  if (phases.includes('idle')) {
    console.warn(`[PROBE] IDLE phase (${phaseDurationMs}ms) — stopping all movement...`);
    const allUnits = scene.units.getChildren();
    for (const u of allUnits) {
      u.flowTarget = undefined;
      u.setData('_flowField', undefined);
      u.path = null;
      u.body.reset(u.x, u.y);
    }
    const samples = await sampleFrameMetrics(scene, phaseDurationMs);
    results.idle = computeStats(samples);
    console.warn(`[PROBE] IDLE done:`, results.idle);
  }

  // ── Phase: FLOW FIELD ──
  if (phases.includes('flow')) {
    console.warn(`[PROBE] FLOW FIELD phase — mass move to (4000, 4000)...`);
    const allUnits = scene.units.getChildren();
    const targetX = 4000;
    const targetY = 4000;

    // Clear cache so generateFlowField actually computes
    scene.pathfinder.flowFieldCache.clear();
    const beforeFF = scene.pathfinder.flowFieldsGenerated;
    const beforePaths = scene.pathfinder.pathsComputed;

    // Issue command — triggers generateFlowField + per-unit steering assignment
    scene.unitSystem.commandMove(allUnits, new Phaser.Math.Vector2(targetX, targetY), false);

    const ffSpike = scene.pathfinder.flowFieldsGenerated - beforeFF;
    const pathSpike = scene.pathfinder.pathsComputed - beforePaths;
    console.warn(`[PROBE] Flow fields gen: ${ffSpike}, Paths computed: ${pathSpike}`);

    const samples = await sampleFrameMetrics(scene, phaseDurationMs);
    results.flow = computeStats(samples);
    results.flow.flowFieldSpike = { flowFieldGenerated: ffSpike, pathsComputed: pathSpike };
    console.warn(`[PROBE] FLOW done:`, results.flow);
  }

  // ── Phase: JPS SPIKE (synchronous findPath per unit) ──
  if (phases.includes('jps')) {
    console.warn(`[PROBE] JPS SPIKE — queue=true triggers N synchronous findPath calls...`);
    const allUnits = scene.units.getChildren();

    // Stop all movement first
    for (const u of allUnits) {
      u.flowTarget = undefined;
      u.setData('_flowField', undefined);
      u.path = null;
      u.body.reset(u.x, u.y);
    }
    await delay(500);

    scene.pathfinder.flowFieldCache.clear();
    const pathsBefore = scene.pathfinder.pathsComputed;

    // Measure the actual synchronous spike duration
    const spikeStart = performance.now();
    scene.unitSystem.commandMove(allUnits, new Phaser.Math.Vector2(100, 100), true);
    const spikeMs = performance.now() - spikeStart;

    const pathsComputed = scene.pathfinder.pathsComputed - pathsBefore;
    console.warn(`[PROBE] JPS spike: ${pathsComputed} paths in ${spikeMs.toFixed(1)}ms (${(spikeMs / pathsComputed).toFixed(3)}ms/path)`);

    // Sample frames after spike for recovery
    const samples = await sampleFrameMetrics(scene, phaseDurationMs);
    results.jps = computeStats(samples);
    results.jps.spikeStats = {
      totalPaths: pathsComputed,
      spikeMs: Math.round(spikeMs),
      msPerPath: Math.round((spikeMs / pathsComputed) * 1000) / 1000,
    };
    console.warn(`[PROBE] JPS done:`, results.jps);
  }

  // ── Summary ──
  console.warn('\n[PROBE] ═══════════════════════════════════════════════════');
  console.warn(`[PROBE] VERDICT SUMMARY — ${actualUnits} units`);
  console.warn('[PROBE] ═══════════════════════════════════════════════════');
  for (const [phase, data] of Object.entries(results)) {
    const extra = data.spikeStats ? ` | JPS spike: ${data.spikeStats.spikeMs}ms` : '';
    const ffExtra = data.flowFieldSpike ? ` | FF gen: ${data.flowFieldSpike.flowFieldGenerated}` : '';
    console.warn(`[PROBE] ${phase.toUpperCase()}: avg ${data.fps.avg.toFixed(1)} FPS, min ${data.fps.min}, max ${data.fps.max}${extra}${ffExtra}`);
  }
  console.warn('[PROBE] ═══════════════════════════════════════════════════');

  return results;
}

// ── Heap Snapshot ──────────────────────────────────────────────────────────

async function takeHeapSnapshot(label = 'default') {
  const scene = getScene();
  const unitCount = scene.units.getLength();
  const mem = performance.memory;
  const info = mem
    ? { usedJSHeapSize: mem.usedJSHeapSize, totalJSHeapSize: mem.totalJSHeapSize }
    : { usedJSHeapSize: 'N/A', totalJSHeapSize: 'N/A' };
  const mb = typeof info.usedJSHeapSize === 'number' ? (info.usedJSHeapSize / 1048576).toFixed(1) : 'N/A';
  console.warn(`[HEAP] ${label}: ${unitCount} units, JS Heap: ${mb}MB`);
  return { label, unitCount, ...info };
}

// ── Quick Read ─────────────────────────────────────────────────────────────

function quickRead() {
  const scene = getScene();
  return {
    units: scene.units.getLength(),
    fps: Math.round(scene.game.loop.actualFps),
    pathCacheStats: scene.pathfinder.getCacheStats(),
    profileTimings: { ...scene.profileTimings },
  };
}
