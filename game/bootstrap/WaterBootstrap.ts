import Phaser from 'phaser';

import { MAP_SIZES } from '../../constants';
import { MapSize } from '../../types';
import { yieldToBrowser } from '../../utils/gameLoading';
import { MainScene } from '../MainScene';
import { toIso } from '../utils/iso';

export interface WaterBootstrapProgress {
  progress: number;
  phase: string;
  detail: string;
  processed?: number;
  total?: number;
}

export interface WaterBootstrapResult {
  waterDepthSprite: Phaser.GameObjects.Sprite | null;
  waterWaveSprite: Phaser.GameObjects.TileSprite | null;
  waterMaskBounds: Phaser.Geom.Rectangle | null;
  waterShoreChainData: { px: number; py: number; nx: number; ny: number; ph1: number; ph2: number }[][];
}

type WaterPoly = {
  pts: { x: number; y: number }[];
  depth: number;
  shore: boolean;
  isCross: boolean[];
};

/**
 * Builds fixed-map water without monopolizing the browser main thread.
 * Gameplay terrain/pathfinding stay full resolution. Only the water rendering
 * mesh/canvas are adaptively downsampled on large maps.
 */
export class WaterBootstrap {
  constructor(private readonly scene: MainScene) {}

  async initialize(onProgress?: (progress: WaterBootstrapProgress) => void): Promise<WaterBootstrapResult> {
    const scene = this.scene;
    const sourceDim = scene.terrainSystem.getGridDimensions();
    const grid = scene.terrainSystem.getHeightMapData();
    const level = scene.terrainSystem.getWaterLevel();

    const isHuge = scene.mapWidth >= MAP_SIZES[MapSize.HUGE];
    const isLarge = scene.mapWidth >= MAP_SIZES[MapSize.LARGE];
    const sampleScale = isHuge ? 4 : isLarge ? 2 : 1;
    const canvasScale = isHuge ? 0.25 : isLarge ? 0.5 : 1;
    const detailedWaterAccents = !isLarge;

    const dim = {
      width: Math.ceil(sourceDim.width / sampleScale),
      height: Math.ceil(sourceDim.height / sampleScale),
      cellSize: sourceDim.cellSize * sampleScale,
    };
    const cellSize = dim.cellSize;

    onProgress?.({
      progress: 0.02,
      phase: 'Shaping coastlines',
      detail: `Tracing water mesh at ${cellSize}px visual resolution`,
      processed: 0,
      total: dim.height,
    });
    await yieldToBrowser();

    const shallowR = 40, shallowG = 175, shallowB = 210;
    const deepR = 12, deepG = 70, deepB = 145;
    const blurPad = 4;
    const sample = (wx: number, wy: number) => scene.terrainSystem.getHeightInterpolated(wx, wy);
    const edgePt = (
      ax: number, ay: number, ha: number,
      bx: number, by: number, hb: number,
    ) => {
      const t = (level - ha) / (hb - ha || 1e-6);
      return toIso(ax + (bx - ax) * t, ay + (by - ay) * t);
    };

    const waterPolys: WaterPoly[] = [];
    let wMinX = Infinity, wMinY = Infinity, wMaxX = -Infinity, wMaxY = -Infinity;
    const expand = (pts: { x: number; y: number }[]) => {
      for (const p of pts) {
        if (p.x < wMinX) wMinX = p.x;
        if (p.x > wMaxX) wMaxX = p.x;
        if (p.y < wMinY) wMinY = p.y;
        if (p.y > wMaxY) wMaxY = p.y;
      }
    };

    let sliceStart = performance.now();
    for (let gy = 0; gy < dim.height; gy++) {
      for (let gx = 0; gx < dim.width; gx++) {
        const wx = gx * cellSize;
        const wy = gy * cellSize;
        const h0 = sample(wx, wy);
        const h1 = sample(wx + cellSize, wy);
        const h2 = sample(wx + cellSize, wy + cellSize);
        const h3 = sample(wx, wy + cellSize);
        const m0 = h0 < level ? 1 : 0;
        const m1 = h1 < level ? 1 : 0;
        const m2 = h2 < level ? 1 : 0;
        const m3 = h3 < level ? 1 : 0;
        const mask = m0 | (m1 << 1) | (m2 << 2) | (m3 << 3);
        if (mask === 0) continue;

        const c0 = toIso(wx, wy);
        const c1 = toIso(wx + cellSize, wy);
        const c2 = toIso(wx + cellSize, wy + cellSize);
        const c3 = toIso(wx, wy + cellSize);
        const e0 = () => edgePt(wx, wy, h0, wx + cellSize, wy, h1);
        const e1 = () => edgePt(wx + cellSize, wy, h1, wx + cellSize, wy + cellSize, h2);
        const e2 = () => edgePt(wx + cellSize, wy + cellSize, h2, wx, wy + cellSize, h3);
        const e3 = () => edgePt(wx, wy + cellSize, h3, wx, wy, h0);

        let depthSum = 0;
        let wetCount = 0;
        for (const height of [h0, h1, h2, h3]) {
          if (height < level) {
            depthSum += (level - height) / level;
            wetCount++;
          }
        }
        const depth = Math.min(1, depthSum / Math.max(1, wetCount));

        if (mask === 5) {
          const a = [c0, e0(), e3()];
          const b = [c2, e1(), e2()];
          waterPolys.push({ pts: a, depth, shore: true, isCross: [false, true, true] });
          waterPolys.push({ pts: b, depth, shore: true, isCross: [false, true, true] });
          expand(a);
          expand(b);
          continue;
        }
        if (mask === 10) {
          const a = [c1, e0(), e1()];
          const b = [c3, e2(), e3()];
          waterPolys.push({ pts: a, depth, shore: true, isCross: [false, true, true] });
          waterPolys.push({ pts: b, depth, shore: true, isCross: [false, true, true] });
          expand(a);
          expand(b);
          continue;
        }

        let pts: { x: number; y: number }[];
        let isCross: boolean[];
        switch (mask) {
          case 1: pts = [c0, e0(), e3()]; isCross = [false, true, true]; break;
          case 2: pts = [c1, e1(), e0()]; isCross = [false, true, true]; break;
          case 3: pts = [c0, c1, e1(), e3()]; isCross = [false, false, true, true]; break;
          case 4: pts = [c2, e2(), e1()]; isCross = [false, true, true]; break;
          case 6: pts = [c1, c2, e2(), e0()]; isCross = [false, false, true, true]; break;
          case 7: pts = [c0, c1, c2, e2(), e3()]; isCross = [false, false, false, true, true]; break;
          case 8: pts = [c3, e3(), e2()]; isCross = [false, true, true]; break;
          case 9: pts = [c0, e0(), e2(), c3]; isCross = [false, true, true, false]; break;
          case 11: pts = [c0, c1, e1(), e2(), c3]; isCross = [false, false, true, true, false]; break;
          case 12: pts = [c2, c3, e3(), e1()]; isCross = [false, false, true, true]; break;
          case 13: pts = [c0, e0(), e1(), c2, c3]; isCross = [false, true, true, false, false]; break;
          case 14: pts = [c1, c2, c3, e3(), e0()]; isCross = [false, false, false, true, true]; break;
          default: pts = [c0, c1, c2, c3]; isCross = [false, false, false, false]; break;
        }
        waterPolys.push({ pts, depth, shore: mask !== 15, isCross });
        expand(pts);
      }

      if (performance.now() - sliceStart >= 8) {
        onProgress?.({
          progress: 0.02 + ((gy + 1) / dim.height) * 0.36,
          phase: 'Shaping coastlines',
          detail: 'Tracing water surface',
          processed: gy + 1,
          total: dim.height,
        });
        await yieldToBrowser();
        sliceStart = performance.now();
      }
    }

    onProgress?.({
      progress: 0.40,
      phase: 'Shaping coastlines',
      detail: `${waterPolys.length.toLocaleString()} water polygons traced`,
      processed: dim.height,
      total: dim.height,
    });
    await yieldToBrowser();

    if (waterPolys.length === 0) {
      await this.finishEnvironment(level, onProgress);
      return {
        waterDepthSprite: null,
        waterWaveSprite: null,
        waterMaskBounds: null,
        waterShoreChainData: [],
      };
    }

    const waterMaskBounds = new Phaser.Geom.Rectangle(
      wMinX - blurPad,
      wMinY - blurPad,
      Math.ceil(wMaxX - wMinX) + blurPad * 2,
      Math.ceil(wMaxY - wMinY) + blurPad * 2,
    );
    const wb = waterMaskBounds;
    const depthCvs = document.createElement('canvas');
    depthCvs.width = Math.max(1, Math.ceil(wb.width * canvasScale));
    depthCvs.height = Math.max(1, Math.ceil(wb.height * canvasScale));
    const dCtx = depthCvs.getContext('2d')!;

    onProgress?.({
      progress: 0.44,
      phase: 'Rendering water',
      detail: `Rasterizing ${depthCvs.width}×${depthCvs.height} water mask`,
      processed: 0,
      total: waterPolys.length,
    });
    await yieldToBrowser();

    sliceStart = performance.now();
    for (let polyIndex = 0; polyIndex < waterPolys.length; polyIndex++) {
      const poly = waterPolys[polyIndex];
      const t = poly.depth;
      const alpha = poly.shore ? (0.65 + 0.25 * t) : (0.92 + 0.08 * t);
      const r = Math.floor(shallowR + (deepR - shallowR) * t);
      const gg = Math.floor(shallowG + (deepG - shallowG) * t);
      const b = Math.floor(shallowB + (deepB - shallowB) * t);
      dCtx.fillStyle = `rgba(${r},${gg},${b},${alpha})`;
      dCtx.beginPath();
      const p0 = poly.pts[0];
      dCtx.moveTo((p0.x - wb.x) * canvasScale, (p0.y - wb.y) * canvasScale);
      for (let i = 1; i < poly.pts.length; i++) {
        dCtx.lineTo((poly.pts[i].x - wb.x) * canvasScale, (poly.pts[i].y - wb.y) * canvasScale);
      }
      dCtx.closePath();
      dCtx.fill();

      if (performance.now() - sliceStart >= 8) {
        onProgress?.({
          progress: 0.44 + ((polyIndex + 1) / waterPolys.length) * 0.14,
          phase: 'Rendering water',
          detail: 'Painting water depth mask',
          processed: polyIndex + 1,
          total: waterPolys.length,
        });
        await yieldToBrowser();
        sliceStart = performance.now();
      }
    }

    const waterShoreChains = await this.buildShoreChains(waterPolys, wb, onProgress);
    const waterShoreChainData = waterShoreChains.map((chain) => {
      const points: { px: number; py: number; nx: number; ny: number; ph1: number; ph2: number }[] = [];
      for (let i = 0; i < chain.length; i += 2) {
        const px = chain[i], py = chain[i + 1];
        const dx = wb.width * 0.5 - px, dy = wb.height * 0.5 - py;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        points.push({ px, py, nx: dx / len, ny: dy / len, ph1: px * 0.015 + py * 0.01, ph2: px * 0.007 - py * 0.013 });
      }
      return points;
    });

    let waterCanvas = depthCvs;
    if (detailedWaterAccents) {
      onProgress?.({ progress: 0.68, phase: 'Rendering water', detail: 'Softening shoreline edges' });
      await yieldToBrowser();
      const softCvs = document.createElement('canvas');
      softCvs.width = depthCvs.width;
      softCvs.height = depthCvs.height;
      const sCtx = softCvs.getContext('2d')!;
      sCtx.filter = 'blur(1px)';
      sCtx.drawImage(depthCvs, 0, 0);
      sCtx.filter = 'none';
      waterCanvas = softCvs;
    }

    if (scene.textures.exists('_waterDepth')) scene.textures.remove('_waterDepth');
    scene.textures.addCanvas('_waterDepth', waterCanvas);
    const waterDepthSprite = scene.add.sprite(wb.x, wb.y, '_waterDepth').setOrigin(0);
    waterDepthSprite.setDepth(-9000);
    waterDepthSprite.setDisplaySize(wb.width, wb.height);
    scene.worldLayer.add(waterDepthSprite);

    const waterWaveSprite = scene.add.tileSprite(wb.x, wb.y, wb.width, wb.height, 'waterFoam').setOrigin(0);
    waterWaveSprite.setDepth(-8999);
    waterWaveSprite.setAlpha(0.12);
    waterWaveSprite.setTileScale(0.35, 0.175);
    scene.worldLayer.add(waterWaveSprite);

    if (detailedWaterAccents && waterShoreChainData.length > 0) {
      const shoreCvs = document.createElement('canvas');
      shoreCvs.width = Math.max(1, Math.ceil(wb.width));
      shoreCvs.height = Math.max(1, Math.ceil(wb.height));
      const sctx = shoreCvs.getContext('2d')!;
      sctx.strokeStyle = 'rgba(255,255,255,0.18)';
      sctx.lineWidth = 2;
      sctx.lineCap = 'round';
      sctx.lineJoin = 'round';
      for (const points of waterShoreChainData) {
        sctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const point = points[i];
          if (i === 0) sctx.moveTo(point.px, point.py);
          else sctx.lineTo(point.px, point.py);
        }
        sctx.stroke();
      }
      if (scene.textures.exists('_waterShore')) scene.textures.remove('_waterShore');
      scene.textures.addCanvas('_waterShore', shoreCvs);
      const shoreSprite = scene.add.sprite(wb.x, wb.y, '_waterShore').setOrigin(0);
      shoreSprite.setDepth(-8998);
      scene.worldLayer.add(shoreSprite);
    }

