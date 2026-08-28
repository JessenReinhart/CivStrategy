#!/usr/bin/env node

import { chromium } from 'playwright';
import fs from 'fs';
import { join } from 'path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 5173;
const STRESS_URL = `http://localhost:${PORT}/?stress=city&density=high`;
const VIEWPORT_W = 1440;
const VIEWPORT_H = 810;
const WARMUP_MS = 8000;
const CAPTURE_MS = 20000;
const MIN_AMBIENT = 150;
const MIN_BUILDINGS = 20;
const REPORT_PATH = join(process.cwd(), 'profile-city-results.json');
const JSONL_PATH = join(process.cwd(), 'progress-metrics.jsonl');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}`);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await sleep(250);
  }
  throw new Error(`Vite did not become ready.\n${serverOutput}`);
}

async function stopServer() {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), sleep(2_000)]);
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
}

(async () => {
  let browser;
  const consoleErrors = [];

  try {
    await waitForServer();

    console.log(`[profile-city-density] launching Chromium ${VIEWPORT_W}x${VIEWPORT_H} -> ${STRESS_URL}`);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-gpu', '--disable-dev-shm-usage'] });
    const ctx = await browser.newContext({ viewport: { width: VIEWPORT_W, height: VIEWPORT_H } });
    const page = await ctx.newPage();

    page.on('pageerror', (e) => consoleErrors.push(e.message));
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' || text.includes('ERROR') || text.includes('error')) consoleErrors.push(text);
      if (text.startsWith('[stress-wait]') || text.startsWith('[city-stress]')) console.log(text);
    });

    try {
      await page.goto(STRESS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      throw new Error(`Server unavailable at ${STRESS_URL}: ${e.message}`);
    }

    console.log('[profile-city-density] page loaded, waiting for canvas...');
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('[profile-city-density] canvas detected');

    console.log('[profile-city-density] waiting for window.__perf API...');
    await page.waitForFunction(() => typeof window.__perf !== 'undefined', { timeout: 30000 });
    console.log('[profile-city-density] __perf API available');

    console.log('[profile-city-density] waiting for city scene readiness...');
    await page.waitForFunction(
      () => {
        const game = window.__civStrategyGame;
        if (!game) {
          console.log('[stress-wait] no __civStrategyGame');
          return false;
        }
        const scenes = game.scene?.getScenes(true);
        const scene = scenes?.[0];
        if (!scene) {
          console.log('[stress-wait] no active scene');
          return false;
        }
        if (!scene.isReady) {
          console.log('[stress-wait] scene not ready');
          return false;
        }
        const buildingCount = scene.buildings?.getLength?.() ?? 0;
        if (buildingCount < 20) {
          console.log(`[stress-wait] buildings ${buildingCount} < ${20}`);
          return false;
        }
        const ambientCount = scene.getAmbientCitizenCount?.() ?? 0;
        if (ambientCount < 150) {
          console.log(`[stress-wait] ambient ${ambientCount} < ${150}`);
          return false;
        }
        const population = scene.population ?? 0;
        if (population < 100) {
          console.log(`[stress-wait] population ${population} < 100`);
          return false;
        }
        console.log(`[stress-wait] city ready: buildings=${buildingCount}, ambient=${ambientCount}, population=${population}`);
        return true;
      },
      { timeout: 180000 },
    );

    console.log('[profile-city-density] city settlement confirmed');

    // Verify ambient citizens are not gameplay units.
    const ambientIsolation = await page.evaluate(() => {
      const game = window.__civStrategyGame;
      const scene = game?.scene?.getScenes(true)?.[0];
      if (!scene) return { ok: false, reason: 'no scene' };
      const units = scene.units?.getChildren?.() ?? [];
      const bobs = scene.ambientSystem?.blitter?.children?.list ?? [];
      const bobInUnits = units.some((u) => bobs.some((b) => b === u));
      return { ok: !bobInUnits, bobCount: bobs.length, unitCount: units.length };
    });
    console.log('[profile-city-density] ambient isolation:', ambientIsolation);

    console.log(`[profile-city-density] warming up ${WARMUP_MS}ms...`);
    await sleep(WARMUP_MS);

    const baseline = await page.evaluate(() => performance.now());
    console.log(`[profile-city-density] baseline ${baseline.toFixed(0)}ms, capturing for ${CAPTURE_MS}ms...`);
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
    console.log(`[profile-city-density] captured ${allSamples.length} unique samples over ${durationMs}ms`);

    const frameTimes = allSamples.map((s) => s.frameMs).sort((a, b) => a - b);
    const fpsList = allSamples.map((s) => s.fps);

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

    const pass = hasSufficientData && p95FrameMs <= 16.67 && minFps >= 60;

    let note;
    if (!hasSufficientData) {
      note = `city settlement reached but ${allSamples.length === 0 ? 'no post-warmup perf snapshot was emitted' : `only ${allSamples.length} sample(s) with non-finite metrics`}`;
    } else if (!pass) {
      const reasons = [];
      if (p95FrameMs > 16.67) reasons.push(`p95 ${p95FrameMs}ms > 16.67ms`);
      if (minFps < 60) reasons.push(`min FPS ${minFps} < 60`);
      note = reasons.join('; ');
    } else {
      note = 'meets 60 FPS target under dense city settlement';
    }

    const result = {
      timestamp: Date.now(),
      url: STRESS_URL,
      mode: 'city-density',
      density: 'high',
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
      ambient: ambientIsolation,
      pass,
      note,
      errors: consoleErrors.length > 0 ? consoleErrors : undefined,
    };

    console.log(`[profile-city-density] ${result.sampleCount} samples, avg ${result.avgFps} FPS, p95 ${result.p95FrameMs}ms`);
    console.log(`[profile-city-density] pass=${result.pass} -- ${result.note}`);

    fs.writeFileSync(REPORT_PATH, JSON.stringify(result, null, 2) + '\n');
    console.log(`[profile-city-density] wrote ${REPORT_PATH}`);

    fs.appendFileSync(JSONL_PATH, JSON.stringify(result) + '\n');
    console.log(`[profile-city-density] appended ${JSONL_PATH}`);

    await browser.close();
    await stopServer();
    process.exit(pass ? 0 : 1);
  } catch (error) {
    console.error('[profile-city-density] failed:', error.message);

    const errorResult = {
      timestamp: Date.now(),
      url: STRESS_URL,
      mode: 'city-density',
      density: 'high',
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
      ambient: null,
      pass: false,
      note: error.message,
      errors: consoleErrors.length > 0 ? consoleErrors : undefined,
    };

    try {
      fs.writeFileSync(REPORT_PATH, JSON.stringify(errorResult, null, 2) + '\n');
      fs.appendFileSync(JSONL_PATH, JSON.stringify(errorResult) + '\n');
    } catch (e) {
      console.error('[profile-city-density] failed to write error result:', e.message);
    }

    if (browser) {
      try { await browser.close(); } catch {}
    }
    await stopServer();
    process.exit(1);
  }
})();
