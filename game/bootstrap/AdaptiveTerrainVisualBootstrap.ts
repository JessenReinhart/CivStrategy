import { MAP_SIZES, TERRAIN_CONFIG } from '../../constants';
import { MapSize } from '../../types';
import { LoadingWorkProgress, runBudgetedWork, yieldToBrowser } from '../../utils/gameLoading';
import type { MainScene } from '../MainScene';
import { toIso, toIsoElev } from '../utils/iso';

// Keep Large/Huge terrain backing storage around the same bounded pixel budget.
// This is ~36 MB of raw RGBA before browser/GPU copies, versus ~140 MB raw for
// the old full-resolution Large terrain canvas and far more on Huge.
export const MAX_ADAPTIVE_TERRAIN_RASTER_PIXELS = 9_000_000;

export interface AdaptiveTerrainVisualProfile {
  renderScale: number;
  sampleScale: number;
  sampleStep: number;
  fullWidth: number;
  fullHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}

export function getAdaptiveTerrainVisualProfile(scene: MainScene): AdaptiveTerrainVisualProfile {
  const corners = [
    toIso(0, 0),
    toIso(scene.mapWidth, 0),
    toIso(scene.mapWidth, scene.mapHeight),
    toIso(0, scene.mapHeight),
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of corners) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  // Reserve the worst-case terrain lift so the bounded canvas can never clip a peak.
  minY -= (1 - scene.terrainSystem.getWaterLevel()) * TERRAIN_CONFIG.HEIGHT_LIFT;
  const fullWidth = Math.ceil(maxX - minX) + 2;
  const fullHeight = Math.ceil(maxY - minY) + 2;

  const isHuge = scene.mapWidth >= MAP_SIZES[MapSize.HUGE];
  // Preserve substantially more texture detail than the first freeze fix while
  // still staying far below the original full-resolution backing allocation.
  const preferredScale = isHuge ? 0.25 : 0.5;
  const budgetScale = Math.sqrt(MAX_ADAPTIVE_TERRAIN_RASTER_PIXELS / Math.max(1, fullWidth * fullHeight));
  const renderScale = Math.min(preferredScale, budgetScale, 1);

  // Never reduce terrain sampling density. The first implementation sampled
  // Large at 4x cells and Huge at 8x cells, which turned biome textures into
  // visible colored diamonds/blocks. Only the backing raster is reduced now.
  const sampleScale = 1;
  const sampleStep = TERRAIN_CONFIG.CELL_SIZE;

  return {
    renderScale,
    sampleScale,
    sampleStep,
    fullWidth,
    fullHeight,
    canvasWidth: Math.max(1, Math.ceil(fullWidth * renderScale)),
    canvasHeight: Math.max(1, Math.ceil(fullHeight * renderScale)),
  };
}

/**
 * Large/Huge-only terrain painter.
 *
 * This intentionally mirrors TerrainSystem.applyVisualTinting(): same biome
 * texture order, soft biome blending, shared corner heights, smoothed lighting,
 * rocky slopes, highlights, rivers, and cliff faces. The only visual compromise
 * is a smaller backing canvas which is scaled back to world size by Phaser.
 * Gameplay terrain/pathfinding remain full resolution.
 */
