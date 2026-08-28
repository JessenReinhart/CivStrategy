import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';

const PORT = 4173;
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
    return Boolean(
      scene?.isReady
      && scene?.buildingManager
      && scene?.pathfinder
      && scene?.buildings?.getChildren?.().length,
    );
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
      Barracks: { width: 72, height: 72 },
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

    function findSinglePlacement(type) {
      const def = dims[type];
      const baseX = snap(tc.x - 280);
      const baseY = snap(tc.y - 280);
      for (let oy = 0; oy <= 560; oy += GRID) {
        for (let ox = 0; ox <= 560; ox += GRID) {
          const center = {
            x: baseX + ox + def.width / 2,
            y: baseY + oy + def.height / 2,
          };
          if (validity(center.x, center.y, type).valid) return center;
        }
      }
      throw new Error(`Could not find a valid ${type} placement inside player territory.`);
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

    function verifyPathAroundPair(pair) {
      const def = dims[pair.type];
      const halfWidth = def.width / 2;
      const halfHeight = def.height / 2;
      const minX = Math.min(pair.first.x, pair.second.x) - halfWidth;
      const maxX = Math.max(pair.first.x, pair.second.x) + halfWidth;
      const minY = Math.min(pair.first.y, pair.second.y) - halfHeight;
      const maxY = Math.max(pair.first.y, pair.second.y) + halfHeight;
      const margin = 64;
      const candidates = [
        [{ x: minX - margin, y: minY - margin }, { x: maxX + margin, y: maxY + margin }],
        [{ x: minX - margin, y: maxY + margin }, { x: maxX + margin, y: minY - margin }],
        [{ x: minX - margin, y: (minY + maxY) / 2 }, { x: maxX + margin, y: (minY + maxY) / 2 }],
        [{ x: (minX + maxX) / 2, y: minY - margin }, { x: (minX + maxX) / 2, y: maxY + margin }],
      ];

      for (const [start, end] of candidates) {
        if (scene.pathfinder.isBlocked(start.x, start.y) || scene.pathfinder.isBlocked(end.x, end.y)) continue;
        const path = scene.pathfinder.findPath(start, end);
        if (path?.length > 1) {
          return { pathLength: path.length, start, end };
        }
      }

      throw new Error(`${pair.type} dense pair left no usable route around its occupied footprint.`);
    }

    const houseEconomyBefore = {
      wood: scene.resources.wood,
      maxPopulation: scene.maxPopulation,
    };
    const houses = verifyPair('House');
    const houseEconomyAfter = {
      wood: scene.resources.wood,
      maxPopulation: scene.maxPopulation,
    };
    const expectedHouseWoodCost = 50 * 2;
    const expectedHousePopulationBonus = 8 * 2;
    if (houseEconomyAfter.wood !== houseEconomyBefore.wood - expectedHouseWoodCost) {
      throw new Error(`House placement wood cost mismatch: ${houseEconomyBefore.wood} -> ${houseEconomyAfter.wood}.`);
    }
    if (houseEconomyAfter.maxPopulation !== houseEconomyBefore.maxPopulation + expectedHousePopulationBonus) {
      throw new Error(`House placement population-cap mismatch: ${houseEconomyBefore.maxPopulation} -> ${houseEconomyAfter.maxPopulation}.`);
    }

    const houseNavigation = verifyPathAroundPair(houses);
    const farms = verifyPair('Farm');
    const farmNavigation = verifyPathAroundPair(farms);
    const barracksPlacement = findSinglePlacement('Barracks');
    const barracks = buildAt('Barracks', barracksPlacement);
    window.__placementJourneyBarracks = barracks.built;
    manager.cancelBuildMode();

    return {
      houses,
      houseEconomy: {
        before: houseEconomyBefore,
        after: houseEconomyAfter,
        expectedWoodCost: expectedHouseWoodCost,
        expectedPopulationBonus: expectedHousePopulationBonus,
      },
      houseNavigation,
      farms,
      farmNavigation,
      barracks: {
        x: barracks.built.x,
        y: barracks.built.y,
        previewDelta: Math.hypot(
          barracks.snapshot.previewX - barracks.built.visual.x,
          barracks.snapshot.previewY - barracks.built.visual.y,
        ),
      },
      buildingCount: buildings().length,
    };
  });

  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const barracks = window.__placementJourneyBarracks;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(barracks.visual.x, barracks.visual.y);
  });
  await sleep(50);

  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas was not measurable for Barracks selection.');

  const barracksPoint = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const barracks = window.__placementJourneyBarracks;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (barracks.visual.x - topLeft.x) * camera.zoom,
      y: (barracks.visual.y - 18 - topLeft.y) * camera.zoom,
    };
  });

  await page.mouse.click(canvasBox.x + barracksPoint.x, canvasBox.y + barracksPoint.y, { button: 'left' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedBuilding === window.__placementJourneyBarracks;
  }, undefined, { timeout: 3_000 });

  const beforeTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      playerMilitary: scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length,
    };
  });

  const pikesmanButton = page.getByRole('button', { name: /Pikesman/i });
  await pikesmanButton.waitFor({ state: 'visible', timeout: 3_000 });
  await pikesmanButton.click();

  await page.waitForFunction((before) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const military = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length;
    return military === before.playerMilitary + 1 && scene.population === before.population + 1;
  }, beforeTraining, { timeout: 5_000 });

  const afterTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const units = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0);
    const newest = units[units.length - 1];
    if (!newest) throw new Error('Trained Pikesman was not available after training.');
    window.__placementJourneyTrainedUnit = newest;
    newest.setData('__journeyStartX', newest.x);
    newest.setData('__journeyStartY', newest.y);
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      playerMilitary: units.length,
      newestType: newest.unitType ?? newest.getData('unitType') ?? null,
      newestPosition: { x: newest.x, y: newest.y },
    };
  });

  result.training = { before: beforeTraining, after: afterTraining };

  if (result.barracks.previewDelta > 0.01) {
    throw new Error(`Barracks ghost/final visual position drifted by ${result.barracks.previewDelta}px.`);
  }
  if (afterTraining.playerMilitary !== beforeTraining.playerMilitary + 1) {
    throw new Error('Pikesman training did not create exactly one player military unit.');
  }
  if (afterTraining.population !== beforeTraining.population + 1) {
    throw new Error('Pikesman training did not increment player population by one.');
  }
  if (afterTraining.food !== beforeTraining.food - 100 || afterTraining.gold !== beforeTraining.gold - 50) {
    throw new Error(`Pikesman training cost mismatch: food ${beforeTraining.food} -> ${afterTraining.food}, gold ${beforeTraining.gold} -> ${afterTraining.gold}.`);
  }
  if (afterTraining.food < 0 || afterTraining.gold < 0) {
    throw new Error('Pikesman training produced negative resources.');
  }
  if (afterTraining.newestType !== 'Pikesman') {
    throw new Error(`Expected trained unit to be Pikesman, got ${afterTraining.newestType ?? 'unknown'}.`);
  }

  const movementSetup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__placementJourneyTrainedUnit;
    if (!unit?.visual) throw new Error('Trained Pikesman has no interactive visual.');

    const bounds = scene.physics.world.bounds;
    const offsets = [[64, 0], [-64, 0], [0, 64], [0, -64], [64, 64], [64, -64], [-64, 64], [-64, -64]];
    let target = null;
    for (const [dx, dy] of offsets) {
      const x = unit.x + dx;
      const y = unit.y + dy;
      const inside = x >= bounds.x + 32 && x <= bounds.right - 32 && y >= bounds.y + 32 && y <= bounds.bottom - 32;
      if (!inside || scene.pathfinder.isBlocked(x, y)) continue;
      const path = scene.pathfinder.findPath({ x: unit.x, y: unit.y }, { x, y });
      const endpoint = path?.[path.length - 1];
      if (!path?.length || !endpoint || Math.hypot(endpoint.x - x, endpoint.y - y) > 32) continue;
      target = { x, y, pathLength: path.length };
      break;
    }
    if (!target) throw new Error('Could not find a reachable movement target for the trained Pikesman.');

    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(unit.visual.x, unit.visual.y);
    return { start: { x: unit.x, y: unit.y }, target };
  });
  await sleep(50);

  const unitPoint = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__placementJourneyTrainedUnit;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (unit.visual.x - topLeft.x) * camera.zoom,
      y: (unit.visual.y - 10 - topLeft.y) * camera.zoom,
    };
  });
  await page.mouse.click(canvasBox.x + unitPoint.x, canvasBox.y + unitPoint.y, { button: 'left' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedUnits.includes(window.__placementJourneyTrainedUnit);
  }, undefined, { timeout: 3_000 });

  const targetPoint = await page.evaluate((target) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    const iso = { x: target.x - target.y, y: (target.x + target.y) * 0.5 };
    return {
      x: (iso.x - topLeft.x) * camera.zoom,
      y: (iso.y - topLeft.y) * camera.zoom,
    };
  }, movementSetup.target);
  await page.mouse.click(canvasBox.x + targetPoint.x, canvasBox.y + targetPoint.y, { button: 'right' });

  await page.waitForFunction(() => {
    const unit = window.__placementJourneyTrainedUnit;
    return Math.hypot(
      unit.x - unit.getData('__journeyStartX'),
      unit.y - unit.getData('__journeyStartY'),
    ) > 5;
  }, undefined, { timeout: 12_000 });

  const movementAfter = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__placementJourneyTrainedUnit;
    return {
      position: { x: unit.x, y: unit.y },
      state: unit.state,
      selected: scene.inputManager.selectedUnits.includes(unit),
    };
  });
  const movedDistance = Math.hypot(
    movementAfter.position.x - movementSetup.start.x,
    movementAfter.position.y - movementSetup.start.y,
  );
  if (!movementAfter.selected) throw new Error('Trained Pikesman lost selection during its movement command.');
  if (movedDistance <= 5) throw new Error(`Trained Pikesman moved only ${movedDistance}px after the real command.`);
  result.trainedUnitMovement = { setup: movementSetup, after: movementAfter, movedDistance };

  await page.screenshot({ path: `${ARTIFACT_DIR}/placement-journey.png`, fullPage: true });
  console.log(JSON.stringify(result, null, 2));

  if (browserErrors.length > 0) {
    throw new Error(`Browser page errors during placement journey:\n${browserErrors.join('\n')}`);
  }
} finally {
  if (browser) await browser.close();
  await stopServer();
}
