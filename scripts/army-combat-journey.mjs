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
const telemetry = { phase: 'boot', browserErrors: [] };

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
    // JSON telemetry is still useful if Chromium has already closed.
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
      pathLength: unit.path?.length ?? 0,
      inUnitGroup: scene.units.getChildren().includes(unit),
      explicitTarget: unit.getData('explicitTarget') === true,
      targetEnemyIndex: enemies.indexOf(unit.target),
    })),
    enemies: enemies.map((unit) => ({
      x: unit.x,
      y: unit.y,
      active: unit.active,
      hp: unit.active ? unit.getData('hp') : null,
      inUnitGroup: scene.units.getChildren().includes(unit),
      inSpatialHash: scene.unitSpatialHash.query(unit.x, unit.y, 1).includes(unit),
    })),
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
    const insideWorld = (x, y, margin = 96) => (
      x >= bounds.x + margin && x <= bounds.right - margin
      && y >= bounds.y + margin && y <= bounds.bottom - margin
    );
    const playerOffsets = [[-12, 0], [0, 0], [12, 0]];
    const origins = [
      [260, 0], [-260, 0], [0, 260], [0, -260],
      [260, 260], [260, -260], [-260, 260], [-260, -260],
    ];
    const moves = [[72, 0], [-72, 0], [0, 72], [0, -72]];
    let arena = null;

    for (const [ox, oy] of origins) {
      const center = { x: existing.x + ox, y: existing.y + oy };
      const starts = playerOffsets.map(([dx, dy]) => ({ x: center.x + dx, y: center.y + dy }));
      if (starts.some(({ x, y }) => !insideWorld(x, y) || scene.pathfinder.isBlocked(x, y))) continue;

      for (const [dx, dy] of moves) {
        const target = { x: center.x + dx, y: center.y + dy };
        if (!insideWorld(target.x, target.y) || scene.pathfinder.isBlocked(target.x, target.y)) continue;
        const reachable = starts.every((start) => {
          const path = scene.pathfinder.findPath(start, target);
          const endpoint = path?.[path.length - 1];
          return Boolean(path?.length && endpoint && Math.hypot(endpoint.x - target.x, endpoint.y - target.y) <= 36);
        });
        if (reachable) {
          arena = { center, starts, moveTarget: target };
          break;
        }
      }
      if (arena) break;
    }

    if (!arena) throw new Error('Could not find a connected walkable arena for group movement.');

    const players = arena.starts.map(({ x, y }) => {
      const unit = scene.entityFactory.spawnUnit('Pikesman', x, y, 0);
      if (!unit) throw new Error('Could not spawn deterministic player army.');
      unit.setData('__journeyStartX', unit.x);
      unit.setData('__journeyStartY', unit.y);
      return unit;
    });

    window.__armyCombatProbe = { players, enemies: [], previousGameSpeed: scene.gameSpeed };
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

  await page.waitForFunction(() => window.__armyCombatProbe.players.every((unit) => Math.hypot(
    unit.x - unit.getData('__journeyStartX'),
    unit.y - unit.getData('__journeyStartY'),
  ) > 5), undefined, { timeout: 15_000 });

  telemetry.afterMovement = await readRuntimeProbe();
  telemetry.initialMoveDistances = telemetry.afterMovement.players.map((unit, index) => Math.hypot(
    unit.x - telemetry.setup.playerStart[index].x,
    unit.y - telemetry.setup.playerStart[index].y,
  ));

  telemetry.phase = 'setup-combat';
  telemetry.combatSetup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__armyCombatProbe;
    const { players } = probe;
    scene.peacefulMode = true;
    probe.previousGameSpeed = scene.gameSpeed;
    scene.gameSpeed = 0;

    const centroid = players.reduce(
      (point, unit) => ({ x: point.x + unit.x / players.length, y: point.y + unit.y / players.length }),
      { x: 0, y: 0 },
    );
    const bounds = scene.physics.world.bounds;
    const pairs = [
      [[36, 0], [36, 18]],
      [[-36, 0], [-36, 18]],
      [[0, 36], [18, 36]],
      [[0, -36], [18, -36]],
    ];
    const inside = (x, y) => x >= bounds.x + 32 && x <= bounds.right - 32
      && y >= bounds.y + 32 && y <= bounds.bottom - 32;

    let points = null;
    for (const pair of pairs) {
      const candidates = pair.map(([dx, dy]) => ({ x: centroid.x + dx, y: centroid.y + dy }));
      if (candidates.every(({ x, y }) => inside(x, y) && !scene.pathfinder.isBlocked(x, y))) {
        points = candidates;
        break;
      }
    }
    if (!points) throw new Error('Could not find walkable enemy positions.');

    const enemies = points.map(({ x, y }) => {
      const unit = scene.entityFactory.spawnUnit('Pikesman', x, y, 1);
      if (!unit) throw new Error('Could not spawn deterministic enemy group.');
      unit.setData('hp', 10);
      unit.setData('stance', 'Hold');
      unit.setData('anchor', { x: unit.x, y: unit.y });
      return unit;
    });
    players.forEach((unit) => { unit.lastAttackTime = scene.gameTime - 10_000; });
    probe.enemies = enemies;

    return {
      centroid,
      pausedAtGameTime: scene.gameTime,
      previousGameSpeed: probe.previousGameSpeed,
      enemies: enemies.map((unit) => ({ x: unit.x, y: unit.y, hp: unit.getData('hp') })),
    };
  });

  await page.waitForFunction(() => window.__armyCombatProbe.enemies.every(
    (unit) => unit.visual && Number.isFinite(unit.visual.x) && Number.isFinite(unit.visual.y)
  ), undefined, { timeout: 5_000 });
  await centerCameraOnProbeUnits();

  telemetry.phase = 'attack-command';
  const enemyPoint = await unitScreenPoint('enemies', 0);
  await page.mouse.click(canvasBox.x + enemyPoint.x, canvasBox.y + enemyPoint.y, { button: 'right' });

  telemetry.attackCommand = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { players, enemies } = window.__armyCombatProbe;
    const target = enemies[0];
    const accepted = players.map((unit) => ({
      targetsEnemy: unit.target === target,
      explicitTarget: unit.getData('explicitTarget') === true,
      state: unit.state,
    }));
    if (!accepted.every(({ targetsEnemy, explicitTarget }) => targetsEnemy && explicitTarget)) {
      throw new Error(`Attack command was not accepted by the full selected army: ${JSON.stringify(accepted)}`);
    }
    return {
      gameTime: scene.gameTime,
      gameSpeed: scene.gameSpeed,
      peacefulMode: scene.peacefulMode,
      targetHp: target.active ? target.getData('hp') : null,
      accepted,
    };
  });

  if (telemetry.attackCommand.gameSpeed !== 0
    || telemetry.attackCommand.gameTime !== telemetry.combatSetup.pausedAtGameTime
    || telemetry.attackCommand.targetHp !== 10) {
    throw new Error(`Simulation advanced during attack-command capture: ${JSON.stringify(telemetry.attackCommand)}`);
  }

  telemetry.phase = 'combat-resolution';
  telemetry.combatEnabledAtGameTime = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__armyCombatProbe;
    scene.peacefulMode = false;
    scene.gameSpeed = probe.previousGameSpeed || 1;
    return scene.gameTime;
  });

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return window.__armyCombatProbe.enemies.every(
      (enemy) => !enemy.active && !scene.units.getChildren().includes(enemy)
    );
  }, undefined, { timeout: 15_000 });

  telemetry.afterCombat = await readRuntimeProbe();
  if (telemetry.afterCombat.enemies.some((enemy) => enemy.active || enemy.inUnitGroup || enemy.inSpatialHash)) {
    throw new Error(`Enemy cleanup was incomplete: ${JSON.stringify(telemetry.afterCombat.enemies)}`);
  }

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
    const bounds = scene.physics.world.bounds;
    const offsets = [[72, 0], [-72, 0], [0, 72], [0, -72], [54, 54], [-54, -54]];
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
    return { target, survivorCount: survivors.length };
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

  telemetry.afterRally = await readRuntimeProbe();
  const survivorCount = telemetry.afterRally.players.filter((unit) => unit.active && unit.inUnitGroup).length;
  if (survivorCount !== telemetry.rally.survivorCount) {
    throw new Error(`Survivor count changed during post-combat rally: ${telemetry.rally.survivorCount} -> ${survivorCount}`);
  }
  if (telemetry.browserErrors.length > 0) {
    throw new Error(`Browser errors occurred: ${telemetry.browserErrors.join(' | ')}`);
  }

  telemetry.phase = 'complete';
  await persistEvidence();
  console.log(JSON.stringify(telemetry, null, 2));
} catch (error) {
  telemetry.phase = `failed:${telemetry.phase}`;
  telemetry.error = error instanceof Error ? error.stack ?? error.message : String(error);
  try {
    telemetry.failureRuntime = page ? await readRuntimeProbe() : null;
  } catch {
    telemetry.failureRuntime = null;
  }
  await persistEvidence();
  throw error;
} finally {
  await browser?.close();
  await stopServer();
}