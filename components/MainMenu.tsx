import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FactionType, MapMode, MapSize } from '../types';
import { FACTION_COLORS } from '../constants';
import {
  Shield, Users, Sword, Globe, Infinity as InfinityIcon,
  Eye, EyeOff, Map as MapIcon, Maximize, Handshake, Clock,
  ChevronRight, Star, Sparkles
} from 'lucide-react';
import gsap from 'gsap';

// ─── Type Definitions ───────────────────────────────────────────────────────
interface MainMenuProps {
  onStart: (faction: FactionType, mode: MapMode, size: MapSize, fow: boolean, peaceful: boolean, treaty: number, aiDisabled: boolean) => void;
}

// ─── Faction Metadata ───────────────────────────────────────────────────────
const FACTION_INFO = {
  [FactionType.ROMANS]: {
    desc: 'Disciplined empire builders. Balanced economy and peerless infantry.',
    bonus: '+10% Gold Generation',
    playStyle: 'Expand methodically. Dominate with Legion might.',
    icon: Shield
  },
  [FactionType.GAULS]: {
    desc: 'Fierce warriors of the wild. Swift expansion and cheap construction.',
    bonus: '-10% Building Cost',
    playStyle: 'Rush early. Overwhelm before they fortify.',
    icon: Sword
  },
  [FactionType.CARTHAGE]: {
    desc: 'Masters of trade and sea. Unrivaled population growth and wealth.',
    bonus: '+5 Max Population',
    playStyle: 'Outscale enemies with superior economy.',
    icon: Users
  }
};

// ─── Gameplay Tips ───────────────────────────────────────────────────────────
const GAMEPLAY_TIPS = [
  { title: 'Economy First', text: 'Build Lumber Camps early. Wood fuels your entire civilization.' },
  { title: 'Feed Your People', text: 'Farms and Hunter\'s Lodges keep your population growing. Starvation halts expansion.' },
  { title: 'Tax Wisely', text: 'High taxes generate gold but lower happiness. Keep a balanced rate.' },
  { title: 'Territory Matters', text: 'Bonfires and Town Centers expand your territory. Build them to claim resources.' },
  { title: 'Use Formations', text: 'Line formation boosts attack by 20%. Circle boosts defense by 25%. Adapt to your enemy.' },
  { title: 'Scout Ahead', text: 'Cavalry have the fastest movement. Use them to explore and reveal the fog of war.' },
  { title: 'Happy Citizens', text: 'Build Small Parks to boost happiness. Unhappy citizens produce less.' },
  { title: 'Defensive Stance', text: 'Set units to "Hold" stance to guard chokepoints. They won\'t chase into traps.' },
  { title: 'Barracks Waypoints', text: 'Set a rally point from your Barracks to send fresh troops straight to the frontline.' },
  { title: 'Infinite Realm', text: 'In Infinite mode, the map generates as you explore. No border can contain you.' },
];

// ─── Particle for Background ────────────────────────────────────────────────
interface Particle {
  x: number; y: number; vx: number; vy: number; size: number;
  alpha: number; life: number; maxLife: number; color: string;
}

