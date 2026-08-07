#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'fs';

const URL_BASE = 'http://localhost:5173/';
const URL_STRESS = 'http://localhost:5173/?stress=5000';
const CAPTURE_MS = 20000;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function runSession(label, url, { clickStart = false, clickCommence = false } = {}) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  console.log(`[${label}] navigating to ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    throw new Error(`Server unavailable at ${url}: ${e.message}`);
  }

  // For normal mode: Phaser has no canvas until MainScene starts (empty scene array).
  // Click Start Game → Commence first, then canvas/__perf appear.
  if (clickStart) {
    console.log(`[${label}] clicking "Start Game" on menu...`);
    await page.click('text=Start Game');
    await new Promise(r => setTimeout(r, 1500));
  }
  if (clickCommence) {
    console.log(`[${label}] clicking "Commence"...`);
    await page.click('text=Commence');
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`[${label}] waiting for canvas...`);
  await page.waitForSelector('canvas', { timeout: 30000 });
  console.log(`[${label}] canvas detected`);

  // Wait for __perf API
  console.log(`[${label}] waiting for __perf API...`);
  await page.waitForFunction(() => typeof window !== 'undefined' && typeof window.__perf !== 'undefined', { timeout: 30000 });
  console.log(`[${label}] __perf available`);

  // Wait for at least 1 unit to spawn
  console.log(`[${label}] waiting for units...`);
  await page.waitForFunction(
    (target) => {
      const p = window.__perf;
      if (!p || p.buffer.length === 0) return false;
      const latest = p.buffer[p.buffer.length - 1];
      return latest.units >= target;
    },
    1,
    { timeout: 120000 }
  );

  // Reset buffer
  console.log(`[${label}] resetting buffer...`);
  await page.evaluate(() => window.__perf.reset());
  // Warmup: wait for buffer to accumulate samples (normal mode terrain gen blocks update loop)
  const warmupMs = clickStart ? 30000 : 5000; // normal mode needs longer warmup
  console.log(`[${label}] warming up ${warmupMs}ms...`);
  await new Promise(r => setTimeout(r, warmupMs));

  console.log(`[${label}] capturing ${CAPTURE_MS}ms...`);
  const captureStart = Date.now();
  await new Promise(r => setTimeout(r, CAPTURE_MS));
  const durationMs = Date.now() - captureStart;

  const result = await page.evaluate((lbl) => {
    const p = window.__perf;
    if (!p || !p.buffer || p.buffer.length === 0) return { label: lbl, error: 'no perf data', samples: 0 };

    const buf = p.buffer;
    const frameTimes = buf.map(s => s.frameMs).sort((a, b) => a - b);
    const fpsList = buf.map(s => s.fps);

    const latest = buf[buf.length - 1];
    const hogMap = new Map();
    for (const s of buf) {
      for (const h of s.hogs || []) {
        const prev = hogMap.get(h.name) || { ms: 0, pct: 0, n: 0 };
        hogMap.set(h.name, { ms: prev.ms + h.ms, pct: prev.pct + h.pct, n: prev.n + 1 });
      }
    }
    const topHogs = [...hogMap.entries()]
      .map(([name, v]) => ({ name, ms: +(v.ms / v.n).toFixed(2), pct: +(v.pct / v.n).toFixed(2) }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 8);

    const pidx = (arr, p) => arr.length === 0 ? 0 : arr[Math.ceil((p / 100) * arr.length) - 1];

    return {
      label: lbl,
      samples: buf.length,
      p50: +pidx(frameTimes, 50).toFixed(2),
      p95: +pidx(frameTimes, 95).toFixed(2),
      minFrameMs: +frameTimes[0].toFixed(2),
      avgFps: +(fpsList.reduce((a, b) => a + b, 0) / fpsList.length).toFixed(1),
      minFps: +Math.min(...fpsList).toFixed(1),
      maxFps: +Math.max(...fpsList).toFixed(1),
      units: latest.units,
      updateMs: +latest.updateMs.toFixed(2),
      renderMs: +latest.renderMs.toFixed(2),
      frameMs: +latest.frameMs.toFixed(2),
      topHogs,
    };
  }, label);

  console.log(`[${label}] done — ${result.samples} samples, ${result.units} units`);
  if (errors.length > 0) console.log(`[${label}] errors (${errors.length}):`, errors.slice(0, 3));
  await browser.close();
  return { label, durationMs, ...result };
}

(async () => {
  try {
    const normal = await runSession('NORMAL', URL_BASE, { clickStart: true, clickCommence: true });
    const stress = await runSession('STRESS', URL_STRESS, {});

    console.log('\n═══ COMPARISON ═══');
    console.log(`Normal: p50=${normal.p50}ms p95=${normal.p95}ms avg=${normal.avgFps}fps min=${normal.minFps}fps ${normal.units} units`);
    console.log(`Stress: p50=${stress.p50}ms p95=${stress.p95}ms avg=${stress.avgFps}fps min=${stress.minFps}fps ${stress.units} units`);
    console.log('\nNormal topHogs:', JSON.stringify(normal.topHogs));
    console.log('Stress topHogs:', JSON.stringify(stress.topHogs));

    const stressPass = stress.p95 <= 16.67 && stress.minFps >= 60;
    const normalPass = normal.p95 <= 16.67 && normal.minFps >= 60;
    console.log(`\nStress 60FPS gate: ${stressPass ? 'PASS' : 'FAIL'}`);
    console.log(`Normal 60FPS gate: ${normalPass ? 'PASS' : 'FAIL'}`);

    const out = { normal, stress, gates: { stressPass, normalPass } };
    fs.writeFileSync('comparison-results.json', JSON.stringify(out, null, 2) + '\n');
    console.log('\nWrote comparison-results.json');

  } catch (err) {
    console.error('FATAL:', err.message);
    process.exit(1);
  }
})();
