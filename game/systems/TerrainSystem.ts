
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { Noise } from '../utils/Noise';
import { TERRAIN_CONFIG } from '../../constants';
import { TerrainModifiers, SlopeInfo } from '../../types';
import { toIso, toIsoElev } from '../utils/iso';

export class TerrainSystem {
  private scene: MainScene;
  private heightGrid: Float32Array;
  private gridWidth: number;
  private gridHeight: number;
  private noise: Noise;
  private visualSprite: Phaser.GameObjects.Sprite | null = null;

  constructor(scene: MainScene, mapWidth: number, mapHeight: number) {
    this.scene = scene;
    this.gridWidth = Math.ceil(mapWidth / TERRAIN_CONFIG.CELL_SIZE);
    this.gridHeight = Math.ceil(mapHeight / TERRAIN_CONFIG.CELL_SIZE);
    this.heightGrid = new Float32Array(this.gridWidth * this.gridHeight);
    this.noise = new Noise(Math.random() * 233280);
  }

  generateHeightMap(): void {
    const w = this.gridWidth;
    const h = this.gridHeight;
    const baseScale = TERRAIN_CONFIG.BASE_SCALE;
    const detailScale = TERRAIN_CONFIG.DETAIL_SCALE;
    const macroScale = TERRAIN_CONFIG.MACRO_SCALE;
    const macroAmp = TERRAIN_CONFIG.MACRO_AMPLITUDE;

    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        // World position at center of this grid cell
        const wx = gx * TERRAIN_CONFIG.CELL_SIZE + TERRAIN_CONFIG.CELL_SIZE / 2;
        const wy = gy * TERRAIN_CONFIG.CELL_SIZE + TERRAIN_CONFIG.CELL_SIZE / 2;

        // Three-octave noise: macro (continental basins) + base (hills/valleys) + detail (roughness)
        const macro = this.noise.perlin2(wx * macroScale, wy * macroScale) * macroAmp;
        const base = this.noise.perlin2(wx * baseScale, wy * baseScale);
        const detail = this.noise.perlin2(wx * detailScale, wy * detailScale) * TERRAIN_CONFIG.DETAIL_AMPLITUDE;

        let height = (macro + base + detail) * 0.5 + 0.5;
        height = Phaser.Math.Clamp(height, 0, 1);

        // Power stretch: push above-water heights toward peaks so more cells hit
        // scrub/stone biomes instead of everything clustering in grass/forest.
        const waterLevel = TERRAIN_CONFIG.WATER_LEVEL;
        const exp = TERRAIN_CONFIG.HEIGHT_EXPONENT;
        if (height > waterLevel && exp < 1.0) {
          const t = (height - waterLevel) / (1 - waterLevel);
          const stretched = t ** exp;
          height = waterLevel + stretched * (1 - waterLevel);
        }

      }
    }
  }

  getHeightAt(wx: number, wy: number): number {
    const gx = Math.floor(wx / TERRAIN_CONFIG.CELL_SIZE);
    const gy = Math.floor(wy / TERRAIN_CONFIG.CELL_SIZE);

    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
      return 0.5; // Default height outside map
    }

    return this.heightGrid[gy * this.gridWidth + gx];
  }

  getHeightInterpolated(wx: number, wy: number): number {
    const gx = wx / TERRAIN_CONFIG.CELL_SIZE;
    const gy = wy / TERRAIN_CONFIG.CELL_SIZE;
    const gxi = Math.floor(gx);
    const gyi = Math.floor(gy);
    const fx = gx - gxi;
    const fy = gy - gyi;

    if (gxi < 0 || gxi >= this.gridWidth - 1 || gyi < 0 || gyi >= this.gridHeight - 1) {
      return this.getHeightAt(wx, wy);
    }

    const idx = gyi * this.gridWidth + gxi;
    const h00 = this.heightGrid[idx];
    const h10 = this.heightGrid[idx + 1];
    const h01 = this.heightGrid[idx + this.gridWidth];
    const h11 = this.heightGrid[idx + this.gridWidth + 1];

    // Bilinear interpolation
    const top = h00 * (1 - fx) + h10 * fx;
    const bottom = h01 * (1 - fx) + h11 * fx;
    return top * (1 - fy) + bottom * fy;
  }

  getSlopeAt(wx: number, wy: number): SlopeInfo {
    const cx = wx / TERRAIN_CONFIG.CELL_SIZE;
    const cy = wy / TERRAIN_CONFIG.CELL_SIZE;
    const gxi = Math.floor(cx);
    const gyi = Math.floor(cy);

    if (gxi < 1 || gxi >= this.gridWidth - 1 || gyi < 1 || gyi >= this.gridHeight - 1) {
      return { slope: 0, isBuildable: true };
    }

    const idx = gyi * this.gridWidth + gxi;
    const hCenter = this.heightGrid[idx];
    const hRight = this.heightGrid[idx + 1];
    const hBottom = this.heightGrid[idx + this.gridWidth];

    // Slope magnitude from horizontal & vertical deltas
    const dx = Math.abs(hRight - hCenter);
    const dy = Math.abs(hBottom - hCenter);
    const slope = Math.sqrt(dx * dx + dy * dy);

    return {
      slope,
      isBuildable: slope <= TERRAIN_CONFIG.MAX_BUILDABLE_SLOPE
    };
  }

  getMovementModifier(wx: number, wy: number): number {
    const slopeInfo = this.getSlopeAt(wx, wy);
    if (slopeInfo.slope < TERRAIN_CONFIG.SLOPE_THRESHOLD) {
      return 1.0; // Flat terrain — no modifier
    }

    // Directional check: sample height ahead vs behind
    // Use interpolated height for smooth transitions
    const h = this.getHeightInterpolated(wx, wy);
    const hForward = this.getHeightInterpolated(wx + TERRAIN_CONFIG.CELL_SIZE * 0.5, wy + TERRAIN_CONFIG.CELL_SIZE * 0.5);

    const diffForward = hForward - h;

    if (diffForward > TERRAIN_CONFIG.SLOPE_THRESHOLD) {
      // Uphill — slower
      return TERRAIN_CONFIG.UPHILL_SPEED_PENALTY;
    } else if (diffForward < -TERRAIN_CONFIG.SLOPE_THRESHOLD) {
      // Downhill — faster
      return TERRAIN_CONFIG.DOWNHILL_SPEED_BONUS;
    }

    return 1.0;
  }

  getCombatModifiers(attackerX: number, attackerY: number, defenderX: number, defenderY: number): TerrainModifiers {
    const defHeight = this.getHeightInterpolated(defenderX, defenderY);
    const atkHeight = this.getHeightInterpolated(attackerX, attackerY);
    const diff = atkHeight - defHeight;

    let attackBonus = 0;
    let defenseBonus = 0;

    if (Math.abs(diff) > TERRAIN_CONFIG.HEIGHT_DIFF_THRESHOLD) {
      if (diff > 0) {
        // Attacker on high ground
        attackBonus = TERRAIN_CONFIG.HIGH_GROUND_ATTACK_BONUS;
        defenseBonus = 0; // Defender already at low ground
      } else {
        // Defender on high ground
        attackBonus = 0;
        defenseBonus = TERRAIN_CONFIG.HIGH_GROUND_DEFENSE_BONUS;
      }
    }

    return {
      movementSpeed: this.getMovementModifier(attackerX, attackerY),
      attackBonus,
      defenseBonus
    };
  }

  private hash11(seed: number): number {
    // simple deterministic hash from integer seed → [0,1)
    seed = (seed * 16807) % 2147483647;
    return (seed & 0x7fffffff) / 2147483647;
  }

  applyVisualTinting(): void {
    if (this.visualSprite) { this.visualSprite.destroy(); this.visualSprite = null; }
    if (this.scene.textures.exists('_terrainTint')) this.scene.textures.remove('_terrainTint');

    const {
      CELL_SIZE: CS, BIOMES, BIOME_DITHER, TEX_PERIOD,
      LIGHT_DIR_X, LIGHT_DIR_Y, LIGHT_DIR_Z,
      LIGHT_AMBIENT, LIGHT_DIFFUSE, NORMAL_STRENGTH, HEIGHT_SHADE,
      WATER_LEVEL,
    } = TERRAIN_CONFIG;
    const w = this.gridWidth;
    const h = this.gridHeight;
    const src = this.scene.textures;
    // Period = how many world px one seamless tile covers. Keep << viewport so
    // createPattern actually repeats on screen (768 looked like a single zoomed photo).
    const period = Math.max(32, TEX_PERIOD ?? 256);

    const textureKeys = ['terrain_sand', 'terrain_grass', 'terrain_forest', 'terrain_scrub', 'terrain_stone'];
    const patterns: (CanvasPattern | null)[] = BIOMES.map((b, i) => {
      if (i === 0) return null;
      const key = textureKeys[i - 1];
      if (!src.exists(key)) return null;
      const img = src.get(key).getSourceImage() as HTMLImageElement;
      if (!img) return null;
      const sw = img.naturalWidth || img.width || period;
      const sh = img.naturalHeight || img.height || period;
      const c = document.createElement('canvas');
      c.width = period;
      c.height = period;
      const cctx = c.getContext('2d')!;
      cctx.imageSmoothingEnabled = true;
      cctx.imageSmoothingQuality = 'high';
      // Scale source into period canvas — pattern unit size = period, not raw 512.
      cctx.drawImage(img, 0, 0, sw, sh, 0, 0, period, period);
      return cctx.createPattern(c, 'repeat')!;
    });

    // Dither: pick biome at height boundaries
    const getBiomeIndex = (height: number, dither: number): number => {
      for (let i = 0; i < BIOMES.length - 1; i++) {
        const lo = BIOMES[i].minHeight;
        const tLo = lo - BIOME_DITHER;
        const tHi = lo + BIOME_DITHER;
        if (height >= tLo && height < tHi) {
          return dither < (height - tLo) / (tHi - tLo) ? i : i + 1;
        }
      }
      if (height < BIOMES[1].minHeight) return 0;
      for (let i = BIOMES.length - 1; i >= 0; i--) if (height >= BIOMES[i].minHeight) return i;
      return 0;
    };

    // Find max height for AABB expansion (elevation lifts upward = extends minY)
    let maxGridHeight = 0;
    for (let i = 0; i < w * h; i++) {
      const hgt = this.heightGrid[i];
      if (hgt > maxGridHeight) maxGridHeight = hgt;
    }
    const maxLift = Math.max(0, maxGridHeight - WATER_LEVEL) * TERRAIN_CONFIG.HEIGHT_LIFT;

    // Iso AABB — expand upward for elevation lift
    const cornerPts = [toIso(0, 0), toIso(w * CS, 0), toIso(w * CS, h * CS), toIso(0, h * CS)];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of cornerPts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    minY -= maxLift; // peaks rise upward in screen space
    const ox = minX, oy = minY;
    const tw = Math.ceil(maxX - minX), th = Math.ceil(maxY - minY);

    const cvs = document.createElement('canvas');
    cvs.width = tw;
    cvs.height = th;
    const ctx = cvs.getContext('2d')!;
    // Normalize light once; N·L in world-grid X/Y (not iso).
    const llen = Math.hypot(LIGHT_DIR_X, LIGHT_DIR_Y, LIGHT_DIR_Z) || 1;
    const lx = LIGHT_DIR_X / llen;
    const ly = LIGHT_DIR_Y / llen;
    const lz = LIGHT_DIR_Z / llen;

    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const height = this.heightGrid[gy * w + gx];
        const wx = gx * CS;
        const wy = gy * CS;
        const dither = this.hash11(gx * 7919 + gy * 6271);
        const biomeIdx = getBiomeIndex(height, dither);
        const pat = patterns[biomeIdx];

        // Iso diamond with elevation lift
        const c0 = toIsoElev(wx, wy, height);
        const c1 = toIsoElev(wx + CS, wy, height);
        const c2 = toIsoElev(wx + CS, wy + CS, height);
        const c3 = toIsoElev(wx, wy + CS, height);

        const path = () => {
          ctx.beginPath();
          ctx.moveTo(c0.x - ox, c0.y - 0.5 - oy);
          ctx.lineTo(c1.x + 0.5 - ox, c1.y - oy);
          ctx.lineTo(c2.x - ox, c2.y + 0.5 - oy);
          ctx.lineTo(c3.x - 0.5 - ox, c3.y - oy);
          ctx.closePath();
        };

        path();
        ctx.fillStyle = pat ?? '#3c3c32';
        ctx.fill();

        // Central-diff normal from unitless height 0–1
        const hL = gx > 0 ? this.heightGrid[gy * w + (gx - 1)] : height;
        const hR = gx < w - 1 ? this.heightGrid[gy * w + (gx + 1)] : height;
        const hU = gy > 0 ? this.heightGrid[(gy - 1) * w + gx] : height;
        const hD = gy < h - 1 ? this.heightGrid[(gy + 1) * w + gx] : height;
        const nx = -(hR - hL) * 0.5 * NORMAL_STRENGTH;
        const ny = -(hD - hU) * 0.5 * NORMAL_STRENGTH;
        const nz = 1;
        const nlen = Math.hypot(nx, ny, nz) || 1;
        const ndotl = Math.max(0, (nx * lx + ny * ly + nz * lz) / nlen);

        // Absolute Lambertian (not delta-from-flat) — every cell gets shade.
        let lit = LIGHT_AMBIENT + LIGHT_DIFFUSE * ndotl;
        // Height term: below water dark, peaks slightly lifted
        const hTerm = (height - WATER_LEVEL) / Math.max(1e-6, 1 - WATER_LEVEL);
        lit *= 1 + (hTerm - 0.35) * HEIGHT_SHADE;
        lit = Math.max(0.22, Math.min(1.15, lit));

        // Multiply into texture (source-over black α was invisible on photo tiles)
        const s = Math.round(Math.min(255, lit * 255));
        path();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgb(${s},${s},${s})`;
        ctx.fill();

        // Soft warm lift on sun-facing faces only
        if (ndotl > 0.55 && lit > 0.85) {
          const ha = Math.min(0.28, (ndotl - 0.55) * 0.35);
          path();
          ctx.globalCompositeOperation = 'soft-light';
          ctx.fillStyle = `rgba(255,236,180,${ha.toFixed(3)})`;
          ctx.fill();
        }

        ctx.globalCompositeOperation = 'source-over';

        // ── Cliff face side-walls ──────────────────────────────────────
        // Dark shadow polygons where east/south neighbor is lower
        const eastH = gx < w - 1 ? this.heightGrid[gy * w + (gx + 1)] : height;
        const southH = gy < h - 1 ? this.heightGrid[(gy + 1) * w + gx] : height;

        if (eastH < height - 0.01) {
          const diff = height - eastH;
          const cliffAlpha = Math.min(0.55, 0.18 + diff * 1.5);
          const ec0 = toIsoElev(wx + CS, wy, eastH);
          const ec3 = toIsoElev(wx + CS, wy + CS, eastH);
          ctx.beginPath();
          ctx.moveTo(c1.x - ox, c1.y - oy);
          ctx.lineTo(c2.x - ox, c2.y - oy);
          ctx.lineTo(ec3.x - ox, ec3.y - oy);
          ctx.lineTo(ec0.x - ox, ec0.y - oy);
          ctx.closePath();
          ctx.fillStyle = `rgba(0,0,0,${cliffAlpha.toFixed(3)})`;
          ctx.fill();
        }

        if (southH < height - 0.01) {
          const diff = height - southH;
          const cliffAlpha = Math.min(0.55, 0.18 + diff * 1.5);
          const sc0 = toIsoElev(wx, wy + CS, southH);
          const sc1 = toIsoElev(wx + CS, wy + CS, southH);
          ctx.beginPath();
          ctx.moveTo(c3.x - ox, c3.y - oy);
          ctx.lineTo(c2.x - ox, c2.y - oy);
          ctx.lineTo(sc1.x - ox, sc1.y - oy);
          ctx.lineTo(sc0.x - ox, sc0.y - oy);
          ctx.closePath();
          ctx.fillStyle = `rgba(0,0,0,${cliffAlpha.toFixed(3)})`;
          ctx.fill();
        }
      }
    }

    this.scene.textures.addCanvas('_terrainTint', cvs);
    this.visualSprite = this.scene.add.sprite(ox, oy, '_terrainTint').setOrigin(0);
    this.visualSprite.setDepth(-10000);
    if (this.scene.worldLayer) this.scene.worldLayer.add(this.visualSprite);
  }



  getHeightMapData(): Float32Array {
    return this.heightGrid;
  }

  getGridDimensions(): { width: number; height: number; cellSize: number } {
    return {
      width: this.gridWidth,
      height: this.gridHeight,
      cellSize: TERRAIN_CONFIG.CELL_SIZE
    };
  }
  /**
   * Raise all height-grid cells within `radius` world-pixels of (wx, wy)
   * to at least `minHeight`. Call after generateHeightMap() to guarantee
   * dry land at spawn points / bases.
   */
  flattenAroundWorld(wx: number, wy: number, radius: number, minHeight: number): void {
    const cellSize = TERRAIN_CONFIG.CELL_SIZE;
    const gx0 = Math.max(0, Math.floor((wx - radius) / cellSize));
    const gy0 = Math.max(0, Math.floor((wy - radius) / cellSize));
    const gx1 = Math.min(this.gridWidth - 1, Math.ceil((wx + radius) / cellSize));
    const gy1 = Math.min(this.gridHeight - 1, Math.ceil((wy + radius) / cellSize));
    const r2 = radius * radius;
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = gx * cellSize + cellSize / 2;
        const cy = gy * cellSize + cellSize / 2;
        const dx = cx - wx;
        const dy = cy - wy;
        if (dx * dx + dy * dy > r2) continue;
        const idx = gy * this.gridWidth + gx;
        if (this.heightGrid[idx] < minHeight) {
          this.heightGrid[idx] = minHeight;
        }
      }
    }
  }

  destroy(): void {
    if (this.visualSprite) {
      this.visualSprite.destroy();
      this.visualSprite = null;
    }
    if (this.scene.textures.exists('_terrainTint')) {
      this.scene.textures.remove('_terrainTint');
    }
  }
}
