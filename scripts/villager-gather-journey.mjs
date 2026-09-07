import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4178;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const JOURNEY_TIMEOUT_MS = 30_000;
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
      if ((await fetch(BASE_URL)).ok) return;
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

const readProbe = () => page.evaluate(() => {
  const scene = window.__civStrategyGame.scene.getScene('MainScene');
  const { villager, camp } = window.__villagerGatherProbe;
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
    },
    campAssignedWorkerId: camp.getData('assignedWorker')?.id ?? null,
  };
});

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
    return Boolean(
      scene?.isReady
      && scene?.villagerSystem
      && scene?.economySystem
      && scene?.entityFactory
      && scene?.pathfinder,
    );
  }, undefined, { timeout: 45_000 });

  telemetry.phase = 'setup-workforce-slot';
  telemetry.setup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;

    const anchorVillager = scene.villagerSystem.getIdleVillagers(0)[0];
    if (!anchorVillager?.visual) throw new Error('No idle player villager is available.');

    const trees = scene.trees.getChildren().filter((tree) => (
      tree.active && !tree.getData('isGoldMine') && !tree.getData('isChopped')
    ));
    let nearestTree = null;
    let nearestDistance = Infinity;
    for (const tree of trees) {
      const distance = Math.hypot(tree.x - anchorVillager.x, tree.y - anchorVillager.y);
      if (distance < nearestDistance) {
        nearestTree = tree;
        nearestDistance = distance;
      }
    }
    if (!nearestTree || nearestDistance > 280) {
      throw new Error(`No live tree is close enough for a deterministic lumber loop (${nearestDistance.toFixed(1)}px).`);
    }

    const dx = nearestTree.x - anchorVillager.x;
    const dy = nearestTree.y - anchorVillager.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const camp = scene.entityFactory.spawnBuilding(
      'Lumber Camp',
      anchorVillager.x + (-dy / length) * 64,
      anchorVillager.y + (dx / length) * 64,
      0,
    );
    camp.setData('__journeyCamp', true);

    // Current gameplay is Stronghold-style: an economic building exposes a
    // workforce slot and the economy system fills it from idle villagers.
    scene.economySystem.assignJobs();
    const villager = scene.villagerSystem.getAllVillagers().find(
      (candidate) => candidate.owner === 0 && candidate.jobBuilding === camp,
    );
    if (!villager?.visual || camp.getData('assignedWorker') !== villager) {
      throw new Error('Lumber Camp did not receive an idle villager through workforce slots.');
    }

    window.__villagerGatherProbe = { villager, camp, tree: nearestTree };
    return {
      initialWood: scene.resources.wood,
      treeDistance: nearestDistance,
      villagerId: villager.id,
      assignedToCamp: villager.jobBuilding === camp,
      campAssignedWorkerId: camp.getData('assignedWorker')?.id ?? null,
    };
  });

  if (!telemetry.setup.assignedToCamp
      || telemetry.setup.campAssignedWorkerId !== telemetry.setup.villagerId) {
    throw new Error(`Stronghold workforce assignment failed: ${JSON.stringify(telemetry.setup)}`);
  }
  telemetry.afterAssignment = await readProbe();

  telemetry.phase = 'reject-unreachable-rally';
  telemetry.rejectedRally = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { villager, camp } = window.__villagerGatherProbe;
    const originalFindPath = scene.pathfinder.findPath;
    const before = {
      state: villager.state,
      pathLength: villager.path?.length ?? 0,
      pathStep: villager.pathStep ?? 0,
      assignedToCamp: villager.jobBuilding === camp,
      campAssignedWorkerId: camp.getData('assignedWorker')?.id ?? null,
    };

    // Exercise the pathfinder's real one-point no-route contract deterministically.
    scene.pathfinder.findPath = (start) => [{ x: start.x, y: start.y }];
    try {
      scene.villagerSystem.sendToRallyPoint(villager, villager.x + 1200, villager.y + 1200);
    } finally {
      scene.pathfinder.findPath = originalFindPath;
    }

    return {
      before,
      after: {
        state: villager.state,
        pathLength: villager.path?.length ?? 0,
        pathStep: villager.pathStep ?? 0,
        assignedToCamp: villager.jobBuilding === camp,
        campAssignedWorkerId: camp.getData('assignedWorker')?.id ?? null,
      },
    };
  });
  telemetry.afterRejectedRally = await readProbe();

  telemetry.phase = 'gather-deposit';
  telemetry.simulationAdvance = await page.evaluate((initialWood) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    let simulatedMs = 0;

    // CI rendering speed is not the gameplay contract. Advance the authoritative
    // VillagerSystem clock while keeping its real path/gather/carry/deposit state machine.
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

  if (!telemetry.afterAssignment.villager.assignedToCamp
      || telemetry.afterAssignment.campAssignedWorkerId !== telemetry.setup.villagerId) {
    throw new Error('Workforce-slot assignment did not remain coherent after setup.');
  }
  if (!telemetry.rejectedRally.after.assignedToCamp
      || telemetry.rejectedRally.after.campAssignedWorkerId !== telemetry.setup.villagerId) {
    throw new Error('Rejected rally command destroyed the last valid workforce assignment.');
  }
  if (telemetry.rejectedRally.after.state !== telemetry.rejectedRally.before.state
      || telemetry.rejectedRally.after.pathLength !== telemetry.rejectedRally.before.pathLength
      || telemetry.rejectedRally.after.pathStep !== telemetry.rejectedRally.before.pathStep) {
    throw new Error('Rejected rally command did not preserve the worker state/path already in progress.');
  }
  if (telemetry.woodDeposited <= 0) {
    throw new Error(`Gather loop did not deposit wood after ${telemetry.simulationAdvance.simulatedMs} ms simulated (${telemetry.woodDeposited}).`);
  }
  if (!telemetry.final.villager.assignedToCamp
      || telemetry.final.campAssignedWorkerId !== telemetry.setup.villagerId) {
    throw new Error('Gather/deposit cycle lost the Stronghold workforce relationship.');
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
