import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'gauntlet/results';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));

await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /start game/i }).click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /commence/i }).click();
console.log('game launching; waiting for HUD ribbon...');

// Wait for the new top-left resource ribbon (max 6 min; terrain generation is slow).
const hudReady = await page
  .waitForFunction(() => !!document.querySelector('.hud-resource-ribbon'), { timeout: 360000, polling: 1000 })
  .then(() => true)
  .catch(() => false);
console.log('hudReady:', hudReady);
if (!hudReady) {
  await page.screenshot({ path: `${OUT}/after-load-failed.png` });
  await browser.close();
  process.exit(1);
}

// Let a few economy ticks run so rates and production history populate.
await page.waitForTimeout(8000);

const topBarText = await page.evaluate(() => document.body.innerText.slice(0, 400));
console.log('--- HUD text ---');
console.log(topBarText);

// State 1: idle HUD
await page.screenshot({ path: `${OUT}/after-hud-idle.png` });
console.log('captured after-hud-idle.png');

// State 2: Economy build menu open
await page.getByRole('button', { name: /economy/i }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/after-hud-economy.png` });
console.log('captured after-hud-economy.png');
const economyText = await page.evaluate(() => document.body.innerText);
console.log('economy menu open:', /house|farm|lumber/i.test(economyText));

// Close economy, then click canvas center to select the town center.
await page.getByRole('button', { name: /economy/i }).click();
await page.waitForTimeout(400);
await page.mouse.click(640, 360);
await page.waitForTimeout(1200);
let selectionText = await page.evaluate(() => document.body.innerText);
const selectedSomething = /town center|selected group|demolish/i.test(selectionText);
console.log('selection detected:', selectedSomething);
if (!selectedSomething) {
  // Retry selection with a slightly offset click.
  await page.mouse.click(700, 400);
  await page.waitForTimeout(1200);
  selectionText = await page.evaluate(() => document.body.innerText);
}
// Give production history (10 ticks) time to accumulate for the selected TC.
await page.waitForTimeout(12000);
const selectionCard = await page.evaluate(() => {
  const t = document.body.innerText;
  const hasSelection = /town center|selected group/i.test(t);
  const hasProduction = /\+\d+\s*(wood|food|gold)\/tick/i.test(t);
  return { hasSelection, hasProduction, productionLine: (t.match(/\+\d+\s*(wood|food|gold)\/tick/i) ?? [''])[0] };
});
console.log('selection card:', JSON.stringify(selectionCard));
await page.screenshot({ path: `${OUT}/after-hud-selection.png` });
console.log('captured after-hud-selection.png');

await browser.close();
console.log('DONE');
