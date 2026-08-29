import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4177;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const PLAYER_COUNT = 3;
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
const telemetry = {
  phase: 'boot',
  browserErrors: [],
};

async function persistEvidence() {
  await writeFile(
    `${ARTIFACT_DIR}/army-combat-telemetry.json`,
    `${JSON.stringify(telemetry, null, 2)}\n`,
    'utf8',
  );
  if (!page) return;
  try {
    await page.screenshot({ path: `${ARTIFACT_DIR}/army-combat-journey.png`, fullPage: true });
  } catch {
    // JSON telemetry remains useful if Chromium has already closed.
  }
}

const readRuntimeProbe = () => page.evaluate(() => {
  const scene = window.__civStrategyGame.scene.getScene('MainScene');
  const probe = window.__armyCombatProbe;
  const players = probe?.players ?? [];
  const enemies = probe?.enemies ?? [];
  return {
    gameTime: scene.gameTime,
    actualFps: scene.game.loop.actualFps,
    selectedCount: scene.inputManager.selectedUnits.length,
    players: players.map((unit) => ({
      x: unit.x,
      y: unit.y,
      active: unit.active,
      hp: unit.active ? unit.getData('hp') : null,
      state: unit.state,
      pathStep: unit.pathStep,
      pathLength: unit.path?.length ?? 0,
      inUnitGroup: scene.units.getChildren().includes(unit),
      visual: unit.visual ? { x: unit.visual.x, y: unit.visual.y } : null,
      velocity: unit.body ? { x: unit.body.velocity.x, y: unit.body.velocity.y } : null,
    })),
    enemies: enemies.map((unit) => {
      const candidates = scene.unitSpatialHash.query(unit.x, unit.y, 1);
      return {
        x: unit.x,
        y: unit.y,
        active: unit.active,
        hp: unit.active ? unit.getData('hp') : null,
        state: unit.state,
        inUnitGroup: scene.units.getChildren().includes(unit),
        inSpatialHash: candidates.includes(unit),
        visual: unit.visual ? { x: unit.visual.x, y: unit.visual.y } : null,
      };
    }),
  };
});

const cartesianScreenPoint = (point) => page.evaluate((cart) => {
  const scene = window.__civStrategyGame.scene.getScene('MainScene');
  const camera = scene.cameras.main;
  const topLeft = camera.getWorldPoint(0, 0);
  const iso = { x: cart.x - cart.y, y: (cart.x + cart.y) * 0.5 };
  return {
    x: (iso.x - topLeft.x) * camera.zoom,
    y: (iso.y - topLeft.y) * camera.zoom,
  };
}, point);

const unitScreenPoint = (kind, index) => page.evaluate(({ key, unitIndex }) => {
  const scene = window.__civStrategyGame.scene.getScene('MainScene');
  const unit = window.__armyCombatProbe[key][unitIndex];
  const camera = scene.cameras.main;
  const topLeft = camera.getWorldPoint(0, 0);
  return {
    x: (unit.visual.x - topLeft.x) * camera.zoom,
    y: (unit.visual.y - 10 - topLeft.y) * camera.zoom,
  };
}, { key: kind, unitIndex: index });

async function centerCameraOnProbeUnits() {
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__armyCombatProbe;
    const units = [...(probe?.players ?? []), ...(probe?.enemies ?? [])]
      .filter((unit) => unit.active && unit.visual);
    if (units.length === 0) return;
    const x = units.reduce((sum, unit) => sum + unit.visual.x, 0) / units.length;
    const y = units.reduce((sum, unit) => sum + unit.visual.y, 0) / units.length;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(x, y);
  });
  await sleep(80);
}

