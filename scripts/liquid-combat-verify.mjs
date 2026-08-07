#!/usr/bin/env node
// One-shot verification for LiquidCombatSystem macro behavior:
// loads stress test with enemies, probes pressure/contact/modifiedOffset,
// captures console errors + pageerrors, measures FPS, screenshots the battle.

import { chromium } from 'playwright';
import fs from 'fs';
import { join } from 'path';

const STRESS_URL = 'http://localhost:5173/?stress=1500&enemies=true';
const VIEWPORT_W = 1440;
const VIEWPORT_H = 810;
const WARMUP_MS = 6000;
const CAPTURE_MS = 10000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const consoleErrors = [];
  let browser;
  try {
    console.log(`[liquid-verify] launching -> ${STRESS_URL}`);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-gpu', '--disable-dev-shm-usage'] });
    const ctx = await browser.newContext({ viewport: { width: VIEWPORT_W, height: VIEWPORT_H } });
    const page = await ctx.newPage();

    page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`);
    });

    await page.goto(STRESS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('[liquid-verify] canvas detected');

    // Wait for units to spawn (stress config drives spawn immediately)
    await page.waitForFunction(() => {
      const g = window.__civStrategyGame;
      const s = g?.scene?.getScenes?.(true)?.[0];
      return s && s.units && s.units.getChildren().length >= 1000;
    }, { timeout: 60000 });
    console.log('[liquid-verify] units spawned');

    await sleep(WARMUP_MS);

    // Probe liquid combat internals after warmup
    const probe1 = await page.evaluate(() => {
      const g = window.__civStrategyGame;
      const s = g?.scene?.getScenes?.(true)?.[0];
      if (!s) return { error: 'no scene' };
      const liquid = s.liquidCombat;
      const units = s.units.getChildren();
      const enemyCount = units.filter(u => u.getData?.('owner') === 1).length;
      const samples = [];
      for (const u of units) {
        if (u.unitType && u.unitType !== 'Villager' && u.unitType !== 'Animal') {
          samples.push({
            owner: u.getData?.('owner'),
            type: u.unitType,
            deform: u.modifiedOffset ?? null,
            hasSpatialKey: !!u.getData?.('spatialKey'),
          });
          if (samples.length >= 3) break;
        }
      }
      return {
        sceneFound: !!s,
        liquidFound: !!liquid,
        peacefulMode: s.peacefulMode,
        stressConfig: s.stressTestConfig,
        unitCount: units.length,
        enemyCount,
        pressureCells: liquid?.pressureCellCount ?? -1,
        contactLines: liquid?.contactLineCount ?? -1,
        enabled: liquid?.enabled ?? null,
        samples,
      };
    });
    console.log('[liquid-verify] probe1:', JSON.stringify(probe1, null, 2));

    // Measure FPS via consecutive rAF deltas (true frame times, no sleep between)
    const frameDeltas = await page.evaluate(() => new Promise((resolve) => {
        const deltas = [];
        let last = performance.now();
        let count = 0;
        const tick = () => {
            const now = performance.now();
            deltas.push(now - last);
            last = now;
            count++;
            if (count >= 120) resolve(deltas);
            else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }));
    const sorted = [...frameDeltas].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const avgMs = frameDeltas.reduce((a, b) => a + b, 0) / frameDeltas.length;

    // Probe again after capture — forces should differ from probe1 if battle evolved
    const probe2 = await page.evaluate(() => {
      const g = window.__civStrategyGame;
      const s = g?.scene?.getScenes?.(true)?.[0];
      const liquid = s?.liquidCombat;
      return {
        pressureCells: liquid?.pressureCellCount ?? -1,
        contactLines: liquid?.contactLineCount ?? -1,
      };
    });
    console.log('[liquid-verify] probe2:', JSON.stringify(probe2));

    // Screenshot battle
    const shotPath = join(process.cwd(), 'liquid-combat-verify.png');
    await page.screenshot({ path: shotPath });
    console.log(`[liquid-verify] screenshot -> ${shotPath}`);

    const report = {
      timestamp: Date.now(),
      url: STRESS_URL,
      probe1,
      probe2,
      avgFrameDeltaMs: +avgMs.toFixed(2),
      p50FrameMs: +p50.toFixed(2),
      p95FrameMs: +p95.toFixed(2),
      approxFps: avgMs > 0 ? +(1000 / avgMs).toFixed(1) : 0,
      consoleErrors,
      screenshot: shotPath,
    };
    fs.writeFileSync(join(process.cwd(), 'liquid-combat-verify.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('[liquid-verify] wrote liquid-combat-verify.json');
    console.log('[liquid-verify] consoleErrors:', consoleErrors.length ? consoleErrors : 'none');
    await browser.close();
    process.exit(0);
  } catch (error) {
    console.error('[liquid-verify] failed:', error.message);
    if (browser) { try { await browser.close(); } catch {} }
    process.exit(1);
  }
})();
