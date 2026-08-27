import { MAP_SIZES, TERRAIN_CONFIG } from '../../constants';
import { MapSize } from '../../types';
import { LoadingWorkProgress, runBudgetedWork, yieldToBrowser } from '../../utils/gameLoading';
import type { MainScene } from '../MainScene';
import { toIso, toIsoElev } from '../utils/iso';

export const MAX_ADAPTIVE_TERRAIN_RASTER_PIXELS = 4_000_000;

export interface AdaptiveTerrainVisualProfile {
  renderScale: number;
  sampleScale: number;
  sampleStep: number;
  fullWidth: number;
  fullHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

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

  // Reserve the worst-case terrain lift without scanning another full map pass.
  minY -= (1 - scene.terrainSystem.getWaterLevel()) * TERRAIN_CONFIG.HEIGHT_LIFT;
  const fullWidth = Math.ceil(maxX - minX) + 2;
  const fullHeight = Math.ceil(maxY - minY) + 2;

  const isHuge = scene.mapWidth >= MAP_SIZES[MapSize.HUGE];
  // Large-map terrain is a background visual, not gameplay state. Keeping its
  // backing canvas much smaller avoids duplicating tens of megapixels across
  // CPU canvas storage, Phaser textures, and the GPU on memory-constrained browsers.
  const preferredScale = isHuge ? 0.125 : 0.25;
  const budgetScale = Math.sqrt(MAX_ADAPTIVE_TERRAIN_RASTER_PIXELS / Math.max(1, fullWidth * fullHeight));
  const renderScale = Math.min(preferredScale, budgetScale, 1);

  // IMPORTANT: only reduce the backing raster, never the terrain sampling grid.
  // Sampling 4x/8x cells at once produced giant biome quads and checkerboard
  // transitions after the low-resolution canvas was scaled back to world size.
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
 * Gameplay terrain remains full resolution. Only the visual backing raster is
 * reduced. Biome/elevation sampling stays at the canonical terrain cell size so
 * Large/Huge maps keep the same texture layout and transition fidelity as the
 * normal terrain painter without the full-resolution canvas memory cost.
 */
export async function applyAdaptiveTerrainVisuals(
  scene: MainScene,
  onProgress?: (progress: LoadingWorkProgress) => void,
): Promise<AdaptiveTerrainVisualProfile> {
  const terrain = scene.terrainSystem;
  const profile = getAdaptiveTerrainVisualProfile(scene);
  const waterLevel = terrain.getWaterLevel();

  terrain.visualSprite?.destroy();
  terrain.visualSprite = null;
  if (scene.textures.exists('_terrainTint')) scene.textures.remove('_terrainTint');

  const corners = [
    toIso(0, 0),
    toIso(scene.mapWidth, 0),
    toIso(scene.mapWidth, scene.mapHeight),
    toIso(0, scene.mapHeight),
  ];
  let minX = Math.min(...corners.map((point) => point.x));
  let minY = Math.min(...corners.map((point) => point.y));
  minX -= 1;
  minY -= (1 - waterLevel) * TERRAIN_CONFIG.HEIGHT_LIFT + 1;

  const columns = Math.ceil(scene.mapWidth / profile.sampleStep);
  const rows = Math.ceil(scene.mapHeight / profile.sampleStep);
  const totalSamples = rows * columns;

  onProgress?.({
    processed: 0,
    total: totalSamples,
    detail: `Allocating bounded terrain raster ${profile.canvasWidth}×${profile.canvasHeight}`,
  });
  await yieldToBrowser();

  const canvas = document.createElement('canvas');
  canvas.width = profile.canvasWidth;
  canvas.height = profile.canvasHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const textureKeyByBiome: Record<string, string> = {
    sand: 'terrain_sand',
    swamp: 'terrain_swamp',
    grass: 'terrain_grass',
    jungle: 'terrain_jungle',
    forest: 'terrain_forest',
    tundra: 'terrain_tundra',
    scrub: 'terrain_scrub',
    stone: 'terrain_stone',
  };

  const biomeColor = new Map(
    TERRAIN_CONFIG.BIOMES.map((biome) => [biome.label, biome.color] as const),
  );
  // Pattern is authored in backing-raster pixels. Scaling the final sprite back
  // to full world size restores the canonical TEX_PERIOD in world coordinates.
  const patternPeriod = Math.max(24, Math.round(TERRAIN_CONFIG.TEX_PERIOD * profile.renderScale));
  const fills = new Map<string, CanvasPattern | string>();

  for (const biome of TERRAIN_CONFIG.BIOMES) {
    if (biome.label === 'deep') continue;
    const textureKey = textureKeyByBiome[biome.label];
    const fallback = `rgb(${biome.color.r},${biome.color.g},${biome.color.b})`;
    if (!textureKey || !scene.textures.exists(textureKey)) {
      fills.set(biome.label, fallback);
      continue;
    }

    const texture = scene.textures.get(textureKey);
    const source = (typeof (texture as { getSourceImage?: () => CanvasImageSource }).getSourceImage === 'function'
      ? (texture as { getSourceImage: () => CanvasImageSource }).getSourceImage()
      : (texture as { image?: CanvasImageSource }).image) as HTMLImageElement | HTMLCanvasElement | undefined;
    if (!source) {
      fills.set(biome.label, fallback);
      continue;
    }

    const tile = document.createElement('canvas');
    tile.width = patternPeriod;
    tile.height = patternPeriod;
    const tileCtx = tile.getContext('2d')!;
    tileCtx.imageSmoothingEnabled = true;
    tileCtx.imageSmoothingQuality = 'high';
    const sourceWidth = ('naturalWidth' in source ? source.naturalWidth : 0) || source.width || patternPeriod;
    const sourceHeight = ('naturalHeight' in source ? source.naturalHeight : 0) || source.height || patternPeriod;
    tileCtx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, patternPeriod, patternPeriod);
    fills.set(biome.label, ctx.createPattern(tile, 'repeat') ?? fallback);
  }

