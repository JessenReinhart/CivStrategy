import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4174;
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
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();

  const mapSizeGroup = page.getByRole('group', { name: 'Map size' });
  await mapSizeGroup.getByRole('button', { name: /large/i }).click();

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

  await page.getByRole('button', { name: 'Commence' }).click();

  await page.waitForFunction(() => {
    const telemetry = window.__largeMapLoadingTelemetry;
    const game = window.__civStrategyGame;
    const scene = game?.scene?.getScene?.('MainScene');
    return Boolean(telemetry?.ready && scene?.isReady);
  }, undefined, { timeout: 90_000 });

  const result = await page.evaluate(() => {
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
      browserErrors,
    };
  });

  // Persist measurement evidence before assertions so a red journey still
  // explains whether the blocker was responsiveness, progress, readiness, or rendering.
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
  const missingPhases = requiredPhases.filter((phase) => !result.phases.includes(phase));

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
  if (browserErrors.length > 0) {
    throw new Error(`Browser page errors during Large map loading:\n${browserErrors.join('\n')}`);
  }
} finally {
  if (browser) await browser.close();
  await stopServer();
}
