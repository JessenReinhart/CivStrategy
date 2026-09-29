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

// Wait for the Phaser canvas/game instance.
const gameReady = await page
  .waitForFunction(
    () => {
      const game = window.__PHASER_GAME__ ?? window.game;
      if (!game) return false;
      const scene = game.scene?.getScene?.('MainScene');
      return Boolean(scene && scene.units && scene.unitSystem);
    },
    { timeout: 60000 },
  )
  .then(() => true)
  .catch(() => false);
console.log('gameReady:', gameReady);
await page.waitForTimeout(6000);

const probe = await page.evaluate(() => {
  const game = window.__PHASER_GAME__ ?? window.game;
  const scene = game.scene.getScene('MainScene');
  const units = scene.units.getChildren();
  const byOwner = {};
  for (const u of units) byOwner[u.getData('owner')] = (byOwner[u.getData('owner')] ?? 0) + 1;
  return {
    fps: game.loop.actualFps,
    unitCount: units.length,
    byOwner,
    commandAttackMove: typeof scene.unitSystem.commandAttackMove,
    showHitFlash: typeof scene.feedbackSystem?.showHitFlash,
    inputKeys: Object.keys(scene.inputManager).filter((k) => /attack|armed/i.test(k)),
    cameraZoom: scene.cameras.main.zoom,
  };
});
console.log('probe:', JSON.stringify(probe, null, 2));
await page.screenshot({ path: `${OUT}/gp-01-world.png` });
await browser.close();
