import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';

const server = spawn(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
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

function stopServer() {
  if (!server.killed) server.kill('SIGTERM');
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
    return Boolean(scene?.buildingManager && scene?.buildings?.getChildren?.().length);
  }, undefined, { timeout: 45_000 });

  const result = await page.evaluate(() => {
    const game = window.__civStrategyGame;
    const scene = game.scene.getScene('MainScene');
    const manager = scene.buildingManager;

    scene.resources.wood = 100_000;
    scene.resources.food = 100_000;
    scene.resources.gold = 100_000;

    const GRID = 16;
    const dims = {
      House: { width: 48, height: 48 },
      Farm: { width: 48, height: 48 },
    };
    const toIso = (x, y) => ({ x: x - y, y: (x + y) * 0.5 });
    const snap = (value) => Math.floor(value / GRID) * GRID;
    const buildings = () => scene.buildings.getChildren();
    const getDef = (building) => building.getData('def');
    const getOwner = (building) => building.getData('owner');
    const tc = buildings().find((building) => getOwner(building) === 0 && getDef(building)?.type === 'Town Center');
    if (!tc) throw new Error('Player Town Center was not available after world load.');

    const validity = (x, y, type) => manager.getBuildValidity(x, y, type);

    function findAdjacentPair(type) {
      const def = dims[type];
      const baseX = snap(tc.x - 280);
      const baseY = snap(tc.y - 280);
      for (let oy = 0; oy <= 560; oy += GRID) {
        for (let ox = 0; ox <= 560; ox += GRID) {
          const originX = baseX + ox;
          const originY = baseY + oy;
          const first = { x: originX + def.width / 2, y: originY + def.height / 2 };
          const horizontal = { x: first.x + def.width, y: first.y };
          const vertical = { x: first.x, y: first.y + def.height };
          if (validity(first.x, first.y, type).valid && validity(horizontal.x, horizontal.y, type).valid) {
            return { first, second: horizontal };
          }
          if (validity(first.x, first.y, type).valid && validity(vertical.x, vertical.y, type).valid) {
            return { first, second: vertical };
          }
        }
      }
      throw new Error(`Could not find an adjacent valid ${type} pair inside player territory.`);
    }

    function inputForCenter(center, type) {
      const def = dims[type];
      return toIso(center.x - def.width / 2, center.y - def.height / 2);
    }

    function ghostSnapshot(type, center) {
      manager.enterBuildMode(type);
      const input = inputForCenter(center, type);
      manager.updatePreview(input.x, input.y);
      const preview = manager.previewBuilding;
      const ghost = preview.list.find((child) => child.getData?.('placementGhostSprite') === true);
      if (!ghost) throw new Error(`${type} placement ghost sprite was not rendered.`);
      return {
        input,
        previewX: preview.x,
        previewY: preview.y,
        tint: ghost.tintTopLeft,
        alpha: ghost.alpha,
      };
    }

    function buildAt(type, center) {
      const before = new Set(buildings());
      const snapshot = ghostSnapshot(type, center);
      manager.tryBuild(snapshot.input.x, snapshot.input.y);
      const built = buildings().find((building) => !before.has(building) && getOwner(building) === 0 && getDef(building)?.type === type);
      if (!built) throw new Error(`${type} was not created after a valid placement.`);
      return { snapshot, built };
    }

    function verifyPair(type) {
      const pair = findAdjacentPair(type);
      const first = buildAt(type, pair.first);
      const secondValidity = validity(pair.second.x, pair.second.y, type);
      if (!secondValidity.valid) {
        throw new Error(`${type} exact-edge neighbor became invalid after first placement: ${secondValidity.reason ?? 'unknown'}`);
      }
      const second = buildAt(type, pair.second);
      const dx = Math.abs(first.built.x - second.built.x);
      const dy = Math.abs(first.built.y - second.built.y);
      const edgeAdjacent = (dx === dims[type].width && dy === 0) || (dy === dims[type].height && dx === 0);
      if (!edgeAdjacent) throw new Error(`${type} pair was not placed at exact footprint adjacency.`);

      const visual = first.built.visual;
      const previewDelta = Math.hypot(first.snapshot.previewX - visual.x, first.snapshot.previewY - visual.y);
      if (previewDelta > 0.01) throw new Error(`${type} ghost/final visual position drifted by ${previewDelta}px.`);
      if (first.snapshot.tint !== 0xffffff) throw new Error(`${type} valid ghost tint was not the normal building art tint.`);

      const invalid = ghostSnapshot(type, pair.first);
      if (invalid.tint !== 0xff5555) throw new Error(`${type} invalid overlap did not tint the actual ghost red.`);

      return {
        type,
        first: { x: first.built.x, y: first.built.y },
        second: { x: second.built.x, y: second.built.y },
        previewDelta,
        validTint: first.snapshot.tint,
        invalidTint: invalid.tint,
      };
    }

    const houses = verifyPair('House');
    const farms = verifyPair('Farm');
    manager.cancelBuildMode();
    return { houses, farms, buildingCount: buildings().length };
  });

  await page.screenshot({ path: `${ARTIFACT_DIR}/placement-journey.png`, fullPage: true });
  console.log(JSON.stringify(result, null, 2));

  if (browserErrors.length > 0) {
    throw new Error(`Browser page errors during placement journey:\n${browserErrors.join('\n')}`);
  }
} finally {
  if (browser) await browser.close();
  stopServer();
}