async function dragSelectPlayers(canvasBox) {
  const points = [];
  for (let index = 0; index < PLAYER_COUNT; index += 1) {
    points.push(await unitScreenPoint('players', index));
  }

  const left = Math.min(...points.map(({ x }) => x)) - 24;
  const right = Math.max(...points.map(({ x }) => x)) + 24;
  const top = Math.min(...points.map(({ y }) => y)) - 24;
  const bottom = Math.max(...points.map(({ y }) => y)) + 24;

  await page.mouse.move(canvasBox.x + left, canvasBox.y + top);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(canvasBox.x + right, canvasBox.y + bottom, { steps: 8 });
  await page.mouse.up({ button: 'left' });

  await page.waitForFunction((expected) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const players = window.__armyCombatProbe.players;
    return scene.inputManager.selectedUnits.length === expected
      && players.every((unit) => scene.inputManager.selectedUnits.includes(unit));
  }, PLAYER_COUNT, { timeout: 5_000 });

  return { left, right, top, bottom, points };
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
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.entityFactory && scene?.inputManager && scene?.unitSystem);
  }, undefined, { timeout: 45_000 });

  telemetry.phase = 'setup-army';
  telemetry.setup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;

    const existing = scene.units.getChildren().find((unit) => unit.getData?.('owner') === 0);
    if (!existing) throw new Error('No player unit available to anchor army journey.');

    const bounds = scene.physics.world.bounds;
    const playerOffsets = [[-12, 0], [0, 0], [12, 0]];
    const originOffsets = [
      [260, 0], [-260, 0], [0, 260], [0, -260],
      [260, 260], [260, -260], [-260, 260], [-260, -260],
      [380, 0], [-380, 0], [0, 380], [0, -380],
    ];
    const moveOffsets = [[72, 0], [-72, 0], [0, 72], [0, -72]];

    const insideWorld = (x, y, margin = 96) => (
      x >= bounds.x + margin && x <= bounds.right - margin
      && y >= bounds.y + margin && y <= bounds.bottom - margin
    );

    let arena = null;
    for (const [originX, originY] of originOffsets) {
      const centerX = existing.x + originX;
      const centerY = existing.y + originY;
      const starts = playerOffsets.map(([dx, dy]) => ({ x: centerX + dx, y: centerY + dy }));
      if (starts.some(({ x, y }) => !insideWorld(x, y) || scene.pathfinder.isBlocked(x, y))) continue;

      for (const [moveDx, moveDy] of moveOffsets) {
        const moveTarget = { x: centerX + moveDx, y: centerY + moveDy };
        if (!insideWorld(moveTarget.x, moveTarget.y) || scene.pathfinder.isBlocked(moveTarget.x, moveTarget.y)) continue;

        const paths = starts.map((start) => scene.pathfinder.findPath(start, moveTarget));
        const allConnected = paths.every((path) => {
          const endpoint = path?.[path.length - 1];
          return Boolean(
            path?.length
            && endpoint
            && Math.hypot(endpoint.x - moveTarget.x, endpoint.y - moveTarget.y) <= 36
          );
        });
        if (!allConnected) continue;

        arena = { centerX, centerY, starts, moveTarget };
        break;
      }
      if (arena) break;
    }

    if (!arena) throw new Error('Could not find a connected walkable arena for group movement.');

    const players = arena.starts.map(({ x, y }) => {
      const unit = scene.entityFactory.spawnUnit('Pikesman', x, y, 0);
      if (!unit) throw new Error('Could not spawn deterministic player army.');
      return unit;
    });

    players.forEach((unit, index) => {
      unit.setData('__journeyIndex', index);
      unit.setData('__journeyStartX', unit.x);
      unit.setData('__journeyStartY', unit.y);
    });

    window.__armyCombatProbe = { players, enemies: [] };
    return {
      arena,
      playerStart: players.map((unit) => ({ x: unit.x, y: unit.y, hp: unit.getData('hp') })),
    };
  });

  await page.waitForFunction((expected) => {
    const players = window.__armyCombatProbe?.players ?? [];
    return players.length === expected
      && players.every((unit) => unit.visual && Number.isFinite(unit.visual.x) && Number.isFinite(unit.visual.y));
  }, PLAYER_COUNT, { timeout: 5_000 });

  await centerCameraOnProbeUnits();

  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas was not measurable.');

  telemetry.phase = 'group-select';
  telemetry.selection = await dragSelectPlayers(canvasBox);
  telemetry.afterSelection = await readRuntimeProbe();

  telemetry.phase = 'group-move';
  const movePoint = await cartesianScreenPoint(telemetry.setup.arena.moveTarget);
  await page.mouse.click(canvasBox.x + movePoint.x, canvasBox.y + movePoint.y, { button: 'right' });
  telemetry.moveStarted = await readRuntimeProbe();

  await page.waitForFunction(() => {
    const players = window.__armyCombatProbe.players;
    return players.every((unit) => Math.hypot(
      unit.x - unit.getData('__journeyStartX'),
      unit.y - unit.getData('__journeyStartY'),
    ) > 5);
  }, undefined, { timeout: 15_000 });

  telemetry.afterMovement = await readRuntimeProbe();
  telemetry.initialMoveDistances = telemetry.afterMovement.players.map((unit, index) => Math.hypot(
    unit.x - telemetry.setup.playerStart[index].x,
    unit.y - telemetry.setup.playerStart[index].y,
  ));

  telemetry.phase = 'setup-combat';
  telemetry.combatSetup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { players } = window.__armyCombatProbe;

    const centroid = players.reduce(
      (point, unit) => ({ x: point.x + unit.x / players.length, y: point.y + unit.y / players.length }),
      { x: 0, y: 0 },
    );
    const bounds = scene.physics.world.bounds;
    const candidates = [
      [[44, 0], [44, 18]],
      [[-44, 0], [-44, 18]],
      [[0, 44], [18, 44]],
      [[0, -44], [18, -44]],
    ];

    const insideWorld = (x, y) => (
      x >= bounds.x + 32 && x <= bounds.right - 32
      && y >= bounds.y + 32 && y <= bounds.bottom - 32
    );

    let enemyPoints = null;
    for (const pair of candidates) {
      const points = pair.map(([dx, dy]) => ({ x: centroid.x + dx, y: centroid.y + dy }));
      if (points.every(({ x, y }) => insideWorld(x, y) && !scene.pathfinder.isBlocked(x, y))) {
        enemyPoints = points;
        break;
      }
    }
    if (!enemyPoints) throw new Error('Could not find walkable enemy-group positions.');

    const enemies = enemyPoints.map(({ x, y }) => {
      const unit = scene.entityFactory.spawnUnit('Pikesman', x, y, 1);
      if (!unit) throw new Error('Could not spawn deterministic enemy group.');
      unit.setData('hp', 10);
      unit.setData('stance', 'Hold');
      unit.setData('anchor', { x: unit.x, y: unit.y });
      return unit;
    });

    players.forEach((unit) => { unit.lastAttackTime = -10_000; });
    window.__armyCombatProbe.enemies = enemies;

    return {
      playerCentroid: centroid,
      enemies: enemies.map((unit) => ({ x: unit.x, y: unit.y, hp: unit.getData('hp') })),
    };
  });

  await page.waitForFunction(() => (
    window.__armyCombatProbe.enemies.every(
      (unit) => unit.visual && Number.isFinite(unit.visual.x) && Number.isFinite(unit.visual.y)
    )
  ), undefined, { timeout: 5_000 });

  await centerCameraOnProbeUnits();

  telemetry.phase = 'fight-enemy-group';
  const enemyPoint = await unitScreenPoint('enemies', 0);
  await page.mouse.click(canvasBox.x + enemyPoint.x, canvasBox.y + enemyPoint.y, { button: 'right' });

  await page.waitForFunction(() => {
    const { players, enemies } = window.__armyCombatProbe;
    const target = enemies[0];
    return players.every(
      (unit) => unit.target === target && unit.getData('explicitTarget') === true
    );
  }, undefined, { timeout: 3_000 });

  telemetry.attackCommand = {
    targetEnemyIndex: 0,
    acceptedAtGameTime: (await readRuntimeProbe()).gameTime,
  };

  telemetry.combatEnabledAtGameTime = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = false;
    return scene.gameTime;
  });

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return window.__armyCombatProbe.enemies.every(
      (enemy) => !enemy.active && !scene.units.getChildren().includes(enemy)
    );
  }, undefined, { timeout: 15_000 });

  telemetry.afterCombat = await readRuntimeProbe();

  telemetry.phase = 'post-combat-rally';
  telemetry.rally = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const survivors = window.__armyCombatProbe.players.filter(
      (unit) => unit.active && scene.units.getChildren().includes(unit)
    );
    if (survivors.length === 0) throw new Error('No player survivors remained for post-combat commandability check.');

    const centroid = survivors.reduce(
      (point, unit) => ({ x: point.x + unit.x / survivors.length, y: point.y + unit.y / survivors.length }),
      { x: 0, y: 0 },
    );
    const offsets = [[72, 0], [-72, 0], [0, 72], [0, -72], [54, 54], [-54, -54]];
    const bounds = scene.physics.world.bounds;
    let target = null;

    for (const [dx, dy] of offsets) {
      const candidate = { x: centroid.x + dx, y: centroid.y + dy };
      const inside = candidate.x >= bounds.x + 64 && candidate.x <= bounds.right - 64
        && candidate.y >= bounds.y + 64 && candidate.y <= bounds.bottom - 64;
      if (!inside || scene.pathfinder.isBlocked(candidate.x, candidate.y)) continue;

      const reachable = survivors.every((unit) => {
        const path = scene.pathfinder.findPath({ x: unit.x, y: unit.y }, candidate);
        const endpoint = path?.[path.length - 1];
        return Boolean(path?.length && endpoint && Math.hypot(endpoint.x - candidate.x, endpoint.y - candidate.y) <= 36);
      });
      if (reachable) {
        target = candidate;
        break;
      }
    }

    if (!target) throw new Error('Could not find a connected post-combat rally point.');

    survivors.forEach((unit) => {
      unit.setData('__postCombatX', unit.x);
      unit.setData('__postCombatY', unit.y);
    });

    return {
      target,
      survivorCount: survivors.length,
      before: survivors.map((unit) => ({ x: unit.x, y: unit.y })),
    };
  });

  const rallyPoint = await cartesianScreenPoint(telemetry.rally.target);
  await page.mouse.click(canvasBox.x + rallyPoint.x, canvasBox.y + rallyPoint.y, { button: 'right' });

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const survivors = window.__armyCombatProbe.players.filter(
      (unit) => unit.active && scene.units.getChildren().includes(unit)
    );
    return survivors.length > 0 && survivors.every((unit) => Math.hypot(
      unit.x - unit.getData('__postCombatX'),
      unit.y - unit.getData('__postCombatY'),
    ) > 5);
  }, undefined, { timeout: 15_000 });

  telemetry.final = await readRuntimeProbe();
  telemetry.postCombatMoveDistances = telemetry.final.players
    .filter((unit) => unit.active && unit.inUnitGroup)
    .map((unit, index) => Math.hypot(
      unit.x - telemetry.rally.before[index].x,
      unit.y - telemetry.rally.before[index].y,
    ));

  telemetry.phase = 'assert';

  if (telemetry.afterSelection.selectedCount !== PLAYER_COUNT) {
    throw new Error(`Real drag selection selected ${telemetry.afterSelection.selectedCount}/${PLAYER_COUNT} player units.`);
  }
  if (telemetry.initialMoveDistances.length !== PLAYER_COUNT || telemetry.initialMoveDistances.some((distance) => distance <= 5)) {
    throw new Error(`Group movement left a selected unit stuck: ${JSON.stringify(telemetry.initialMoveDistances)}.`);
  }
  if (!telemetry.attackCommand) {
    throw new Error('Enemy group did not receive a real browser attack command across the input boundary.');
  }
  if (telemetry.afterCombat.enemies.some((enemy) => enemy.active || enemy.inUnitGroup || enemy.inSpatialHash)) {
    throw new Error('Combat resolution left a defeated enemy active, grouped, or queryable in the spatial hash.');
  }
  if (telemetry.rally.survivorCount < 1) {
    throw new Error('Combat produced no surviving player army to continue commanding.');
  }
  if (
    telemetry.postCombatMoveDistances.length !== telemetry.rally.survivorCount
    || telemetry.postCombatMoveDistances.some((distance) => distance <= 5)
  ) {
    throw new Error(`A surviving army member did not respond to the post-combat command: ${JSON.stringify(telemetry.postCombatMoveDistances)}.`);
  }
  if (telemetry.browserErrors.length > 0) {
    throw new Error(`Browser page errors during army combat journey:\n${telemetry.browserErrors.join('\n')}`);
  }

  telemetry.phase = 'passed';
  await persistEvidence();
  console.log(JSON.stringify(telemetry, null, 2));
} catch (error) {
  if (page) {
    try {
      telemetry.failureRuntime = await readRuntimeProbe();
    } catch {
      // Preserve the original failure if the page is already unavailable.
    }
  }
  telemetry.phase = `failed:${telemetry.phase}`;
  telemetry.error = error instanceof Error ? error.stack ?? error.message : String(error);
  telemetry.serverOutput = serverOutput.slice(-8_000);
  await persistEvidence();
  console.error(JSON.stringify(telemetry, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}