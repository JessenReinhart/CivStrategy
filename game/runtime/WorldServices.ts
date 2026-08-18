import type { MainScene } from '../MainScene';

/** Capabilities consumed by the world coordinator. */
export interface WorldServices {
  /** Null on non-infinite maps or in stress mode. */
  readonly infiniteMap: { update(): void } | null;

  /** Null in stress mode. */
  readonly minimap: { update(): void } | null;

  /** Null when fog of war is disabled or in stress mode. */
  readonly fogOfWar: { update(): void } | null;
}

/**
 * Temporary scene adapter. This is the only place the world boundary
 * knows how the legacy MainScene-owned systems are assembled.
 *
 * Keep behavior decisions here while the scene is still the source of truth.
 * The runtime should coordinate work, not infer scene-specific modes.
 */
export function createWorldServices(scene: MainScene): WorldServices {
  const isStress = () => !!scene.stressTestConfig;
  return {
    get infiniteMap() {
      return isStress() ? null : scene.infiniteMapSystem;
    },
    get minimap() {
      return isStress() ? null : scene.minimapSystem;
    },
    get fogOfWar() {
      return isStress() ? null : scene.fogOfWar;
    },
  };
}
