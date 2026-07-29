
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

        this.heightGrid[gy * w + gx] = height;

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
    const period = Math.max(32, TEX_PERIOD ?? 256);
    const textureKeys = ['terrain_sand', 'terrain_grass', 'terrain_forest', 'terrain_scrub', 'terrain_stone'];

    // Prefer Phaser source image; fall back to solid biome color so canvas never goes blank.
    const patterns: (CanvasPattern | string | null)[] = BIOMES.map((b, i) => {
      if (i === 0) return null;
      const fallback = `rgb(${b.color.r},${b.color.g},${b.color.b})`;
      const key = textureKeys[i - 1];
      if (!src.exists(key)) return fallback;
      const tex = src.get(key);
      // Phaser 3: Texture.getSourceImage() is the correct API; .image may be undefined on some builds.
      const img = (typeof (tex as { getSourceImage?: () => CanvasImageSource }).getSourceImage === 'function'
        ? (tex as { getSourceImage: () => CanvasImageSource }).getSourceImage()
        : (tex as { image?: CanvasImageSource }).image) as HTMLImageElement | HTMLCanvasElement | undefined;
      if (!img) return fallback;
      const sw = ('naturalWidth' in img ? (img as HTMLImageElement).naturalWidth : 0) || img.width || period;
      const sh = ('naturalHeight' in img ? (img as HTMLImageElement).naturalHeight : 0) || img.height || period;
      const c = document.createElement('canvas');
      c.width = period;
      c.height = period;
      const cctx = c.getContext('2d')!;
      cctx.imageSmoothingEnabled = true;
      cctx.imageSmoothingQuality = 'high';
      cctx.drawImage(img, 0, 0, sw, sh, 0, 0, period, period);
      return cctx.createPattern(c, 'repeat') ?? fallback;
    });

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

    let maxGridHeight = 0;
    for (let i = 0; i < w * h; i++) {
      const hgt = this.heightGrid[i];
      if (hgt > maxGridHeight) maxGridHeight = hgt;
    }
    const maxLift = Math.max(0, maxGridHeight - WATER_LEVEL) * TERRAIN_CONFIG.HEIGHT_LIFT;

    const cornerPts = [toIso(0, 0), toIso(w * CS, 0), toIso(w * CS, h * CS), toIso(0, h * CS)];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of cornerPts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    minY -= maxLift;
    const ox = minX, oy = minY;
    const tw = Math.ceil(maxX - minX), th = Math.ceil(maxY - minY);

    const cvs = document.createElement('canvas');
    cvs.width = tw;
    cvs.height = th;
    const ctx = cvs.getContext('2d')!;

    const llen = Math.hypot(LIGHT_DIR_X, LIGHT_DIR_Y, LIGHT_DIR_Z) || 1;
    const lx = LIGHT_DIR_X / llen;
    const ly = LIGHT_DIR_Y / llen;
    const lz = LIGHT_DIR_Z / llen;

    // Per-cell diamonds with bilinear corner heights (shared edges → smooth surface).
    // Biome from cell center height — multi-biome, no stacked-MS wash.
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const height = this.heightGrid[gy * w + gx];
        if (height < WATER_LEVEL) continue;

        const wx = gx * CS;
        const wy = gy * CS;
        const h0 = this.getHeightInterpolated(wx, wy);
        const h1 = this.getHeightInterpolated(wx + CS, wy);
        const h2 = this.getHeightInterpolated(wx + CS, wy + CS);
        const h3 = this.getHeightInterpolated(wx, wy + CS);

        const dither = this.hash11(gx * 7919 + gy * 6271);
        const biomeIdx = getBiomeIndex(height, dither);
        const bi = Math.max(1, biomeIdx);
        const pat = patterns[biomeIdx] ?? `rgb(${BIOMES[bi].color.r},${BIOMES[bi].color.g},${BIOMES[bi].color.b})`;

        const c0 = toIsoElev(wx, wy, h0);
        const c1 = toIsoElev(wx + CS, wy, h1);
        const c2 = toIsoElev(wx + CS, wy + CS, h2);
        const c3 = toIsoElev(wx, wy + CS, h3);

        const path = () => {
          ctx.beginPath();
          ctx.moveTo(c0.x - ox, c0.y - oy);
          ctx.lineTo(c1.x - ox, c1.y - oy);
          ctx.lineTo(c2.x - ox, c2.y - oy);
          ctx.lineTo(c3.x - ox, c3.y - oy);
          ctx.closePath();
        };

        path();
        ctx.fillStyle = pat as string | CanvasPattern;
        ctx.fill();

        const hL = gx > 0 ? this.heightGrid[gy * w + (gx - 1)] : height;
        const hR = gx < w - 1 ? this.heightGrid[gy * w + (gx + 1)] : height;
        const hU = gy > 0 ? this.heightGrid[(gy - 1) * w + gx] : height;
        const hD = gy < h - 1 ? this.heightGrid[(gy + 1) * w + gx] : height;
        const nx = -(hR - hL) * 0.5 * NORMAL_STRENGTH;
        const ny = -(hD - hU) * 0.5 * NORMAL_STRENGTH;
        const nz = 1;
        const nlen = Math.hypot(nx, ny, nz) || 1;
        const ndotl = Math.max(0, (nx * lx + ny * ly + nz * lz) / nlen);

        let lit = LIGHT_AMBIENT + LIGHT_DIFFUSE * ndotl;
        const hTerm = (height - WATER_LEVEL) / Math.max(1e-6, 1 - WATER_LEVEL);
        lit *= 1 + (hTerm - 0.35) * HEIGHT_SHADE;
        lit = Math.max(0.22, Math.min(1.15, lit));

        const s = Math.round(Math.min(255, lit * 255));
        path();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgb(${s},${s},${s})`;
        ctx.fill();

        if (ndotl > 0.55 && lit > 0.85) {
          const ha = Math.min(0.28, (ndotl - 0.55) * 0.35);
          path();
          ctx.globalCompositeOperation = 'soft-light';
          ctx.fillStyle = `rgba(255,236,180,${ha.toFixed(3)})`;
          ctx.fill();
        }

        ctx.globalCompositeOperation = 'source-over';

        const eastH = gx < w - 1 ? this.heightGrid[gy * w + (gx + 1)] : height;
        const southH = gy < h - 1 ? this.heightGrid[(gy + 1) * w + gx] : height;

        if (eastH < height - 0.01) {
          const diff = height - eastH;
          const cliffAlpha = Math.min(0.55, 0.18 + diff * 1.5);
          const eBot0 = toIsoElev(wx + CS, wy, eastH);
          const eBot3 = toIsoElev(wx + CS, wy + CS, eastH);
          ctx.beginPath();
          ctx.moveTo(c1.x - ox, c1.y - oy);
          ctx.lineTo(c2.x - ox, c2.y - oy);
          ctx.lineTo(eBot3.x - ox, eBot3.y - oy);
          ctx.lineTo(eBot0.x - ox, eBot0.y - oy);
          ctx.closePath();
          ctx.fillStyle = `rgba(0,0,0,${cliffAlpha.toFixed(3)})`;
          ctx.fill();
        }

        if (southH < height - 0.01) {
          const diff = height - southH;
          const cliffAlpha = Math.min(0.55, 0.18 + diff * 1.5);
          const sBot0 = toIsoElev(wx, wy + CS, southH);
          const sBot1 = toIsoElev(wx + CS, wy + CS, southH);
          ctx.beginPath();
          ctx.moveTo(c3.x - ox, c3.y - oy);
          ctx.lineTo(c2.x - ox, c2.y - oy);
          ctx.lineTo(sBot1.x - ox, sBot1.y - oy);
          ctx.lineTo(sBot0.x - ox, sBot0.y - oy);
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


  /**
   * Return the biome label at a world coordinate, matching the baked terrain tint.
   * Uses the same dither logic as applyVisualTinting so trees match what the player sees.
   */
  getBiomeAt(wx: number, wy: number): string {
    const h = this.getHeightAt(wx, wy);
    const CS = TERRAIN_CONFIG.CELL_SIZE;
    const gx = Math.floor(wx / CS);
    const gy = Math.floor(wy / CS);
    // Same hash11 as in applyVisualTinting
    const dither = ((gx * 7919 + gy * 6271) * 6271 + 7919) % 10000 / 10000;

    for (let i = 0; i < TERRAIN_CONFIG.BIOMES.length - 1; i++) {
      const lo = TERRAIN_CONFIG.BIOMES[i].minHeight;
      const tLo = lo - TERRAIN_CONFIG.BIOME_DITHER;
      const tHi = lo + TERRAIN_CONFIG.BIOME_DITHER;
      if (h >= tLo && h < tHi) {
        const idx = dither < (h - tLo) / (tHi - tLo) ? i : i + 1;
        return TERRAIN_CONFIG.BIOMES[idx]?.label ?? 'grass';
      }
    }
    if (h < TERRAIN_CONFIG.BIOMES[1].minHeight) return 'deep';
    for (let i = TERRAIN_CONFIG.BIOMES.length - 1; i >= 0; i--) {
      if (h >= TERRAIN_CONFIG.BIOMES[i].minHeight) return TERRAIN_CONFIG.BIOMES[i].label;
    }
    return 'grass';
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
