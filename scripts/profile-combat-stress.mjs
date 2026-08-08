#!/usr/bin/env node

import { chromium } from 'playwright';
import fs from 'fs';
import { join } from 'path';

const STRESS_URL = 'http://localhost:5173/?stress=5000&enableEnemies=true';
const VIEWPORT_W = 1440;
const VIEWPORT_H = 810;
const WARMUP_MS = 10000;
const CAPTURE_MS = 30000;
const UNITS_TARGET = 5000;
const REPORT_PATH = join(process.cwd(), 'profile-combat-results.json');
const JSONL_PATH = join(process.cwd(), 'progress-combat-metrics.jsonl');

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
    console.log(`[profile-combat-stress] launching Chromium ${VIEWPORT_W}x${VIEWPORT_H} -> ${STRESS_URL}`);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: VIEWPORT_W, height: VIEWPORT_H } });
    const page = await context.newPage();

    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error' || text.includes('ERROR') || text.includes('error')) {
        consoleErrors.push(text);
      }
      if (text.includes('[profileTimings]')) console.log(text);
    });

    page.on('pageerror', err => consoleErrors.push(err.message));

    await page.goto(STRESS_URL, { waitUntil: 'networkidle', timeout: 60000 });

    // Wait for units to spawn and engage in combat
    await page.waitForFunction(
      () => {
        const win = window;
        const game = win.gameInstance;
        if (!game || !game.scene) return false;
        const scene = game.scene;
        if (!scene.liquidCombatSystem || !scene.liquidCombatSystem.enabled) return false;
        if (!scene.units || !scene.units.getChildren) return false;
        const units = scene.units.getChildren();
        if (units.length < 4000) return false;
        // Require contact lines AND HP loss to confirm combat
        if (scene.liquidCombatSystem.contactLines.length === 0) return false;
        // Check if any unit has taken damage
        let hpLoss = false;
        for (const u of units) {
          const hp = u.getData ? u.getData('hp') : u.hp;
          const maxHp = u.getData ? u.getData('maxHp') : u.maxHp;
          if (hp !== undefined && maxHp !== undefined && hp < maxHp) {
            hpLoss = true;
            break;
          }
        }
        if (!hpLoss) return false;
        return true;
      },
      { timeout: 60000 }
    );

    console.log('[profile-combat-stress] combat engagement detected, warming up...');
    await sleep(WARMUP_MS);

    // Capture frame metrics during combat
    const samples = [];
    const endTime = Date.now() + CAPTURE_MS;
    let lastLog = 0;

    while (Date.now() < endTime) {
      await page.evaluate(() => {}); // force frame
      const timing = await page.evaluate(() => {
        const win = window;
        const game = win.gameInstance;
        if (!game || !game.scene) return null;
        const scene = game.scene;
        const now = performance.now();
        const prev = scene._lastProfileTime || now;
        scene._lastProfileTime = now;
        const frameMs = now - prev;

        let updateMs = 0, renderMs = 0;
        if (scene.sys && scene.sys.game && scene.sys.game.loop) {
          const loop = scene.sys.game.loop;
          updateMs = loop._lastUpdateDuration || 0;
          renderMs = loop._lastRenderDuration || 0;
        }

        return { frameMs, updateMs, renderMs };
      });

      if (timing && isFiniteNumber(timing.frameMs) && timing.frameMs > 0 && timing.frameMs < 1000) {
        samples.push(timing.frameMs);
      }

      if (Date.now() - lastLog > 5000) {
        const count = samples.length;
        if (count > 0) {
          const sorted = [...samples].sort((a, b) => a - b);
          const avg = sorted.reduce((a, b) => a + b, 0) / count;
          const p95 = percentile(sorted, 95);
          const p99 = percentile(sorted, 99);
          const fps = 1000 / avg;
          console.log(`[profile-combat-stress] samples=${count} avg=${avg.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms fps=${fps.toFixed(1)}`);
        }
        lastLog = Date.now();
      }
    }

    // Final metrics
    const sorted = samples.sort((a, b) => a - b);
    const count = sorted.length;
    const avg = count > 0 ? sorted.reduce((a, b) => a + b, 0) / count : 0;
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);
    const minFps = count > 0 ? Math.round(1000 / sorted[count - 1]) : 0;
    const maxFps = count > 0 ? Math.round(1000 / sorted[0]) : 0;
    const avgFps = avg > 0 ? Math.round(1000 / avg) : 0;

    const result = {
      units: UNITS_TARGET,
      samples: count,
      avgFrameMs: avg,
      p50FrameMs: p50,
      p95FrameMs: p95,
      p99FrameMs: p99,
      avgFps: avgFps,
      minFps: minFps,
      maxFps: maxFps,
      pass: avgFps >= 60 && count > 100,
      errors: consoleErrors.slice(0, 20),
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync(REPORT_PATH, JSON.stringify(result, null, 2));
    console.log('\n=== COMBAT STRESS REPORT ===');
    console.log(`Units: ${UNITS_TARGET}`);
    console.log(`Samples: ${count}`);
    console.log(`Avg FPS: ${avgFps} (avg frame ${avg.toFixed(2)}ms)`);
    console.log(`P50: ${p50.toFixed(2)}ms | P95: ${p95.toFixed(2)}ms | P99: ${p99.toFixed(2)}ms`);
    console.log(`Min FPS: ${minFps} | Max FPS: ${maxFps}`);
    console.log(`Pass (>=60 FPS): ${result.pass ? 'YES' : 'NO'}`);
    console.log(`Report saved to: ${REPORT_PATH}`);

    if (consoleErrors.length > 0) {
      console.log('\nConsole errors (first 20):');
      consoleErrors.slice(0, 20).forEach(e => console.log('  ' + e));
    }

    process.exit(result.pass ? 0 : 1);
  } catch (error) {
    console.error('[profile-combat-stress] FAILED:', error);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();