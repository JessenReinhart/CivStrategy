#!/usr/bin/env node

import { chromium } from 'playwright';
import fs from 'fs';
import { join } from 'path';

const STRESS_URL = 'http://localhost:5173/?stress=300&enableEnemies=true';
const VIEWPORT_W = 1440;
const VIEWPORT_H = 810;
const WARMUP_MS = 8000;
const CAPTURE_MS = 20000;
const UNITS_TARGET = 300;
const REPORT_PATH = join(process.cwd(), 'profile-results.json');
const JSONL_PATH = join(process.cwd(), 'progress-metrics.jsonl');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

(async () => {
  let browser;
  const consoleErrors = [];

  try {
    console.log(`[profile-stress] launching Chromium ${VIEWPORT_W}x${VIEWPORT_H} -> ${STRESS_URL}`);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-gpu', '--disable-dev-shm-usage'] });
    const ctx = await browser.newContext({ viewport: { width: VIEWPORT_W, height: VIEWPORT_H } });
    const page = await ctx.newPage();

    page.on('pageerror', e => consoleErrors.push(e.message));
    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error' || text.includes('ERROR') || text.includes('error')) consoleErrors.push(text);
      if (text.startsWith('[stress-wait]') || text.startsWith('[stress]')) console.log(text);
    });

    try {
      await page.goto(STRESS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      throw new Error(`Server unavailable at ${STRESS_URL}: ${e.message}`);
    }

    console.log('[profile-stress] page loaded, waiting for canvas...');
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('[profile-stress] canvas detected');

    console.log('[profile-stress] waiting for window.__perf API...');
    await page.waitForFunction(() => typeof window.__perf !== 'undefined', { timeout: 30000 });
    console.log('[profile-stress] __perf API available');

    console.log(`[profile-stress] waiting for ${UNITS_TARGET} units in active combat...`);
    await page.waitForFunction(
      (target) => {
        const p = window.__perf;
        if (!p || p.buffer.length === 0) {
          console.log('[stress-wait] no __perf buffer');
          return false;
        }
        const latest = p.buffer[p.buffer.length - 1];
        if (latest.units < target) {
          console.log(`[stress-wait] units ${latest.units} < ${target}`);
          return false;
        }
        const game = window.__civStrategyGame;
        if (!game) {
          console.log('[stress-wait] no __civStrategyGame');
          return false;
        }
        const scene = game.scene?.getScenes(true)?.[0];
        if (!scene) {
          console.log('[stress-wait] no active scene');
          return false;
        }
        if (!scene.liquidCombat) {
          console.log('[stress-wait] no scene.liquidCombat');
          return false;
        }
        if (!scene.liquidCombat.enabled) {
          console.log('[stress-wait] liquidCombat.enabled == false');
          return false;
        }
        if (scene.liquidCombat.contactLines.length === 0) {
          console.log('[stress-wait] contactLines.length == 0');
          return false;
        }
        const units = scene.units?.getChildren?.() || [];
        let hpLoss = false;
        for (const u of units) {
          const hp = u.getData?.('hp');
          const maxHp = u.getData?.('maxHp');
          if (hp !== undefined && maxHp !== undefined && hp < maxHp) { hpLoss = true; break; }
        }
        if (!hpLoss) {
          console.log('[stress-wait] no HP loss detected');
          return false;
        }
        console.log(`[stress-wait] combat OK: units=${latest.units}, contact=${scene.liquidCombat.contactLines.length}, hpLoss=true`);
        return true;
      },
      UNITS_TARGET,
      { timeout: 180000 }
    );

    console.log('[profile-stress] combat engagement confirmed');
    console.log(`[profile-stress] units >= ${UNITS_TARGET} confirmed in runtime`);

    console.log(`[profile-stress] warming up ${WARMUP_MS}ms...`);
    await sleep(WARMUP_MS);

    // Snapshot performance.now() immediately after warmup — filter capture to post-warmup
    const baseline = await page.evaluate(() => performance.now());
    console.log(`[profile-stress] baseline ${baseline.toFixed(0)}ms, capturing for ${CAPTURE_MS}ms...`);
    const captureStart = Date.now();

    const seenTimestamps = new Set();
    const allSamples = [];

    while (Date.now() - captureStart < CAPTURE_MS) {
      const newSamples = await page.evaluate(() => {
        const p = window.__perf;
        if (!p || p.buffer.length === 0) return [];
        return p.report().buffer;
      });

      for (const s of newSamples) {
        if (s.timestamp >= baseline && !seenTimestamps.has(s.timestamp)) {
          seenTimestamps.add(s.timestamp);
          allSamples.push(s);
        }
      }

      await sleep(500);
    }

    const durationMs = Date.now() - captureStart;
    console.log(`[profile-stress] captured ${allSamples.length} unique samples over ${durationMs}ms`);

    const frameTimes = allSamples.map(s => s.frameMs).sort((a, b) => a - b);
    const fpsList = allSamples.map(s => s.fps);

    const hogMap = new Map();
    for (const s of allSamples) {
      for (const h of s.hogs || []) {
        const prev = hogMap.get(h.name) ?? { ms: 0, pct: 0, n: 0 };
        hogMap.set(h.name, { ms: prev.ms + h.ms, pct: prev.pct + h.pct, n: prev.n + 1 });
      }
    }
    const topHogs = [...hogMap.entries()]
      .map(([name, v]) => ({ name, ms: +(v.ms / v.n).toFixed(2), pct: +(v.pct / v.n).toFixed(2) }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 8);

    const p50FrameMs = allSamples.length > 0 ? +percentile(frameTimes, 50).toFixed(2) : 0;
    const p95FrameMs = allSamples.length > 0 ? +percentile(frameTimes, 95).toFixed(2) : 0;
    const minFrameMs = allSamples.length > 0 ? +frameTimes[0].toFixed(2) : 0;
    const avgFps = allSamples.length > 0 ? +(fpsList.reduce((a, b) => a + b, 0) / fpsList.length).toFixed(2) : 0;
    const minFps = allSamples.length > 0 ? +Math.min(...fpsList).toFixed(2) : 0;
    const maxFps = allSamples.length > 0 ? +Math.max(...fpsList).toFixed(2) : 0;

    const hasSufficientData = allSamples.length >= 1 &&
      isFiniteNumber(p50FrameMs) && isFiniteNumber(p95FrameMs) &&
      isFiniteNumber(minFrameMs) && isFiniteNumber(avgFps) &&
      isFiniteNumber(minFps) && isFiniteNumber(maxFps);

    // Combat stress pass condition: maintain 60 FPS (p95 frame time <= 16.67ms)
    const pass = hasSufficientData && p95FrameMs <= 16.67 && minFps >= 60;

    let note;
    if (!hasSufficientData) {
      note = `units reached ${UNITS_TARGET} but ${allSamples.length === 0
        ? 'no post-warmup perf snapshot was emitted during capture window (game may be too slow to sample)'
        : `only ${allSamples.length} sample(s) with non-finite metrics`}`;
    } else if (!pass) {
      const reasons = [];
      if (p95FrameMs > 16.67) reasons.push(`p95 ${p95FrameMs}ms > 16.67ms`);
      if (minFps < 60) reasons.push(`min FPS ${minFps} < 60`);
      note = reasons.join('; ');
    } else {
      note = 'meets 60 FPS target under active combat';
    }

    const result = {
      timestamp: Date.now(),
      url: STRESS_URL,
      units: UNITS_TARGET,
      warmupMs: WARMUP_MS,
      durationMs,
      sampleCount: allSamples.length,
      p50FrameMs,
      p95FrameMs,
      minFrameMs,
      avgFps,
      minFps,
      maxFps,
      topHogs,
      pass,
      note,
      errors: consoleErrors.length > 0 ? consoleErrors : undefined,
    };

    console.log(`[profile-stress] ${result.sampleCount} samples, avg ${result.avgFps} FPS, p95 ${result.p95FrameMs}ms`);
    console.log(`[profile-stress] pass=${result.pass} -- ${result.note}`);

    fs.writeFileSync(REPORT_PATH, JSON.stringify(result, null, 2) + '\n');
    console.log(`[profile-stress] wrote ${REPORT_PATH}`);

    fs.appendFileSync(JSONL_PATH, JSON.stringify(result) + '\n');
    console.log(`[profile-stress] appended ${JSONL_PATH}`);

    await browser.close();
    process.exit(pass ? 0 : 1);

  } catch (error) {
    console.error('[profile-stress] failed:', error.message);

    const errorResult = {
      timestamp: Date.now(),
      url: STRESS_URL,
      units: UNITS_TARGET,
      warmupMs: WARMUP_MS,
      durationMs: 0,
      sampleCount: 0,
      p50FrameMs: 0,
      p95FrameMs: 0,
      minFrameMs: 0,
      avgFps: 0,
      minFps: 0,
      maxFps: 0,
      topHogs: [],
      pass: false,
      note: error.message,
      errors: consoleErrors.length > 0 ? consoleErrors : undefined,
    };

    try {
      fs.writeFileSync(REPORT_PATH, JSON.stringify(errorResult, null, 2) + '\n');
      console.log(`[profile-stress] wrote error result to ${REPORT_PATH}`);
      fs.appendFileSync(JSONL_PATH, JSON.stringify(errorResult) + '\n');
    } catch (e) {
      console.error('[profile-stress] failed to write error result:', e.message);
    }

    if (browser) {
      try { await browser.close(); } catch {}
    }
    process.exit(1);
  }
})();