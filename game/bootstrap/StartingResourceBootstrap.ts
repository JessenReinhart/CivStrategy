import type { MainScene } from '../MainScene';

/**
 * Recreate deterministic starting resource nodes for both factions before a
 * pending save is hydrated. SaveSystem restores finite node state by matching
 * generated coordinates, so skipping one faction here would silently remove
 * that side's resource nodes after reload.
 */
export function spawnStartingResourceNodes(
  scene: MainScene,
  playerX: number,
  playerY: number,
): void {
  scene.mapGenerationSystem.spawnStartingForest(playerX, playerY);
  scene.mapGenerationSystem.spawnStartingGoldMines(playerX, playerY);
  scene.mapGenerationSystem.spawnStartingForest(scene.enemyAI.baseX, scene.enemyAI.baseY);
  scene.mapGenerationSystem.spawnStartingGoldMines(scene.enemyAI.baseX, scene.enemyAI.baseY);
}
