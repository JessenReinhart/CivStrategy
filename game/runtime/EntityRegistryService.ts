import type Phaser from 'phaser';

import type { SpatialHash } from '../utils/SpatialHash';

/**
 * Owns the Phaser entity groups and spatial hashes that MainScene used to
 * declare as scattered public fields (Phase 8, A1).
 *
 * Backing fields are public nullable fields assigned during scene bootstrap.
 */
export class EntityRegistryService {
  public units: Phaser.GameObjects.Group | null = null;
  public buildings: Phaser.GameObjects.Group | null = null;
  public trees: Phaser.GameObjects.Group | null = null;
  public treeVisuals: Phaser.GameObjects.Group | null = null;
  public worldVisuals: Phaser.GameObjects.Group | null = null;
  public uiGroup: Phaser.GameObjects.Group | null = null;
  public treeSpatialHash: SpatialHash | null = null;
  public unitSpatialHash: SpatialHash | null = null;

  public init(params?: Partial<{
    units: Phaser.GameObjects.Group | null;
    buildings: Phaser.GameObjects.Group | null;
    trees: Phaser.GameObjects.Group | null;
    treeVisuals: Phaser.GameObjects.Group | null;
    worldVisuals: Phaser.GameObjects.Group | null;
    uiGroup: Phaser.GameObjects.Group | null;
    treeSpatialHash: SpatialHash | null;
    unitSpatialHash: SpatialHash | null;
  }>): void {
    if (!params) return;
    if (params.units !== undefined) this.units = params.units;
    if (params.buildings !== undefined) this.buildings = params.buildings;
    if (params.trees !== undefined) this.trees = params.trees;
    if (params.treeVisuals !== undefined) this.treeVisuals = params.treeVisuals;
    if (params.worldVisuals !== undefined) this.worldVisuals = params.worldVisuals;
    if (params.uiGroup !== undefined) this.uiGroup = params.uiGroup;
    if (params.treeSpatialHash !== undefined) this.treeSpatialHash = params.treeSpatialHash;
    if (params.unitSpatialHash !== undefined) this.unitSpatialHash = params.unitSpatialHash;
  }

  public getUnits(): Phaser.GameObjects.Group {
    return this.units!;
  }

  public getBuildings(): Phaser.GameObjects.Group {
    return this.buildings!;
  }

  public getTrees(): Phaser.GameObjects.Group {
    return this.trees!;
  }

  public getTreeVisuals(): Phaser.GameObjects.Group {
    return this.treeVisuals!;
  }

  public getWorldVisuals(): Phaser.GameObjects.Group {
    return this.worldVisuals!;
  }

  public getUiGroup(): Phaser.GameObjects.Group {
    return this.uiGroup!;
  }

  public getTreeSpatialHash(): SpatialHash {
    return this.treeSpatialHash!;
  }

  public getUnitSpatialHash(): SpatialHash {
    return this.unitSpatialHash!;
  }
}
