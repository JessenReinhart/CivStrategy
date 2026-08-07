#!/usr/bin/env node
import { chromium } from 'playwright';

const URL_BASE = 'http://localhost:5173/';
const URL_STRESS = 'http://localhost:5173/?stress=5000';
const VIEWPORT = { width: 1440, height: 810 };
const CAPTURE_MS = 10000;

async function runProfile(label, url, { clickStart = false } = {}) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  console.log(`[${label}] navigating ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  console.log(`[${label}] canvas OK`);

  if (clickStart) {
    // Try clicking Start Game button
    try {
      const btn = page.locator('text=Start Game');
      if (await btn.count() > 0) {
        await btn.first().click();
        console.log(`[${label}] clicked Start Game`);
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (e) {
      console.log(`[${label}] no Start Game button: ${e.message}`);
    }
  }

  // Wait for __perf
  await page.waitForFunction(() => typeof window !== 'undefined' && typeof window.__perf !== 'undefined', { timeout: 20000 });
  console.log(`[${label}] __perf available`);

  // Wait for game to settle
  await new Promise(r => setTimeout(r, 5000));

  // Reset buffer
  await page.evaluate(() => window.__perf.reset());
  console.log(`[${label}] capturing ${CAPTURE_MS}ms...`);
  await new Promise(r => setTimeout(r, CAPTURE_MS));

  const result = await page.evaluate(() => {
    const p = window.__perf;
    if (!p || p.buffer.length === 0) return { error: 'no data', samples: 0 };
    const buf = p.buffer;
    const frameTimes = buf.map(s => s.frameMs).sort((a, b) => a - b);
    const fpsList = buf.map(s => s.fps);
    const latest = buf[buf.length - 1];
    const pidx = (arr, p) => arr.length === 0 ? 0 : arr[Math.ceil((p / 100) * arr.length) - 1];
    return {
      samples: buf.length,
      p50: +pidx(frameTimes, 50).toFixed(1),
      p95: +pidx(frameTimes, 95).toFixed(1),
      avgFps: +(fpsList.reduce((a, b) => a + b, 0) / fpsList.length).toFixed(1),
      minFps: +Math.min(...fpsList).toFixed(1),
      maxFps: +Math.max(...fpsList).toFixed(1),
      updateMs: +latest.updateMs.toFixed(2),
      renderMs: +latest.renderMs.toFixed(2),
      frameMs: +latest.frameMs.toFixed(2),
      units: latest.units,
      topHogs: latest.hogs,
    };
  });

  console.log(`\n[${label}] Results:`);
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) console.log(`[${label}] Errors:`, errors.slice(0, 5));
  await browser.close();
  return { label, ...result };
}

const normal = await runProfile('NORMAL', URL_BASE, { clickStart: true });
console.log('\n');
const stress = await runProfile('STRESS', URL_STRESS);

console.log('\n=== COMPARISON ===');
console.log(`Normal: p95=${normal.p50}ms, avg=${normal.avgFps}fps, ${normal.units} units`);
console.log(`Stress: p95=${stress.p50}ms, avg=${stress.avgFps}fps, ${stress.units} units`);
console.log('Normal hogs:', JSON.stringify(normal.topHogs));
console.log('Stress hogs:', JSON.stringify(stress.topHogs));
