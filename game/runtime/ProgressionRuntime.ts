import type { ProgressionContext } from './ProgressionContext';
import { CASTLE_GARRISON_FIRE_INTERVAL, SEASON_DURATION_MS } from '../../constants';

/**
 * Coordinates the time-based progression pipeline without depending on
 * MainScene: the 1s economy/research/victory/season/world-maintenance window,
 * the 8s population window, the seasonal clock, the garrison fire interval,
 * the auto-save cadence, and per-frame age advancement progress.
 *
 * Cadence decisions and ordering live here; all scene-specific side effects
 * are delegated through {ProgressionServices}. Frame counters that are not
 * part of the serialized episode stay in this module; `seasonTimer` remains
 * scene-owned (it is serialized) and is read/written through the service.
 */
export class ProgressionRuntime {
  private accumulatedTime = 0; // 1s window accumulator (game-scaled dt)
  private accumulatedPopTime = 0; // 8s population window accumulator
  private autoSaveTickCounter = 0;
  private lastGarrisonFireTime = 0;

  update(context: ProgressionContext): void {
    const { services, now, dt } = context;

    // Non-critical systems are skipped entirely in stress mode.
    if (services.isStressMode) return;

    this.accumulatedTime += dt;

    // ── 1s economy/progression window ───────────────────────────────
    if (this.accumulatedTime >= 1000) {
      this.accumulatedTime -= 1000;

      // Win/lose + dominance (the checks themselves early-return when the
      // game is no longer PLAYING).
      services.victory.check();

      if (services.session.isPlaying) {
        services.economy.tick();
        services.research.tick(1000);
        services.economy.assignJobs();
      }

      // Seasonal clock (1-second tick aligned with economy). The scene owns
      // the (serialized) seasonTimer storage; the runtime owns the cadence.
      const seasonMs = services.season.elapsed + 1000;
      if (seasonMs >= SEASON_DURATION_MS) {
        services.season.change();
        services.season.setElapsed(seasonMs - SEASON_DURATION_MS);
      } else {
        services.season.setElapsed(seasonMs);
      }

      // Respawn depleted gold mines (runs regardless of game state).
      services.world.respawnGoldMines(now);

      // Castle garrison firing, clamped to its own 3s interval.
      if (services.session.isPlaying && now - this.lastGarrisonFireTime >= CASTLE_GARRISON_FIRE_INTERVAL) {
        this.lastGarrisonFireTime = now;
        services.world.fireGarrison();
      }

      // Auto-save every 60 seconds.
      this.autoSaveTickCounter++;
      if (this.autoSaveTickCounter >= 60) {
        this.autoSaveTickCounter = 0;
        services.autoSave.save();
      }
    }

    // ── Per-frame progression while playing ─────────────────────────
    if (services.session.isPlaying) {
      this.accumulatedPopTime += dt;
      if (this.accumulatedPopTime >= 8000) {
        this.accumulatedPopTime -= 8000;
        services.population.tick();
      }

      // Age advancement progress ticking (player only).
      if (services.age.isAdvancing && services.age.nextAge) {
        services.age.progress(dt);
      }
    }
  }
}
