import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4179;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const START_ATTEMPTS = 3;

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
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

async function requireCameraInput(page) {
  const before = await page.evaluate(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return { x: scene?.cameras?.main?.scrollX, y: scene?.cameras?.main?.scrollY };
  });

  await page.keyboard.down('ArrowRight');
  await sleep(250);
  await page.keyboard.up('ArrowRight');

  let after = await page.evaluate(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return { x: scene?.cameras?.main?.scrollX, y: scene?.cameras?.main?.scrollY };
  });

  if (after.x === before.x && after.y === before.y) {
    await page.keyboard.down('ArrowLeft');
    await sleep(250);
    await page.keyboard.up('ArrowLeft');
    after = await page.evaluate(() => {
      const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
      return { x: scene?.cameras?.main?.scrollX, y: scene?.cameras?.main?.scrollY };
    });
  }

  if (after.x === before.x && after.y === before.y) {
    throw new Error('Camera did not respond to keyboard input after world startup.');
  }

  return { before, after };
}

await mkdir(ARTIFACT_DIR, { recursive: true });

let browser;
let page;
let phase = 'server-start';
const browserErrors = [];
const attempts = [];

try {
  await waitForServer();
  phase = 'browser-launch';
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  for (let attempt = 1; attempt <= START_ATTEMPTS; attempt++) {
    const errorCountBeforeAttempt = browserErrors.length;
    phase = `attempt-${attempt}-navigation`;
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    phase = `attempt-${attempt}-main-menu`;
    const startButton = page.getByRole('button', { name: 'Start Game' });
    await startButton.waitFor({ state: 'visible', timeout: 10_000 });
    await startButton.click();

    phase = `attempt-${attempt}-commence`;
    const commenceButton = page.getByRole('button', { name: 'Commence' });
    await commenceButton.waitFor({ state: 'visible', timeout: 10_000 });
    const startedAt = Date.now();
    await commenceButton.click();

    phase = `attempt-${attempt}-world-ready`;
    await page.waitForFunction(() => {
      const game = window.__civStrategyGame;
      const scene = game?.scene?.getScene?.('MainScene');
      return Boolean(
        scene?.isReady
        && scene?.cameras?.main
        && scene?.buildings?.getChildren?.().length
        && scene?.units?.getChildren?.().length,
      );
    }, undefined, { timeout: 60_000 });

    const world = await page.evaluate(() => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      return {
        mapWidth: scene.mapWidth,
        mapHeight: scene.mapHeight,
        buildingCount: scene.buildings.getChildren().length,
        unitCount: scene.units.getChildren().length,
        isReady: scene.isReady,
      };
    });

    phase = `attempt-${attempt}-camera-input`;
    const camera = await requireCameraInput(page);
    const attemptErrors = browserErrors.slice(errorCountBeforeAttempt);

    if (!world.isReady) throw new Error(`Attempt ${attempt} did not leave MainScene ready.`);
    if (world.buildingCount <= 0) throw new Error(`Attempt ${attempt} loaded no buildings.`);
    if (world.unitCount <= 0) throw new Error(`Attempt ${attempt} loaded no units.`);
    if (attemptErrors.length > 0) {
      throw new Error(`Browser errors during startup attempt ${attempt}:\n${attemptErrors.join('\n')}`);
    }

    attempts.push({
      attempt,
      loadDurationMs: Date.now() - startedAt,
      ...world,
      camera,
      browserErrors: attemptErrors,
    });
  }

  const dimensions = new Set(attempts.map(({ mapWidth, mapHeight }) => `${mapWidth}x${mapHeight}`));
  if (dimensions.size !== 1) {
    throw new Error(`Default map dimensions changed across fresh starts: ${[...dimensions].join(', ')}`);
  }

  const result = { attempts, browserErrors };
  await writeFile(
    `${ARTIFACT_DIR}/standard-world-start.json`,
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  await page.screenshot({ path: `${ARTIFACT_DIR}/standard-world-start.png`, fullPage: true });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page) {
    try {
      await page.screenshot({ path: `${ARTIFACT_DIR}/standard-world-start-failure.png`, fullPage: true });
    } catch {
      // Screenshot evidence is best effort after browser-level failures.
    }
  }

  const failure = {
    phase,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    attempts,
    browserErrors,
    serverOutput: serverOutput.slice(-8_000),
  };
  await writeFile(
    `${ARTIFACT_DIR}/standard-world-start-failure.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
    'utf8',
  );
  console.error(JSON.stringify(failure, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
