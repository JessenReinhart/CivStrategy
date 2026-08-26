import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';

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

  const initial = await readSnapshot();
  if (!initial.minimap.viewportVisible) {
    throw new Error('Minimap viewport is not a live visible overlay.');
  }

  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 720, y: 450 } });
  await page.keyboard.down('ArrowRight');
  await sleep(120);
  await page.keyboard.up('ArrowRight');
  await sleep(50);

  const afterPan = await readSnapshot();
  const cameraPan = Math.hypot(
    afterPan.camera.scrollX - initial.camera.scrollX,
    afterPan.camera.scrollY - initial.camera.scrollY,
  );
  if (cameraPan < 5) throw new Error(`Real keyboard pan did not move the camera enough (${cameraPan}px).`);

  const viewportPan = Math.hypot(
    afterPan.minimap.viewportX - initial.minimap.viewportX,
    afterPan.minimap.viewportY - initial.minimap.viewportY,
  );
  if (viewportPan < 0.01) {
    throw new Error('Minimap viewport did not move with the real camera pan.');
  }

  const panFogError = Math.hypot(
    afterPan.fog.topLeftX - afterPan.camera.topLeftX,
    afterPan.fog.topLeftY - afterPan.camera.topLeftY,
  );
  if (panFogError > 1) {
    throw new Error(`Fog camera state lagged real pan by ${panFogError.toFixed(2)} world pixels.`);
  }

  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas was not measurable.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -500);
  await sleep(80);

  const afterZoom = await readSnapshot();
  if (Math.abs(afterZoom.camera.zoom - afterPan.camera.zoom) < 0.01) {
    throw new Error('Real mouse-wheel zoom did not change the camera zoom.');
  }

  const expectedMinimapScale = 1 / afterZoom.camera.zoom;
  if (Math.abs(afterZoom.minimap.textureScaleX - expectedMinimapScale) > 0.01) {
    throw new Error(`Minimap scale ${afterZoom.minimap.textureScaleX} did not match camera zoom ${afterZoom.camera.zoom}.`);
  }

  const expectedFogScale = 4 / afterZoom.camera.zoom;
  if (Math.abs(afterZoom.fog.textureScaleX - expectedFogScale) > 0.02) {
    throw new Error(`Fog scale ${afterZoom.fog.textureScaleX} did not counter-scale camera zoom ${afterZoom.camera.zoom}.`);
  }

  const expectedFogX = (afterZoom.camera.width * 0.5) * (1 - 1 / afterZoom.camera.zoom);
  const expectedFogY = (afterZoom.camera.height * 0.5) * (1 - 1 / afterZoom.camera.zoom);
  if (Math.abs(afterZoom.fog.textureX - expectedFogX) > 1 || Math.abs(afterZoom.fog.textureY - expectedFogY) > 1) {
    throw new Error('Fog render texture did not remain screen-aligned after real zoom input.');
  }

  const zoomFogError = Math.hypot(
    afterZoom.fog.topLeftX - afterZoom.camera.topLeftX,
    afterZoom.fog.topLeftY - afterZoom.camera.topLeftY,
  );
  if (zoomFogError > 1) {
    throw new Error(`Fog camera state lagged real zoom by ${zoomFogError.toFixed(2)} world pixels.`);
  }

  await page.screenshot({ path: `${ARTIFACT_DIR}/camera-overlay-journey.png`, fullPage: true });
  console.log(JSON.stringify({ initial, afterPan, afterZoom, cameraPan, viewportPan, panFogError, zoomFogError }, null, 2));

  if (browserErrors.length > 0) {
    throw new Error(`Browser page errors during camera overlay journey:\n${browserErrors.join('\n')}`);
  }
} finally {
  if (browser) await browser.close();
  await stopServer();
}
