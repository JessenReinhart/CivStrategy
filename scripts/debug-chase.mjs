#!/usr/bin/env node
// Debug CHASING units: hook handleCombatState to log velocity/path/target state.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.text().startsWith('[CHASING]')) console.log('PAGE:', m.text());
});

console.log('[setup] navigating');
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);
await page.locator('text=Start Game').first().click();
await page.waitForTimeout(2000);
const fow = page.locator('text=Fog of War');
if (await fow.count() > 0) await fow.first().click();
await page.locator('text=Commence').first().click();
await page.waitForTimeout(5000);

// Spawn two armies and force them to fight — same as the verifier
const setup = await page.evaluate(() => {
  const g = window.__civStrategyGame;
  const s = g?.scene?.getScenes?.(true)?.[0];
  if (!s) return { error: 'no scene' };
  const TS = s.unitSystem;
  if (!TS) return { error: 'no unitSystem' };

  // Hook handleCombatState
  const orig = TS.handleCombatState.bind(TS);
  let logCount = 0;
  TS.handleCombatState = function(unit, time) {
    orig(unit, time);
    const st = unit.getData?.('state');
    if ((st === 'chasing' || st === 2) && logCount < 30) {
      logCount++;
      const body = unit.body;
      console.log('[CHASING] x:' + Math.round(unit.x) + ' y:' + Math.round(unit.y) +
        ' path:' + (unit.path?.length ?? 'null') +
        ' step:' + (unit.pathStep ?? 'null') +
        ' vx:' + (body?.velocity?.x ?? 'null')?.toFixed(2) +
        ' vy:' + (body?.velocity?.y ?? 'null')?.toFixed(2) +
        ' drag:' + (body?.drag?.x ?? 'null') +
        ' enable:' + (body?.enable) +
        ' tgt:' + (unit.target ? Math.round(unit.target.x) + ',' + Math.round(unit.target.y) : 'null'));
    }
  };

  // Spawn two armies
  const midX = 1024, midY = 1024;
  let playerCount = 0, enemyCount = 0;
  for (let i = 0; i < 21; i++) {
    s.entityFactory.spawnUnit(5, midX - 170 + (i % 7) * 22, midY - 40 + Math.floor(i / 7) * 22, 0);
    playerCount++;
  }
  for (let i = 0; i < 21; i++) {
    s.entityFactory.spawnUnit(5, midX + 170 - (i % 7) * 22, midY - 40 + Math.floor(i / 7) * 22, 1);
    enemyCount++;
  }

  // Force attack orders
  const units = s.units.getChildren();
  const playerUnits = units.filter(u => u.getData('owner') === 0);
  const enemyUnits = units.filter(u => u.getData('owner') === 1);
  // Each player unit attacks nearest enemy
  for (const u of playerUnits) {
    let nearest = null, nd = Infinity;
    for (const e of enemyUnits) {
      const d = Math.hypot(u.x - e.x, u.y - e.y);
      if (d < nd) { nd = d; nearest = e; }
    }
    if (nearest) TS.commandAttack(u, nearest.x, nearest.y, nearest);
  }
  for (const u of enemyUnits) {
    let nearest = null, nd = Infinity;
    for (const e of playerUnits) {
      const d = Math.hypot(u.x - e.x, u.y - e.y);
      if (d < nd) { nd = d; nearest = e; }
    }
    if (nearest) TS.commandAttack(u, nearest.x, nearest.y, nearest);
  }
  return { playerCount, enemyCount, midX, midY };
});
console.log('[setup]', JSON.stringify(setup));

// Wait for armies to move
await page.waitForTimeout(5000);

const diag = await page.evaluate(() => {
  const s = window.__civStrategyGame?.scene?.getScenes?.(true)?.[0];
  const units = s?.units?.getChildren?.() || [];
  const chasing = [];
  const idle = [];
  for (const u of units) {
    const st = u.getData?.('state');
    const info = {
      x: Math.round(u.x), y: Math.round(u.y),
      state: st,
      pathLen: u.path?.length ?? null,
      vx: u.body?.velocity?.x?.toFixed(2) ?? 'no-body',
      vy: u.body?.velocity?.y?.toFixed(2) ?? 'no-body',
      drag: u.body?.drag?.x ?? 'no-body',
      enable: u.body?.enable,
      target: u.target ? { x: Math.round(u.target.x), y: Math.round(u.target.y) } : null,
    };
    if (st === 'chasing' || st === 2) chasing.push(info);
    else idle.push(info);
  }
  return { total: units.length, chasing: chasing.length, idle: idle.length, chasingSample: chasing.slice(0,5), idleSample: idle.slice(0,3) };
});
console.log('diag:', JSON.stringify(diag, null, 2));
console.log('errors:', JSON.stringify(errors.slice(0, 10)));
await browser.close();
