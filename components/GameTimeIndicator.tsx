import React, { useEffect, useMemo, useState } from 'react';
import type Phaser from 'phaser';
import { Moon, Sun, Sunrise, Sunset } from 'lucide-react';

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

function iconForDaypart(daypart: Daypart, className: string) {
  switch (daypart) {
    case 'Dawn':
      return <Sunrise size={18} className={className} strokeWidth={1.8} />;
    case 'Dusk':
      return <Sunset size={18} className={className} strokeWidth={1.8} />;
    case 'Night':
      return <Moon size={17} className={className} strokeWidth={1.8} />;
    default:
      return <Sun size={18} className={className} strokeWidth={1.8} />;
  }
}

const DAYPART_THEME: Record<Daypart, {
  accent: string;
  glow: string;
  label: string;
}> = {
  Dawn: {
    accent: 'text-orange-300',
    glow: 'rgba(251,146,60,0.24)',
    label: 'text-orange-200/70',
  },
  Morning: {
    accent: 'text-amber-300',
    glow: 'rgba(251,191,36,0.22)',
    label: 'text-amber-100/70',
  },
  Midday: {
    accent: 'text-yellow-200',
    glow: 'rgba(254,240,138,0.18)',
    label: 'text-yellow-50/70',
  },
  Afternoon: {
    accent: 'text-amber-300',
    glow: 'rgba(245,158,11,0.20)',
    label: 'text-amber-100/70',
  },
  Dusk: {
    accent: 'text-orange-300',
    glow: 'rgba(249,115,22,0.24)',
    label: 'text-orange-100/70',
  },
  Night: {
    accent: 'text-sky-300',
    glow: 'rgba(56,189,248,0.18)',
    label: 'text-sky-100/65',
  },
};

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
  const theme = DAYPART_THEME[daypart];
  const progress = (((clock.hour % 24) + 24) % 24) / 24;
  const daylight = daypart !== 'Night';

  const celestialY = useMemo(() => {
    const elevation = Math.max(0, Math.min(1, clock.sunElevation));
    return 12 - elevation * 8;
  }, [clock.sunElevation]);

  return (
    <div
      className="absolute top-6 left-6 z-30 pointer-events-none select-none"
      aria-label={`Game time ${formatGameClock(clock.hour)}, ${daypart}`}
    >
      <div
        className="relative w-[208px] overflow-hidden rounded-2xl border border-white/[0.11] bg-[#090a0c]/90 px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.38)] backdrop-blur-xl"
        style={{ boxShadow: `0 18px 50px rgba(0,0,0,0.38), 0 0 28px ${theme.glow}` }}
      >
        <div
          className="absolute inset-x-0 top-0 h-px opacity-80"
          style={{
            background: daylight
              ? 'linear-gradient(90deg, transparent, rgba(251,191,36,0.7), transparent)'
              : 'linear-gradient(90deg, transparent, rgba(125,211,252,0.55), transparent)',
          }}
        />
        <div
          className="absolute -right-7 -top-9 h-24 w-24 rounded-full blur-2xl"
          style={{ background: theme.glow }}
        />

        <div className="relative flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.055] ${theme.accent}`}>
              {iconForDaypart(daypart, theme.accent)}
            </div>
            <div className="min-w-0">
              <div className={`text-[9px] font-semibold uppercase tracking-[0.22em] ${theme.label}`}>
                {daypart}
              </div>
              <div className="mt-0.5 font-mono text-[19px] font-semibold leading-none tracking-[0.04em] text-stone-50 tabular-nums">
                {formatGameClock(clock.hour)}
              </div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-[8px] font-semibold uppercase tracking-[0.18em] text-stone-500">Day cycle</div>
            <div className="mt-1 text-[9px] font-medium text-stone-400">
              {daylight ? `${Math.round(clock.sunIntensity * 100)}% sun` : 'Moonlit'}
            </div>
          </div>
        </div>

        <div className="relative mt-3 h-[14px]">
          <div
            className="absolute left-0 right-0 top-[6px] h-[2px] rounded-full opacity-75"
            style={{
              background: 'linear-gradient(90deg, #172033 0%, #402b30 18%, #d88b42 27%, #f8dc8d 50%, #d97938 73%, #352b3d 82%, #142038 100%)',
            }}
          />
          <div className="absolute left-[24.8%] top-[3px] h-2 w-px bg-white/20" />
          <div className="absolute left-1/2 top-[3px] h-2 w-px bg-white/20" />
          <div className="absolute left-[74.8%] top-[3px] h-2 w-px bg-white/20" />

          <div
            className="absolute z-10 h-3 w-3 -translate-x-1/2 rounded-full border border-white/70 shadow-[0_0_10px_currentColor] transition-[left,top,color] duration-150 ease-linear"
            style={{
              left: `${progress * 100}%`,
              top: `${celestialY - 6}px`,
              color: daylight ? '#fbbf24' : '#7dd3fc',
              background: daylight ? '#fde68a' : '#dbeafe',
            }}
          />
        </div>

        <div className="mt-0.5 flex justify-between text-[7px] font-medium uppercase tracking-[0.14em] text-stone-600">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      </div>
    </div>
  );
};
