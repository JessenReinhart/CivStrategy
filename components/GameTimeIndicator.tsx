import React, { useEffect, useState } from 'react';
import type Phaser from 'phaser';

interface GameTimeIndicatorProps {
  gameInstance: Phaser.Game | null;
}

interface ClockSnapshot {
  hour: number;
  sunElevation: number;
  sunIntensity: number;
}

type Daypart = 'Dawn' | 'Morning' | 'Midday' | 'Afternoon' | 'Dusk' | 'Night';

const EMPTY_CLOCK: ClockSnapshot = {
  hour: 8,
  sunElevation: 0.5,
  sunIntensity: 0.5,
};

function getDaypart(hour: number): Daypart {
  if (hour >= 5 && hour < 7.5) return 'Dawn';
  if (hour >= 7.5 && hour < 11.5) return 'Morning';
  if (hour >= 11.5 && hour < 14.5) return 'Midday';
  if (hour >= 14.5 && hour < 17.5) return 'Afternoon';
  if (hour >= 17.5 && hour < 19.5) return 'Dusk';
  return 'Night';
}

function formatGameClock(hour: number): string {
  const safeHour = ((hour % 24) + 24) % 24;
  const wholeHour = Math.floor(safeHour);
  const minute = Math.floor((safeHour - wholeHour) * 60);
  return `${wholeHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

export const GameTimeIndicator: React.FC<GameTimeIndicatorProps> = ({ gameInstance }) => {
  const [clock, setClock] = useState<ClockSnapshot>(EMPTY_CLOCK);

  useEffect(() => {
    if (!gameInstance) return;

    const sync = () => {
      const scene = gameInstance.scene.getScene('MainScene') as Phaser.Scene & {
        dayNightSystem?: {
          getState?: () => ClockSnapshot;
        };
      };
      const state = scene?.dayNightSystem?.getState?.();
      if (!state) return;

      setClock(previous => {
        if (
          Math.abs(previous.hour - state.hour) < 0.002
          && Math.abs(previous.sunElevation - state.sunElevation) < 0.004
          && Math.abs(previous.sunIntensity - state.sunIntensity) < 0.004
        ) {
          return previous;
        }
        return {
          hour: state.hour,
          sunElevation: state.sunElevation,
          sunIntensity: state.sunIntensity,
        };
      });
    };

    sync();
    const timer = window.setInterval(sync, 125);
    return () => window.clearInterval(timer);
  }, [gameInstance]);

  const daypart = getDaypart(clock.hour);
  const progress = (((clock.hour % 24) + 24) % 24) / 24;
  const daylight = daypart !== 'Night';

  return (
    <div
      className="hud-clock absolute top-6 left-6 z-30 pointer-events-none select-none flex flex-col justify-center w-[125px]"
      aria-label={`Game time ${formatGameClock(clock.hour)}, ${daypart}`}
    >
      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#7b7c77] flex items-center gap-1.5 leading-none select-none">
        <span>{daypart}</span>
        <span>•</span>
        <span>{daylight ? `${Math.round(clock.sunIntensity * 100)}% SUN` : 'MOONLIT'}</span>
      </div>

      <div className="text-[22px] font-bold tracking-tight text-[#f3f3f1] font-sans leading-none my-1 tabular-nums select-none">
        {formatGameClock(clock.hour)}
      </div>

      <div className="relative w-full h-[2px] bg-[#625c51]/60 rounded-full mt-0.5">
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#fff1c2] shadow-[0_0_8px_#ffe494,0_0_2px_#fff]"
          style={{ left: `${progress * 100}%` }}
        />
      </div>

      <div className="flex justify-between text-[7px] font-mono text-[#727270] tracking-wider mt-1 select-none">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
};
