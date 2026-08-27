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
 * Restores high-frequency biome detail after the Large/Huge bounded terrain
 * raster is painted. The expensive world-sized backing allocation remains
 * bounded; this pass only reuses the existing canvas and native texture sources.
 *
 * The previous adaptive painter resized each biome source into an intermediate
 * low-resolution tile before drawing it. Fine-grained textures such as sand,
 * tundra, scrub and stone could average into flat colour while coarse grass
 * detail remained visible. This pass keeps the native source and scales the
 * CanvasPattern at draw time instead, preserving more texture information.
 *
 * It also paints cell-edge sealing with the SAME texture pattern. This hides the
 * solid-colour/dark seam strokes that became a pixelated isometric grid when the
 * bounded raster was enlarged back to world size.
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

    // Keep the canonical world-space repeat period without pre-downsampling the
    // source into a throwaway tile canvas. Modern Chromium/Brave support this.
    if (typeof pattern.setTransform === 'function') {
      pattern.setTransform(new DOMMatrix({
        a: rasterPeriodX / sourceWidth,
        d: rasterPeriodY / sourceHeight,
      }));
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

  const toRasterPoint = (point: { x: number; y: number }) => ({
    x: (point.x - visual.x) * rasterScaleX,
    y: (point.y - visual.y) * rasterScaleY,
  });

  const biomeCells: Record<string, number> = {};
  let paintedCells = 0;
  let completed = 0;
  const batchSize = 16;
  const total = Math.ceil((w * h) / batchSize);

  const work = function* (): Generator<LoadingWorkProgress, void, void> {
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
          if (!basePattern || !topPattern) {
            throw new Error(`Missing adaptive detail pattern for biome ${baseBiome.label}/${topBiome.label}`);
          }

          // Reintroduce native texture detail without flattening the canonical
          // lighting/cliff work underneath. Pattern alignment is global, so texture
          // does not restart at every diamond.
          path();
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 0.58;
          ctx.fillStyle = basePattern;
          ctx.fill();

          if (blend.t > 0.001 && blend.top !== blend.base) {
            path();
            ctx.globalAlpha = 0.58 * blend.t;
            ctx.fillStyle = topPattern;
            ctx.fill();
          }

          // Seal shared AA edges using texture, never a solid RGB/dark stroke.
          // This specifically removes the enlarged pixel-grid appearance.
          path();
          ctx.globalAlpha = 0.48;
          ctx.strokeStyle = blend.t >= 0.5 ? topPattern : basePattern;
          ctx.lineWidth = 1.15;
          ctx.lineJoin = 'round';
          ctx.stroke();

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
            detail: 'Restoring native biome texture detail',
          };
        }
      }
    }
  };

  await runBudgetedWork(work(), onProgress, yieldToBrowser, 6);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  terrainTexture.refresh?.();

  const diagnostics: AdaptiveTerrainTextureDetailDiagnostics = {
    paintedCells,
    biomeCells,
    sourceTextures,
  };
  scene.registry.set('adaptiveTerrainTextureDetail', diagnostics);
  return diagnostics;
}
