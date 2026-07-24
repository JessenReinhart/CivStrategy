import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FactionType, MapMode, MapSize } from '../types';
import { Shield, Users, Sword, X } from 'lucide-react';
import gsap from 'gsap';

interface MainMenuProps {
  onStart: (faction: FactionType, mode: MapMode, size: MapSize, fow: boolean, peaceful: boolean, treaty: number, aiDisabled: boolean) => void;
}

type MenuScreen = 'landing' | 'lobby' | 'stress';

// ─── Hermes Design Tokens ───────────────────────────────────────────
const GOLD = '#cba374';
const COPPER = '#a86a42';
const DARK_EARTH = '#0d1514';
const SURFACE = '#151f1d';
const SURFACE_LIGHT = '#1f2b28';
const TEXT_PRIMARY = '#e2ece9';
const TEXT_MUTED = '#8a9ba8';
const TEXT_BODY = '#bccfc9';
const BORDER = '#2a3d38';
const BORDER_GOLD = 'rgba(203, 163, 116, 0.35)';
const GOLD_GLOW = 'rgba(203, 163, 116, 0.15)';
const COPPER_GLOW = 'rgba(168, 106, 66, 0.15)';
// ──────────────────────────────────────────────────────────────────

const FACTION_INFO = {
  [FactionType.ROMANS]: {
    desc: 'Disciplined empire builders. Balanced economy and peerless infantry.',
    bonus: '+10% Gold Generation',
    playStyle: 'Expand methodically. Dominate with Legion might.',
    icon: Shield,
  },
  [FactionType.GAULS]: {
    desc: 'Fierce warriors of the wild. Swift expansion and cheap construction.',
    bonus: '-10% Building Cost',
    playStyle: 'Rush early. Overwhelm before they fortify.',
    icon: Sword,
  },
  [FactionType.CARTHAGE]: {
    desc: 'Masters of trade and sea. Unrivaled population growth and wealth.',
    bonus: '+5 Max Population',
    playStyle: 'Outscale enemies with superior economy.',
    icon: Users,
  },
};

const FACTION_HERMES: Record<
  FactionType,
  { accent: string; border: string; muted: string; glow: string }
> = {
  [FactionType.ROMANS]: {
    accent: GOLD,
    border: BORDER_GOLD,
    muted: TEXT_MUTED,
    glow: GOLD_GLOW,
  },
  [FactionType.GAULS]: {
    accent: COPPER,
    border: 'rgba(168, 106, 66, 0.35)',
    muted: TEXT_MUTED,
    glow: COPPER_GLOW,
  },
  [FactionType.CARTHAGE]: {
    accent: '#C9A227',
    border: 'rgba(201, 162, 39, 0.35)',
    muted: TEXT_MUTED,
    glow: 'rgba(201, 162, 39, 0.12)',
  },
};

