import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 4187;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAVE_KEY = 'civstrategy-save';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(BASE_URL)).ok) return;
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

async function waitForMainScene(page) {
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.buildings?.getChildren?.().length);
  }, undefined, { timeout: 45_000 });
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForMainScene(page);

  const savedConfig = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    window.__crossConfigOldGame = window.__civStrategyGame;
    window.dispatchEvent(new Event('save-game'));
    return {
      faction: scene.faction,
      mapSeed: scene.mapSeed,
      mapPreset: scene.mapPreset,
      peacefulMode: scene.peacefulMode,
      mapWidth: scene.mapWidth,
      mapHeight: scene.mapHeight,
    };
  });

  await page.waitForFunction((key) => Boolean(localStorage.getItem(key)), SAVE_KEY, { timeout: 5_000 });

  // Simulate the dangerous state that used to occur when a different New Game
  // world was active before loading the older save. An in-place deserialize
  // leaves these init-owned values behind; a fresh saved-world session cannot.
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.faction = scene.faction === 'Romans' ? 'Gauls' : 'Romans';
    scene.mapSeed = (scene.mapSeed ?? 0) + 987654;
    scene.peacefulMode = !scene.peacefulMode;
    scene.mapWidth += 512;
    scene.mapHeight += 512;
  });

  await page.evaluate(() => window.dispatchEvent(new Event('load-game')));
  await page.waitForFunction(() => (
    window.__civStrategyGame
    && window.__civStrategyGame !== window.__crossConfigOldGame
    && window.__civStrategyGame.scene?.getScene?.('MainScene')?.isReady
  ), undefined, { timeout: 45_000 });

  const restored = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return {
      faction: scene.faction,
      mapSeed: scene.mapSeed,
      mapPreset: scene.mapPreset,
      peacefulMode: scene.peacefulMode,
      mapWidth: scene.mapWidth,
      mapHeight: scene.mapHeight,
      pendingLoad: localStorage.getItem('civstrategy-pending-load'),
    };
  });

  for (const key of ['faction', 'mapSeed', 'mapPreset', 'peacefulMode', 'mapWidth', 'mapHeight']) {
    if (restored[key] !== savedConfig[key]) {
      throw new Error(`Saved-world reload mismatch for ${key}: expected ${savedConfig[key]}, got ${restored[key]}.`);
    }
  }
  if (restored.pendingLoad !== null) throw new Error('Pending-load marker was not consumed by the fresh scene.');
  if (browserErrors.length > 0) throw new Error(`Browser errors during saved-world remount: ${browserErrors.join(' | ')}`);

  console.log(JSON.stringify({
    status: 'pass',
    assertion: 'in-game Load Game rebuilds Phaser from saved world configuration',
    savedConfig,
    restored,
  }));
} finally {
  if (browser) await browser.close();
  await stopServer();
}