  const getBiomeBlend = (height: number): { a: number; b: number; t: number } => {
    const biomes = TERRAIN_CONFIG.BIOMES;
    let idx = 0;
    for (let i = biomes.length - 1; i >= 0; i--) {
      if (height >= biomes[i].minHeight) {
        idx = i;
        break;
      }
    }

    if (idx <= 0) return { a: 0, b: 0, t: 0 };
    if (idx >= biomes.length - 1) {
      const cur = biomes[idx].minHeight;
      const prev = biomes[idx - 1].minHeight;
      const gap = Math.max(1e-6, cur - (Number.isFinite(prev) ? prev : waterLevel));
      const half = Math.min(TERRAIN_CONFIG.BIOME_DITHER, gap * 0.45);
      const lo = cur - half;
      const hi = cur + half;
      if (height >= lo && height < hi) {
        const raw = (height - lo) / Math.max(1e-6, hi - lo);
        const t = raw * raw * (3 - 2 * raw);
        return { a: idx - 1, b: idx, t };
      }
      return { a: idx, b: idx, t: 0 };
    }

    const next = biomes[idx + 1].minHeight;
    const gapUp = Math.max(1e-6, next - biomes[idx].minHeight);
    const halfUp = Math.min(TERRAIN_CONFIG.BIOME_DITHER, gapUp * 0.45);
    const upLo = next - halfUp;
    const upHi = next + halfUp;
    if (height >= upLo && height < upHi) {
      const raw = (height - upLo) / Math.max(1e-6, upHi - upLo);
      const t = raw * raw * (3 - 2 * raw);
      return { a: idx, b: idx + 1, t };
    }

    const cur = biomes[idx].minHeight;
    const prev = biomes[idx - 1].minHeight;
    const gapDown = Math.max(1e-6, cur - (Number.isFinite(prev) ? prev : waterLevel));
    const halfDown = Math.min(TERRAIN_CONFIG.BIOME_DITHER, gapDown * 0.45);
    const downLo = cur - halfDown;
    const downHi = cur + halfDown;
    if (height >= downLo && height < downHi) {
      const raw = (height - downLo) / Math.max(1e-6, downHi - downLo);
      const t = raw * raw * (3 - 2 * raw);
      return { a: idx - 1, b: idx, t };
    }

    return { a: idx, b: idx, t: 0 };
  };

  const getFill = (biomeIndex: number): CanvasPattern | string => {
    const clamped = Math.max(1, Math.min(TERRAIN_CONFIG.BIOMES.length - 1, biomeIndex));
    const biome = TERRAIN_CONFIG.BIOMES[clamped];
    return fills.get(biome.label) ?? `rgb(${biome.color.r},${biome.color.g},${biome.color.b})`;
  };

