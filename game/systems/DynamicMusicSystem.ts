import Phaser from 'phaser';

import { UnitState, type GameUnit } from '../../types';
import type { MainScene } from '../MainScene';
import { isPlayerEnemyEngagement, MusicStateController, type MusicMode } from './MusicStateController';

const IDLE_MUSIC_PATH = '/assets/audio/music/hearth-of-ashen-oak.mp3';
const BATTLE_MUSIC_PATH = '/assets/audio/music/ravenbanner-march.mp3';
const MUSIC_POLL_INTERVAL_MS = 250;
const MUSIC_CROSSFADE_MS = 1_400;
const IDLE_VOLUME = 0.34;
const BATTLE_VOLUME = 0.4;

type MusicTarget = Phaser.GameObjects.GameObject & {
  active: boolean;
};

/**
 * Returns true only while an opposed unit has reached its ATTACKING state.
 * CHASING alone does not count, so merely spotting or pursuing an enemy does
 * not interrupt the normal soundtrack.
 */
export function hasActiveBattle(units: readonly GameUnit[]): boolean {
  for (const unit of units) {
    if (!unit.active || unit.state !== UnitState.ATTACKING) continue;

    const target = unit.target as MusicTarget | null;
    if (!target?.active) continue;

    const owner = unit.getData('owner');
    const targetOwner = target.getData('owner');
    if (isPlayerEnemyEngagement(owner, targetOwner)) return true;
  }

  return false;
}

/**
 * Streams the two long-form music tracks through HTMLAudioElement and applies
 * a short crossfade when real unit combat starts or settles.
 */
export class DynamicMusicSystem {
  private readonly controller = new MusicStateController();
  private readonly idleTrack: HTMLAudioElement | null;
  private readonly battleTrack: HTMLAudioElement | null;
  private currentMode: MusicMode | null = null;
  private pollEvent: Phaser.Time.TimerEvent | null = null;
  private fadeTween: Phaser.Tweens.Tween | null = null;
  private destroyed = false;

  private readonly unlockAudio = (): void => {
    const activeTrack = this.currentMode === 'battle' ? this.battleTrack : this.idleTrack;
    if (!activeTrack) return;

    const result = activeTrack.play();
    if (result) {
      void result.then(() => this.removeUnlockListeners()).catch(() => undefined);
    }
  };

  constructor(private readonly scene: MainScene) {
    // Keep performance benchmarks deterministic and avoid browser audio in
    // headless environments.
    if (scene.stressTestConfig || typeof Audio === 'undefined') {
      this.idleTrack = null;
      this.battleTrack = null;
      return;
    }

    this.idleTrack = this.createTrack(IDLE_MUSIC_PATH);
    this.battleTrack = this.createTrack(BATTLE_MUSIC_PATH);

    this.installUnlockListeners();
    this.switchMode('idle', true);
    this.pollEvent = scene.time.addEvent({
      delay: MUSIC_POLL_INTERVAL_MS,
      loop: true,
      callback: this.updateMusicState,
      callbackScope: this,
    });

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    scene.events.on(Phaser.Scenes.Events.PAUSE, this.pause, this);
    scene.events.on(Phaser.Scenes.Events.SLEEP, this.pause, this);
    scene.events.on(Phaser.Scenes.Events.RESUME, this.resume, this);
    scene.events.on(Phaser.Scenes.Events.WAKE, this.resume, this);
  }

  private createTrack(src: string): HTMLAudioElement {
    const track = new Audio(src);
    track.loop = true;
    track.preload = 'auto';
    track.volume = 0;
    return track;
  }

  private readonly updateMusicState = (): void => {
    if (this.destroyed) return;

    const units = this.scene.units.getChildren() as GameUnit[];
    const desiredMode = this.controller.resolve(
      this.scene.time.now,
      hasActiveBattle(units),
    );
    this.switchMode(desiredMode);
  };

  private switchMode(mode: MusicMode, immediate = false): void {
    if (!this.idleTrack || !this.battleTrack || this.currentMode === mode) return;

    const previous = this.currentMode === 'battle' ? this.battleTrack : this.idleTrack;
    const next = mode === 'battle' ? this.battleTrack : this.idleTrack;
    const nextVolume = mode === 'battle' ? BATTLE_VOLUME : IDLE_VOLUME;

    if (mode === 'battle') {
      try {
        next.currentTime = 0;
      } catch {
        // Metadata may not be available yet. Playback still starts normally.
      }
    }

    this.tryPlay(next);
    this.fadeTween?.stop();
    this.currentMode = mode;

    if (immediate) {
      this.idleTrack.volume = mode === 'idle' ? IDLE_VOLUME : 0;
      this.battleTrack.volume = mode === 'battle' ? BATTLE_VOLUME : 0;
      if (previous !== next) previous.pause();
      return;
    }

    const previousStart = previous.volume;
    const nextStart = next.volume;
    this.fadeTween = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: MUSIC_CROSSFADE_MS,
      ease: 'Sine.easeInOut',
      onUpdate: (tween) => {
        const progress = tween.getValue() ?? 0;
        previous.volume = Phaser.Math.Linear(previousStart, 0, progress);
        next.volume = Phaser.Math.Linear(nextStart, nextVolume, progress);
      },
      onComplete: () => {
        previous.volume = 0;
        previous.pause();
        next.volume = nextVolume;
        this.fadeTween = null;
      },
    });
  }

  private tryPlay(track: HTMLAudioElement): void {
    try {
      const result = track.play();
      if (result) void result.catch(() => undefined);
    } catch {
      // Browser autoplay policies are handled by the unlock listeners.
    }
  }

  private installUnlockListeners(): void {
    this.scene.game.canvas.addEventListener('pointerdown', this.unlockAudio);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.unlockAudio);
    }
  }

  private removeUnlockListeners(): void {
    this.scene.game.canvas.removeEventListener('pointerdown', this.unlockAudio);
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.unlockAudio);
    }
  }

  private pause(): void {
    this.idleTrack?.pause();
    this.battleTrack?.pause();
  }

  private resume(): void {
    const activeTrack = this.currentMode === 'battle' ? this.battleTrack : this.idleTrack;
    if (activeTrack) this.tryPlay(activeTrack);
  }

  private destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.pollEvent?.remove(false);
    this.pollEvent = null;
    this.fadeTween?.stop();
    this.fadeTween = null;
    this.removeUnlockListeners();

    this.scene.events.off(Phaser.Scenes.Events.PAUSE, this.pause, this);
    this.scene.events.off(Phaser.Scenes.Events.SLEEP, this.pause, this);
    this.scene.events.off(Phaser.Scenes.Events.RESUME, this.resume, this);
    this.scene.events.off(Phaser.Scenes.Events.WAKE, this.resume, this);

    for (const track of [this.idleTrack, this.battleTrack]) {
      if (!track) continue;
      track.pause();
      track.removeAttribute('src');
      track.load();
    }
  }
}
