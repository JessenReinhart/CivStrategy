
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { Noise } from '../utils/Noise';
import { TERRAIN_CONFIG } from '../../constants';
import { TerrainModifiers, SlopeInfo } from '../../types';
import { toIso } from '../utils/iso';

export class TerrainSystem {
  private scene: MainScene;
  private heightGrid: Float32Array;
  private gridWidth: number;
  private gridHeight: number;
  private noise: Noise;
  private visualGraphics!: Phaser.GameObjects.Graphics;

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

    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        // World position at center of this grid cell
        const wx = gx * TERRAIN_CONFIG.CELL_SIZE + TERRAIN_CONFIG.CELL_SIZE / 2;
        const wy = gy * TERRAIN_CONFIG.CELL_SIZE + TERRAIN_CONFIG.CELL_SIZE / 2;

        // Multi-octave Perlin noise
        const base = this.noise.perlin2(wx * baseScale, wy * baseScale);
        const detail = this.noise.perlin2(wx * detailScale, wy * detailScale) * 0.3;

        // Combine, shift from [-1,1] to [0,1]
        let height = (base + detail) * 0.5 + 0.5;
        height = Phaser.Math.Clamp(height, 0, 1);

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
    const hForward = this.getHeightInterpolated(wx + 8, wy + 8);

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

  applyVisualTinting(): void {
    // Draw terrain height as colored ground overlay
    if (this.visualGraphics) {
      this.visualGraphics.destroy();
    }

    this.visualGraphics = this.scene.add.graphics();
    this.visualGraphics.setDepth(-10000); // Below trees, above ground layer
    if (this.scene.worldLayer) this.scene.worldLayer.add(this.visualGraphics);

    const cellSize = TERRAIN_CONFIG.CELL_SIZE;
    const w = this.gridWidth;
    const h = this.gridHeight;
    const { VALLEY_COLOR: vc, PEAK_COLOR: pc, TINT_ALPHA_MIN: aMin, TINT_ALPHA_MAX: aMax, SLOPE_TINT: slopeK } = TERRAIN_CONFIG;

    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const idx = gy * w + gx;
        const height = this.heightGrid[idx];
        const wx = gx * cellSize;
        const wy = gy * cellSize;

        // Height -> [0,1] elevation factor
        const t = (height - TERRAIN_CONFIG.MIN_HEIGHT) / (TERRAIN_CONFIG.MAX_HEIGHT - TERRAIN_CONFIG.MIN_HEIGHT);

        // Base hue tracks elevation: cool shadowed lowland -> warm sunlit highland
        let r = vc.r + (pc.r - vc.r) * t;
        let g = vc.g + (pc.g - vc.g) * t;
        let b = vc.b + (pc.b - vc.b) * t;

        // Slope shading: a cell higher than its neighbours reads as lit/convex;
        // lower reads as shaded. Gives 3D relief instead of a flat green sheet.
        const n = (
          (gx > 0 ? this.heightGrid[idx - 1] : height) +
          (gx < w - 1 ? this.heightGrid[idx + 1] : height) +
          (gy > 0 ? this.heightGrid[idx - w] : height) +
          (gy < h - 1 ? this.heightGrid[idx + w] : height)
        ) * 0.25;
        const shade = Math.max(0.6, Math.min(1.4, 1 + (height - n) * slopeK));
        r = Math.min(255, Math.floor(r * shade));
        g = Math.min(255, Math.floor(g * shade));
        b = Math.min(255, Math.floor(b * shade));

        // Contiguous iso-quad per cell; adjacent cells share exact corners so the
        // tint tiles seamlessly (no discrete ellipse/rect shapes).
        const c0 = toIso(wx, wy);
        const c1 = toIso(wx + cellSize, wy);
        const c2 = toIso(wx + cellSize, wy + cellSize);
        const c3 = toIso(wx, wy + cellSize);
        const alpha = aMin + (aMax - aMin) * t; // subtle, height-weighted shade
        const color = Phaser.Display.Color.GetColor(r, g, b);

        this.visualGraphics.fillStyle(color, alpha);
        this.visualGraphics.beginPath();
        this.visualGraphics.moveTo(c0.x, c0.y);
        this.visualGraphics.lineTo(c1.x, c1.y);
        this.visualGraphics.lineTo(c2.x, c2.y);
        this.visualGraphics.lineTo(c3.x, c3.y);
        this.visualGraphics.closePath();
        this.visualGraphics.fillPath();
      }
    }
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

  destroy(): void {
    if (this.visualGraphics) {
      this.visualGraphics.destroy();
    }
  }
}
