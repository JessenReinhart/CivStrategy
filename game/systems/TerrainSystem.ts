
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
      CELL_SIZE: CS, BIOMES, TEX_PERIOD,
      LIGHT_DIR_X, LIGHT_DIR_Y, LIGHT_DIR_Z,
      LIGHT_AMBIENT, LIGHT_DIFFUSE, NORMAL_STRENGTH, HEIGHT_SHADE,
      WATER_LEVEL,
    } = TERRAIN_CONFIG;
    const w = this.gridWidth;
    const h = this.gridHeight;
    const src = this.scene.textures;
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
      cctx.drawImage(img, 0, 0, sw, sh, 0, 0, period, period);
      return cctx.createPattern(c, 'repeat')!;
    });

    // (getBiomeIndex removed — terrain uses marching-squares contours instead)

    for (let i = 0; i < w * h; i++) {
      const hgt = this.heightGrid[i];
      if (hgt > maxGridHeight) maxGridHeight = hgt;
    }
    const maxLift = Math.max(0, maxGridHeight - WATER_LEVEL) * TERRAIN_CONFIG.HEIGHT_LIFT;

    // Iso AABB — expand upward for elevation lift
    const cornerPts = [toIso(0, 0), toIso(w * CS, 0), toIso(w * CS, h * CS), toIso(0, h * CS)];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of cornerPts) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    minY -= maxLift;
    const ox = minX, oy = minY;
    const tw = Math.ceil(maxX - minX), th = Math.ceil(maxY - minY);

    const cvs = document.createElement('canvas');
    cvs.width = tw;
    cvs.height = th;
    const ctx = cvs.getContext('2d')!;

    // Normalize light once
    const llen = Math.hypot(LIGHT_DIR_X, LIGHT_DIR_Y, LIGHT_DIR_Z) || 1;
    const lx = LIGHT_DIR_X / llen;
    const ly = LIGHT_DIR_Y / llen;
    const lz = LIGHT_DIR_Z / llen;

    // ────────────────────────────────────────────────────────────────────
    // Phase 1: Marching-squares terrain contours for each biome boundary.
    // For each biome threshold, generate MS polys for cells above that threshold.
    // Draw higher biomes first (stone on top), lower ones fill the gaps below.
    // ────────────────────────────────────────────────────────────────────
    const sample = (wx: number, wy: number) => this.getHeightInterpolated(wx, wy);
    const edgePt = (
      ax: number, ay: number, ha: number,
      bx: number, by: number, hb: number,
      level: number
    ) => {
      const t = (level - ha) / (hb - ha || 1e-6);
      return toIsoElev(ax + (bx - ax) * t, ay + (by - ay) * t, level);
    };

    // Biome thresholds in ascending order (sand → grass → forest → scrub → stone)
    // Draw lowest first so higher biomes paint on top.
    for (let bi = 1; bi < biomes.length; bi++) {
      const pat = patterns[bi];
      // Skip water biome (index 0) and anything below it
      if (bi === 0) continue;
      if (!pat) continue;

      // Expand AABB for each poly
      let biMinX = Infinity, biMinY = Infinity, biMaxX = -Infinity, biMaxY = -Infinity;
      const biPolys: { pts: { x: number; y: number }[] }[] = [];

      for (let gy = 0; gy < h; gy++) {
        for (let gx = 0; gx < w; gx++) {
          const wx = gx * CS;
          const wy = gy * CS;
          const h0 = sample(wx, wy);
          const h1 = sample(wx + CS, wy);
          const h2 = sample(wx + CS, wy + CS);
          const h3 = sample(wx, wy + CS);
          const m0 = h0 >= level ? 1 : 0;
          const m1 = h1 >= level ? 1 : 0;
          const m2 = h2 >= level ? 1 : 0;
          const m3 = h3 >= level ? 1 : 0;
          const mask = m0 | (m1 << 1) | (m2 << 2) | (m3 << 3);
          if (mask === 0) continue;

          // Edge interpolations at this threshold level
          const e0 = () => edgePt(wx, wy, h0, wx + CS, wy, h1, level);
          const e1 = () => edgePt(wx + CS, wy, h1, wx + CS, wy + CS, h2, level);
          const e2 = () => edgePt(wx + CS, wy + CS, h2, wx, wy + CS, h3, level);
          const e3 = () => edgePt(wx, wy + CS, h3, wx, wy, h0, level);

          // Corner iso positions — use max(actual, level) so all corners in a
          // boundary cell lift to at least the threshold, preventing seams.
          const c0 = toIsoElev(wx, wy, Math.max(h0, level));
          const c1 = toIsoElev(wx + CS, wy, Math.max(h1, level));
          const c2 = toIsoElev(wx + CS, wy + CS, Math.max(h2, level));
          const c3 = toIsoElev(wx, wy + CS, Math.max(h3, level));

          let pts: { x: number; y: number }[];
          // Saddle cases: two separate tris
          if (mask === 5) {
            const a = [c0, e0(), e3()]; const b = [c2, e1(), e2()];
            biPolys.push({ pts: a }); biPolys.push({ pts: b });
            for (const p of a) { if (p.x < biMinX) biMinX = p.x; if (p.x > biMaxX) biMaxX = p.x; if (p.y < biMinY) biMinY = p.y; if (p.y > biMaxY) biMaxY = p.y; }
            for (const p of b) { if (p.x < biMinX) biMinX = p.x; if (p.x > biMaxX) biMaxX = p.x; if (p.y < biMinY) biMinY = p.y; if (p.y > biMaxY) biMaxY = p.y; }
            continue;
          }
          if (mask === 10) {
            const a = [c1, e0(), e1()]; const b = [c3, e2(), e3()];
            biPolys.push({ pts: a }); biPolys.push({ pts: b });
            for (const p of a) { if (p.x < biMinX) biMinX = p.x; if (p.x > biMaxX) biMaxX = p.x; if (p.y < biMinY) biMinY = p.y; if (p.y > biMaxY) biMaxY = p.y; }
            for (const p of b) { if (p.x < biMinX) biMinX = p.x; if (p.x > biMaxX) biMaxX = p.x; if (p.y < biMinY) biMinY = p.y; if (p.y > biMaxY) biMaxY = p.y; }
            continue;
          }

          switch (mask) {
            case 1:  pts = [c0, e0(), e3()]; break;
            case 2:  pts = [c1, e1(), e0()]; break;
            case 3:  pts = [c0, c1, e1(), e3()]; break;
            case 4:  pts = [c2, e2(), e1()]; break;
            case 6:  pts = [c1, c2, e2(), e0()]; break;
            case 7:  pts = [c0, c1, c2, e2(), e3()]; break;
            case 8:  pts = [c3, e3(), e2()]; break;
            case 9:  pts = [c0, e0(), e2(), c3]; break;
            case 11: pts = [c0, c1, e1(), e2(), c3]; break;
            case 12: pts = [c2, c3, e3(), e1()]; break;
            case 13: pts = [c0, e0(), e1(), c2, c3]; break;
            case 14: pts = [c1, c2, c3, e3(), e0()]; break;
            default: pts = [c0, c1, c2, c3]; break; // 15 full cell
          }
          biPolys.push({ pts });
          for (const p of pts) {
            if (p.x < biMinX) biMinX = p.x; if (p.x > biMaxX) biMaxX = p.x;
            if (p.y < biMinY) biMinY = p.y; if (p.y > biMaxY) biMaxY = p.y;
          }
        }
      }

      // Draw this biome's contour polys as one batch
      if (biPolys.length > 0) {
        // Batch: set pattern once, draw all polys for this biome
        ctx.save();
        ctx.fillStyle = pat;
        for (const poly of biPolys) {
          ctx.beginPath();
          const p0 = poly.pts[0];
          ctx.moveTo(p0.x - ox, p0.y - oy);
          for (let pi = 1; pi < poly.pts.length; pi++) {
            ctx.lineTo(poly.pts[pi].x - ox, poly.pts[pi].y - oy);
          }
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // Phase 2: Per-cell N·L lighting + cliff faces (diamond-based, same as before)
    // This gives directional shading and elevation shadows.
    // ────────────────────────────────────────────────────────────────────
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const height = this.heightGrid[gy * w + gx];
        const wx = gx * CS;
        const wy = gy * CS;

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

        let lit = LIGHT_AMBIENT + LIGHT_DIFFUSE * ndotl;
        const hTerm = (height - WATER_LEVEL) / Math.max(1e-6, 1 - WATER_LEVEL);
        lit *= 1 + (hTerm - 0.35) * HEIGHT_SHADE;
        lit = Math.max(0.22, Math.min(1.15, lit));

        const s = Math.round(Math.min(255, lit * 255));
        path();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgb(${s},${s},${s})`;
        ctx.fill();

        // Soft warm lift on sun-facing faces
        if (ndotl > 0.55 && lit > 0.85) {
          const ha = Math.min(0.28, (ndotl - 0.55) * 0.35);
          path();
          ctx.globalCompositeOperation = 'soft-light';
          ctx.fillStyle = `rgba(255,236,180,${ha.toFixed(3)})`;
          ctx.fill();
        }

        ctx.globalCompositeOperation = 'source-over';

        // ── Cliff face side-walls ──────────────────────────────────────
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