  const work = function* (): Generator<LoadingWorkProgress, void, void> {
    const step = profile.sampleStep;
    const scale = profile.renderScale;
    // Match the legacy painter's ~0.6 logical-pixel seam seal after raster scale.
    const seamWidth = Math.max(0.12, 0.6 * scale);
    let processed = 0;

    for (let row = 0; row < rows; row++) {
      const wy = row * step;
      for (let column = 0; column < columns; column++) {
        const wx = column * step;
        const x1 = Math.min(scene.mapWidth, wx + step);
        const y1 = Math.min(scene.mapHeight, wy + step);
        const h0 = terrain.getHeightInterpolated(wx, wy);
        const h1 = terrain.getHeightInterpolated(x1, wy);
        const h2 = terrain.getHeightInterpolated(x1, y1);
        const h3 = terrain.getHeightInterpolated(wx, y1);

        if (Math.max(h0, h1, h2, h3) >= waterLevel - 0.01) {
          const centerX = (wx + x1) * 0.5;
          const centerY = (wy + y1) * 0.5;
          const centerHeight = terrain.getHeightInterpolated(centerX, centerY);

          if (centerHeight >= waterLevel - 0.01) {
            const c0 = toIsoElev(wx, wy, Math.max(h0, waterLevel));
            const c1 = toIsoElev(x1, wy, Math.max(h1, waterLevel));
            const c2 = toIsoElev(x1, y1, Math.max(h2, waterLevel));
            const c3 = toIsoElev(wx, y1, Math.max(h3, waterLevel));
            const points = [c0, c1, c2, c3].map((point) => ({
              x: (point.x - minX) * scale,
              y: (point.y - minY) * scale,
            }));

            const path = () => {
              ctx.beginPath();
              ctx.moveTo(points[0].x, points[0].y);
              for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
              ctx.closePath();
            };

            const { a, b, t } = getBiomeBlend(Math.max(centerHeight, waterLevel));
            const baseIndex = Math.max(1, a);
            const topIndex = Math.max(1, b);
            const baseFill = getFill(baseIndex);

            path();
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            ctx.fillStyle = baseFill;
            ctx.fill();
            // Seal AA fringes using the same texture instead of a contrasting
            // biome-colored 1px outline. At 0.25x, a 1px stroke became a 4px
            // world-space grid line after sprite upscaling.
            ctx.strokeStyle = baseFill;
            ctx.lineWidth = seamWidth;
            ctx.lineJoin = 'round';
            ctx.stroke();

            if (t > 0.001 && topIndex !== baseIndex) {
              path();
              ctx.globalAlpha = t;
              ctx.fillStyle = getFill(topIndex);
              ctx.fill();
            }

            const normalizedHeight = Math.max(0, (centerHeight - waterLevel) / Math.max(0.001, 1 - waterLevel));
            const slope = terrain.getSlopeAt(centerX, centerY).slope;
            const shade = Math.max(0.68, Math.min(1, 0.84 + normalizedHeight * 0.16 - slope * 0.75));
            const shadeByte = clampByte(shade * 255);
            path();
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'multiply';
            ctx.fillStyle = `rgb(${shadeByte},${shadeByte},${shadeByte})`;
            ctx.fill();

            if (terrain.isRiverAt(centerX, centerY)) {
              path();
              ctx.globalCompositeOperation = 'multiply';
              ctx.fillStyle = 'rgba(120,160,255,0.65)';
              ctx.fill();
            }
          }
        }

        processed++;
        // Keep each generator item small enough that runBudgetedWork can honor
        // its event-loop budget even on slow integrated/software renderers.
        if ((processed & 7) === 0 || processed === totalSamples) {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          yield {
            processed,
            total: totalSamples,
            detail: `Painting bounded terrain raster ${profile.canvasWidth}×${profile.canvasHeight}`,
          };
        }
      }
    }
  };

  await runBudgetedWork(work(), onProgress, yieldToBrowser, 6);

  scene.textures.addCanvas('_terrainTint', canvas);
  terrain.visualSprite = scene.add.sprite(minX, minY, '_terrainTint').setOrigin(0);
  terrain.visualSprite.setDisplaySize(profile.fullWidth, profile.fullHeight);
  terrain.visualSprite.setDepth(-10000);
  scene.worldLayer.add(terrain.visualSprite);

  return profile;
}
