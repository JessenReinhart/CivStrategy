export type VillagerCarryCommandPolicy = 'allow' | 'keep-current' | 'defer';

type CarryingVillager = {
  carryAmount: number;
  carryType: string | null;
  jobBuilding?: object;
};

/**
 * A gathered load belongs to the current deposit trip until it reaches a
 * dropsite. Letting another command replace that trip can strand or reinterpret
 * already-gathered resources before they enter the economy.
 */
export function getVillagerCarryCommandPolicy(
  villager: CarryingVillager,
  destinationBuilding: object | null,
): VillagerCarryCommandPolicy {
  if (!(villager.carryAmount > 0) || !villager.carryType) return 'allow';
  if (destinationBuilding && destinationBuilding === villager.jobBuilding) return 'keep-current';
  return 'defer';
}

export interface DropsiteCandidate {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly hp?: number;
}

const DROPSITE_RESOURCE_MAP: Readonly<Record<string, readonly string[]>> = {
  TownCenter: ['wood', 'food', 'stone', 'gold', 'iron'],
  'Town Center': ['wood', 'food', 'stone', 'gold', 'iron'],
  LumberCamp: ['wood'],
  'Lumber Camp': ['wood'],
  HuntersLodge: ['food'],
  "Hunter's Lodge": ['food'],
  Farm: ['food'],
  Quarry: ['stone'],
  IronMine: ['iron'],
  'Iron Mine': ['iron'],
};

/**
 * Checks whether a building type acts as a valid resource drop-off point
 * for the specified resource type.
 */
export function canBuildingAcceptResource(buildingType: string, resourceType: string): boolean {
  const normalizedResource = resourceType.trim().toLowerCase();
  if (!normalizedResource) return false;
  const accepted = DROPSITE_RESOURCE_MAP[buildingType];
  return accepted ? accepted.includes(normalizedResource) : false;
}

/**
 * Selects the nearest living dropsite capable of accepting the villager's
 * carried resource type.
 */
export function findOptimalDropsite(
  villagerX: number,
  villagerY: number,
  carryType: string,
  candidates: readonly DropsiteCandidate[],
): DropsiteCandidate | null {
  let best: DropsiteCandidate | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate.hp !== undefined && candidate.hp <= 0) continue;
    if (!canBuildingAcceptResource(candidate.type, carryType)) continue;
    const dx = candidate.x - villagerX;
    const dy = candidate.y - villagerY;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = candidate;
    }
  }

  return best;
}

/**
 * Formats a concise HUD/tooltip badge for a villager's active resource load.
 */
export function formatVillagerCarryBadge(
  carryType: string | null | undefined,
  carryAmount: number,
): string | null {
  if (!carryType || !(carryAmount > 0)) return null;
  return `+${Math.round(carryAmount)} ${carryType.trim().toUpperCase()}`;
}
