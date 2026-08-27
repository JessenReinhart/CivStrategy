import { TERRAIN_CONFIG } from '../../constants';
import { LoadingWorkProgress, runBudgetedWork, yieldToBrowser } from '../../utils/gameLoading';
import type { MainScene } from '../MainScene';
import { toIsoElev } from '../utils/iso';

export interface AdaptiveTerrainTextureDetailDiagnostics {
  paintedCells: number;
  biomeCells: Record<string, number>;
  sourceTextures: Array<{ key: string; width: number; height: number }>;
}

const TEXTURE_KEYS = [
  'terrain_sand',
  'terrain_swamp',
  'terrain_grass',
  'terrain_jungle',
  'terrain_forest',
  'terrain_tundra',
  'terrain_scrub',
  'terrain_stone',
] as const;

/**
 * Repaints Large/Huge top surfaces from the native biome sources after the
 * bounded terrain canvas is built. The first adaptive pass still owns geometry,
 * cliffs, rivers and the bounded allocation; this pass replaces only the top
 * surface so fine texture is not averaged into flat biome colour.
 */
export async function applyAdaptiveTerrainTextureDetailPass(
  scene: MainScene,
  onProgress?: (progress: LoadingWorkProgress) => void,
): Promise<AdaptiveTerrainTextureDetailDiagnostics> {
  const terrain = scene.terrainSystem;
  const visual = terrain.visualSprite;
  if (!visual || !scene.textures.exists('_terrainTint')) {
    throw new Error('Adaptive terrain detail pass requires an existing _terrainTint canvas.');
  }

  const terrainTexture = scene.textures.get('_terrainTint');
  const sourceCanvas = terrainTexture.getSourceImage?.() as HTMLCanvasElement | undefined;
  if (!sourceCanvas || typeof sourceCanvas.getContext !== 'function') {
    throw new Error('Adaptive terrain detail pass requires _terrainTint to be canvas-backed.');
  }

  const ctx = sourceCanvas.getContext('2d');
  if (!ctx) throw new Error('Could not acquire adaptive terrain canvas context.');

  const grid = terrain.getGridDimensions();
  const heightGrid = terrain.getHeightMapData();
  const waterLevel = terrain.getWaterLevel();
  const w = grid.width;
  const h = grid.height;
  const CS = grid.cellSize;
  const rasterScaleX = sourceCanvas.width / visual.displayWidth;
  const rasterScaleY = sourceCanvas.height / visual.displayHeight;
  const period = Math.max(64, TERRAIN_CONFIG.TEX_PERIOD ?? 768);
  const rasterPeriodX = period * rasterScaleX;
  const rasterPeriodY = period * rasterScaleY;

  const patterns = new Map<string, CanvasPattern>();
  const sourceTextures: AdaptiveTerrainTextureDetailDiagnostics['sourceTextures'] = [];

  for (let index = 1; index < TERRAIN_CONFIG.BIOMES.length; index++) {
    const biome = TERRAIN_CONFIG.BIOMES[index];
    const key = TEXTURE_KEYS[index - 1];
    if (!key || !scene.textures.exists(key)) {
      throw new Error(`Required terrain texture is unavailable: ${key ?? biome.label}`);
    }

    const texture = scene.textures.get(key);
    const source = (typeof (texture as { getSourceImage?: () => CanvasImageSource }).getSourceImage === 'function'
      ? (texture as { getSourceImage: () => CanvasImageSource }).getSourceImage()
      : (texture as { image?: CanvasImageSource }).image) as HTMLImageElement | HTMLCanvasElement | undefined;
    if (!source) throw new Error(`Terrain texture has no drawable source: ${key}`);

    const sourceWidth = ('naturalWidth' in source ? source.naturalWidth : 0) || source.width || 0;
    const sourceHeight = ('naturalHeight' in source ? source.naturalHeight : 0) || source.height || 0;
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      throw new Error(`Terrain texture source is empty: ${key}`);
    }

    const pattern = ctx.createPattern(source, 'repeat');
    if (!pattern) throw new Error(`Could not create terrain pattern: ${key}`);

    if (typeof pattern.setTransform === 'function') {
      const transform = new DOMMatrix();
      transform.a = rasterPeriodX / sourceWidth;
      transform.d = rasterPeriodY / sourceHeight;
      pattern.setTransform(transform);
    }

    patterns.set(biome.label, pattern);
    sourceTextures.push({ key, width: sourceWidth, height: sourceHeight });
  }

  const getBiomeBlend = (height: number): { base: number; top: number; t: number } => {
    const biomes = TERRAIN_CONFIG.BIOMES;
    let index = 0;
    for (let i = biomes.length - 1; i >= 0; i--) {
      if (height >= biomes[i].minHeight) {
        index = i;
        break;
      }
    }

    index = Math.max(1, index);
    if (index >= biomes.length - 1) return { base: index, top: index, t: 0 };

    const next = biomes[index + 1].minHeight;
    const gap = Math.max(1e-6, next - biomes[index].minHeight);
    const half = Math.min(TERRAIN_CONFIG.BIOME_DITHER, gap * 0.45);
    const low = next - half;
    const high = next + half;
    if (height >= low && height < high) {
      const raw = (height - low) / Math.max(1e-6, high - low);
      const t = raw * raw * (3 - 2 * raw);
      return { base: index, top: index + 1, t };
    }

    return { base: index, top: index, t: 0 };
  };

  const rockFromSlope = (slope: number): number => {
    const low = TERRAIN_CONFIG.CLIFF_SLOPE_START ?? 0.18;
    const high = TERRAIN_CONFIG.CLIFF_SLOPE_FULL ?? 0.38;
    if (slope <= low) return 0;
    if (slope >= high) return 1;
    const raw = (slope - low) / Math.max(1e-6, high - low);
    return raw * raw * (3 - 2 * raw);
  };

  const litGrid = new Float32Array(w * h);
  const litSmooth = new Float32Array(w * h);
  const rockGrid = new Float32Array(w * h);
  const lightLength = Math.hypot(
    TERRAIN_CONFIG.LIGHT_DIR_X,
    TERRAIN_CONFIG.LIGHT_DIR_Y,
    TERRAIN_CONFIG.LIGHT_DIR_Z,
  ) || 1;
  const lx = TERRAIN_CONFIG.LIGHT_DIR_X / lightLength;
  const ly = TERRAIN_CONFIG.LIGHT_DIR_Y / lightLength;
  const lz = TERRAIN_CONFIG.LIGHT_DIR_Z / lightLength;

  const biomeCells: Record<string, number> = {};
  let paintedCells = 0;
  let completed = 0;
  const batchSize = 16;
  const paintBatches = Math.ceil((w * h) / batchSize);
  const total = h + h + paintBatches;

  const toRasterPoint = (point: { x: number; y: number }) => ({
    x: (point.x - visual.x) * rasterScaleX,
    y: (point.y - visual.y) * rasterScaleY,
  });

  const work = function* (): Generator<LoadingWorkProgress, void, void> {
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const index = gy * w + gx;
        const height = heightGrid[index];
        const hL = gx > 0 ? heightGrid[index - 1] : height;
        const hR = gx < w - 1 ? heightGrid[index + 1] : height;
        const hU = gy > 0 ? heightGrid[index - w] : height;
        const hD = gy < h - 1 ? heightGrid[index + w] : height;
        const dx = Math.max(Math.abs(hR - height), Math.abs(height - hL));
        const dy = Math.max(Math.abs(hD - height), Math.abs(height - hU));
        const rock = rockFromSlope(Math.hypot(dx, dy));
        rockGrid[index] = rock;

        const nx = -(hR - hL) * 0.5 * TERRAIN_CONFIG.NORMAL_STRENGTH;
        const ny = -(hD - hU) * 0.5 * TERRAIN_CONFIG.NORMAL_STRENGTH;
        const normalLength = Math.hypot(nx, ny, 1) || 1;
        const ndotl = Math.max(0, (nx * lx + ny * ly + lz) / normalLength);
        let lit = TERRAIN_CONFIG.LIGHT_AMBIENT + TERRAIN_CONFIG.LIGHT_DIFFUSE * ndotl;
        const heightTerm = (height - waterLevel) / Math.max(1e-6, 1 - waterLevel);
        lit *= 1 + (heightTerm - 0.35) * (TERRAIN_CONFIG.HEIGHT_SHADE ?? 0.28);
        lit *= 1 - rock * 0.18;
        litGrid[index] = Math.max(0.35, Math.min(1.1, lit));
      }
      completed++;
      yield { processed: completed, total, detail: 'Computing texture-preserving terrain light' };
    }

    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        let sum = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const x = gx + ox;
            const y = gy + oy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            sum += litGrid[y * w + x];
            count++;
          }
        }
        litSmooth[gy * w + gx] = sum / count;
      }
      completed++;
      yield { processed: completed, total, detail: 'Smoothing terrain texture lighting' };
    }

    let cellsInBatch = 0;
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const index = gy * w + gx;
        const height = heightGrid[index];
        if (height >= waterLevel - 0.01) {
          const wx = gx * CS;
          const wy = gy * CS;
          const h0 = Math.max(terrain.getHeightInterpolated(wx, wy), waterLevel);
          const h1 = Math.max(terrain.getHeightInterpolated(wx + CS, wy), waterLevel);
          const h2 = Math.max(terrain.getHeightInterpolated(wx + CS, wy + CS), waterLevel);
          const h3 = Math.max(terrain.getHeightInterpolated(wx, wy + CS), waterLevel);
          const points = [
            toRasterPoint(toIsoElev(wx, wy, h0)),
            toRasterPoint(toIsoElev(wx + CS, wy, h1)),
            toRasterPoint(toIsoElev(wx + CS, wy + CS, h2)),
            toRasterPoint(toIsoElev(wx, wy + CS, h3)),
          ];

          const path = () => {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            ctx.lineTo(points[1].x, points[1].y);
            ctx.lineTo(points[2].x, points[2].y);
            ctx.lineTo(points[3].x, points[3].y);
            ctx.closePath();
          };

          const blend = getBiomeBlend(Math.max(height, waterLevel));
          const baseBiome = TERRAIN_CONFIG.BIOMES[blend.base];
          const topBiome = TERRAIN_CONFIG.BIOMES[blend.top];
          const basePattern = patterns.get(baseBiome.label);
          const topPattern = patterns.get(topBiome.label);
          const stonePattern = patterns.get('stone');
          if (!basePattern || !topPattern || !stonePattern) {
            throw new Error(`Missing adaptive detail pattern for biome ${baseBiome.label}/${topBiome.label}`);
          }

          // Full native texture surface. This intentionally replaces the flat
          // baked top colour from the first adaptive pass.
          path();
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.fillStyle = basePattern;
          ctx.fill();

          if (blend.t > 0.001 && blend.top !== blend.base) {
            path();
            ctx.globalAlpha = blend.t;
            ctx.fillStyle = topPattern;
            ctx.fill();
          }

          const rock = rockGrid[index];
          if (rock > 0.02) {
            path();
            ctx.globalAlpha = rock;
            ctx.fillStyle = stonePattern;
            ctx.fill();
          }

          // Seal AA cracks BEFORE shading so the edge receives the same light as
          // the interior. No solid RGB or dark cell stroke is used.
          path();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = blend.t >= 0.5 ? topPattern : basePattern;
          ctx.lineWidth = 1.25;
          ctx.lineJoin = 'round';
          ctx.stroke();

          const shade = Math.round(Math.min(255, litSmooth[index] * 255));
          path();
          ctx.globalCompositeOperation = 'multiply';
          ctx.globalAlpha = 0.72;
          ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
          ctx.fill();

          if (terrain.isRiverAt(wx + CS * 0.5, wy + CS * 0.5)) {
            path();
            ctx.globalCompositeOperation = 'multiply';
            ctx.globalAlpha = 1;
            ctx.fillStyle = 'rgba(120,160,255,0.7)';
            ctx.fill();
          }

          paintedCells++;
          biomeCells[baseBiome.label] = (biomeCells[baseBiome.label] ?? 0) + 1;
        }

        cellsInBatch++;
        if (cellsInBatch >= batchSize || (gx === w - 1 && gy === h - 1)) {
          cellsInBatch = 0;
          completed++;
          yield {
            processed: completed,
            total,
            detail: 'Painting native biome texture surfaces',
          };
        }
      }
    }
  };

  await runBudgetedWork(work(), onProgress, yieldToBrowser, 6);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  (terrainTexture as { refresh?: () => void }).refresh?.();

  const diagnostics: AdaptiveTerrainTextureDetailDiagnostics = {
    paintedCells,
    biomeCells,
    sourceTextures,
  };
  scene.registry.set('adaptiveTerrainTextureDetail', diagnostics);
  return diagnostics;
}