    const maskSprite = scene.add.sprite(wb.x, wb.y, '_waterDepth').setOrigin(0).setVisible(false);
    maskSprite.setDisplaySize(wb.width, wb.height);
    waterWaveSprite.setMask(maskSprite.createBitmapMask());

    onProgress?.({
      progress: 0.76,
      phase: 'Preparing navigation',
      detail: 'Blocking deep water from pathfinding',
    });
    await yieldToBrowser();
    await this.finishEnvironment(level, onProgress);

    // eslint-disable-next-line no-console
    console.log(
      '[Water] adaptive smooth MS water:',
      waterPolys.length,
      '/',
      grid.length,
      `sample=${sampleScale}x canvas=${canvasScale}x`,
    );

    return {
      waterDepthSprite,
      waterWaveSprite,
      waterMaskBounds,
      waterShoreChainData,
    };
  }

  private async buildShoreChains(
    waterPolys: WaterPoly[],
    wb: Phaser.Geom.Rectangle,
    onProgress?: (progress: WaterBootstrapProgress) => void,
  ): Promise<number[][]> {
    const segSet = new Set<string>();
    const segments: [number, number, number, number][] = [];
    let sliceStart = performance.now();

    for (let polyIndex = 0; polyIndex < waterPolys.length; polyIndex++) {
      const poly = waterPolys[polyIndex];
      const n = poly.pts.length;
      for (let i = 0; i < n; i++) {
        const ni = (i + 1) % n;
        if (!(poly.isCross[i] && poly.isCross[ni])) continue;
        const p1 = poly.pts[i], p2 = poly.pts[ni];
        const lx1 = p1.x - wb.x, ly1 = p1.y - wb.y;
        const lx2 = p2.x - wb.x, ly2 = p2.y - wb.y;
        const key = lx1 < lx2 || (lx1 === lx2 && ly1 < ly2)
          ? `${(lx1 * 10 | 0)},${(ly1 * 10 | 0)},${(lx2 * 10 | 0)},${(ly2 * 10 | 0)}`
          : `${(lx2 * 10 | 0)},${(ly2 * 10 | 0)},${(lx1 * 10 | 0)},${(ly1 * 10 | 0)}`;
        if (segSet.has(key)) continue;
        segSet.add(key);
        segments.push([lx1, ly1, lx2, ly2]);
      }

      if (performance.now() - sliceStart >= 8) {
        onProgress?.({
          progress: 0.58 + ((polyIndex + 1) / waterPolys.length) * 0.08,
          phase: 'Shaping coastlines',
          detail: 'Linking shoreline segments',
          processed: polyIndex + 1,
          total: waterPolys.length,
        });
        await yieldToBrowser();
        sliceStart = performance.now();
      }
    }

    const used = new Uint8Array(segments.length);
    const epMap = new Map<string, number[]>();
    const endpointKey = (x: number, y: number) => `${(x * 10 | 0)},${(y * 10 | 0)}`;
    for (let i = 0; i < segments.length; i++) {
      const [x1, y1, x2, y2] = segments[i];
      let a = epMap.get(endpointKey(x1, y1));
      if (!a) { a = []; epMap.set(endpointKey(x1, y1), a); }
      a.push(i);
      let b = epMap.get(endpointKey(x2, y2));
      if (!b) { b = []; epMap.set(endpointKey(x2, y2), b); }
      b.push(i);
    }

    const chains: number[][] = [];
    sliceStart = performance.now();
    for (let i = 0; i < segments.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const chain: number[] = [segments[i][0], segments[i][1], segments[i][2], segments[i][3]];
      let cx = segments[i][2], cy = segments[i][3];
      let forward = true;
      while (forward) {
        forward = false;
        for (const nextIndex of (epMap.get(endpointKey(cx, cy)) || [])) {
          if (used[nextIndex]) continue;
          used[nextIndex] = 1;
          const [sx, sy, ex, ey] = segments[nextIndex];
          if (Math.abs(sx - cx) < 0.2 && Math.abs(sy - cy) < 0.2) {
            chain.push(ex, ey);
            cx = ex;
            cy = ey;
            forward = true;
            break;
          }
          if (Math.abs(ex - cx) < 0.2 && Math.abs(ey - cy) < 0.2) {
            chain.push(sx, sy);
            cx = sx;
            cy = sy;
            forward = true;
            break;
          }
        }
      }
      if (chain.length >= 6) chains.push(chain);

      if (performance.now() - sliceStart >= 8) {
        onProgress?.({
          progress: 0.66,
          phase: 'Shaping coastlines',
          detail: 'Merging shoreline chains',
          processed: i + 1,
          total: segments.length,
        });
        await yieldToBrowser();
        sliceStart = performance.now();
      }
    }

    return chains;
  }

  private async finishEnvironment(
    level: number,
    onProgress?: (progress: WaterBootstrapProgress) => void,
  ): Promise<void> {
    const scene = this.scene;
    scene.pathfinder.applyWaterMask(
      (wx, wy) => scene.terrainSystem.getHeightAt(wx, wy),
      level,
    );

    onProgress?.({ progress: 0.82, phase: 'Growing world', detail: 'Drawing terrain overlays' });
    await yieldToBrowser();
    scene.mapGenerationSystem.createEnvironment();

    onProgress?.({ progress: 0.88, phase: 'Growing world', detail: 'Finding fertile ground' });
    await yieldToBrowser();
    scene.mapGenerationSystem.generateFertileZones();

    onProgress?.({ progress: 0.93, phase: 'Growing world', detail: 'Planting forests and spawning wildlife' });
    await yieldToBrowser();
    await scene.mapGenerationSystem.generateForestsAndAnimalsAsync((work) => {
      const ratio = work.total > 0 ? work.processed / work.total : 0;
      onProgress?.({
        progress: 0.93 + ratio * 0.06,
        phase: 'Growing world',
        detail: work.detail || 'Planting forests and spawning wildlife',
        processed: work.processed,
        total: work.total,
      });
    });

    onProgress?.({ progress: 1, phase: 'World environment ready', detail: 'Terrain, water, forests and wildlife are ready' });
    await yieldToBrowser();
  }
}
