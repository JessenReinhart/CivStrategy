import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'gauntlet/evidence';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);
console.log('title:', await page.title());
await page.getByRole('button', { name: /start game/i }).click();
await page.waitForTimeout(2000);
console.log('after start:', (await page.locator('body').innerText()).slice(0, 3000));
const nextButtons = page.getByRole('button');
console.log('next buttons:', await nextButtons.allTextContents());
for (const label of ['Begin', 'Start', 'Play', 'Create', 'Standard']) {
  const candidate = page.getByRole('button', { name: new RegExp(label, 'i') }).last();
  if (await candidate.count()) { await candidate.click().catch(() => {}); break; }
}
await page.waitForTimeout(12000);
console.log('final body:', (await page.locator('body').innerText()).slice(0, 3000));
await page.screenshot({ path: `${OUT}/gp-debug-world.png` });
const probe = await page.evaluate(() => {
  const game = window.__PHASER_GAME__ ?? window.game;
  return { keys: Object.keys(window).filter(k => /game|phaser/i.test(k)), hasGame: !!game };
});
console.log('probe:', probe);
await browser.close();
