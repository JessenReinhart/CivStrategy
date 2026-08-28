import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4178;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const POINTER_STATE_TIMEOUT_MS = 30_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

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
    `${ARTIFACT_DIR}/villager-gather-telemetry.json`,
    `${JSON.stringify(telemetry, null, 2)}\n`,
    'utf8',
  );
  if (!page) return;
  try {
    await page.screenshot({ path: `${ARTIFACT_DIR}/villager-gather-journey.png`, fullPage: true });
  } catch {
    // Keep telemetry if Chromium has already closed.
  }
}

const visualScreenPoint = (kind) => page.evaluate((targetKind) => {
  const scene = window.__civStrategyGame.scene.getScene('MainScene');
  const probe = window.__villagerGatherProbe;
  const visual = targetKind === 'villager' ? probe.villager.visual : probe.camp.visual;
  const camera = scene.cameras.main;
  const topLeft = camera.getWorldPoint(0, 0);
  let worldX = visual.x;
  let worldY = visual.y - 8;

  if (targetKind === 'camp') {
    const hitArea = visual.input?.hitArea;
    const localX = typeof hitArea?.centerX === 'number' ? hitArea.centerX : 0;
    const localY = typeof hitArea?.centerY === 'number' ? hitArea.centerY : -24;
    const transformed = visual.getWorldTransformMatrix().transformPoint(localX, localY);
    worldX = transformed.x;
    worldY = transformed.y;
  }

  return {
    x: (worldX - topLeft.x) * camera.zoom,
    y: (worldY - topLeft.y) * camera.zoom,
  };
}, kind);

const readProbe = () => page.evaluate(() => {
  const scene = window.__civStrategyGame.scene.getScene('MainScene');
  const { villager, camp } = window.__villagerGatherProbe;
  const ring = villager.visual?.getData('workforceSelectionRing');
  return {
    gameTime: scene.gameTime,
    wood: scene.resources.wood,
    population: scene.population,
    villager: {
      id: villager.id,
      state: villager.state,
      carryAmount: villager.carryAmount,
      carryType: villager.carryType,
      hasPath: Boolean(villager.path?.length),
      assignedToCamp: villager.jobBuilding === camp,
      selected: Boolean(ring?.active),
    },
    campAssignedWorkerId: camp.getData('assignedWorker')?.id ?? null,
  };
});

const waitForCameraSync = () => page.waitForFunction(() => {
  const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
  const mainCamera = scene?.cameras?.main;
  const uiCamera = scene?.uiCamera;
  if (!mainCamera || !uiCamera) return false;

  return Math.abs(mainCamera.scrollX - uiCamera.scrollX) < 0.5
    && Math.abs(mainCamera.scrollY - uiCamera.scrollY) < 0.5
    && Math.abs(mainCamera.zoom - uiCamera.zoom) < 0.001;
}, undefined, { timeout: POINTER_STATE_TIMEOUT_MS });