export async function applyAdaptiveTerrainVisuals(
  scene: MainScene,
  onProgress?: (progress: LoadingWorkProgress) => void,
): Promise<AdaptiveTerrainVisualProfile> {
  const terrain = scene.terrainSystem;
  const profile = getAdaptiveTerrainVisualProfile(scene);
  const heightGrid = terrain.getHeightMapData();
  const grid = terrain.getGridDimensions();
  const waterLevel = terrain.getWaterLevel();
  const w = grid.width;
  const h = grid.height;
  const CS = grid.cellSize;

  const {
    BIOMES,
    BIOME_DITHER,
    TEX_PERIOD,
    LIGHT_DIR_X,
    LIGHT_DIR_Y,
    LIGHT_DIR_Z,
    LIGHT_AMBIENT,
    LIGHT_DIFFUSE,
    NORMAL_STRENGTH,
    HEIGHT_SHADE,
    CLIFF_SLOPE_START,
    CLIFF_SLOPE_FULL,
    CLIFF_FACE_MIN_DROP,
  } = TERRAIN_CONFIG;

  terrain.visualSprite?.destroy();
  terrain.visualSprite = null;
  if (scene.textures.exists('_terrainTint')) scene.textures.remove('_terrainTint');

  const mapCorners = [
    toIso(0, 0),
    toIso(scene.mapWidth, 0),
    toIso(scene.mapWidth, scene.mapHeight),
    toIso(0, scene.mapHeight),
  ];
  const rawMinX = Math.min(...mapCorners.map((point) => point.x));
  const rawMinY = Math.min(...mapCorners.map((point) => point.y));
  const minX = rawMinX - 1;
  const minY = rawMinY - (1 - waterLevel) * TERRAIN_CONFIG.HEIGHT_LIFT - 1;
  const scale = profile.renderScale;

  onProgress?.({
    processed: 0,
    total: 1,
    detail: `Allocating bounded terrain raster ${profile.canvasWidth}×${profile.canvasHeight}`,
  });
  await yieldToBrowser();

  const canvas = document.createElement('canvas');
  canvas.width = profile.canvasWidth;
  canvas.height = profile.canvasHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Use the exact texture ordering from TerrainSystem.applyVisualTinting().
  const textureKeys = [
    'terrain_sand',
    'terrain_swamp',
    'terrain_grass',
    'terrain_jungle',
    'terrain_forest',
    'terrain_tundra',
    'terrain_scrub',
    'terrain_stone',
  ];
  const period = Math.max(64, TEX_PERIOD ?? 768);
  const rasterPeriod = Math.max(16, Math.round(period * scale));
  const patterns: (CanvasPattern | string | null)[] = BIOMES.map((biome, index) => {
    if (index === 0) return null;
    const fallback = `rgb(${biome.color.r},${biome.color.g},${biome.color.b})`;
    const key = textureKeys[index - 1];
    if (!scene.textures.exists(key)) return fallback;

    const texture = scene.textures.get(key);
    const source = (typeof (texture as { getSourceImage?: () => CanvasImageSource }).getSourceImage === 'function'
      ? (texture as { getSourceImage: () => CanvasImageSource }).getSourceImage()
      : (texture as { image?: CanvasImageSource }).image) as HTMLImageElement | HTMLCanvasElement | undefined;
    if (!source) return fallback;

    const sourceWidth = ('naturalWidth' in source ? source.naturalWidth : 0) || source.width || period;
    const sourceHeight = ('naturalHeight' in source ? source.naturalHeight : 0) || source.height || period;
    const tile = document.createElement('canvas');
    tile.width = rasterPeriod;
    tile.height = rasterPeriod;
    const tileCtx = tile.getContext('2d')!;
    tileCtx.imageSmoothingEnabled = true;
    tileCtx.imageSmoothingQuality = 'high';
    tileCtx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, rasterPeriod, rasterPeriod);
    return ctx.createPattern(tile, 'repeat') ?? fallback;
  });

  const solid = (index: number): string => {
    const clamped = Math.max(1, Math.min(BIOMES.length - 1, index));
    const color = BIOMES[clamped].color;
    return `rgb(${color.r},${color.g},${color.b})`;
  };

  const stoneIndex = BIOMES.length - 1;
  const stonePattern = patterns[stoneIndex] ?? solid(stoneIndex);

  const getBiomeBlend = (height: number): { a: number; b: number; t: number } => {
    let index = 0;
    for (let i = BIOMES.length - 1; i >= 0; i--) {
      if (height >= BIOMES[i].minHeight) {
        index = i;
        break;
      }
    }

    if (index <= 0) return { a: 0, b: 0, t: 0 };
    if (index >= BIOMES.length - 1) {
      const current = BIOMES[index].minHeight;
      const previous = BIOMES[index - 1].minHeight;
      const gap = Math.max(1e-6, current - (Number.isFinite(previous) ? previous : waterLevel));
      const half = Math.min(BIOME_DITHER, gap * 0.45);
      const low = current - half;
      const high = current + half;
      if (height >= low && height < high) {
        const raw = (height - low) / Math.max(1e-6, high - low);
        const t = raw * raw * (3 - 2 * raw);
        return { a: index - 1, b: index, t };
      }
      return { a: index, b: index, t: 0 };
    }

    const next = BIOMES[index + 1].minHeight;
    const gapUp = Math.max(1e-6, next - BIOMES[index].minHeight);
    const halfUp = Math.min(BIOME_DITHER, gapUp * 0.45);
    const upLow = next - halfUp;
    const upHigh = next + halfUp;
    if (height >= upLow && height < upHigh) {
      const raw = (height - upLow) / Math.max(1e-6, upHigh - upLow);
      const t = raw * raw * (3 - 2 * raw);
      return { a: index, b: index + 1, t };
    }

    const current = BIOMES[index].minHeight;
    const previous = BIOMES[index - 1].minHeight;
    const gapDown = Math.max(1e-6, current - (Number.isFinite(previous) ? previous : waterLevel));
    const halfDown = Math.min(BIOME_DITHER, gapDown * 0.45);
    const downLow = current - halfDown;
    const downHigh = current + halfDown;
    if (height >= downLow && height < downHigh) {
      const raw = (height - downLow) / Math.max(1e-6, downHigh - downLow);
      const t = raw * raw * (3 - 2 * raw);
      return { a: index - 1, b: index, t };
    }

    return { a: index, b: index, t: 0 };
  };

  const rockFromSlope = (slope: number): number => {
    const low = CLIFF_SLOPE_START ?? 0.18;
    const high = CLIFF_SLOPE_FULL ?? 0.38;
    if (slope <= low) return 0;
    if (slope >= high) return 1;
    const raw = (slope - low) / Math.max(1e-6, high - low);
    return raw * raw * (3 - 2 * raw);
  };

  const cornerWidth = w + 1;
  const cornerHeight = h + 1;
  const cornerH = new Float32Array(cornerWidth * cornerHeight);
  const litGrid = new Float32Array(w * h);
  const rockGrid = new Float32Array(w * h);
  const litSmooth = new Float32Array(w * h);

  const lightLength = Math.hypot(LIGHT_DIR_X, LIGHT_DIR_Y, LIGHT_DIR_Z) || 1;
  const lx = LIGHT_DIR_X / lightLength;
  const ly = LIGHT_DIR_Y / lightLength;
  const lz = LIGHT_DIR_Z / lightLength;
  const faceMin = CLIFF_FACE_MIN_DROP ?? 0.10;
  const paintBatch = 16;
  const paintBatchesPerRow = Math.ceil(w / paintBatch);
  const totalWork = cornerHeight + h + h + h * paintBatchesPerRow;
  let completedWork = 0;

  const toRasterPoint = (point: { x: number; y: number }) => ({
    x: (point.x - minX) * scale,
    y: (point.y - minY) * scale,
  });

  const work = function* (): Generator<LoadingWorkProgress, void, void> {
    for (let cy = 0; cy < cornerHeight; cy++) {
      for (let cx = 0; cx < cornerWidth; cx++) {
        cornerH[cy * cornerWidth + cx] = terrain.getHeightInterpolated(cx * CS, cy * CS);
      }
      completedWork++;
      yield { processed: completedWork, total: totalWork, detail: 'Sampling terrain corners' };
    }

    // Canonical directional lighting and rocky-slope mask.
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const height = heightGrid[gy * w + gx];
        const hL = gx > 0 ? heightGrid[gy * w + gx - 1] : height;
        const hR = gx < w - 1 ? heightGrid[gy * w + gx + 1] : height;
        const hU = gy > 0 ? heightGrid[(gy - 1) * w + gx] : height;
        const hD = gy < h - 1 ? heightGrid[(gy + 1) * w + gx] : height;
        const dx = Math.max(Math.abs(hR - height), Math.abs(height - hL));
        const dy = Math.max(Math.abs(hD - height), Math.abs(height - hU));
        const slope = Math.hypot(dx, dy);
        const rock = rockFromSlope(slope);
        rockGrid[gy * w + gx] = rock;

        const nx = -(hR - hL) * 0.5 * NORMAL_STRENGTH;
        const ny = -(hD - hU) * 0.5 * NORMAL_STRENGTH;
        const nz = 1;
        const normalLength = Math.hypot(nx, ny, nz) || 1;
        const ndotl = Math.max(0, (nx * lx + ny * ly + nz * lz) / normalLength);
        let lit = LIGHT_AMBIENT + LIGHT_DIFFUSE * ndotl;
        const heightTerm = (height - waterLevel) / Math.max(1e-6, 1 - waterLevel);
        lit *= 1 + (heightTerm - 0.35) * (HEIGHT_SHADE ?? 0.28);
        lit *= 1 - rock * 0.18;
        litGrid[gy * w + gx] = Math.max(0.2, Math.min(1.12, lit));
      }
      completedWork++;
      yield { processed: completedWork, total: totalWork, detail: 'Computing terrain lighting' };
    }

    // The 3x3 blur is important. Without it, the low-resolution backing canvas
    // exaggerates per-cell lighting into the checkerboard seen in preview builds.
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        let sum = 0;
        let count = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            const x = gx + offsetX;
            const y = gy + offsetY;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            sum += litGrid[y * w + x];
            count++;
          }
        }
        litSmooth[gy * w + gx] = sum / count;
      }
      completedWork++;
      yield { processed: completedWork, total: totalWork, detail: 'Smoothing terrain lighting' };
    }

    const isLandish = (gx: number, gy: number): boolean => {
      const height = heightGrid[gy * w + gx];
      if (height >= waterLevel - 0.01) return true;
      const index = gy * cornerWidth + gx;
      return (
        cornerH[index] >= waterLevel ||
        cornerH[index + 1] >= waterLevel ||
        cornerH[index + cornerWidth] >= waterLevel ||
        cornerH[index + cornerWidth + 1] >= waterLevel
      );
    };

    for (let gy = 0; gy < h; gy++) {
      let cellsInBatch = 0;
      for (let gx = 0; gx < w; gx++) {
        if (isLandish(gx, gy)) {
          const height = heightGrid[gy * w + gx];
          const wx = gx * CS;
          const wy = gy * CS;
          const h0 = cornerH[gy * cornerWidth + gx];
          const h1 = cornerH[gy * cornerWidth + gx + 1];
          const h2 = cornerH[(gy + 1) * cornerWidth + gx + 1];
          const h3 = cornerH[(gy + 1) * cornerWidth + gx];
          const e0 = Math.max(h0, waterLevel);
          const e1 = Math.max(h1, waterLevel);
          const e2 = Math.max(h2, waterLevel);
          const e3 = Math.max(h3, waterLevel);

          const rockT = rockGrid[gy * w + gx];
          const { a, b, t } = getBiomeBlend(Math.max(height, waterLevel));
          const baseIndex = Math.max(1, a);
          const topIndex = Math.max(1, b);
          const basePattern = patterns[baseIndex] ?? solid(baseIndex);
          const topPattern = patterns[topIndex] ?? solid(topIndex);

          const points = [
            toRasterPoint(toIsoElev(wx, wy, e0)),
            toRasterPoint(toIsoElev(wx + CS, wy, e1)),
            toRasterPoint(toIsoElev(wx + CS, wy + CS, e2)),
            toRasterPoint(toIsoElev(wx, wy + CS, e3)),
          ];

          const path = () => {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            ctx.lineTo(points[1].x, points[1].y);
            ctx.lineTo(points[2].x, points[2].y);
            ctx.lineTo(points[3].x, points[3].y);
            ctx.closePath();
          };

          const fillSeal = (style: string | CanvasPattern, alpha = 1, sealColor?: string) => {
            path();
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = alpha;
            ctx.fillStyle = style;
            ctx.fill();
            if (sealColor) {
              ctx.strokeStyle = sealColor;
              ctx.lineWidth = Math.max(0.12, 0.6 * scale);
              ctx.lineJoin = 'round';
              ctx.globalAlpha = Math.min(0.25, alpha * 0.25);
              ctx.stroke();
            }
          };

          fillSeal(basePattern as string | CanvasPattern, 1, solid(baseIndex));
          if (t > 0.001 && topIndex !== baseIndex) {
            fillSeal(topPattern as string | CanvasPattern, t);
          }
          if (rockT > 0.02) {
            fillSeal(stonePattern as string | CanvasPattern, rockT);
          }

          const lit = litSmooth[gy * w + gx];
          const shade = Math.round(Math.min(255, lit * 255));
          path();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'multiply';
          ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
          ctx.fill();
          ctx.strokeStyle = `rgb(${shade},${shade},${shade})`;
          ctx.lineWidth = Math.max(0.12, 0.6 * scale);
          ctx.globalAlpha = 0.15;
          ctx.stroke();

          const hL = gx > 0 ? heightGrid[gy * w + gx - 1] : height;
          const hR = gx < w - 1 ? heightGrid[gy * w + gx + 1] : height;
          const hU = gy > 0 ? heightGrid[(gy - 1) * w + gx] : height;
          const hD = gy < h - 1 ? heightGrid[(gy + 1) * w + gx] : height;
          const nx = -(hR - hL) * 0.5 * NORMAL_STRENGTH;
          const ny = -(hD - hU) * 0.5 * NORMAL_STRENGTH;
          const normalLength = Math.hypot(nx, ny, 1) || 1;
          const ndotl = Math.max(0, (nx * lx + ny * ly + lz) / normalLength);

          if (ndotl > 0.55 && lit > 0.85 && rockT < 0.35) {
            const highlightAlpha = Math.min(0.22, (ndotl - 0.55) * 0.3);
            path();
            ctx.globalCompositeOperation = 'soft-light';
            ctx.globalAlpha = 1;
            ctx.fillStyle = `rgba(255,236,180,${highlightAlpha.toFixed(3)})`;
            ctx.fill();
          }

          if (terrain.isRiverAt(wx + CS * 0.5, wy + CS * 0.5)) {
            path();
            ctx.globalCompositeOperation = 'multiply';
            ctx.globalAlpha = 1;
            ctx.fillStyle = 'rgba(120,160,255,0.7)';
            ctx.fill();
          }

          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;

          const eastHeight = gx < w - 1 ? heightGrid[gy * w + gx + 1] : height;
          const southHeight = gy < h - 1 ? heightGrid[(gy + 1) * w + gx] : height;

          if (eastHeight < height - faceMin) {
            const difference = height - eastHeight;
            const cliffAlpha = Math.min(0.65, 0.25 + difference * 1.2);
            const bottomNorth = toRasterPoint(toIsoElev(wx + CS, wy, Math.max(eastHeight, waterLevel)));
            const bottomSouth = toRasterPoint(toIsoElev(wx + CS, wy + CS, Math.max(eastHeight, waterLevel)));
            ctx.beginPath();
            ctx.moveTo(points[1].x, points[1].y);
            ctx.lineTo(points[2].x, points[2].y);
            ctx.lineTo(bottomSouth.x, bottomSouth.y);
            ctx.lineTo(bottomNorth.x, bottomNorth.y);
            ctx.closePath();
            ctx.fillStyle = stonePattern as string | CanvasPattern;
            ctx.fill();
            ctx.fillStyle = `rgba(24,20,16,${cliffAlpha.toFixed(3)})`;
            ctx.fill();
          }

          if (southHeight < height - faceMin) {
            const difference = height - southHeight;
            const cliffAlpha = Math.min(0.65, 0.25 + difference * 1.2);
            const bottomWest = toRasterPoint(toIsoElev(wx, wy + CS, Math.max(southHeight, waterLevel)));
            const bottomEast = toRasterPoint(toIsoElev(wx + CS, wy + CS, Math.max(southHeight, waterLevel)));
            ctx.beginPath();
            ctx.moveTo(points[3].x, points[3].y);
            ctx.lineTo(points[2].x, points[2].y);
            ctx.lineTo(bottomEast.x, bottomEast.y);
            ctx.lineTo(bottomWest.x, bottomWest.y);
            ctx.closePath();
            ctx.fillStyle = stonePattern as string | CanvasPattern;
            ctx.fill();
            ctx.fillStyle = `rgba(24,20,16,${cliffAlpha.toFixed(3)})`;
            ctx.fill();
          }
        }

        cellsInBatch++;
        if (cellsInBatch >= paintBatch || gx === w - 1) {
          completedWork++;
          cellsInBatch = 0;
          yield {
            processed: completedWork,
            total: totalWork,
            detail: `Painting canonical terrain textures ${profile.canvasWidth}×${profile.canvasHeight}`,
          };
        }
      }
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  };

  await runBudgetedWork(work(), onProgress, yieldToBrowser, 6);

  scene.textures.addCanvas('_terrainTint', canvas);
  terrain.visualSprite = scene.add.sprite(minX, minY, '_terrainTint').setOrigin(0);
  terrain.visualSprite.setDisplaySize(profile.fullWidth, profile.fullHeight);
  terrain.visualSprite.setDepth(-10000);
  scene.worldLayer.add(terrain.visualSprite);

  return profile;
}
