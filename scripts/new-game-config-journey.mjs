import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 4197;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js',
  '--host', '127.0.0.1',
  '--port', String(PORT),
  '--strictPort',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(BASE_URL)).ok) return;
    } catch {}
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

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  const startGame = page.getByRole('button', { name: 'Start Game', exact: true });
  await startGame.waitFor({ state: 'visible', timeout: 10_000 });
  await startGame.click();

  await page.getByRole('heading', { name: 'New Game', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });

  const gauls = page.getByRole('button', { name: /Gauls/i }).first();
  await gauls.click();
  if ((await gauls.getAttribute('aria-pressed')) !== 'true') {
    throw new Error('Gauls faction control did not enter the selected state.');
  }

  const peacefulMode = page.getByRole('button', { name: /Peaceful Mode/i });
  await peacefulMode.click();
  if ((await peacefulMode.getAttribute('aria-pressed')) !== 'true') {
    throw new Error('Peaceful Mode control did not enter the enabled state.');
  }

  const commence = page.getByRole('button', { name: 'Commence', exact: true });
  await commence.click();

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.terrainSystem && scene?.inputManager);
  }, undefined, { timeout: 45_000 });

  const runtime = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return {
      faction: scene.faction,
      peacefulMode: scene.peacefulMode,
      treatyLength: scene.treatyLength,
      mapMode: scene.mapMode,
      fowEnabled: scene.isFowEnabled,
      ready: scene.isReady,
    };
  });

  if (runtime.faction !== 'Gauls') {
    throw new Error(`Lobby faction did not reach MainScene: ${JSON.stringify(runtime)}`);
  }
  if (runtime.peacefulMode !== true) {
    throw new Error(`Lobby Peaceful Mode did not reach MainScene: ${JSON.stringify(runtime)}`);
  }
  if (runtime.treatyLength !== 10 * 60_000) {
    throw new Error(`Lobby treaty duration did not reach PlayerMainScene in milliseconds: ${JSON.stringify(runtime)}`);
  }
  if (runtime.mapMode !== 'Fixed Map' || runtime.fowEnabled !== true || runtime.ready !== true) {
    throw new Error(`Default world settings or readiness changed unexpectedly: ${JSON.stringify(runtime)}`);
  }
  if (browserErrors.length > 0) {
    throw new Error(`Browser errors occurred during configured world startup: ${browserErrors.join(' | ')}`);
  }

  console.log('New Game configuration journey passed.', runtime);
} finally {
  if (browser) await browser.close();
  await stopServer();
}
