import type { VillagerData } from '../../types';
import { WORLD_CHARACTER_SCALE } from '../worldScale';

const VILLAGER_BASE_SPRITE_SCALE = 0.22;

/**
 * Apply the shared human presentation scale without mutating authoritative
 * villager state, movement, work assignment, pathing, or economy behavior.
 */
export function applyVillagerPresentationScale(villager: VillagerData | undefined): void {
  if (!villager?.visual) return;

  const sprite = villager.visual.getData('villagerSprite') as
    | { setScale?: (scale: number) => unknown }
    | undefined;
  sprite?.setScale?.(VILLAGER_BASE_SPRITE_SCALE * WORLD_CHARACTER_SCALE);

  const shadow = villager.visual.list?.[0] as
    | { setScale?: (scale: number) => unknown }
    | undefined;
  shadow?.setScale?.(WORLD_CHARACTER_SCALE);
}
