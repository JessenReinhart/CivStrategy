import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const DAY_LENGTH_MS = 12 * 60 * 1000;
const DAY_START_HOUR = 8;

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
  await page.getByRole('button', { name: 'Commence' }).click();

  await page.waitForFunction(() => {
    const game = window.__civStrategyGame;
    const scene = game?.scene?.getScene?.('MainScene');
    return Boolean(
      scene?.isReady &&
      scene?.data?.get?.('dayNightSystem') &&
      scene?.uiCamera &&
      scene?.buildings?.getChildren?.().length,
    );
  }, undefined, { timeout: 45_000 });

  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.aiDisabled = true;
    scene.gameSpeed = 0;
  });

  async function capturePhase(label, hour) {
    await page.evaluate(({ hourValue, gameTime }) => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      scene.gameSpeed = 0;
      scene.gameTime = gameTime;
      scene.data.set('acceptanceTargetHour', hourValue);
    }, { hourValue: hour, gameTime: gameTimeForHour(hour) });

    await page.waitForTimeout(350);
    const snapshot = await page.evaluate(() => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      const system = scene.data.get('dayNightSystem');
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
  assert(midnight.state.shadowAlpha === 0, 'Midnight solar shadow alpha was not zero.');
  assert(midnight.state.ambientAlpha > morning.state.ambientAlpha, 'Night did not darken ambient lighting vs morning.');
  assert(noon.state.shadowLength < morning.state.shadowLength, 'Noon shadows were not shorter than morning shadows.');
  assert(sunset.state.shadowLength > noon.state.shadowLength * 2, 'Sunset shadows were not substantially longer than noon.');

  const angleDelta = Math.abs(sunset.state.shadowAngleRad - morning.state.shadowAngleRad);
  assert(angleDelta > 1, `Building shadow direction did not rotate enough across the day (${angleDelta.toFixed(2)} rad).`);
  assert(evening.state.shadowAlpha === 0, 'Evening solar shadows should be gone after sunset.');
  assert(morning.diagnostics.uiCameraIgnoresAmbient, 'UI camera does not ignore the ambient day/night layer.');
  assert(morning.diagnostics.uiCameraIgnoresShadows, 'UI camera does not ignore the day/night shadow layer.');
  assert(midnight.diagnostics.uiCameraIgnoresAmbient, 'Night ambient overlay can reach the UI camera.');

  const continuity = await page.evaluate(async ({ dayLengthMs, startHour }) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const system = scene.data.get('dayNightSystem');
    scene.gameSpeed = 0;
    const samples = [];
    const toTime = (hour) => {
      const offset = ((hour - startHour) % 24 + 24) % 24;
      return dayLengthMs * (offset / 24);
    };

    for (let hour = 0; hour <= 24; hour++) {
      scene.gameTime = toTime(hour % 24);
      await new Promise((resolve) => setTimeout(resolve, 70));
      samples.push({ requestedHour: hour, ...system.getState() });
    }
    return samples;
  }, { dayLengthMs: DAY_LENGTH_MS, startHour: DAY_START_HOUR });

  let maxAmbientAlphaStep = 0;
  for (let i = 1; i < continuity.length; i++) {
    maxAmbientAlphaStep = Math.max(
      maxAmbientAlphaStep,
      Math.abs(continuity[i].ambientAlpha - continuity[i - 1].ambientAlpha),
    );
  }
  assert(maxAmbientAlphaStep < 0.16, `Ambient cycle contains a visible alpha jump (${maxAmbientAlphaStep.toFixed(3)}).`);
  assert(
    Math.abs(continuity[0].ambientAlpha - continuity.at(-1).ambientAlpha) < 0.001,
    'Day/night ambient loop does not wrap continuously from 24:00 to 00:00.',
  );

  // Verify the real UI-facing speed event changes MainScene speed and that
  // simulation time advances. Avoid wall-clock ratio assertions because CI's
  // software renderer can skip frames under load without changing game logic.
  async function probeGameSpeed(speed, minAdvanceMs) {
    const start = await page.evaluate((value) => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      scene.game.events.emit('set-game-speed', value);
      if (scene.gameSpeed !== value) {
        throw new Error(`SET_GAME_SPEED did not set gameSpeed to ${value}.`);
      }
      return scene.gameTime;
    }, speed);

    await page.waitForFunction(({ startTime, advance }) => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      return scene.gameTime >= startTime + advance;
    }, { startTime: start, advance: minAdvanceMs }, { timeout: 5_000 });

    const end = await page.evaluate(() => window.__civStrategyGame.scene.getScene('MainScene').gameTime);
    return end - start;
  }

  const slowAdvanceMs = await probeGameSpeed(0.5, 20);
  const fastAdvanceMs = await probeGameSpeed(2, 80);

  // Build the dense fixture only for the shadow performance/culling contract.
  // Keeping it out of the timing checks prevents software-renderer stalls from
  // being mistaken for broken game-speed behavior.
  const denseSetup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.gameSpeed = 0;
    const buildings = scene.buildings.getChildren();
    const tc = buildings.find((building) =>
      building.getData('owner') === 0 && building.getData('def')?.type === 'Town Center');
    if (!tc) throw new Error('Player Town Center missing during dense day/night setup.');

    const before = buildings.length;
    for (let i = 0; i < 320; i++) {
      const col = i % 20;
      const row = Math.floor(i / 20);
      const x = 48 + col * 56;
      const y = scene.mapHeight - 48 - row * 56;
      scene.entityFactory.spawnBuilding('House', x, y, 0);
    }
    if (tc.visual) scene.cameras.main.centerOn(tc.visual.x, tc.visual.y);

    return {
      initialBuildings: before,
      totalBuildings: scene.buildings.getChildren().length,
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
    return scene.data.get('dayNightSystem').getDiagnostics();
  });
  await page.waitForTimeout(1_200);
  const perfEnd = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.data.get('dayNightSystem').getDiagnostics();
  });

  const refreshDelta = perfEnd.shadowRefreshCount - perfStart.shadowRefreshCount;
  const renderMsDelta = perfEnd.totalShadowRenderMs - perfStart.totalShadowRenderMs;
  const averageShadowRenderMs = refreshDelta > 0 ? renderMsDelta / refreshDelta : Infinity;

  assert(denseSetup.totalBuildings >= 300, `Dense-map fixture only created ${denseSetup.totalBuildings} buildings.`);
  assert(refreshDelta >= 4 && refreshDelta <= 8, `Shadow redraw cadence was not bounded near 5 Hz (${refreshDelta} redraws / 1.2s).`);
  assert(perfEnd.lastScannedBuildings >= 300, 'Dense-map shadow diagnostics did not scan the populated building set.');
  assert(perfEnd.lastDrawnBuildings > 0, 'Dense-map acceptance drew no on-screen shadows.');
  assert(
    perfEnd.lastDrawnBuildings < perfEnd.lastScannedBuildings,
    `Viewport culling did not reduce shadow draw work (${perfEnd.lastDrawnBuildings}/${perfEnd.lastScannedBuildings}).`,
  );
  assert(
    averageShadowRenderMs < 20,
    `Dense-map batched shadow redraw averaged ${averageShadowRenderMs.toFixed(2)}ms, above the 20ms acceptance ceiling.`,
  );

  await page.screenshot({
    path: `${ARTIFACT_DIR}/day-night-dense-sunset.png`,
    fullPage: true,
  });

  // Pause is the final lifecycle check. Day/night derives from gameTime, so a
  // frozen gameTime proves lighting is frozen too. No resume is needed because
  // the browser is torn down immediately afterward.
  const pauseStart = await page.evaluate(() => {
    const game = window.__civStrategyGame;
    const scene = game.scene.getScene('MainScene');
    scene.game.events.emit('set-game-speed', 1);
    const start = scene.gameTime;
    game.scene.pause('MainScene');
    return start;
  });
  await page.waitForTimeout(450);
  const pauseEnd = await page.evaluate(() => window.__civStrategyGame.scene.getScene('MainScene').gameTime);
  const pausedAdvanceMs = pauseEnd - pauseStart;
  assert(pausedAdvanceMs < 8, `Day/night simulation advanced ${pausedAdvanceMs.toFixed(1)}ms while the scene was paused.`);

  const result = {
    denseSetup,
    phases: { morning, noon, sunset, evening, midnight },
    continuity: { samples: continuity, maxAmbientAlphaStep },
    simulationTiming: { pausedAdvanceMs, slowAdvanceMs, fastAdvanceMs },
    densePerformance: {
      refreshDelta,
      renderMsDelta,
      averageShadowRenderMs,
      finalDiagnostics: perfEnd,
    },
  };

  await writeFile(
    `${ARTIFACT_DIR}/day-night-journey.json`,
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify(result, null, 2));

  if (browserErrors.length > 0) {
    throw new Error(`Browser page errors during day/night journey:\n${browserErrors.join('\n')}`);
  }
} finally {
  if (browser) await browser.close();
  await stopServer();
}