const pressRightButtonThroughGameFrame = async (canvasBox, point) => {
  await page.mouse.move(canvasBox.x + point.x, canvasBox.y + point.y);

  // Workforce commands are handled on pointerdown and read Phaser's world-space
  // pointer immediately. Let one game step consume the DOM mousemove first so a
  // slow SwiftShader frame cannot reuse the previous pointer position as a rally.
  const frameBeforeMoveSync = await page.evaluate(() => window.__civStrategyGame.loop.frame);
  await page.waitForFunction((previousFrame) => (
    window.__civStrategyGame?.loop?.frame > previousFrame
  ), frameBeforeMoveSync, { timeout: POINTER_STATE_TIMEOUT_MS });

  const frameBeforeDown = await page.evaluate(() => window.__civStrategyGame.loop.frame);
  await page.mouse.down({ button: 'right' });
  try {
    // Keep the button down through a game step too. On SwiftShader a complete
    // Playwright click can otherwise press and release between two Phaser steps.
    await page.waitForFunction((previousFrame) => (
      window.__civStrategyGame?.loop?.frame > previousFrame
    ), frameBeforeDown, { timeout: POINTER_STATE_TIMEOUT_MS });
  } finally {
    await page.mouse.up({ button: 'right' });
  }
};

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => telemetry.browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.villagerSystem && scene?.inputManager && scene?.entityFactory);
  }, undefined, { timeout: 45_000 });

  telemetry.phase = 'setup';
  telemetry.setup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;

    // Isolate explicit player assignment from the periodic auto-staffing pass.
    // The gather/carry/deposit state machine remains authoritative.
    scene.economySystem.assignJobs = () => {};

    const villagers = scene.villagerSystem.getIdleVillagers(0);
    const villager = villagers[0];
    if (!villager?.visual) throw new Error('No idle player villager is available for workforce input.');

    const trees = scene.trees.getChildren().filter((tree) => (
      tree.active && !tree.getData('isGoldMine') && !tree.getData('isChopped')
    ));
    let nearestTree = null;
    let nearestDistance = Infinity;
    for (const tree of trees) {
      const distance = Math.hypot(tree.x - villager.x, tree.y - villager.y);
      if (distance < nearestDistance) {
        nearestTree = tree;
        nearestDistance = distance;
      }
    }
    if (!nearestTree || nearestDistance > 280) {
      throw new Error(`No live tree is close enough for a deterministic lumber loop (${nearestDistance.toFixed(1)}px).`);
    }

    const dx = nearestTree.x - villager.x;
    const dy = nearestTree.y - villager.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    // Keep the drop site beside the villager→tree corridor. A camp placed on
    // that corridor can legitimately block the same worker's later resource path.
    const campX = villager.x + (-dy / length) * 64;
    const campY = villager.y + (dx / length) * 64;
    const camp = scene.entityFactory.spawnBuilding('Lumber Camp', campX, campY, 0);
    camp.setData('__journeyCamp', true);

    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(villager.visual.x, villager.visual.y);
    window.__villagerGatherProbe = { villager, camp };

    return {
      initialWood: scene.resources.wood,
      treeDistance: nearestDistance,
      villager: { id: villager.id, x: villager.x, y: villager.y, state: villager.state },
      camp: { x: campX, y: campY },
    };
  });
  // MainScene synchronizes the UI camera at the end of update(). SwiftShader
  // CI can render below 1 FPS, so a fixed wall-clock sleep is not evidence that
  // pointer.worldX/worldY now use the camera transform established above.
  await waitForCameraSync();

  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas was not measurable.');

  telemetry.phase = 'select-villager';
  let villagerPoint = await visualScreenPoint('villager');
  await page.mouse.click(canvasBox.x + villagerPoint.x, canvasBox.y + villagerPoint.y, { button: 'left' });
  await page.waitForFunction(() => {
    const ring = window.__villagerGatherProbe?.villager?.visual?.getData('workforceSelectionRing');
    return Boolean(ring?.active);
  }, undefined, { timeout: POINTER_STATE_TIMEOUT_MS });
  telemetry.afterSelection = await readProbe();

  telemetry.phase = 'escape-deselect';
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const ring = window.__villagerGatherProbe?.villager?.visual?.getData('workforceSelectionRing');
    return !ring?.active;
  }, undefined, { timeout: POINTER_STATE_TIMEOUT_MS });
  telemetry.afterEscape = await readProbe();

  const campPointWhileDeselected = await visualScreenPoint('camp');
  await pressRightButtonThroughGameFrame(canvasBox, campPointWhileDeselected);
  await sleep(100);
  telemetry.afterDeselectedCommand = await readProbe();

  telemetry.phase = 'reselect-villager';
  villagerPoint = await visualScreenPoint('villager');
  await page.mouse.click(canvasBox.x + villagerPoint.x, canvasBox.y + villagerPoint.y, { button: 'left' });
  await page.waitForFunction(() => {
    const ring = window.__villagerGatherProbe?.villager?.visual?.getData('workforceSelectionRing');
    return Boolean(ring?.active);
  }, undefined, { timeout: POINTER_STATE_TIMEOUT_MS });
  telemetry.afterReselection = await readProbe();

  telemetry.phase = 'assign-work';
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { villager, camp } = window.__villagerGatherProbe;
    scene.cameras.main.centerOn((villager.visual.x + camp.visual.x) * 0.5, (villager.visual.y + camp.visual.y) * 0.5);
  });
  await waitForCameraSync();
  const campPoint = await visualScreenPoint('camp');
  await pressRightButtonThroughGameFrame(canvasBox, campPoint);

  await page.waitForFunction(() => {
    const { villager, camp } = window.__villagerGatherProbe;
    return villager.jobBuilding === camp && camp.getData('assignedWorker') === villager;
  }, undefined, { timeout: POINTER_STATE_TIMEOUT_MS });
  telemetry.afterAssignment = await readProbe();

  telemetry.phase = 'gather-deposit';
  telemetry.simulationAdvance = await page.evaluate((initialWood) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    let simulatedMs = 0;

    // Headless CI can render Phaser at only a few FPS. Advance only the real
    // VillagerSystem clock deterministically after the real pointer assignment
    // so this proves its path/gather/carry/deposit state machine without making
    // wall-clock runner speed part of the acceptance contract.
    for (let i = 0; i < 2_000 && scene.resources.wood <= initialWood; i++) {
      scene.villagerSystem.update(scene.gameTime + simulatedMs, 100);
      simulatedMs += 100;
    }

    return { simulatedMs, finalWood: scene.resources.wood };
  }, telemetry.setup.initialWood);
  telemetry.final = await readProbe();
  telemetry.woodDeposited = telemetry.final.wood - telemetry.setup.initialWood;

  telemetry.phase = 'assert';
  await persistEvidence();

  if (!telemetry.afterSelection.villager.selected) {
    throw new Error('Real canvas left-click did not visibly select the starting villager.');
  }
  if (telemetry.afterEscape.villager.selected) {
    throw new Error('Escape did not clear the workforce selection ring.');
  }
  if (telemetry.afterDeselectedCommand.villager.assignedToCamp) {
    throw new Error('A deselected villager still accepted a workforce right-click command.');
  }
  if (!telemetry.afterReselection.villager.selected) {
    throw new Error('Villager could not be selected again after Escape.');
  }
  if (!telemetry.afterAssignment.villager.assignedToCamp) {
    throw new Error('Real right-click did not assign the selected villager to the Lumber Camp.');
  }
  if (telemetry.woodDeposited <= 0) {
    throw new Error(`Gather loop did not deposit wood after ${telemetry.simulationAdvance.simulatedMs} ms simulated (${telemetry.woodDeposited}).`);
  }
  if (telemetry.browserErrors.length > 0) {
    throw new Error(`Browser page errors during villager gather journey:\n${telemetry.browserErrors.join('\n')}`);
  }

  telemetry.phase = 'passed';
  await persistEvidence();
  console.log(JSON.stringify(telemetry, null, 2));
} catch (error) {
  telemetry.phase = `failed:${telemetry.phase}`;
  telemetry.error = error instanceof Error ? error.stack ?? error.message : String(error);
  if (page && await page.evaluate(() => Boolean(window.__villagerGatherProbe)).catch(() => false)) {
    telemetry.failureRuntime = await readProbe().catch(() => null);
  }
  await persistEvidence();
  console.error(JSON.stringify(telemetry, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