// ─── Main Component ─────────────────────────────────────────────────────────
export const MainMenu: React.FC<MainMenuProps> = ({ onStart }) => {
  // ── State ──────────────────────────────────────────────────────────────────
  const [selectedFaction, setSelectedFaction] = useState<FactionType>(FactionType.ROMANS);
  const [mapMode, setMapMode] = useState<MapMode>(MapMode.FIXED);
  const [mapSize, setMapSize] = useState<MapSize>(MapSize.MEDIUM);
  const [fowEnabled, setFowEnabled] = useState<boolean>(true);
  const [peacefulMode, setPeacefulMode] = useState<boolean>(false);
  const [treatyLength, setTreatyLength] = useState<number>(10);
  const [aiDisabled, setAiDisabled] = useState<boolean>(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // ── Refs ───────────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const particleAnimRef = useRef<number>(0);

  // ── Parallax Mouse ─────────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMousePos({
      x: ((e.clientX - rect.left) / rect.width - 0.5) * 2,
      y: ((e.clientY - rect.top) / rect.height - 0.5) * 2,
    });
  }, []);

  // ── Tip Cycling ───────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      if (tipRef.current) {
        gsap.to(tipRef.current, {
          opacity: 0, y: -10, duration: 0.4, ease: 'power2.in',
          onComplete: () => {
            setTipIndex((prev) => (prev + 1) % GAMEPLAY_TIPS.length);
          }
        });
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (tipRef.current) {
      gsap.fromTo(tipRef.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' });
    }
  }, [tipIndex]);

  // ── Particle System ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = particlesRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;

    const particles: Particle[] = [];
    const colors = ['rgba(251,191,36,', 'rgba(245,158,11,', 'rgba(217,119,6,', 'rgba(255,255,255,'];

    const createParticle = (): Particle => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3, vy: -(Math.random() * 0.2 + 0.1),
      size: Math.random() * 3 + 1,
      alpha: Math.random() * 0.5 + 0.1,
      life: 0, maxLife: Math.random() * 200 + 200,
      color: colors[Math.floor(Math.random() * colors.length)],
    });

    for (let i = 0; i < 80; i++) particles.push(createParticle());

    const animate = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life++;
        const lifeRatio = p.life / p.maxLife;
        const alpha = p.alpha * (1 - lifeRatio);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color + alpha + ')';
        ctx.fill();
        // Glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        ctx.fillStyle = p.color + alpha * 0.15 + ')';
        ctx.fill();
        if (p.life >= p.maxLife) {
          particles[i] = createParticle();
        }
      }
      particleAnimRef.current = requestAnimationFrame(animate);
    };

    animate();

    const onResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(particleAnimRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // ── GSAP Entrance Animations ──────────────────────────────────────────────
  useEffect(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    // Initial setup: hide everything
    if (titleRef.current) gsap.set(titleRef.current, { opacity: 0, y: -60 });
    if (subtitleRef.current) gsap.set(subtitleRef.current, { opacity: 0, y: -30 });
    if (cardsRef.current) gsap.set(cardsRef.current.children, { opacity: 0, y: 60 });
    if (settingsRef.current) gsap.set(settingsRef.current, { opacity: 0, y: 40 });
    if (buttonRef.current) gsap.set(buttonRef.current, { opacity: 0, scale: 0.8 });

    // Animate in
    if (titleRef.current) tl.to(titleRef.current, { opacity: 1, y: 0, duration: 1.2 });
    if (subtitleRef.current) tl.to(subtitleRef.current, { opacity: 1, y: 0, duration: 0.8 }, '-=0.6');
    if (cardsRef.current) tl.to(cardsRef.current.children, { opacity: 1, y: 0, duration: 0.8, stagger: 0.15 }, '-=0.4');
    if (settingsRef.current) tl.to(settingsRef.current, { opacity: 1, y: 0, duration: 0.8 }, '-=0.4');
    if (buttonRef.current) tl.to(buttonRef.current, { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.7)' }, '-=0.3');

    timelineRef.current = tl;

    return () => { tl.kill(); };
  }, []);

  // ── Animate on faction change ──────────────────────────────────────────────
  useEffect(() => {
    if (cardsRef.current) {
      const cards = Array.from(cardsRef.current.children);
      gsap.to(cards, { scale: 1, borderColor: 'rgba(120,113,108,0.5)', duration: 0.4, ease: 'power2.out' });
      const selected = cards.find(
        (_, i) => Object.values(FactionType)[i] === selectedFaction
      ) as HTMLElement | undefined;
      if (selected) {
        gsap.to(selected, { scale: 1.05, duration: 0.5, ease: 'back.out(1.7)' });
      }
    }
  }, [selectedFaction]);

  // ── Button Pulse ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!buttonRef.current) return;
    gsap.to(buttonRef.current, {
      boxShadow: '0 0 40px rgba(245,158,11,0.4), 0 0 80px rgba(245,158,11,0.2)',
      duration: 2, repeat: -1, yoyo: true, ease: 'sine.inOut'
    });
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const factionList = Object.values(FactionType);
  const tip = GAMEPLAY_TIPS[tipIndex];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden"
    >
      {/* ── Background Layer ─────────────────────────────────────────────── */}
      <div className="absolute inset-0 bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950" />
      <div className="absolute inset-0 bg-gradient-to-tr from-amber-950/20 via-transparent to-amber-900/10" />

      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
          transform: `translate(${mousePos.x * 8}px, ${mousePos.y * 8}px)`,
          transition: 'transform 0.1s ease-out',
        }}
      />

      {/* Vignette */}
      <div className="absolute inset-0 bg-radial-vignette pointer-events-none" />

      {/* Animated radial glow */}
      <div
        className="absolute w-[600px] h-[600px] rounded-full bg-amber-500/5 blur-[120px] pointer-events-none"
        style={{
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) translate(${mousePos.x * 30}px, ${mousePos.y * 20}px)`,
          transition: 'transform 0.3s ease-out',
        }}
      />

      {/* Particles canvas */}
      <canvas
        ref={particlesRef}
        className="absolute inset-0 pointer-events-none"
      />

      {/* ── Decorative Top/Bottom bars ──────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />

      {/* Corner decorations */}
      <div className="absolute top-0 left-0 w-32 h-32 pointer-events-none">
        <div className="absolute top-0 left-0 w-16 h-px bg-gradient-to-r from-amber-500/50 to-transparent" />
        <div className="absolute top-0 left-0 h-16 w-px bg-gradient-to-b from-amber-500/50 to-transparent" />
      </div>
      <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none">
        <div className="absolute top-0 right-0 w-16 h-px bg-gradient-to-l from-amber-500/50 to-transparent" />
        <div className="absolute top-0 right-0 h-16 w-px bg-gradient-to-b from-amber-500/50 to-transparent" />
      </div>
      <div className="absolute bottom-0 left-0 w-32 h-32 pointer-events-none">
        <div className="absolute bottom-0 left-0 w-16 h-px bg-gradient-to-r from-amber-500/50 to-transparent" />
        <div className="absolute bottom-0 left-0 h-16 w-px bg-gradient-to-t from-amber-500/50 to-transparent" />
      </div>
      <div className="absolute bottom-0 right-0 w-32 h-32 pointer-events-none">
        <div className="absolute bottom-0 right-0 w-16 h-px bg-gradient-to-l from-amber-500/50 to-transparent" />
        <div className="absolute bottom-0 right-0 h-16 w-px bg-gradient-to-t from-amber-500/50 to-transparent" />
      </div>

      {/* ── Main Content ────────────────────────────────────────────────── */}
      <div className="relative z-10 max-w-6xl w-full p-8 flex flex-col items-center h-screen overflow-y-auto scrollbar-none">
        {/* ── Title Section ──────────────────────────────────────────────── */}
        <div className="flex flex-col items-center mb-8 mt-8 md:mt-12">
          {/* Decorative line above title */}
          <div
            ref={subtitleRef}
            className="flex items-center gap-3 mb-4"
          >
            <div className="w-12 h-px bg-gradient-to-r from-transparent to-amber-500/60" />
            <span className="text-[10px] font-bold tracking-[0.3em] text-amber-500/70 uppercase">
              Real-Time Strategy
            </span>
            <div className="w-12 h-px bg-gradient-to-l from-transparent to-amber-500/60" />
          </div>

          {/* Main Title */}
          <h1
            ref={titleRef}
            className="relative text-6xl md:text-8xl font-serif font-bold text-center mb-2"
          >
            {/* Title glow */}
            <span
              className="absolute inset-0 bg-clip-text text-transparent select-none pointer-events-none"
              style={{
                background: 'linear-gradient(180deg, rgba(251,191,36,0.3), transparent)',
                filter: 'blur(20px)',
                transform: 'translateY(4px)',
              }}
            >
              CIV STRATEGY
            </span>
            {/* Title text with gradient */}
            <span
              className="bg-clip-text text-transparent select-none"
              style={{
                backgroundImage: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 30%, #fef3c7 50%, #f59e0b 70%, #b45309 100%)',
                backgroundSize: '200% auto',
                animation: 'shimmer 4s linear infinite',
              }}
            >
              CIV STRATEGY
            </span>
          </h1>

          {/* Subtitle */}
          <p
            ref={subtitleRef}
            className="text-lg md:text-xl tracking-[0.15em] uppercase text-stone-400 font-light"
          >
            Ancient Realms
          </p>

          {/* Tagline */}
          <p className="mt-3 text-xs text-stone-600 tracking-[0.25em] uppercase font-mono">
            Forge Your Empire · Command Your Legacy
          </p>
        </div>

        {/* ── Faction Selection Cards ────────────────────────────────────── */}
        <div
          ref={cardsRef}
          className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6 w-full mb-7 max-w-5xl"
        >
          {factionList.map((faction) => {
            const info = FACTION_INFO[faction];
            const Icon = info.icon;
            const isSelected = selectedFaction === faction;
            const colorHex = '#' + FACTION_COLORS[faction].toString(16).padStart(6, '0');

            return (
              <button
                key={faction}
                onClick={() => setSelectedFaction(faction)}
                className={`
                  group relative rounded-2xl p-6 transition-all duration-500 cursor-pointer
                  ${isSelected
                    ? 'ring-2 ring-amber-400/80 bg-stone-800/95 shadow-2xl shadow-amber-500/10'
                    : 'bg-stone-900/80 hover:bg-stone-800/80 ring-1 ring-stone-700/50 hover:ring-amber-500/30'
                  }
                `}
                style={{
                  transformStyle: 'preserve-3d',
                  perspective: '1000px',
                }}
              >
                {/* Card background gradient */}
                <div
                  className={`absolute inset-0 rounded-2xl transition-opacity duration-500 ${isSelected ? 'opacity-100' : 'opacity-0'}`}
                  style={{
                    background: `radial-gradient(ellipse at 50% 0%, ${colorHex}15 0%, transparent 70%)`,
                  }}
                />

                {/* Faction color accent line */}
                <div
                  className={`absolute top-0 left-4 right-4 h-0.5 rounded-full transition-all duration-500 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}
                  style={{ backgroundColor: colorHex }}
                />

                {/* Icon Container */}
                <div className="relative flex justify-center mb-5">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-500"
                    style={{
                      backgroundColor: isSelected ? colorHex : `${colorHex}30`,
                      transform: isSelected ? 'scale(1.1) rotate(5deg)' : 'scale(1) rotate(0deg)',
                    }}
                  >
                    <Icon size={32} className="text-white drop-shadow-lg" />
                  </div>
                  {isSelected && (
                    <div className="absolute -top-1 -right-1">
                      <Star size={14} className="text-amber-400 fill-amber-400" />
                    </div>
                  )}
                </div>

                {/* Faction Name */}
                <h3
                  className={`text-xl font-bold text-center mb-2 transition-colors duration-300 ${isSelected ? 'text-amber-200' : 'text-stone-300 group-hover:text-stone-200'}`}
                >
                  {faction}
                </h3>

                {/* Description */}
                <p className="text-stone-500 text-xs text-center mb-4 min-h-[32px] leading-relaxed">
                  {info.desc}
                </p>

                {/* Bonus Badge */}
                <div
                  className={`rounded-lg p-2.5 text-center border transition-all duration-300 ${
                    isSelected
                      ? 'bg-stone-900/80 border-amber-500/30'
                      : 'bg-stone-900/50 border-stone-700/50 group-hover:border-stone-600'
                  }`}
                >
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${isSelected ? 'text-amber-400' : 'text-stone-500'}`}>
                    Faction Bonus
                  </span>
                  <p className={`text-sm font-semibold mt-0.5 ${isSelected ? 'text-stone-200' : 'text-stone-400'}`}>
                    {info.bonus}
                  </p>
                </div>

                {/* Play Style Hint */}
                {isSelected && (
                  <div className="mt-3 pt-3 border-t border-stone-700/50">
                    <p className="text-[10px] text-stone-600 italic leading-relaxed text-center">
                      "{info.playStyle}"
                    </p>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Game Settings Panel ────────────────────────────────────────── */}
        <div
          ref={settingsRef}
          className="w-full max-w-5xl mb-7"
        >
          <div className="bg-stone-900/90 backdrop-blur-xl rounded-2xl border border-stone-700/50 p-6 md:p-8 shadow-2xl">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-8">
              {/* Map Mode */}
              <div className="space-y-3">
                <h4 className="text-amber-400/80 font-bold flex items-center gap-2 text-sm tracking-wider uppercase">
                  <Globe size={14} /> Map Mode
                </h4>
                <div className="flex flex-col gap-2">
                  {[
                    { mode: MapMode.FIXED, icon: Globe, label: 'Fixed Map', desc: 'Bordered arena' },
                    { mode: MapMode.INFINITE, icon: InfinityIcon, label: 'Infinite Realm', desc: 'Endless frontier' },
                  ].map(({ mode, icon: Icon, label, desc }) => (
                    <button
                      key={mode}
                      onClick={() => setMapMode(mode)}
                      className={`
                        flex items-center gap-3 p-2.5 rounded-xl border transition-all duration-300
                        ${mapMode === mode
                          ? 'bg-amber-900/30 border-amber-500/50 text-amber-200 shadow-lg shadow-amber-500/5'
                          : 'bg-stone-800/50 border-stone-700/30 text-stone-400 hover:bg-stone-800 hover:border-stone-600'
                        }
                      `}
                    >
                      <Icon size={16} className={mapMode === mode ? 'text-amber-400' : 'text-stone-500'} />
                      <div className="text-left">
                        <div className="text-xs font-bold">{label}</div>
                        <div className="text-[10px] text-stone-600">{desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Map Size */}
              <div className={`space-y-3 transition-all duration-300 ${mapMode === MapMode.INFINITE ? 'opacity-20 pointer-events-none' : ''}`}>
                <h4 className="text-amber-400/80 font-bold flex items-center gap-2 text-sm tracking-wider uppercase">
                  <Maximize size={14} /> Map Size
                </h4>
                <div className="flex flex-col gap-2">
                  {Object.values(MapSize).map((size, idx) => (
                    <button
                      key={size}
                      onClick={() => setMapSize(size)}
                      className={`
                        flex items-center gap-3 p-2.5 rounded-xl border transition-all duration-300
                        ${mapSize === size
                          ? 'bg-amber-900/30 border-amber-500/50 text-amber-200'
                          : 'bg-stone-800/50 border-stone-700/30 text-stone-400 hover:bg-stone-800 hover:border-stone-600'
                        }
                      `}
                    >
                      <MapIcon size={16} className={mapSize === size ? 'text-amber-400' : 'text-stone-500'} />
                      <span className="text-xs font-bold">{size}</span>
                      <span className="text-[10px] text-stone-600 ml-auto">
                        {idx === 0 ? '1K' : idx === 1 ? '2K' : '4K'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Diplomacy */}
              <div className="space-y-3">
                <h4 className="text-amber-400/80 font-bold flex items-center gap-2 text-sm tracking-wider uppercase">
                  <Handshake size={14} /> Diplomacy
                </h4>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setPeacefulMode(!peacefulMode)}
                    className={`
                      flex items-center justify-between p-2.5 rounded-xl border transition-all duration-300
                      ${peacefulMode
                        ? 'bg-emerald-900/30 border-emerald-500/40 text-emerald-200'
                        : 'bg-stone-800/50 border-stone-700/30 text-stone-400 hover:bg-stone-800'
                      }
                    `}
                  >
                    <span className="text-xs font-bold">Peaceful</span>
                    <Handshake size={16} className={peacefulMode ? 'text-emerald-400' : 'text-stone-500'} />
                  </button>

                  <div className={`transition-all duration-300 ${peacefulMode ? 'opacity-20 pointer-events-none' : ''}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] text-stone-500 font-bold flex items-center gap-1">
                        <Clock size={10} /> Treaty
                      </span>
                      <span className="text-[11px] text-amber-400 font-mono font-bold">{treatyLength}m</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="60"
                      step="5"
                      value={treatyLength}
                      onChange={(e) => setTreatyLength(parseInt(e.target.value))}
                      className="w-full accent-amber-500 h-1.5 rounded-full appearance-none bg-stone-700 cursor-pointer"
                    />
                    <div className="text-[9px] text-stone-600 mt-1 text-center">
                      {treatyLength === 0 ? 'War Immediately' : `No attacks for ${treatyLength}m`}
                    </div>
                  </div>

                  <button
                    onClick={() => setAiDisabled(!aiDisabled)}
                    className={`
                      flex items-center justify-between p-2.5 rounded-xl border transition-all duration-300
                      ${aiDisabled
                        ? 'bg-red-900/30 border-red-500/40 text-red-200'
                        : 'bg-stone-800/50 border-stone-700/30 text-stone-400 hover:bg-stone-800'
                      }
                    `}
                  >
                    <span className="text-xs font-bold">Enemy AI</span>
                    {aiDisabled
                      ? <EyeOff size={16} className="text-red-400" />
                      : <Eye size={16} className="text-stone-500" />
                    }
                  </button>
                </div>
              </div>

              {/* Visuals */}
              <div className="space-y-3">
                <h4 className="text-amber-400/80 font-bold flex items-center gap-2 text-sm tracking-wider uppercase">
                  <Eye size={14} /> Visuals
                </h4>
                <button
                  onClick={() => setFowEnabled(!fowEnabled)}
                  className={`
                    flex items-center justify-between p-2.5 rounded-xl border transition-all duration-300
                    ${fowEnabled
                      ? 'bg-stone-800/50 border-stone-600/50 text-stone-200'
                      : 'bg-stone-800/50 border-stone-700/30 text-stone-500'
                    }
                  `}
                >
                  <span className="text-xs font-bold">Fog of War</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] ${fowEnabled ? 'text-emerald-400' : 'text-stone-600'}`}>
                      {fowEnabled ? 'ON' : 'OFF'}
                    </span>
                    {fowEnabled
                      ? <Eye size={16} className="text-emerald-400" />
                      : <EyeOff size={16} className="text-stone-500" />
                    }
                  </div>
                </button>

                {/* Faction color indicator */}
                <div className="p-2.5 rounded-xl bg-stone-800/30 border border-stone-700/30 mt-2">
                  <div className="text-[10px] text-stone-600 uppercase tracking-wider mb-2">Selected Faction</div>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded-md"
                      style={{ backgroundColor: '#' + FACTION_COLORS[selectedFaction].toString(16).padStart(6, '0') }}
                    />
                    <span className="text-xs text-stone-400 font-bold">{selectedFaction}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Start Game Button ───────────────────────────────────────────── */}
        <button
          ref={buttonRef}
          onClick={() => onStart(selectedFaction, mapMode, mapSize, fowEnabled, peacefulMode, treatyLength, aiDisabled)}
          className="group relative px-14 py-4 rounded-full font-serif text-2xl md:text-3xl font-bold text-stone-900 overflow-hidden transition-all duration-300"
        >
          {/* Button background */}
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 rounded-full" />
          {/* Button shine overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-white/10 rounded-full" />
          {/* Hover shine sweep */}
          <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/30 to-transparent rounded-full" />

          {/* Inner border */}
          <div className="absolute inset-[2px] rounded-full border border-white/10" />

          {/* Button text */}
          <span className="relative z-10 flex items-center gap-3">
            <Sparkles size={20} className="group-hover:rotate-12 transition-transform" />
            COMMENCE
            <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </span>
        </button>

        {/* ── Cycling Tips ───────────────────────────────────────────────── */}
        <div className="mt-6 mb-6 max-w-lg w-full">
          <div
            ref={tipRef}
            className="flex items-start gap-3 bg-stone-900/60 backdrop-blur-sm rounded-xl border border-stone-700/30 p-4"
          >
            <div className="flex-shrink-0 mt-0.5">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <Star size={12} className="text-amber-400" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold tracking-widest text-amber-400/70 uppercase">
                  Pro Tip
                </span>
                <span className="text-[10px] text-stone-600 font-mono">
                  {tipIndex + 1}/{GAMEPLAY_TIPS.length}
                </span>
              </div>
              <p className="text-xs text-stone-400 font-medium leading-relaxed">
                <span className="text-stone-200 font-bold">{tip.title}:</span> {tip.text}
              </p>
            </div>
            <div className="flex-shrink-0 flex items-center gap-1">
              {GAMEPLAY_TIPS.map((_, i) => (
                <div
                  key={i}
                  className={`w-1 h-1 rounded-full transition-all duration-300 ${
                    i === tipIndex ? 'bg-amber-400 w-3' : 'bg-stone-700'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Inline Styles for custom animations ────────────────────────── */}
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }

        .bg-radial-vignette {
          background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%);
        }

        .scrollbar-none {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .scrollbar-none::-webkit-scrollbar {
          display: none;
        }

        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #f59e0b;
          border: 2px solid #fbbf24;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(245,158,11,0.4);
        }
      `}</style>
    </div>
  );
};
