import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'gauntlet/evidence';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /start game/i }).click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /commence/i }).click();
await page.waitForTimeout(4000);
console.log('body after commence:', (await page.locator('body').innerText()).slice(0, 4000));
await page.screenshot({ path: `${OUT}/gp-post-commence.png` });
await browser.close();