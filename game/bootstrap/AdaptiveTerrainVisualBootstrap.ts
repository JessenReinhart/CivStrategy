import { MAP_SIZES, TERRAIN_CONFIG } from '../../constants';
import { MapSize } from '../../types';
import { LoadingWorkProgress, runBudgetedWork, yieldToBrowser } from '../../utils/gameLoading';
import type { MainScene } from '../MainScene';
import { toIso, toIsoElev } from '../utils/iso';

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
  const preferredScale = isHuge ? 0.25 : 0.5;
  const budgetScale = Math.sqrt(MAX_ADAPTIVE_TERRAIN_RASTER_PIXELS / Math.max(1, fullWidth * fullHeight));
  const renderScale = Math.min(preferredScale, budgetScale, 1);
  const sampleScale = isHuge ? 4 : 2;
  const sampleStep = TERRAIN_CONFIG.CELL_SIZE * sampleScale;

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
 * Gameplay terrain remains full resolution. This only reduces the visual raster
 * and visual sampling density so browser memory is bounded while startup work
 * still yields regularly to the event loop.
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

  onProgress?.({
    processed: 0,
    total: Math.ceil(scene.mapHeight / profile.sampleStep),
    detail: `Allocating bounded terrain raster ${profile.canvasWidth}×${profile.canvasHeight}`,
  });
  await yieldToBrowser();

  const canvas = document.createElement('canvas');
  canvas.width = profile.canvasWidth;
  canvas.height = profile.canvasHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;

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
  const patternPeriod = Math.max(48, Math.round(TERRAIN_CONFIG.TEX_PERIOD * profile.renderScale));
  const fills = new Map<string, CanvasPattern | string>();

  for (const [biome, textureKey] of Object.entries(textureKeyByBiome)) {
    const fallbackColor = biomeColor.get(biome) ?? { r: 90, g: 120, b: 70 };
    const fallback = `rgb(${fallbackColor.r},${fallbackColor.g},${fallbackColor.b})`;
    if (!scene.textures.exists(textureKey)) {
      fills.set(biome, fallback);
      continue;
    }

    const texture = scene.textures.get(textureKey);
    const source = (typeof (texture as { getSourceImage?: () => CanvasImageSource }).getSourceImage === 'function'
      ? (texture as { getSourceImage: () => CanvasImageSource }).getSourceImage()
      : (texture as { image?: CanvasImageSource }).image) as HTMLImageElement | HTMLCanvasElement | undefined;
    if (!source) {
      fills.set(biome, fallback);
      continue;
    }

    const tile = document.createElement('canvas');
    tile.width = patternPeriod;
    tile.height = patternPeriod;
    const tileCtx = tile.getContext('2d')!;
    const sourceWidth = ('naturalWidth' in source ? source.naturalWidth : 0) || source.width || patternPeriod;
    const sourceHeight = ('naturalHeight' in source ? source.naturalHeight : 0) || source.height || patternPeriod;
    tileCtx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, patternPeriod, patternPeriod);
    fills.set(biome, ctx.createPattern(tile, 'repeat') ?? fallback);
  }

  const rows = Math.ceil(scene.mapHeight / profile.sampleStep);
  const work = function* (): Generator<LoadingWorkProgress, void, void> {
    const step = profile.sampleStep;
    const scale = profile.renderScale;

    for (let row = 0; row < rows; row++) {
      const wy = row * step;
      for (let wx = 0; wx < scene.mapWidth; wx += step) {
        const x1 = Math.min(scene.mapWidth, wx + step);
        const y1 = Math.min(scene.mapHeight, wy + step);
        const h0 = terrain.getHeightInterpolated(wx, wy);
        const h1 = terrain.getHeightInterpolated(x1, wy);
        const h2 = terrain.getHeightInterpolated(x1, y1);
        const h3 = terrain.getHeightInterpolated(wx, y1);
        if (Math.max(h0, h1, h2, h3) < waterLevel - 0.01) continue;

        const centerX = (wx + x1) * 0.5;
        const centerY = (wy + y1) * 0.5;
        const centerHeight = terrain.getHeightInterpolated(centerX, centerY);
        const biome = terrain.getBiomeLabel(centerX, centerY);
        if (biome === 'deep') continue;

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

        const color = biomeColor.get(biome) ?? { r: 90, g: 120, b: 70 };
        path();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = fills.get(biome) ?? `rgb(${color.r},${color.g},${color.b})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},0.45)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        const normalizedHeight = Math.max(0, (centerHeight - waterLevel) / Math.max(0.001, 1 - waterLevel));
        const slope = terrain.getSlopeAt(centerX, centerY).slope;
        const shade = Math.max(0.68, Math.min(1, 0.84 + normalizedHeight * 0.16 - slope * 0.75));
        const shadeByte = clampByte(shade * 255);
        path();
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

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      yield {
        processed: row + 1,
        total: rows,
        detail: `Painting bounded terrain raster ${profile.canvasWidth}×${profile.canvasHeight}`,
      };
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
