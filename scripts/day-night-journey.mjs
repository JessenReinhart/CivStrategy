import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const DAY_LENGTH_MS = 12 * 60 * 1000;
const DAY_START_HOUR = 8;
const SHADOW_REFRESH_MS = 200;
const REFRESH_TIMER_TOLERANCE_MS = 10;
const MAX_AVERAGE_SHADOW_RENDER_MS = 20;

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

function gameTimeForHour(hour) {
  const offsetHours = ((hour - DAY_START_HOUR) % 24 + 24) % 24;
  return DAY_LENGTH_MS * (offsetHours / 24);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteMinimum(...values) {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 ? Math.min(...finite) : null;
}

await mkdir(ARTIFACT_DIR, { recursive: true });

let browser;
let page;
const telemetry = {
  phase: 'boot',
  passed: false,
  browserErrors: [],
  failedRequests: [],
};

async function persistEvidence() {
  await writeFile(
    `${ARTIFACT_DIR}/day-night-journey.json`,
    `${JSON.stringify(telemetry, null, 2)}\n`,
    'utf8',
  );
  await writeFile(`${ARTIFACT_DIR}/day-night-vite.log`, serverOutput, 'utf8');
}

try {
  await waitForServer();
  telemetry.phase = 'launch';
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => telemetry.browserErrors.push(error.message));
  page.on('requestfailed', (request) => {
    telemetry.failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'unknown error'}`);
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();

  telemetry.phase = 'world-ready';
  await page.waitForFunction(() => {
    const game = window.__civStrategyGame;
    const scene = game?.scene?.getScene?.('MainScene');
    const dayNightSystem = scene?.dayNightSystem ?? scene?.data?.get?.('dayNightSystem');
    return Boolean(
      scene?.isReady
      && dayNightSystem?.getState
      && dayNightSystem?.getDiagnostics
      && scene?.uiCamera
      && scene?.buildings?.getChildren?.().length,
    );
  }, undefined, { timeout: 45_000 });

  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.aiDisabled = true;
    scene.gameSpeed = 0;
    scene.atmosphericSystem?.setPostFXEnabled(false);
    scene.waterAnimationEnabled = false;
  });

  async function capturePhase(label, hour) {
    telemetry.phase = `capture-${label}`;
    await page.evaluate(({ hourValue, gameTime }) => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      scene.gameSpeed = 0;
      scene.gameTime = gameTime;
      scene.data.set('acceptanceTargetHour', hourValue);
    }, { hourValue: hour, gameTime: gameTimeForHour(hour) });

    await page.waitForTimeout(350);
    const snapshot = await page.evaluate(() => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      const system = scene.dayNightSystem ?? scene.data.get('dayNightSystem');
      return {
        state: system.getState(),
        diagnostics: system.getDiagnostics(),
      };
    });

    await page.screenshot({
      path: `${ARTIFACT_DIR}/day-night-${label}.png`,
      fullPage: true,
    });
    return snapshot;
  }

  const morning = await capturePhase('08-morning', 8);
  const noon = await capturePhase('12-noon', 12);
  const sunset = await capturePhase('17-sunset', 17);
  const evening = await capturePhase('20-evening', 20);
  const midnight = await capturePhase('00-midnight', 0);

  assert(morning.diagnostics.lastDrawnBuildings > 0, 'Morning rendered no visible building shadows.');
  assert(noon.diagnostics.lastDrawnBuildings > 0, 'Noon rendered no visible building shadows.');
  assert(sunset.diagnostics.lastDrawnBuildings > 0, 'Sunset rendered no visible building shadows.');
  assert(midnight.diagnostics.lastDrawnBuildings === 0, 'Midnight still rendered solar building shadows.');
  assert(morning.diagnostics.lastStampedBuildingContacts > 0, 'Morning rendered no building contact shadows.');
  assert(midnight.diagnostics.lastStampedBuildingContacts > 0, 'Midnight removed building contact shadows.');
  assert(morning.diagnostics.lastScannedTreeVisuals >= morning.diagnostics.lastStampedTreeContacts, 'Tree contact diagnostics are inconsistent.');
  assert(midnight.diagnostics.lastScannedTreeVisuals >= midnight.diagnostics.lastStampedTreeContacts, 'Night tree contact diagnostics are inconsistent.');
  assert(midnight.diagnostics.lastStampedTreeProjections === 0, 'Midnight retained projected tree shadows.');
  assert(morning.diagnostics.lastStampedUnitProjections > 0, 'Morning stamped no unit or citizen shadows.');
  assert(midnight.diagnostics.lastStampedUnitProjections === 0, 'Midnight retained projected unit shadows.');
  assert(morning.diagnostics.lastStampedBuildingSilhouettes > 0, 'Morning stamped no building silhouettes.');
  assert(midnight.diagnostics.lastStampedBuildingSilhouettes === 0, 'Midnight stamped solar building silhouettes.');
  assert(morning.diagnostics.shadowBufferResolution === 0.5, 'Shadow buffer is not half resolution.');
  assert(morning.diagnostics.shadowBufferWidth > 0 && morning.diagnostics.shadowBufferHeight > 0, 'Shadow buffer dimensions are invalid.');
  assert(midnight.state.shadowAlpha === 0, 'Midnight solar shadow alpha was not zero.');
  assert(midnight.state.ambientAlpha > morning.state.ambientAlpha, 'Night did not darken ambient lighting vs morning.');
  assert(noon.state.shadowLength < morning.state.shadowLength, 'Noon shadows were not shorter than morning shadows.');
  assert(sunset.state.shadowLength > noon.state.shadowLength * 2, 'Sunset shadows were not substantially longer than noon.');

  const angleDelta = Math.abs(sunset.state.shadowAngleRad - morning.state.shadowAngleRad);
  assert(angleDelta > 1, `Building shadow direction did not rotate enough across the day (${angleDelta.toFixed(2)} rad).`);
  assert(evening.state.shadowAlpha === 0, 'Evening solar shadows should be gone after sunset.');
  assert(morning.diagnostics.uiCameraIgnoresAmbient, 'UI camera does not ignore the ambient day/night layer.');
  assert(morning.diagnostics.uiCameraIgnoresShadows, 'UI camera does not ignore the day/night shadow layers.');
  assert(midnight.diagnostics.uiCameraIgnoresAmbient, 'Night ambient overlay can reach the UI camera.');

  telemetry.phases = { morning, noon, sunset, evening, midnight };

  telemetry.phase = 'cycle-continuity';
  const continuity = await page.evaluate(async ({ dayLengthMs, startHour, samplesPerHour }) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const system = scene.dayNightSystem ?? scene.data.get('dayNightSystem');
    scene.gameSpeed = 0;
    const samples = [];
    const toTime = (hour) => {
      const offset = ((hour - startHour) % 24 + 24) % 24;
      return dayLengthMs * (offset / 24);
    };

    // Sub-hour samples distinguish a real interpolation discontinuity from a large but
    // intentional lighting change accumulated across a full in-game hour.
    for (let index = 0; index <= 24 * samplesPerHour; index++) {
      const requestedHour = index / samplesPerHour;
      const wrappedHour = requestedHour === 24 ? 0 : requestedHour;
      scene.gameTime = toTime(wrappedHour);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      samples.push({ requestedHour, ...system.getState() });
    }
    return samples;
  }, { dayLengthMs: DAY_LENGTH_MS, startHour: DAY_START_HOUR, samplesPerHour: 4 });

  let maxAmbientAlphaStep = 0;
  for (let i = 1; i < continuity.length; i++) {
    maxAmbientAlphaStep = Math.max(
      maxAmbientAlphaStep,
      Math.abs(continuity[i].ambientAlpha - continuity[i - 1].ambientAlpha),
    );
  }
  assert(maxAmbientAlphaStep < 0.16, `Ambient cycle contains a visible alpha jump (${maxAmbientAlphaStep.toFixed(3)}).`);
  assert(
    Math.abs(continuity[0].ambientAlpha - continuity.at(-1).ambientAlpha) < 0.01,
    `Day/night ambient loop does not wrap continuously from 24:00 to 00:00 (${continuity[0].ambientAlpha} vs ${continuity.at(-1).ambientAlpha}).`,
  );
  telemetry.continuity = { samples: continuity, maxAmbientAlphaStep };

  // Exercise the same window event bridge used by the React speed controls.
  async function probeGameSpeed(speed, minAdvanceMs) {
    const start = await page.evaluate((value) => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      window.dispatchEvent(new CustomEvent('set-game-speed-ui', { detail: value }));
      if (scene.gameSpeed !== value) {
        throw new Error(`set-game-speed-ui did not set gameSpeed to ${value}.`);
      }
      return scene.gameTime;
    }, speed);

    await page.waitForFunction(({ startTime, advance }) => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      return scene.gameTime >= startTime + advance;
    }, { startTime: start, advance: minAdvanceMs }, { timeout: 30_000 });

    const end = await page.evaluate(() => window.__civStrategyGame.scene.getScene('MainScene').gameTime);
    return end - start;
  }

  telemetry.phase = 'game-speed';
  const normalAdvanceMs = await probeGameSpeed(1, 40);
  const fastAdvanceMs = await probeGameSpeed(3, 120);

  telemetry.phase = 'dense-fixture';
  const denseSetup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.gameSpeed = 0;
    const buildings = scene.buildings.getChildren();
    const townCenter = buildings.find((building) =>
      building.getData('owner') === 0 && building.getData('def')?.type === 'Town Center');
    if (!townCenter) throw new Error('Player Town Center missing during dense day/night setup.');

    const before = buildings.length;
    for (let i = 0; i < 320; i++) {
      const col = i % 20;
      const row = Math.floor(i / 20);
      const x = 48 + col * 56;
      const y = scene.mapHeight - 48 - row * 56;
      scene.entityFactory.spawnBuilding('House', x, y, 0);
    }
    const treeVisualsBefore = scene.treeVisuals.getLength();
    for (let i = 0; i < 96; i++) {
      const col = i % 12;
      const row = Math.floor(i / 12);
      const visual = scene.treeVisuals.create(
        townCenter.visual.x - 260 + col * 44,
        townCenter.visual.y - 130 + row * 34,
        'tree',
      );
      visual.setOrigin(0.5, 0.95).setScale(0.075).setAlpha(0.85).setDepth(townCenter.visual.y - 100 + row * 34);
      scene.worldLayer.add(visual);
      scene.uiCamera?.ignore(visual);
    }
    if (townCenter.visual) scene.cameras.main.centerOn(townCenter.visual.x, townCenter.visual.y);

    return {
      initialBuildings: before,
      totalBuildings: scene.buildings.getChildren().length,
      addedTreeVisuals: scene.treeVisuals.getLength() - treeVisualsBefore,
    };
  });

  await page.evaluate((gameTime) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.gameSpeed = 0;
    scene.gameTime = gameTime;
  }, gameTimeForHour(17));
  await page.waitForTimeout(450);

  const perfStart = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return (scene.dayNightSystem ?? scene.data.get('dayNightSystem')).getDiagnostics();
  });
  await page.waitForTimeout(1_600);
  const perfEnd = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return (scene.dayNightSystem ?? scene.data.get('dayNightSystem')).getDiagnostics();
  });

  const refreshDelta = perfEnd.shadowRefreshCount - perfStart.shadowRefreshCount;
  const renderMsDelta = perfEnd.totalShadowRenderMs - perfStart.totalShadowRenderMs;
  const averageShadowRenderMs = refreshDelta > 0 ? renderMsDelta / refreshDelta : null;
  const observedMinRefreshGapMs = finiteMinimum(
    perfEnd.minShadowRefreshGapMs,
    perfEnd.lastShadowRefreshGapMs,
  );

  assert(denseSetup.totalBuildings >= 300, `Dense-map fixture only created ${denseSetup.totalBuildings} buildings.`);
  assert(refreshDelta >= 1, 'Dense-map cadence window observed no shadow redraw.');
  assert(
    observedMinRefreshGapMs !== null,
    'Shadow diagnostics did not expose a finite min/last refresh gap.',
  );
  assert(
    observedMinRefreshGapMs >= SHADOW_REFRESH_MS - REFRESH_TIMER_TOLERANCE_MS,
    `Shadow redraw cadence exceeded 5 Hz (${observedMinRefreshGapMs.toFixed(1)}ms minimum gap).`,
  );
  assert(perfEnd.lastScannedBuildings >= 300, 'Dense-map diagnostics did not scan the populated building set.');
  assert(perfEnd.lastDrawnBuildings > 0, 'Dense-map acceptance drew no on-screen shadows.');
  assert(denseSetup.addedTreeVisuals >= 96, 'Dense-map fixture did not add its visible tree pool.');
  assert(perfEnd.lastStampedTreeContacts >= 96, 'Dense-map fixture stamped too few tree contact shadows.');
  assert(perfEnd.lastStampedTreeProjections >= 96, 'Dense-map fixture stamped too few projected tree shadows.');
  assert(
    perfEnd.lastDrawnBuildings < perfEnd.lastScannedBuildings,
    `Viewport culling did not reduce shadow draw work (${perfEnd.lastDrawnBuildings}/${perfEnd.lastScannedBuildings}).`,
  );
  assert(
    averageShadowRenderMs !== null && averageShadowRenderMs < MAX_AVERAGE_SHADOW_RENDER_MS,
    `Dense-map batched redraw averaged ${averageShadowRenderMs?.toFixed(2) ?? 'no samples'}ms, above the ${MAX_AVERAGE_SHADOW_RENDER_MS}ms ceiling.`,
  );

  await page.screenshot({
    path: `${ARTIFACT_DIR}/day-night-dense-sunset.png`,
    fullPage: true,
  });

  telemetry.denseSetup = denseSetup;
  telemetry.densePerformance = {
    refreshWindowMs: 1_600,
    refreshDelta,
    renderMsDelta,
    averageShadowRenderMs,
    observedMinRefreshGapMs,
    timerToleranceMs: REFRESH_TIMER_TOLERANCE_MS,
    initialDiagnostics: perfStart,
    finalDiagnostics: perfEnd,
  };

  // A paused Phaser scene does not run DayNightSystem.update, so both the
  // serialized simulation time and the immutable lighting snapshot must freeze.
  telemetry.phase = 'pause';
  const pauseStart = await page.evaluate(() => {
    const game = window.__civStrategyGame;
    const scene = game.scene.getScene('MainScene');
    window.dispatchEvent(new CustomEvent('set-game-speed-ui', { detail: 1 }));
    const system = scene.dayNightSystem ?? scene.data.get('dayNightSystem');
    const snapshot = { gameTime: scene.gameTime, state: system.getState() };
    game.scene.pause('MainScene');
    return snapshot;
  });
  await page.waitForTimeout(450);
  const pauseEnd = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const system = scene.dayNightSystem ?? scene.data.get('dayNightSystem');
    return { gameTime: scene.gameTime, state: system.getState() };
  });
  const pausedAdvanceMs = pauseEnd.gameTime - pauseStart.gameTime;
  assert(pausedAdvanceMs < 8, `Day/night simulation advanced ${pausedAdvanceMs.toFixed(1)}ms while paused.`);
  assert(
    JSON.stringify(pauseEnd.state) === JSON.stringify(pauseStart.state),
    'Day/night lighting state changed while the scene was paused.',
  );

  telemetry.simulationTiming = { pausedAdvanceMs, normalAdvanceMs, fastAdvanceMs };
  telemetry.pause = { start: pauseStart, end: pauseEnd };
  assert(telemetry.browserErrors.length === 0, `Browser page errors:\n${telemetry.browserErrors.join('\n')}`);
  telemetry.phase = 'complete';
  telemetry.passed = true;

  console.log(JSON.stringify(telemetry, null, 2));
} catch (error) {
  telemetry.phase = `failed:${telemetry.phase}`;
  telemetry.failure = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
  if (page) {
    try {
      await page.screenshot({ path: `${ARTIFACT_DIR}/day-night-failure.png`, fullPage: true });
    } catch {
      // JSON and Vite logs remain available if the page has already closed.
    }
  }
  throw error;
} finally {
  await persistEvidence();
  if (browser) await browser.close();
  await stopServer();
}
