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
