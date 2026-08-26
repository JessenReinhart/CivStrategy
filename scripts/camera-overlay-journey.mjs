import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4176;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';

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
const telemetry = { phase: 'boot', browserErrors: [] };

async function persistEvidence() {
  await writeFile(
    `${ARTIFACT_DIR}/camera-overlay-telemetry.json`,
    `${JSON.stringify(telemetry, null, 2)}\n`,
    'utf8',
  );
  if (page) {
    try {
      await page.screenshot({ path: `${ARTIFACT_DIR}/camera-overlay-journey.png`, fullPage: true });
    } catch {
      // Preserve JSON telemetry even if the page has already closed.
    }
  }
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => telemetry.browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();

  await page.waitForFunction(() => {
    const game = window.__civStrategyGame;
    const scene = game?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.minimapSystem && scene?.fogOfWar && scene?.inputManager);
  }, undefined, { timeout: 45_000 });

  const readSnapshot = () => page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const camera = scene.cameras.main;
    const minimap = scene.minimapSystem;
    const fog = scene.fogOfWar;
    const viewport = minimap.viewportGraphics;
    const viewportBounds = viewport.getBounds();
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      camera: {
        scrollX: camera.scrollX,
        scrollY: camera.scrollY,
        zoom: camera.zoom,
        width: camera.width,
        height: camera.height,
        topLeftX: topLeft.x,
        topLeftY: topLeft.y,
      },
      minimap: {
        viewportVisible: viewport.visible,
        viewportX: viewportBounds.x,
        viewportY: viewportBounds.y,
        viewportWidth: viewportBounds.width,
        viewportHeight: viewportBounds.height,
        textureX: minimap.renderTexture.x,
        textureY: minimap.renderTexture.y,
        textureScaleX: minimap.renderTexture.scaleX,
      },
      fog: {
        topLeftX: fog._topLeftX,
        topLeftY: fog._topLeftY,
        textureX: fog.screenRT.x,
        textureY: fog.screenRT.y,
        textureScaleX: fog.screenRT.scaleX,
      },
    };
  });

  telemetry.phase = 'initial';
  telemetry.initial = await readSnapshot();
  if (!telemetry.initial.minimap.viewportVisible) {
    throw new Error('Minimap viewport is not a live visible overlay.');
  }

  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 720, y: 450 } });
  await page.keyboard.down('ArrowRight');
  await sleep(120);
  await page.keyboard.up('ArrowRight');
  await sleep(50);

  telemetry.phase = 'after-pan';
  telemetry.afterPan = await readSnapshot();
  telemetry.cameraPan = Math.hypot(
    telemetry.afterPan.camera.scrollX - telemetry.initial.camera.scrollX,
    telemetry.afterPan.camera.scrollY - telemetry.initial.camera.scrollY,
  );
  telemetry.viewportPan = Math.hypot(
    telemetry.afterPan.minimap.viewportX - telemetry.initial.minimap.viewportX,
    telemetry.afterPan.minimap.viewportY - telemetry.initial.minimap.viewportY,
  );
  telemetry.panFogError = Math.hypot(
    telemetry.afterPan.fog.topLeftX - telemetry.afterPan.camera.topLeftX,
    telemetry.afterPan.fog.topLeftY - telemetry.afterPan.camera.topLeftY,
  );
  await persistEvidence();

  if (telemetry.cameraPan < 5) {
    throw new Error(`Real keyboard pan did not move the camera enough (${telemetry.cameraPan}px).`);
  }
  if (telemetry.viewportPan < 0.01) {
    throw new Error('Minimap viewport did not move with the real camera pan.');
  }
  if (telemetry.panFogError > 1) {
    throw new Error(`Fog camera state lagged real pan by ${telemetry.panFogError.toFixed(2)} world pixels.`);
  }

  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas was not measurable.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -500);
  await sleep(80);

  telemetry.phase = 'after-zoom';
  telemetry.afterZoom = await readSnapshot();
  telemetry.zoomDelta = Math.abs(telemetry.afterZoom.camera.zoom - telemetry.afterPan.camera.zoom);
  telemetry.expectedMinimapScale = 1 / telemetry.afterZoom.camera.zoom;
  telemetry.expectedFogScale = 4 / telemetry.afterZoom.camera.zoom;
  telemetry.expectedFogX = (telemetry.afterZoom.camera.width * 0.5) * (1 - 1 / telemetry.afterZoom.camera.zoom);
  telemetry.expectedFogY = (telemetry.afterZoom.camera.height * 0.5) * (1 - 1 / telemetry.afterZoom.camera.zoom);
  telemetry.zoomFogError = Math.hypot(
    telemetry.afterZoom.fog.topLeftX - telemetry.afterZoom.camera.topLeftX,
    telemetry.afterZoom.fog.topLeftY - telemetry.afterZoom.camera.topLeftY,
  );
  await persistEvidence();

  if (telemetry.zoomDelta < 0.01) {
    throw new Error('Real mouse-wheel zoom did not change the camera zoom.');
  }
  if (Math.abs(telemetry.afterZoom.minimap.textureScaleX - telemetry.expectedMinimapScale) > 0.01) {
    throw new Error(`Minimap scale ${telemetry.afterZoom.minimap.textureScaleX} did not match expected ${telemetry.expectedMinimapScale} for camera zoom ${telemetry.afterZoom.camera.zoom}.`);
  }
  if (Math.abs(telemetry.afterZoom.fog.textureScaleX - telemetry.expectedFogScale) > 0.02) {
    throw new Error(`Fog scale ${telemetry.afterZoom.fog.textureScaleX} did not match expected ${telemetry.expectedFogScale} for camera zoom ${telemetry.afterZoom.camera.zoom}.`);
  }
  if (Math.abs(telemetry.afterZoom.fog.textureX - telemetry.expectedFogX) > 1 || Math.abs(telemetry.afterZoom.fog.textureY - telemetry.expectedFogY) > 1) {
    throw new Error(`Fog render texture did not remain screen-aligned after real zoom input: actual (${telemetry.afterZoom.fog.textureX}, ${telemetry.afterZoom.fog.textureY}), expected (${telemetry.expectedFogX}, ${telemetry.expectedFogY}).`);
  }
  if (telemetry.zoomFogError > 1) {
    throw new Error(`Fog camera state lagged real zoom by ${telemetry.zoomFogError.toFixed(2)} world pixels.`);
  }
  if (telemetry.browserErrors.length > 0) {
    throw new Error(`Browser page errors during camera overlay journey:\n${telemetry.browserErrors.join('\n')}`);
  }

  telemetry.phase = 'passed';
  await persistEvidence();
  console.log(JSON.stringify(telemetry, null, 2));
} catch (error) {
  telemetry.phase = `failed:${telemetry.phase}`;
  telemetry.error = error instanceof Error ? error.stack ?? error.message : String(error);
  await persistEvidence();
  console.error(JSON.stringify(telemetry, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
