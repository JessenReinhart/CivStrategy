import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4175;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const MAX_MAIN_THREAD_GAP_MS = 1_500;

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

await mkdir(ARTIFACT_DIR, { recursive: true });

let browser;
let page;
let phase = 'server-start';
const browserErrors = [];

try {
  await waitForServer();
  phase = 'browser-launch';
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  phase = 'navigation';
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  phase = 'start-game';
  await page.getByRole('button', { name: 'Start Game' }).click();

  phase = 'map-size';
  const mapSizeGroup = page.getByRole('group', { name: 'Map size' });
  await mapSizeGroup.getByRole('button', { name: /large/i }).click();

  phase = 'telemetry';
  await page.evaluate(() => {
    const telemetry = {
      tracking: false,
      startedAt: 0,
      completedAt: 0,
      lastHeartbeatAt: performance.now(),
      maxGapMs: 0,
      heartbeatTicks: 0,
      progress: [],
      ready: false,
    };
    window.__largeMapLoadingTelemetry = telemetry;

    setInterval(() => {
      const now = performance.now();
      if (telemetry.tracking) {
        telemetry.maxGapMs = Math.max(telemetry.maxGapMs, now - telemetry.lastHeartbeatAt);
        telemetry.heartbeatTicks++;
      }
      telemetry.lastHeartbeatAt = now;
    }, 16);

    window.addEventListener('game-load-progress', (event) => {
      if (!telemetry.tracking) return;
      const detail = event.detail;
      if (detail && typeof detail === 'object') {
        telemetry.progress.push({ ...detail, at: performance.now() });
      }
    });

    window.addEventListener('game-world-ready', () => {
      telemetry.completedAt = performance.now();
      telemetry.ready = true;
      telemetry.tracking = false;
    });
  });

  await page.evaluate(() => {
    const telemetry = window.__largeMapLoadingTelemetry;
    telemetry.tracking = true;
    telemetry.startedAt = performance.now();
    telemetry.lastHeartbeatAt = telemetry.startedAt;
  });

  phase = 'commence';
  await page.getByRole('button', { name: 'Commence' }).click();

  phase = 'world-ready';
  await page.waitForFunction(() => {
    const telemetry = window.__largeMapLoadingTelemetry;
    const game = window.__civStrategyGame;
    const scene = game?.scene?.getScene?.('MainScene');
    return Boolean(telemetry?.ready && scene?.isReady);
  }, undefined, { timeout: 90_000 });

  phase = 'measurement';
  const measured = await page.evaluate(() => {
    const telemetry = window.__largeMapLoadingTelemetry;
    const game = window.__civStrategyGame;
    const scene = game.scene.getScene('MainScene');
    const structuredProgress = telemetry.progress;
    const phases = [...new Set(structuredProgress.map((entry) => entry.phase))];
    const lastProgress = structuredProgress.at(-1);

    return {
      mapWidth: scene.mapWidth,
      mapHeight: scene.mapHeight,
      isReady: scene.isReady,
      durationMs: telemetry.completedAt - telemetry.startedAt,
      maxGapMs: telemetry.maxGapMs,
      heartbeatTicks: telemetry.heartbeatTicks,
      progressEvents: structuredProgress.length,
      phases,
      lastProgress,
      hasRealtimeCounters: structuredProgress.some((entry) => (
        typeof entry.processed === 'number' && typeof entry.total === 'number' && entry.total > 1
      )),
    };
  });

  phase = 'camera-input';
  const cameraBeforeInput = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.cameras.main.scrollX;
  });
  await page.keyboard.down('ArrowRight');
  await sleep(300);
  await page.keyboard.up('ArrowRight');
  await page.waitForFunction((initialScrollX) => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return scene?.cameras?.main?.scrollX > initialScrollX;
  }, cameraBeforeInput, { timeout: 5_000 });
  const cameraAfterInput = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.cameras.main.scrollX;
  });

  const result = {
    ...measured,
    cameraBeforeInput,
    cameraAfterInput,
    browserErrors,
  };

  await writeFile(
    `${ARTIFACT_DIR}/large-map-loading.json`,
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  await page.screenshot({ path: `${ARTIFACT_DIR}/large-map-loaded.png`, fullPage: true });
  console.log(JSON.stringify(result, null, 2));

  const requiredPhases = [
    'Generating terrain',
    'Painting terrain',
    'Shaping coastlines',
    'Growing world',
    'Realm ready',
  ];
  const missingPhases = requiredPhases.filter((requiredPhase) => !result.phases.includes(requiredPhase));

  if (result.mapWidth !== 4096 || result.mapHeight !== 4096) {
    throw new Error(`Large map did not initialize at 4096×4096: ${result.mapWidth}×${result.mapHeight}`);
  }
  if (!result.isReady) throw new Error('Large map never reached scene.isReady.');
  if (missingPhases.length > 0) {
    throw new Error(`Realtime loading phases missing: ${missingPhases.join(', ')}`);
  }
  if (!result.hasRealtimeCounters) {
    throw new Error('Loading progress did not publish processed/total realtime work counters.');
  }
  if (result.lastProgress?.progress !== 1) {
    throw new Error(`Final structured loading progress was ${result.lastProgress?.progress ?? 'missing'}, expected 1.`);
  }
  if (result.heartbeatTicks < 5) {
    throw new Error(`Only ${result.heartbeatTicks} browser heartbeat ticks occurred during Large map loading.`);
  }
  if (result.maxGapMs > MAX_MAIN_THREAD_GAP_MS) {
    throw new Error(
      `Large map loading blocked the browser main thread for ${result.maxGapMs.toFixed(1)}ms ` +
      `(limit ${MAX_MAIN_THREAD_GAP_MS}ms).`,
    );
  }
  if (result.cameraAfterInput <= result.cameraBeforeInput) {
    throw new Error('Camera did not respond to ArrowRight after the Large map became ready.');
  }
  if (browserErrors.length > 0) {
    throw new Error(`Browser page errors during Large map loading:\n${browserErrors.join('\n')}`);
  }
} catch (error) {
  let telemetry = null;
  let url = null;
  if (page) {
    try {
      url = page.url();
    } catch {
      // The page may already be gone after a browser-level failure.
    }
    try {
      telemetry = await page.evaluate(() => window.__largeMapLoadingTelemetry ?? null);
    } catch {
      // Preserve the rest of the diagnostics even if the page is no longer evaluable.
    }
    try {
      await page.screenshot({ path: `${ARTIFACT_DIR}/large-map-loading-failure.png`, fullPage: true });
    } catch {
      // A screenshot is best-effort evidence only.
    }
  }

  const failure = {
    phase,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    serverOutput: serverOutput.slice(-8_000),
    browserErrors,
    url,
    telemetry,
  };
  await writeFile(
    `${ARTIFACT_DIR}/large-map-loading-failure.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
    'utf8',
  );
  console.error(JSON.stringify(failure, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