const GAMEPLAY_TIPS = [
  { title: 'Economy First', text: 'Build Lumber Camps early. Wood fuels your entire civilization.' },
  { title: 'Feed Your People', text: "Farms and Hunter's Lodges keep your population growing. Starvation halts expansion." },
  { title: 'Tax Wisely', text: 'High taxes generate gold but lower happiness. Keep a balanced rate.' },
  { title: 'Territory Matters', text: 'Bonfires and Town Centers expand your territory. Build them to claim resources.' },
  { title: 'Use Formations', text: 'Line formation boosts attack by 20%. Circle boosts defense by 25%. Adapt to your enemy.' },
  { title: 'Scout Ahead', text: 'Cavalry have the fastest movement. Use them to explore and reveal the fog of war.' },
  { title: 'Happy Citizens', text: 'Build Small Parks to boost happiness. Unhappy citizens produce less.' },
  { title: 'Defensive Stance', text: 'Set units to "Hold" stance to guard chokepoints. They won\'t chase into traps.' },
  { title: 'Barracks Waypoints', text: 'Set a rally point from your Barracks to send fresh troops straight to the frontline.' },
  { title: 'Infinite Realm', text: 'In Infinite mode, the map generates as you explore. No border can contain you.' },
];

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const MainMenu: React.FC<MainMenuProps> = ({ onStart }) => {
  const [menuScreen, setMenuScreen] = useState<MenuScreen>('landing');
  const [selectedFaction, setSelectedFaction] = useState<FactionType>(FactionType.ROMANS);
  const [mapMode, setMapMode] = useState<MapMode>(MapMode.FIXED);
  const [mapSize, setMapSize] = useState<MapSize>(MapSize.MEDIUM);
  const [fowEnabled, setFowEnabled] = useState<boolean>(true);
  const [peacefulMode, setPeacefulMode] = useState<boolean>(false);
  const [treatyLength, setTreatyLength] = useState<number>(10);
  const [aiDisabled, setAiDisabled] = useState<boolean>(false);
  const [stressUnitCount, setStressUnitCount] = useState<number>(500);
  const [stressEnableEnemies, setStressEnableEnemies] = useState<boolean>(false);
  const [tipIndex, setTipIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const landingRef = useRef<HTMLDivElement>(null);
  const lobbyRef = useRef<HTMLDivElement>(null);
  const stressRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const spaceHeldRef = useRef(false);
  const menuScreenRef = useRef<MenuScreen>('landing');
  menuScreenRef.current = menuScreen;

  // Tip carousel
  useEffect(() => {
    const tipInterval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % GAMEPLAY_TIPS.length);
    }, 8000);
    return () => clearInterval(tipInterval);
  }, []);

  // Master screen registry — always-mounted absolute stack; direct crossfades
  useEffect(() => {
    const landing = landingRef.current;
    const lobby = lobbyRef.current;
    const stress = stressRef.current;
    if (!landing || !lobby || !stress) return;

    const reduced = prefersReducedMotion();
    gsap.set([landing, lobby, stress], {
      position: 'absolute',
      inset: 0,
      autoAlpha: 0,
      y: reduced ? 0 : 24,
      pointerEvents: 'none',
    });
    gsap.set(landing, { autoAlpha: 1, y: 0, pointerEvents: 'auto' });

    const tl = gsap.timeline({ paused: true });
    tl.addLabel('landing', 0);
    tl.set(landing, { autoAlpha: 1, y: 0, pointerEvents: 'auto' }, 'landing');
    tl.set([lobby, stress], { autoAlpha: 0, y: 0, pointerEvents: 'none' }, 'landing');

    tl.addLabel('lobby', 1);
    tl.set(lobby, { autoAlpha: 1, y: 0, pointerEvents: 'auto' }, 'lobby');
    tl.set([landing, stress], { autoAlpha: 0, y: 0, pointerEvents: 'none' }, 'lobby');

    tl.addLabel('stress', 2);
    tl.set(stress, { autoAlpha: 1, y: 0, pointerEvents: 'auto' }, 'stress');
    tl.set([landing, lobby], { autoAlpha: 0, y: 0, pointerEvents: 'none' }, 'stress');

    timelineRef.current = tl;
    tl.seek('landing');

    return () => {
      tl.kill();
      timelineRef.current = null;
    };
  }, []);

  // Hermes phenotype dye
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ph = FACTION_HERMES[selectedFaction];
    const reduced = prefersReducedMotion();
    gsap.to(el, {
      duration: reduced ? 0 : 0.6,
      ease: 'power2.out',
      '--phenotype-accent': ph.accent,
      '--phenotype-border': ph.border,
      '--phenotype-muted': ph.muted,
      '--phenotype-glow': ph.glow,
    } as gsap.TweenVars);
  }, [selectedFaction]);

  // Space-hold skip landing -> lobby
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      spaceHeldRef.current = true;
      const t = window.setTimeout(() => {
        if (spaceHeldRef.current && menuScreen === 'landing') {
          handleNavigate('lobby');
        }
      }, 400);
      const clear = () => {
        spaceHeldRef.current = false;
        window.clearTimeout(t);
        window.removeEventListener('keyup', clear);
      };
      window.addEventListener('keyup', clear);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuScreen]);

  const handleNavigate = useCallback((screen: MenuScreen) => {
    const prev = menuScreenRef.current;
    const tl = timelineRef.current;
    const map: Record<MenuScreen, HTMLDivElement | null> = {
      landing: landingRef.current,
      lobby: lobbyRef.current,
      stress: stressRef.current,
    };
    const next = map[screen];
    if (!next) return;

    const prevNode = map[prev];
    const reduced = prefersReducedMotion();
    const dur = reduced ? 0 : 0.55;
    const ease = 'power2.inOut';

    gsap.killTweensOf([landingRef.current, lobbyRef.current, stressRef.current]);

    if (reduced || prev === screen) {
      (['landing', 'lobby', 'stress'] as MenuScreen[]).forEach((s) => {
        const node = map[s];
        if (!node) return;
        const on = s === screen;
        gsap.set(node, { autoAlpha: on ? 1 : 0, y: 0, pointerEvents: on ? 'auto' : 'none' });
      });
    } else {
      (['landing', 'lobby', 'stress'] as MenuScreen[]).forEach((s) => {
        if (s === prev || s === screen) return;
        const node = map[s];
        if (node) gsap.set(node, { autoAlpha: 0, y: 0, pointerEvents: 'none' });
      });
      if (prevNode) {
        gsap.to(prevNode, {
          autoAlpha: 0,
          y: -16,
          pointerEvents: 'none',
          duration: dur,
          ease,
        });
      }
      gsap.fromTo(
        next,
        { autoAlpha: 0, y: 24, pointerEvents: 'none' },
        { autoAlpha: 1, y: 0, pointerEvents: 'auto', duration: dur, ease }
      );
    }

    if (tl) tl.seek(screen);
    menuScreenRef.current = screen;
    setMenuScreen(screen);
  }, []);

  const handleStart = () => {
    onStart(selectedFaction, mapMode, mapSize, fowEnabled, peacefulMode, treatyLength, aiDisabled);
  };

  const handleStressTestStart = () => {
    window.dispatchEvent(
      new CustomEvent('stressTestStart', {
        detail: { unitCount: stressUnitCount, enableEnemies: stressEnableEnemies },
      })
    );
  };

  const ph = FACTION_HERMES[selectedFaction];

  return (
    <div
      ref={containerRef}
      className="relative w-full min-h-screen overflow-hidden"
      style={{
        fontFamily: "'Inter', sans-serif",
        backgroundColor: DARK_EARTH,
        color: TEXT_PRIMARY,
        '--phenotype-accent': ph.accent,
        '--phenotype-border': ph.border,
        '--phenotype-muted': ph.muted,
        '--phenotype-glow': ph.glow,
      } as React.CSSProperties}
    >
      {/* ── Cinematic background: deep vignette + organic texture ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 140% 70% at 50% 25%, rgba(203, 163, 116, 0.04) 0%, transparent 60%),
            radial-gradient(ellipse 60% 40% at 70% 80%, rgba(168, 106, 66, 0.03) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 50%, ${DARK_EARTH} 0%, #070b0a 100%)
          `,
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.025] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='5' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: '200px 200px',
        }}
      />

      {/* ── Subtle gold top-edge glow ── */}
      <div
        className="absolute top-0 left-0 right-0 h-px pointer-events-none"
        style={{
          background: `linear-gradient(90deg, transparent 0%, ${GOLD} 20%, ${GOLD} 80%, transparent 100%)`,
          opacity: 0.4,
        }}
      />

      {/* ═══════════════════════ LANDING ═══════════════════════ */}
      <div
        ref={landingRef}
        className="z-10 w-full h-screen flex flex-col items-center justify-center px-6"
        aria-hidden={menuScreen !== 'landing'}
      >
        {/* Hero section */}
        <div className="mb-12 text-center">
          {/* Decorative top bar */}
          <div
            className="mx-auto mb-8 flex items-center gap-4"
            style={{ width: '280px', maxWidth: '80%' }}
          >
            <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${GOLD})`, opacity: 0.5 }} />
            <div className="w-1 h-1 rotate-45" style={{ backgroundColor: GOLD, opacity: 0.6 }} />
            <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${GOLD}, transparent)`, opacity: 0.5 }} />
          </div>

          <h1
            className="text-5xl md:text-7xl font-bold tracking-[0.06em] leading-none mb-5"
            style={{
              fontFamily: "'Cinzel', serif",
              color: GOLD,
              textShadow: `0 0 40px ${GOLD_GLOW}, 0 0 80px ${GOLD_GLOW}`,
            }}
          >
            CIV STRATEGY
          </h1>

          <p
            className="text-sm md:text-base tracking-[0.3em] uppercase"
            style={{ color: TEXT_MUTED, fontFamily: "'Inter', sans-serif", letterSpacing: '0.3em' }}
          >
            Forge an Empire
          </p>

          {/* Gold divider */}
          <div className="mx-auto mt-6 flex items-center justify-center gap-3" style={{ width: '160px' }}>
            <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${GOLD})`, opacity: 0.3 }} />
            <div className="w-2 h-2 rotate-45" style={{ backgroundColor: GOLD, opacity: 0.5 }} />
            <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${GOLD}, transparent)`, opacity: 0.3 }} />
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-5 mb-20">
          <button
            type="button"
            onClick={() => handleNavigate('lobby')}
            className="group relative px-14 py-4 text-sm font-bold uppercase tracking-[0.22em] transition-all duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              color: GOLD,
              border: '1px solid',
              borderColor: GOLD,
              backgroundColor: 'transparent',
              fontFamily: "'Inter', sans-serif",
              letterSpacing: '0.22em',
              '--tw-ring-color': GOLD,
              '--tw-ring-offset-color': DARK_EARTH,
            } as React.CSSProperties}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = GOLD;
              e.currentTarget.style.color = DARK_EARTH;
              e.currentTarget.style.boxShadow = `0 0 30px ${GOLD_GLOW}, inset 0 0 30px ${GOLD_GLOW}`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = GOLD;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <span className="relative z-10">Start Game</span>
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('stress')}
            className="group relative px-12 py-3.5 text-xs font-semibold uppercase tracking-[0.2em] transition-all duration-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              color: TEXT_MUTED,
              border: '1px solid',
              borderColor: BORDER,
              backgroundColor: 'transparent',
              fontFamily: "'Inter', sans-serif",
              letterSpacing: '0.2em',
              '--tw-ring-color': GOLD,
              '--tw-ring-offset-color': DARK_EARTH,
            } as React.CSSProperties}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = GOLD;
              e.currentTarget.style.color = GOLD;
              e.currentTarget.style.backgroundColor = GOLD_GLOW;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = BORDER;
              e.currentTarget.style.color = TEXT_MUTED;
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            Diagnostics
          </button>
        </div>

        {/* Tips carousel */}
        <div
          className="absolute bottom-12 left-1/2 -translate-x-1/2 w-full max-w-lg px-6 text-center"
          style={{ pointerEvents: 'none' }}
        >
          {/* Tip title */}
          <h3
            className="text-xs font-bold uppercase tracking-[0.25em] mb-3"
            style={{
              fontFamily: "'Cinzel', serif",
              color: GOLD,
              letterSpacing: '0.25em',
            }}
          >
            {GAMEPLAY_TIPS[tipIndex].title}
          </h3>
          <p
            className="text-sm leading-relaxed max-w-md mx-auto"
            style={{ color: TEXT_BODY, fontFamily: "'Inter', sans-serif" }}
          >
            {GAMEPLAY_TIPS[tipIndex].text}
          </p>
          {/* Dots */}
          <div className="flex justify-center gap-2 mt-4">
            {GAMEPLAY_TIPS.map((_, i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 transition-all duration-500"
                style={{
                  backgroundColor: i === tipIndex ? GOLD : BORDER,
                  borderRadius: '1px',
                  transform: i === tipIndex ? 'scale(1.3)' : 'scale(1)',
                }}
              />
            ))}
          </div>
          <p
            className="mt-6 text-[10px] uppercase tracking-[0.25em]"
            style={{ color: TEXT_MUTED, opacity: 0.5, fontFamily: "'Inter', sans-serif" }}
          >
            Hold Space to skip
          </p>
        </div>
      </div>

      {/* ═══════════════════════ LOBBY ═══════════════════════ */}
      <div
        ref={lobbyRef}
        className="z-10 w-full min-h-screen flex flex-col py-10 px-6 overflow-y-auto"
        aria-hidden={menuScreen !== 'lobby'}
      >
        {/* Header */}
        <div className="max-w-6xl mx-auto w-full mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2
                className="text-3xl md:text-4xl font-bold tracking-[0.04em]"
                style={{
                  fontFamily: "'Cinzel', serif",
                  color: GOLD,
                  letterSpacing: '0.04em',
                }}
              >
                New Game
              </h2>
              <p className="text-xs tracking-[0.2em] uppercase mt-2" style={{ color: TEXT_MUTED, fontFamily: "'Inter', sans-serif" }}>
                Choose your civilization
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleNavigate('landing')}
              className="p-2 transition-colors duration-300 hover:opacity-70 focus-visible:outline-none focus-visible:ring-2"
              style={{ color: TEXT_MUTED, '--tw-ring-color': GOLD } as React.CSSProperties}
              aria-label="Close lobby"
            >
              <X size={20} />
            </button>
          </div>
          <div className="h-px w-full" style={{ background: `linear-gradient(90deg, ${BORDER_GOLD}, ${BORDER}, transparent)` }} />
        </div>

        {/* Main content */}
        <div className="max-w-6xl mx-auto w-full flex-1">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-10">
            {/* ─── Faction Selection ─── */}
            <div>
              <h3
                className="text-xs font-bold uppercase tracking-[0.25em] mb-5"
                style={{
                  fontFamily: "'Cinzel', serif",
                  color: GOLD,
                  letterSpacing: '0.25em',
                }}
              >
                Faction
              </h3>
              <div className="space-y-3" role="group" aria-label="Faction selection">
                {Object.values(FactionType).map((faction) => {
                  const info = FACTION_INFO[faction];
                  const Icon = info.icon;
                  const isSelected = faction === selectedFaction;
                  const fPh = FACTION_HERMES[faction];
                  return (
                    <button
                      key={faction}
                      type="button"
                      onClick={() => setSelectedFaction(faction)}
                      aria-pressed={isSelected}
                      className="w-full text-left transition-all duration-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                      style={{
                        backgroundColor: isSelected ? SURFACE_LIGHT : 'transparent',
                        border: '1px solid',
                        borderColor: isSelected ? fPh.accent : BORDER,
                        '--tw-ring-color': GOLD,
                        '--tw-ring-offset-color': DARK_EARTH,
                        boxShadow: isSelected ? `0 0 20px ${fPh.glow}` : 'none',
                      } as React.CSSProperties}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.backgroundColor = SURFACE;
                          e.currentTarget.style.borderColor = fPh.accent;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.borderColor = BORDER;
                        }
                      }}
                    >
                      <div className="p-4">
                        <div className="flex items-start gap-3 mb-2">
                          <div
                            className="p-2"
                            style={{
                              backgroundColor: isSelected ? `${fPh.accent}20` : 'transparent',
                              borderRadius: '2px',
                            }}
                          >
                            <Icon
                              size={14}
                              style={{ color: fPh.accent, flexShrink: 0 }}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4
                              className="text-sm font-bold uppercase tracking-[0.12em]"
                              style={{
                                fontFamily: "'Cinzel', serif",
                                color: isSelected ? fPh.accent : TEXT_PRIMARY,
                              }}
                            >
                              {faction}
                            </h4>
                            <p className="text-xs leading-relaxed mt-1" style={{ color: TEXT_BODY, fontFamily: "'Inter', sans-serif" }}>
                              {info.desc}
                            </p>
                          </div>
                          {/* Selected indicator */}
                          {isSelected && (
                            <div
                              className="w-2 h-2 mt-1.5 flex-shrink-0"
                              style={{ backgroundColor: fPh.accent, borderRadius: '1px', transform: 'rotate(45deg)' }}
                            />
                          )}
                        </div>
                        <div className="flex justify-between items-center text-[11px] mt-2 pt-2" style={{ borderTop: `1px solid ${BORDER}` }}>
                          <span style={{ color: fPh.accent, fontFamily: "'Inter', sans-serif", fontWeight: 600 }}>
                            {info.bonus}
                          </span>
                          <span style={{ color: TEXT_MUTED, fontFamily: "'Inter', sans-serif" }}>
                            {info.playStyle}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ─── Game Settings ─── */}
            <div className="space-y-6">
              {/* Map Mode */}
              <div>
                <h4
                  className="text-xs font-bold uppercase tracking-[0.25em] mb-3"
                  style={{ color: GOLD, fontFamily: "'Cinzel', serif", letterSpacing: '0.25em' }}
                >
                  Map Mode
                </h4>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Map mode">
                  {[MapMode.FIXED, MapMode.INFINITE].map((mode) => {
                    const active = mapMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setMapMode(mode)}
                        aria-pressed={active}
                        className="px-4 py-3 text-xs uppercase tracking-[0.15em] font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2"
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          border: '1px solid',
                          borderColor: active ? GOLD : BORDER,
                          backgroundColor: active ? `${GOLD}15` : 'transparent',
                          color: active ? GOLD : TEXT_MUTED,
                          '--tw-ring-color': GOLD,
                        } as React.CSSProperties}
                      >
                        {mode === MapMode.FIXED ? 'Fixed Map' : 'Infinite Realm'}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Map Size */}
              <div>
                <h4
                  className="text-xs font-bold uppercase tracking-[0.25em] mb-3"
                  style={{ color: GOLD, fontFamily: "'Cinzel', serif", letterSpacing: '0.25em' }}
                >
                  Map Size
                </h4>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Map size">
                  {[MapSize.SMALL, MapSize.MEDIUM, MapSize.LARGE].map((size) => {
                    const active = mapSize === size;
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setMapSize(size)}
                        aria-pressed={active}
                        className="px-3 py-3 text-xs uppercase tracking-[0.15em] font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2"
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          border: '1px solid',
                          borderColor: active ? GOLD : BORDER,
                          backgroundColor: active ? `${GOLD}15` : 'transparent',
                          color: active ? GOLD : TEXT_MUTED,
                          '--tw-ring-color': GOLD,
                        } as React.CSSProperties}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Toggles */}
              <div className="space-y-2">
                {(
                  [
                    { label: 'Fog of War', value: fowEnabled, onChange: setFowEnabled },
                    { label: 'Peaceful Mode', value: peacefulMode, onChange: setPeacefulMode },
                    { label: 'Disable Enemy AI', value: aiDisabled, onChange: setAiDisabled },
                  ] as const
                ).map((toggle) => (
                  <button
                    key={toggle.label}
                    type="button"
                    onClick={() => toggle.onChange(!toggle.value)}
                    aria-pressed={toggle.value}
                    className="w-full px-4 py-3 flex items-center justify-between transition-all duration-300 focus-visible:outline-none focus-visible:ring-2"
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      border: '1px solid',
                      borderColor: toggle.value ? GOLD : BORDER,
                      backgroundColor: toggle.value ? `${GOLD}10` : 'transparent',
                      '--tw-ring-color': GOLD,
                    } as React.CSSProperties}
                    onMouseEnter={(e) => {
                      if (!toggle.value) {
                        e.currentTarget.style.borderColor = BORDER_GOLD;
                        e.currentTarget.style.backgroundColor = SURFACE;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!toggle.value) {
                        e.currentTarget.style.borderColor = BORDER;
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    <span
                      className="text-xs font-semibold uppercase tracking-[0.15em]"
                      style={{ color: TEXT_PRIMARY }}
                    >
                      {toggle.label}
                    </span>
                    <div
                      className="w-4 h-4 flex items-center justify-center transition-all duration-300"
                      style={{
                        border: '1px solid',
                        borderColor: toggle.value ? GOLD : BORDER,
                        backgroundColor: toggle.value ? GOLD : 'transparent',
                        borderRadius: '2px',
                      }}
                      aria-hidden
                    >
                      {toggle.value && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5L4 7L8 3" stroke={DARK_EARTH} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* Treaty Length */}
              {peacefulMode && (
                <div>
                  <h4
                    className="text-xs font-bold uppercase tracking-[0.25em] mb-3"
                    style={{ color: GOLD, fontFamily: "'Cinzel', serif", letterSpacing: '0.25em' }}
                  >
                    Peace Duration: {treatyLength} turns
                  </h4>
                  <input
                    type="range"
                    min={1}
                    max={60}
                    value={treatyLength}
                    onChange={(e) => setTreatyLength(parseInt(e.target.value, 10))}
                    className="w-full hermes-range"
                    aria-label="Peace duration in turns"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-5 justify-center pb-8">
            <button
              type="button"
              onClick={() => handleNavigate('landing')}
              className="px-10 py-3.5 text-xs font-semibold uppercase tracking-[0.18em] transition-all duration-300 focus-visible:outline-none focus-visible:ring-2"
              style={{
                fontFamily: "'Inter', sans-serif",
                border: '1px solid',
                borderColor: BORDER,
                color: TEXT_MUTED,
                '--tw-ring-color': GOLD,
              } as React.CSSProperties}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = TEXT_MUTED;
                e.currentTarget.style.color = TEXT_PRIMARY;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = BORDER;
                e.currentTarget.style.color = TEXT_MUTED;
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStart}
              className="px-10 py-3.5 text-xs font-bold uppercase tracking-[0.18em] transition-all duration-500 focus-visible:outline-none focus-visible:ring-2"
              style={{
                fontFamily: "'Inter', sans-serif",
                border: '1px solid',
                borderColor: GOLD,
                color: GOLD,
                backgroundColor: 'transparent',
                '--tw-ring-color': GOLD,
              } as React.CSSProperties}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = GOLD;
                e.currentTarget.style.color = DARK_EARTH;
                e.currentTarget.style.boxShadow = `0 0 30px ${GOLD_GLOW}`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = GOLD;
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              Commence
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════ DIAGNOSTICS ═══════════════════════ */}
      <div
        ref={stressRef}
        className="z-10 w-full min-h-screen flex flex-col items-center justify-center px-6 py-12"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
        aria-hidden={menuScreen !== 'stress'}
      >
        <div className="max-w-md w-full">
          <div className="mb-10 text-center">
            <h2
              className="text-2xl md:text-3xl font-bold tracking-[0.04em] mb-3"
              style={{
                fontFamily: "'Cinzel', serif",
                color: GOLD,
                letterSpacing: '0.04em',
              }}
            >
              Diagnostics
            </h2>
            <p className="text-xs leading-relaxed" style={{ color: TEXT_BODY, fontFamily: "'Inter', sans-serif" }}>
              Flow-field pathfinding benchmark — concurrent unit stress
            </p>
          </div>

          <div className="space-y-5 mb-8">
            {/* Unit Count card */}
            <div
              className="p-5"
              style={{
                backgroundColor: SURFACE,
                border: `1px solid ${BORDER}`,
              }}
            >
              <div className="flex justify-between items-center mb-4">
                <span
                  className="text-[11px] font-semibold uppercase tracking-[0.15em]"
                  style={{ color: GOLD, fontFamily: "'Inter', sans-serif" }}
                >
                  Unit Count
                </span>
                <span className="text-sm font-semibold" style={{ color: TEXT_PRIMARY, fontFamily: "'JetBrains Mono', monospace" }}>
                  {stressUnitCount}
                </span>
              </div>
              <input
                type="range"
                min={100}
                max={3000}
                step={100}
                value={stressUnitCount}
                onChange={(e) => setStressUnitCount(parseInt(e.target.value, 10))}
                className="w-full hermes-range"
                aria-label="Stress unit count"
              />
            </div>

            {/* Spawn Enemy toggle */}
            <button
              type="button"
              onClick={() => setStressEnableEnemies(!stressEnableEnemies)}
              aria-pressed={stressEnableEnemies}
              className="w-full p-5 flex items-center justify-between transition-all duration-300 focus-visible:outline-none focus-visible:ring-2"
              style={{
                fontFamily: "'Inter', sans-serif",
                backgroundColor: stressEnableEnemies ? SURFACE_LIGHT : 'transparent',
                border: '1px solid',
                borderColor: stressEnableEnemies ? COPPER : BORDER,
                '--tw-ring-color': GOLD,
              } as React.CSSProperties}
              onMouseEnter={(e) => {
                if (!stressEnableEnemies) {
                  e.currentTarget.style.backgroundColor = SURFACE;
                  e.currentTarget.style.borderColor = BORDER_GOLD;
                }
              }}
              onMouseLeave={(e) => {
                if (!stressEnableEnemies) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.borderColor = BORDER;
                }
              }}
            >
              <span
                className="text-xs font-semibold uppercase tracking-[0.15em]"
                style={{ color: TEXT_PRIMARY }}
              >
                Spawn Enemy Units
              </span>
              <div
                className="w-4 h-4 flex items-center justify-center transition-all duration-300"
                style={{
                  border: '1px solid',
                  borderColor: stressEnableEnemies ? COPPER : BORDER,
                  backgroundColor: stressEnableEnemies ? COPPER : 'transparent',
                  borderRadius: '2px',
                }}
                aria-hidden
              >
                {stressEnableEnemies && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5L4 7L8 3" stroke={DARK_EARTH} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => handleNavigate('landing')}
              className="flex-1 px-6 py-3.5 text-xs uppercase tracking-[0.18em] font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2"
              style={{
                fontFamily: "'Inter', sans-serif",
                border: '1px solid',
                borderColor: BORDER,
                color: TEXT_MUTED,
                '--tw-ring-color': GOLD,
              } as React.CSSProperties}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = TEXT_MUTED;
                e.currentTarget.style.color = TEXT_PRIMARY;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = BORDER;
                e.currentTarget.style.color = TEXT_MUTED;
              }}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleStressTestStart}
              className="flex-1 px-6 py-3.5 text-xs uppercase tracking-[0.18em] font-bold transition-all duration-500 focus-visible:outline-none focus-visible:ring-2"
              style={{
                fontFamily: "'Inter', sans-serif",
                border: '1px solid',
                borderColor: GOLD,
                color: GOLD,
                backgroundColor: 'transparent',
                '--tw-ring-color': GOLD,
              } as React.CSSProperties}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = GOLD;
                e.currentTarget.style.color = DARK_EARTH;
                e.currentTarget.style.boxShadow = `0 0 30px ${GOLD_GLOW}`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = GOLD;
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              Launch
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .hermes-range {
          appearance: none;
          -webkit-appearance: none;
          width: 100%;
          height: 2px;
          border-radius: 0;
          background: ${BORDER};
          outline: none;
          transition: background 0.3s;
        }
        .hermes-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 1px;
          background: ${GOLD};
          cursor: pointer;
          border: none;
          box-shadow: 0 0 10px ${GOLD_GLOW};
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .hermes-range::-webkit-slider-thumb:hover {
          transform: scale(1.2);
          box-shadow: 0 0 20px ${GOLD_GLOW};
        }
        .hermes-range::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 1px;
          background: ${GOLD};
          cursor: pointer;
          border: none;
          box-shadow: 0 0 10px ${GOLD_GLOW};
        }
        .hermes-range::-moz-range-track {
          background: transparent;
          border: none;
        }
        /* Focus ring for all interactive elements */
        *:focus-visible {
          outline: 2px solid ${GOLD};
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
};
