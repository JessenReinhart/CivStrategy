import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FactionType, MapMode, MapSize } from '../types';
import { FACTION_COLORS } from '../constants';
import {
  Shield, Users, Sword, Globe, Infinity as InfinityIcon,
  Eye, Map as MapIcon, Maximize, Handshake, Clock,
  ChevronRight, Star, Sparkles, BookOpen, Armchair, DoorOpen,
  Activity
} from 'lucide-react';
import gsap from 'gsap';

// ─── Type Definitions ───────────────────────────────────────────────────────
interface MainMenuProps {
  onStart: (faction: FactionType, mode: MapMode, size: MapSize, fow: boolean, peaceful: boolean, treaty: number, aiDisabled: boolean) => void;
}

type MenuScreen = 'landing' | 'lobby' | 'stress-test';

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

// ─── Custom SplitText Utility (Free GSAP alternative) ───────────────────────
function splitTextIntoSpans(text: string): React.ReactNode[] {
  return text.split('').map((char, i) => (
    <span
      key={`${text}-${i}`}
      className="inline-block"
      style={{ overflow: 'visible' }}
    >
      {char === ' ' ? '\u00A0' : char}
    </span>
  ));
}

// ─── Main Component ─────────────────────────────────────────────────────────
export const MainMenu: React.FC<MainMenuProps> = ({ onStart }) => {
  // ── Screen State ──────────────────────────────────────────────────────────
  const [menuScreen, setMenuScreen] = useState<MenuScreen>('landing');

  // ── Game Settings State ───────────────────────────────────────────────────
  const [selectedFaction, setSelectedFaction] = useState<FactionType>(FactionType.ROMANS);
  const [mapMode, setMapMode] = useState<MapMode>(MapMode.FIXED);
  const [mapSize, setMapSize] = useState<MapSize>(MapSize.MEDIUM);
  const [fowEnabled, setFowEnabled] = useState<boolean>(true);
  const [peacefulMode, setPeacefulMode] = useState<boolean>(false);
  const [treatyLength, setTreatyLength] = useState<number>(10);
  const [aiDisabled, setAiDisabled] = useState<boolean>(false);
  const [stressUnitCount, setStressUnitCount] = useState<number>(500);
  const [tipIndex, setTipIndex] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // ── Refs ───────────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const sealRef = useRef<HTMLButtonElement>(null);
  const menuItemsRef = useRef<HTMLDivElement>(null);
  const lobbyRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLCanvasElement>(null);
  const masterTlRef = useRef<gsap.core.Timeline | null>(null);
  const particleAnimRef = useRef<number>(0);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

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
    const colors = ['rgba(212,175,55,', 'rgba(245,241,232,', 'rgba(184,168,138,', 'rgba(255,223,143,'];

    const createParticle = (): Particle => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.2, vy: -(Math.random() * 0.15 + 0.05),
      size: Math.random() * 2.5 + 0.5,
      alpha: Math.random() * 0.3 + 0.05,
      life: 0, maxLife: Math.random() * 300 + 300,
      color: colors[Math.floor(Math.random() * colors.length)],
    });

    for (let i = 0; i < 60; i++) particles.push(createParticle());

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

  // ── GSAP Master Load-In Timeline ──────────────────────────────────────────
  useEffect(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    // Setup: hide everything
    if (titleRef.current) {
      const chars = titleRef.current.querySelectorAll('.char');
      gsap.set(chars, { opacity: 0, y: 80, rotationX: -90, transformOrigin: '50% 50% -50' });
    }
    if (sealRef.current) gsap.set(sealRef.current, { opacity: 0, scale: 0.85 });
    if (menuItemsRef.current) {
      const items = menuItemsRef.current.querySelectorAll('.menu-item');
      gsap.set(items, { opacity: 0, y: 40, filter: 'blur(6px)' });
    }
    if (lobbyRef.current) gsap.set(lobbyRef.current, { opacity: 0, scale: 0.95, display: 'none' });

    // Phase 1: Title entrance (0.6s)
    if (titleRef.current) {
      const chars = titleRef.current.querySelectorAll('.char');
      tl.to(chars, {
        opacity: 1, y: 0, rotationX: 0,
        stagger: 0.03,
        duration: 1.2,
        ease: 'back.out(1.2)'
      }, 0.6);
    }

    // Phase 2: Play button materializes (1.4s)
    if (sealRef.current) {
      tl.to(sealRef.current, {
        opacity: 1, scale: 1, duration: 1, ease: 'power4.out'
      }, 1.4);
    }

    // Phase 3: Menu items stagger up (1.8s)
    if (menuItemsRef.current) {
      const items = menuItemsRef.current.querySelectorAll('.menu-item');
      tl.to(items, {
        opacity: 1, y: 0, filter: 'blur(0px)',
        stagger: { each: 0.1, from: 'center' },
        duration: 0.8,
        ease: 'power3.out'
      }, 1.8);
    }

    masterTlRef.current = tl;

    return () => { tl.kill(); };
  }, []);

  // ── Play Button Ambient Pulse ─────────────────────────────────────────────
  useEffect(() => {
    if (!sealRef.current) return;
    const pulse = gsap.to(sealRef.current, {
      boxShadow: '0 0 30px rgba(212,175,55,0.25), 0 0 60px rgba(212,175,55,0.1)',
      duration: 3, repeat: -1, yoyo: true, ease: 'sine.inOut'
    });
    return () => { pulse.kill(); };
  }, []);

  // ── Magnetic Pull on Play Button ──────────────────────────────────────────
  useEffect(() => {
    const btn = sealRef.current;
    if (!btn) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = btn.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = (e.clientX - centerX) / rect.width;
      const deltaY = (e.clientY - centerY) / rect.height;
      const pullX = deltaX * 12;
      const pullY = deltaY * 8;

      gsap.to(btn, {
        x: pullX, y: pullY,
        duration: 0.3,
        ease: 'power2.out'
      });
    };

    const handleMouseLeave = () => {
      gsap.to(btn, {
        x: 0, y: 0,
        duration: 0.5,
        ease: 'elastic.out(1, 0.5)'
      });
    };

    btn.addEventListener('mousemove', handleMouseMove);
    btn.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      btn.removeEventListener('mousemove', handleMouseMove);
      btn.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [menuScreen]);

  // ── Lobby Transition ──────────────────────────────────────────────────────
  const enterLobby = useCallback(() => {
    const tl = gsap.timeline({
      onComplete: () => setMenuScreen('lobby')
    });

    if (titleRef.current) {
      tl.to(titleRef.current, { opacity: 0, y: -40, duration: 0.5, ease: 'power2.in' }, 0);
    }
    if (sealRef.current) {
      tl.to(sealRef.current, { opacity: 0, scale: 0.9, duration: 0.4, ease: 'power2.in' }, 0);
    }
    if (menuItemsRef.current) {
      const items = menuItemsRef.current.querySelectorAll('.menu-item');
      tl.to(items, { opacity: 0, y: -20, duration: 0.4, stagger: 0.05, ease: 'power2.in' }, 0);
    }

    // After exit, fade in lobby
    setTimeout(() => {
      if (lobbyRef.current) {
        gsap.set(lobbyRef.current, { display: 'flex' });
        gsap.fromTo(lobbyRef.current,
          { opacity: 0, scale: 0.95 },
          { opacity: 1, scale: 1, duration: 0.8, ease: 'power3.out' }
        );
      }
    }, 500);
  }, []);

  // ── Start Handler ─────────────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    // Cinematic exit
    const tl = gsap.timeline({
      onComplete: () => {
        onStart(selectedFaction, mapMode, mapSize, fowEnabled, peacefulMode, treatyLength, aiDisabled);
      }
    });

    tl.to(containerRef.current, {
      opacity: 0,
      duration: 0.8,
      ease: 'power2.inOut'
    });
  }, [onStart, selectedFaction, mapMode, mapSize, fowEnabled, peacefulMode, treatyLength, aiDisabled]);

  const handleStressTestStart = useCallback(() => {
    const tl = gsap.timeline({
      onComplete: () => {
        // Emit a custom event that App.tsx will intercept to launch stress test mode
        window.dispatchEvent(new CustomEvent('start-stress-test', { detail: { unitCount: stressUnitCount } }));
      }
    });
    tl.to(containerRef.current, {
      opacity: 0,
      duration: 0.8,
      ease: 'power2.inOut'
    });
  }, [stressUnitCount]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const titleChars = splitTextIntoSpans('CIV STRATEGY');

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="absolute inset-0 z-50 flex flex-col items-center justify-center overflow-hidden transition-opacity duration-800"
      style={{
        background: 'radial-gradient(ellipse at 50% 120%, #2E2824 0%, #1A1612 60%, #0F0C0A 100%)',
      }}
    >
      {/* ── Background Layers ─────────────────────────────────────────────── */}
      <div className="absolute inset-0 bg-gradient-to-tr from-amber-950/10 via-transparent to-amber-900/5 pointer-events-none" />

      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(15,12,10,0.7) 100%)',
        }}
      />

      {/* Parallax ambient glow */}
      <div
        className="absolute w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) translate(${mousePos.x * 25}px, ${mousePos.y * 15}px)`,
          background: 'radial-gradient(circle, rgba(212,175,55,0.06) 0%, transparent 70%)',
          transition: 'transform 0.3s ease-out',
        }}
      />

      {/* Dust particles canvas */}
      <canvas
        ref={particlesRef}
        className="absolute inset-0 pointer-events-none"
      />

      {/* Corner decorations */}
      <div className="absolute top-0 left-0 w-24 h-24 pointer-events-none">
        <div className="absolute top-0 left-0 w-12 h-px bg-gradient-to-r from-[var(--gold-leaf)]/40 to-transparent" />
        <div className="absolute top-0 left-0 h-12 w-px bg-gradient-to-b from-[var(--gold-leaf)]/40 to-transparent" />
      </div>
      <div className="absolute top-0 right-0 w-24 h-24 pointer-events-none">
        <div className="absolute top-0 right-0 w-12 h-px bg-gradient-to-l from-[var(--gold-leaf)]/40 to-transparent" />
        <div className="absolute top-0 right-0 h-12 w-px bg-gradient-to-b from-[var(--gold-leaf)]/40 to-transparent" />
      </div>
      <div className="absolute bottom-0 left-0 w-24 h-24 pointer-events-none">
        <div className="absolute bottom-0 left-0 w-12 h-px bg-gradient-to-r from-[var(--gold-leaf)]/40 to-transparent" />
        <div className="absolute bottom-0 left-0 h-12 w-px bg-gradient-to-t from-[var(--gold-leaf)]/40 to-transparent" />
      </div>
      <div className="absolute bottom-0 right-0 w-24 h-24 pointer-events-none">
        <div className="absolute bottom-0 right-0 w-12 h-px bg-gradient-to-l from-[var(--gold-leaf)]/40 to-transparent" />
        <div className="absolute bottom-0 right-0 h-12 w-px bg-gradient-to-t from-[var(--gold-leaf)]/40 to-transparent" />
      </div>

      {/* Top/Bottom hairlines */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--gold-leaf)]/20 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--gold-leaf)]/20 to-transparent" />

      {/* ═══════════════════ LANDING SCREEN ═══════════════════ */}
      {menuScreen === 'landing' && (
        <div className="relative z-10 flex flex-col items-center h-screen justify-center">
          {/* ── Title ─────────────────────────────────────────────────────── */}
          <div className="flex flex-col items-center mb-16">
            {/* Decorative line above title */}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-16 h-px bg-gradient-to-r from-transparent to-[var(--gold-leaf)]/50" />
              <span
                className="text-[10px] font-bold tracking-[0.35em] uppercase"
                style={{ color: 'var(--gold-leaf)' }}
              >
                Real-Time Strategy
              </span>
              <div className="w-16 h-px bg-gradient-to-l from-transparent to-[var(--gold-leaf)]/50" />
            </div>

            {/* Main Title with GSAP SplitText */}
            <h1
              ref={titleRef}
              className="relative flex items-center justify-center select-none"
              style={{
                fontFamily: "'Cinzel', serif",
                fontSize: 'clamp(2.8rem, 7vw, 6rem)',
                fontWeight: 300,
                letterSpacing: '0.15em',
                lineHeight: 1,
              }}
            >
              {/* Title glow */}
              <span
                className="absolute inset-0 select-none pointer-events-none"
                style={{
                  background: 'linear-gradient(180deg, rgba(212,175,55,0.25), transparent)',
                  filter: 'blur(24px)',
                  transform: 'translateY(6px)',
                  WebkitTextStroke: '0px',
                }}
              >
                CIV STRATEGY
              </span>
              {/* Title text */}
              <span className="relative flex">
                {titleChars}
              </span>
            </h1>

            {/* Subtitle */}
            <p
              className="mt-4 text-lg md:text-xl tracking-[0.2em] uppercase"
              style={{ color: 'var(--limestone)', fontFamily: "'Inter', sans-serif", fontWeight: 300 }}
            >
              Ancient Realms
            </p>

            {/* Tagline */}
            <p
              className="mt-3 text-[10px] tracking-[0.3em] uppercase font-mono"
              style={{ color: 'var(--sandstone)' }}
            >
              Forge Your Empire · Command Your Legacy
            </p>
          </div>

          {/* ── The Seal (Play Button) ────────────────────────────────────── */}
          <button
            ref={sealRef}
            onClick={enterLobby}
            className="group relative px-16 py-5 rounded-full overflow-hidden cursor-pointer transition-none"
            style={{
              border: '1.5px solid var(--limestone)',
              background: 'transparent',
              backdropFilter: 'blur(0px)',
            }}
          >
            {/* Liquid fill SVG mask */}
            <div
              className="absolute inset-[1.5px] rounded-full overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, #D4AF37 0%, #FFDF8F 50%, #D4AF37 100%)',
                transform: 'scale(0)',
                transformOrigin: 'center center',
                transition: 'none',
              }}
              ref={(el) => {
                if (el) {
                  const btn = sealRef.current;
                  if (btn) {
                    btn.addEventListener('mouseenter', () => {
                      gsap.to(el, { scale: 1, duration: 0.8, ease: 'elastic.out(1, 0.5)' });
                      // Switch text to dark when filled
                      const text = btn.querySelector('.seal-text');
                      if (text) gsap.to(text, { color: '#1A1612', duration: 0.3 });
                    });
                    btn.addEventListener('mouseleave', () => {
                      gsap.to(el, { scale: 0, duration: 0.5, ease: 'power2.in' });
                      // Switch text back to light
                      const text = btn.querySelector('.seal-text');
                      if (text) gsap.to(text, { color: 'var(--dust-white)', duration: 0.3 });
                    });
                  }
                }
              }}
            />

            {/* Shimmer sweep */}
            <div
              className="absolute inset-[1.5px] rounded-full overflow-hidden opacity-0 group-hover:opacity-100"
              style={{
                background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)',
                backgroundSize: '200% 100%',
              }}
              ref={(el) => {
                if (el) {
                  const btn = sealRef.current;
                  if (btn) {
                    btn.addEventListener('mouseenter', () => {
                      gsap.fromTo(el,
                        { x: '-200%' },
                        { x: '200%', duration: 1.2, ease: 'power2.inOut', repeat: -1, repeatDelay: 0.6 }
                      );
                    });
                    btn.addEventListener('mouseleave', () => {
                      // Kill shimmer on leave
                    });
                  }
                }
              }}
            />

            {/* Inner border */}
            <div
              className="absolute inset-[2px] rounded-full pointer-events-none"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            />

            {/* Button text */}
            <span
              className="relative z-10 flex items-center gap-3 select-none seal-text"
              style={{
                fontFamily: "'Inter', sans-serif",
                fontWeight: 500,
                fontSize: 'clamp(1.1rem, 2vw, 1.4rem)',
                letterSpacing: '0.1em',
                color: 'var(--dust-white)',
                transition: 'none',
              }}
            >
              <Sparkles size={18} className="transition-transform duration-300 group-hover:rotate-12" />
              COMMENCE
              <ChevronRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
            </span>
          </button>

          {/* ── The Codex (Menu Items) ────────────────────────────────────── */}
          <div
            ref={menuItemsRef}
            className="flex items-center gap-12 md:gap-16 mt-16"
          >
            {[
              { label: 'Campaign', icon: BookOpen, action: 'lobby' as const },
              { label: 'Stress Test', icon: Activity, action: 'stress' as const },
              { label: 'Multiplayer', icon: Users, action: 'coming' as const },
              { label: 'Armory', icon: Armchair, action: 'coming' as const },
              { label: 'Settings', icon: Star, action: 'settings' as const },
              { label: 'Quit', icon: DoorOpen, action: 'quit' as const },
            ].map((item) => (
              <button
                key={item.label}
                className={`menu-item group relative flex items-center gap-2 bg-transparent border-none outline-none ${item.action === 'coming' ? 'cursor-default opacity-50' : 'cursor-pointer'}`}
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 400,
                  fontSize: 'clamp(0.9rem, 1.4vw, 1.1rem)',
                  letterSpacing: '0.06em',
                  color: 'var(--parchment)',
                  padding: '0.5rem 0',
                  transition: 'none',
                }}
                onClick={() => {
                  switch (item.action) {
                    case 'lobby':
                      enterLobby();
                      break;
                    case 'stress':
                      setMenuScreen('stress-test');
                      break;
                    case 'settings':
                      enterLobby();
                      break;
                    case 'quit':
                      window.location.reload();
                      break;
                    case 'coming':
                      // No action - feature not yet implemented
                      break;
                  }
                }}
                ref={(el) => {
                  if (el) {
                    const handleMouseEnter = () => {
                      gsap.to(el, {
                        color: 'var(--dust-white)',
                        x: 12,
                        duration: 0.3,
                        ease: 'power2.out'
                      });
                      // Bullet flick in
                      const bullet = el.querySelector('.bullet');
                      if (bullet) {
                        gsap.to(bullet, {
                          opacity: 1, x: 0, scale: 1,
                          duration: 0.4,
                          ease: 'back.out(2)'
                        });
                      }
                      // Underline draw
                      const line = el.querySelector('.underline');
                      if (line) {
                        gsap.fromTo(line, 
                          { scaleX: 0 } as Record<string, unknown>,
                          { scaleX: 1, duration: 0.4, ease: 'power2.out' } as Record<string, unknown>
                        );
                      }
                    };

                    const handleMouseLeave = () => {
                      gsap.to(el, {
                        color: 'var(--parchment)',
                        x: 0,
                        duration: 0.4,
                        ease: 'power2.out'
                      });
                      const bullet = el.querySelector('.bullet');
                      if (bullet) {
                        gsap.to(bullet, {
                          opacity: 0, x: -8, scale: 0.5,
                          duration: 0.25,
                          ease: 'power2.in'
                        });
                      }
                      const line = el.querySelector('.underline');
                      if (line) {
                        gsap.to(line, { scaleX: 0, duration: 0.25, ease: 'power2.in' } as Record<string, unknown>);
                      }
                    };

                    el.addEventListener('mouseenter', handleMouseEnter);
                    el.addEventListener('mouseleave', handleMouseLeave);

                    return () => {
                      el.removeEventListener('mouseenter', handleMouseEnter);
                      el.removeEventListener('mouseleave', handleMouseLeave);
                    };
                  }
                }}
              >
                {/* Bullet */}
                <span
                  className="bullet flex-shrink-0 opacity-0"
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--gold-leaf)',
                    transform: 'translateX(-8px) scale(0.5)',
                    transition: 'none',
                  }}
                />
                {/* Label */}
                <span className="relative">
                  {item.label}
                  {/* Underline */}
                  <span
                    className="underline absolute bottom-0 left-0 h-px origin-left"
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--gold-leaf)',
                      transform: 'scaleX(0)',
                      transformOrigin: 'left center',
                      transition: 'none',
                    }}
                  />
                </span>
                {/* Icon (subtle) */}
                <item.icon size={14} className="opacity-0 group-hover:opacity-50 transition-opacity duration-300 ml-1" style={{ color: 'var(--gold-leaf)' }} />
              </button>
            ))}
          </div>

          {/* ── Version Metadata ──────────────────────────────────────────── */}
          <div
            className="absolute bottom-6 right-8"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.65rem',
              color: 'var(--sandstone)',
              letterSpacing: '0.05em',
            }}
          >
            v0.0.1 — Ancient Realms
          </div>
        </div>
      )}

      {/* ═══════════════════ LOBBY SCREEN ═══════════════════ */}
      {menuScreen === 'lobby' && (
        <div
          ref={lobbyRef}
          className="relative z-10 max-w-6xl w-full flex flex-col items-center h-screen overflow-y-auto scrollbar-none py-16"
        >
          {/* ── Section Title ─────────────────────────────────────────────── */}
          <div className="flex flex-col items-center mb-12">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-px bg-gradient-to-r from-transparent to-[var(--gold-leaf)]/40" />
              <span
                className="text-[10px] font-bold tracking-[0.35em] uppercase"
                style={{ color: 'var(--gold-leaf)' }}
              >
                War Council
              </span>
              <div className="w-12 h-px bg-gradient-to-l from-transparent to-[var(--gold-leaf)]/40" />
            </div>
            <h2
              className="text-3xl md:text-4xl tracking-[0.12em] uppercase"
              style={{
                fontFamily: "'Cinzel', serif",
                fontWeight: 300,
                color: 'var(--dust-white)',
              }}
            >
              Choose Your Legacy
            </h2>
          </div>

          {/* ── Faction Slabs ─────────────────────────────────────────────── */}
          <div
            ref={cardsRef}
            className="flex flex-col md:flex-row w-full max-w-5xl mb-16"
            style={{ border: '1px solid var(--limestone)' }}
          >
            {Object.values(FactionType).map((faction, idx) => {
              const info = FACTION_INFO[faction];
              const Icon = info.icon;
              const isSelected = selectedFaction === faction;
              const colorHex = '#' + FACTION_COLORS[faction].toString(16).padStart(6, '0');
              const isLast = idx === 2;

              return (
                <button
                  key={faction}
                  onClick={() => setSelectedFaction(faction)}
                  className="group relative flex-1 text-left cursor-pointer bg-transparent border-none outline-none p-0"
                  style={{
                    borderRight: isLast ? 'none' : '1px solid var(--limestone)',
                  }}
                >
                  {/* Hover glow */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    style={{
                      background: `radial-gradient(ellipse at 50% 0%, ${colorHex}10 0%, transparent 70%)`,
                    }}
                  />

                  {/* Content */}
                  <div className="relative p-8">
                    {/* Faction color accent top bar */}
                    <div
                      className="absolute top-0 left-0 right-0 h-px transition-all duration-500"
                      style={{
                        background: isSelected ? `linear-gradient(90deg, transparent, ${colorHex}, transparent)` : 'transparent',
                        opacity: isSelected ? 1 : 0,
                      }}
                    />

                    {/* Icon */}
                    <div className="mb-6">
                      <div
                        className="w-12 h-12 flex items-center justify-center transition-all duration-500"
                        style={{
                          backgroundColor: isSelected ? colorHex : 'transparent',
                          border: `1px solid ${isSelected ? colorHex : 'var(--limestone)'}`,
                        }}
                      >
                        <Icon size={24} className={isSelected ? 'text-white' : 'text-[var(--parchment)]'} />
                      </div>
                    </div>

                    {/* Name */}
                    <h3
                      className="text-lg mb-2 transition-colors duration-300"
                      style={{
                        fontFamily: "'Cinzel', serif",
                        color: isSelected ? 'var(--dust-white)' : 'var(--parchment)',
                      }}
                    >
                      {faction}
                    </h3>

                    {/* Description */}
                    <p
                      className="text-xs mb-6 leading-relaxed"
                      style={{ color: 'var(--sandstone)', maxWidth: '240px' }}
                    >
                      {info.desc}
                    </p>

                    {/* Bonus */}
                    <div
                      className="inline-block px-3 py-2"
                      style={{
                        border: `1px solid ${isSelected ? 'var(--gold-leaf)' : 'var(--limestone)'}`,
                        borderColor: isSelected ? 'var(--gold-leaf)' : 'var(--limestone)',
                        opacity: isSelected ? 1 : 0.6,
                        transition: 'all 0.3s ease',
                      }}
                    >
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest block mb-1"
                        style={{ color: isSelected ? 'var(--gold-leaf)' : 'var(--sandstone)' }}
                      >
                        Faction Bonus
                      </span>
                      <span
                        className="text-sm font-semibold"
                        style={{ color: isSelected ? 'var(--dust-white)' : 'var(--parchment)' }}
                      >
                        {info.bonus}
                      </span>
                    </div>

                    {/* Selected indicator */}
                    {isSelected && (
                      <div
                        className="absolute bottom-0 left-0 right-0 h-px"
                        style={{
                          background: `linear-gradient(90deg, transparent, ${colorHex}, transparent)`,
                        }}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Divider ───────────────────────────────────────────────────── */}
          <div className="flex items-center gap-4 mb-12 max-w-5xl w-full">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent to-[var(--limestone)]/30" />
            <span
              className="text-[10px] font-bold tracking-[0.35em] uppercase"
              style={{ color: 'var(--gold-leaf)' }}
            >
              Campaign Parameters
            </span>
            <div className="flex-1 h-px bg-gradient-to-l from-transparent to-[var(--limestone)]/30" />
          </div>

          {/* ── Settings Row ──────────────────────────────────────────────── */}
          <div
            ref={settingsRef}
            className="w-full max-w-5xl mb-16"
            style={{ border: '1px solid var(--limestone)' }}
          >
            <div className="flex flex-col md:flex-row">
              {/* Map Mode */}
              <div className="flex-1 p-6 md:p-8" style={{ borderRight: '1px solid var(--limestone)' }}>
                <h4
                  className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2"
                  style={{ color: 'var(--gold-leaf)' }}
                >
                  <Globe size={14} /> Map Mode
                </h4>
                <div className="flex flex-col gap-0">
                  {[
                    { mode: MapMode.FIXED, icon: Globe, label: 'Fixed Map' },
                    { mode: MapMode.INFINITE, icon: InfinityIcon, label: 'Infinite Realm' },
                  ].map(({ mode, icon: Icon, label }) => (
                    <button
                      key={mode}
                      onClick={() => setMapMode(mode)}
                      className="group flex items-center gap-3 py-3 cursor-pointer bg-transparent border-none outline-none text-left"
                      style={{
                        borderBottom: '1px solid var(--limestone)',
                        color: mapMode === mode ? 'var(--dust-white)' : 'var(--parchment)',
                        transition: 'color 0.3s ease',
                      }}
                    >
                      <span
                        className="w-2 h-2 transition-all duration-300"
                        style={{
                          backgroundColor: mapMode === mode ? 'var(--gold-leaf)' : 'transparent',
                          border: mapMode === mode ? 'none' : '1px solid var(--limestone)',
                        }}
                      />
                      <Icon size={14} style={{ color: mapMode === mode ? 'var(--gold-leaf)' : 'var(--sandstone)' }} />
                      <span className="text-xs font-bold">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Map Size */}
              <div
                className={`flex-1 p-6 md:p-8 ${mapMode === MapMode.INFINITE ? 'opacity-20 pointer-events-none' : ''}`}
                style={{ borderRight: '1px solid var(--limestone)' }}
              >
                <h4
                  className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2"
                  style={{ color: 'var(--gold-leaf)' }}
                >
                  <Maximize size={14} /> Map Size
                </h4>
                <div className="flex flex-col gap-0">
                  {Object.values(MapSize).map((size, idx) => (
                    <button
                      key={size}
                      onClick={() => setMapSize(size)}
                      className="group flex items-center gap-3 py-3 cursor-pointer bg-transparent border-none outline-none text-left"
                      style={{
                        borderBottom: '1px solid var(--limestone)',
                        color: mapSize === size ? 'var(--dust-white)' : 'var(--parchment)',
                        transition: 'color 0.3s ease',
                      }}
                    >
                      <span
                        className="w-2 h-2 transition-all duration-300"
                        style={{
                          backgroundColor: mapSize === size ? 'var(--gold-leaf)' : 'transparent',
                          border: mapSize === size ? 'none' : '1px solid var(--limestone)',
                        }}
                      />
                      <MapIcon size={14} style={{ color: mapSize === size ? 'var(--gold-leaf)' : 'var(--sandstone)' }} />
                      <span className="text-xs font-bold">{size}</span>
                      <span className="text-[10px] ml-auto" style={{ color: 'var(--sandstone)' }}>
                        {idx === 0 ? '1K' : idx === 1 ? '2K' : '4K'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Diplomacy */}
              <div className="flex-1 p-6 md:p-8" style={{ borderRight: '1px solid var(--limestone)' }}>
                <h4
                  className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2"
                  style={{ color: 'var(--gold-leaf)' }}
                >
                  <Handshake size={14} /> Diplomacy
                </h4>

                <button
                  onClick={() => setPeacefulMode(!peacefulMode)}
                  className="flex items-center justify-between w-full py-3 cursor-pointer bg-transparent border-none outline-none text-left"
                  style={{
                    borderBottom: '1px solid var(--limestone)',
                    color: peacefulMode ? 'var(--dust-white)' : 'var(--parchment)',
                  }}
                >
                  <span className="text-xs font-bold">Peaceful</span>
                  <span
                    className="w-2 h-2"
                    style={{
                      backgroundColor: peacefulMode ? 'var(--gold-leaf)' : 'transparent',
                      border: peacefulMode ? 'none' : '1px solid var(--limestone)',
                    }}
                  />
                </button>

                <div className={`py-3 ${peacefulMode ? 'opacity-20 pointer-events-none' : ''}`} style={{ borderBottom: '1px solid var(--limestone)' }}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-bold flex items-center gap-1" style={{ color: 'var(--sandstone)' }}>
                      <Clock size={10} /> Treaty
                    </span>
                    <span className="text-[11px] font-mono font-bold" style={{ color: 'var(--gold-leaf)' }}>{treatyLength}m</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="60"
                    step="5"
                    value={treatyLength}
                    onChange={(e) => setTreatyLength(parseInt(e.target.value))}
                    className="w-full h-px appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, var(--gold-leaf) 0%, var(--gold-leaf) ${(treatyLength / 60) * 100}%, var(--shadow) ${(treatyLength / 60) * 100}%, var(--shadow) 100%)`,
                    }}
                  />
                </div>

                <button
                  onClick={() => setAiDisabled(!aiDisabled)}
                  className="flex items-center justify-between w-full py-3 cursor-pointer bg-transparent border-none outline-none text-left"
                  style={{ color: aiDisabled ? 'var(--dust-white)' : 'var(--parchment)' }}
                >
                  <span className="text-xs font-bold">Enemy AI</span>
                  <span
                    className="w-2 h-2"
                    style={{
                      backgroundColor: aiDisabled ? 'var(--gold-leaf)' : 'transparent',
                      border: aiDisabled ? 'none' : '1px solid var(--limestone)',
                    }}
                  />
                </button>
              </div>

              {/* Visuals */}
              <div className="flex-1 p-6 md:p-8">
                <h4
                  className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2"
                  style={{ color: 'var(--gold-leaf)' }}
                >
                  <Eye size={14} /> Visuals
                </h4>

                <button
                  onClick={() => setFowEnabled(!fowEnabled)}
                  className="flex items-center justify-between w-full py-3 cursor-pointer bg-transparent border-none outline-none text-left"
                  style={{
                    borderBottom: '1px solid var(--limestone)',
                    color: 'var(--parchment)',
                  }}
                >
                  <span className="text-xs font-bold">Fog of War</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px]" style={{ color: fowEnabled ? 'var(--gold-leaf)' : 'var(--sandstone)' }}>
                      {fowEnabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                    <span
                      className="w-2 h-2"
                      style={{
                        backgroundColor: fowEnabled ? 'var(--gold-leaf)' : 'transparent',
                        border: fowEnabled ? 'none' : '1px solid var(--limestone)',
                      }}
                    />
                  </div>
                </button>

                <div className="py-3">
                  <span className="text-[10px] block mb-2" style={{ color: 'var(--sandstone)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Selected Faction
                  </span>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3"
                      style={{ backgroundColor: '#' + FACTION_COLORS[selectedFaction].toString(16).padStart(6, '0') }}
                    />
                    <span className="text-xs font-bold" style={{ color: 'var(--dust-white)' }}>{selectedFaction}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Actions Row ───────────────────────────────────────────────── */}
          <div className="flex items-center gap-12">
            {/* Back */}
            <button
              onClick={() => {
                const tl = gsap.timeline({
                  onComplete: () => setMenuScreen('landing')
                });
                tl.to(lobbyRef.current, {
                  opacity: 0, scale: 0.95, duration: 0.4, ease: 'power2.in'
                });
              }}
              className="group relative flex items-center gap-3 cursor-pointer bg-transparent border-none outline-none"
              style={{
                fontFamily: "'Inter', sans-serif",
                fontWeight: 400,
                fontSize: '0.85rem',
                letterSpacing: '0.08em',
                color: 'var(--parchment)',
              }}
            >
              <span
                className="w-2 h-2 transition-all duration-300"
                style={{ border: '1px solid var(--limestone)' }}
              />
              <span className="relative">
                Return to Title
                <span
                  className="absolute bottom-0 left-0 h-px origin-left"
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--gold-leaf)',
                    transform: 'scaleX(0)',
                    transition: 'transform 0.3s ease',
                  }}
                />
              </span>
            </button>

            {/* Commence */}
            <button
              ref={startButtonRef}
              onClick={handleStart}
              className="group relative px-14 py-4 rounded-full overflow-hidden cursor-pointer"
              style={{
                border: '1.5px solid var(--limestone)',
                background: 'transparent',
              }}
            >
              <div
                className="absolute inset-[1.5px] rounded-full overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, #D4AF37 0%, #FFDF8F 50%, #D4AF37 100%)',
                  transform: 'scale(0)',
                  transformOrigin: 'center center',
                }}
                ref={(el) => {
                  if (el) {
                    const btn = startButtonRef.current;
                    if (btn) {
                      btn.addEventListener('mouseenter', () => {
                        gsap.to(el, { scale: 1, duration: 0.8, ease: 'elastic.out(1, 0.5)' });
                        const text = btn.querySelector('.lobby-seal-text');
                        if (text) gsap.to(text, { color: '#1A1612', duration: 0.3 });
                      });
                      btn.addEventListener('mouseleave', () => {
                        gsap.to(el, { scale: 0, duration: 0.5, ease: 'power2.in' });
                        const text = btn.querySelector('.lobby-seal-text');
                        if (text) gsap.to(text, { color: 'var(--dust-white)', duration: 0.3 });
                      });
                    }
                  }
                }}
              />
              <div
                className="absolute inset-[1.5px] rounded-full overflow-hidden opacity-0 group-hover:opacity-100"
                style={{
                  background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)',
                  backgroundSize: '200% 100%',
                }}
                ref={(el) => {
                  if (el) {
                    const btn = startButtonRef.current;
                    if (btn) {
                      btn.addEventListener('mouseenter', () => {
                        gsap.fromTo(el,
                          { x: '-200%' },
                          { x: '200%', duration: 1.2, ease: 'power2.inOut', repeat: -1, repeatDelay: 0.6 }
                        );
                      });
                    }
                  }
                }}
              />
              <div className="absolute inset-[2px] rounded-full pointer-events-none" style={{ border: '1px solid rgba(255,255,255,0.08)' }} />
              <span
                className="relative z-10 flex items-center gap-3 select-none lobby-seal-text"
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 500,
                  fontSize: 'clamp(1rem, 1.6vw, 1.2rem)',
                  letterSpacing: '0.1em',
                  color: 'var(--dust-white)',
                }}
              >
                <Sparkles size={16} className="transition-transform duration-300 group-hover:rotate-12" />
                COMMENCE
                <ChevronRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════ STRESS TEST SCREEN ═══════════════════ */}
      {menuScreen === 'stress-test' && (
        <div className="relative z-10 flex flex-col items-center h-screen justify-center px-8">
          <div className="mb-8 text-center">
            <h2
              className="text-3xl md:text-4xl mb-3"
              style={{
                fontFamily: "'Cinzel', serif",
                fontWeight: 700,
                letterSpacing: '0.15em',
                color: 'var(--dust-white)',
              }}
            >
              FLOW FIELD STRESS TEST
            </h2>
            <p className="text-sm max-w-lg mx-auto" style={{ color: 'var(--sandstone)' }}>
              Spawn thousands of units and command them across the map to benchmark the
              Total Annihilation-style flow field pathfinder.
            </p>
          </div>

          <div
            className="w-full max-w-md p-8 mb-10"
            style={{ border: '1px solid var(--limestone)' }}
          >
            <div className="flex justify-between items-center mb-4">
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--gold-leaf)' }}>
                Unit Count
              </span>
              <span className="text-lg font-mono font-bold" style={{ color: 'var(--dust-white)' }}>
                {stressUnitCount}
              </span>
            </div>
            <input
              type="range"
              min="100"
              max="3000"
              step="100"
              value={stressUnitCount}
              onChange={(e) => setStressUnitCount(parseInt(e.target.value))}
              className="w-full h-1 appearance-none cursor-pointer mb-2"
              style={{
                background: `linear-gradient(to right, var(--gold-leaf) 0%, var(--gold-leaf) ${((stressUnitCount - 100) / 2900) * 100}%, var(--shadow) ${((stressUnitCount - 100) / 2900) * 100}%, var(--shadow) 100%)`,
              }}
            />
            <div className="flex justify-between text-[10px]" style={{ color: 'var(--sandstone)' }}>
              <span>100</span>
              <span>1,500</span>
              <span>3,000</span>
            </div>

            <div className="mt-6 flex items-center gap-3 p-3" style={{ background: 'rgba(212,175,55,0.05)', border: '1px solid var(--limestone)' }}>
              <Activity size={18} style={{ color: 'var(--gold-leaf)' }} />
              <div>
                <div className="text-xs font-bold" style={{ color: 'var(--dust-white)' }}>Flow Field Threshold</div>
                <div className="text-[10px]" style={{ color: 'var(--sandstone)' }}>
                  Groups of 12+ units automatically use flow fields for O(1) movement.
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-12">
            <button
              onClick={() => setMenuScreen('landing')}
              className="group relative flex items-center gap-3 cursor-pointer bg-transparent border-none outline-none"
              style={{
                fontFamily: "'Inter', sans-serif",
                fontWeight: 400,
                fontSize: '0.85rem',
                letterSpacing: '0.08em',
                color: 'var(--parchment)',
              }}
            >
              <span className="w-2 h-2" style={{ border: '1px solid var(--limestone)' }} />
              <span className="relative">
                Return to Title
                <span
                  className="absolute bottom-0 left-0 h-px origin-left"
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--gold-leaf)',
                    transform: 'scaleX(0)',
                    transition: 'transform 0.3s ease',
                  }}
                />
              </span>
            </button>

            <button
              onClick={handleStressTestStart}
              className="group relative px-14 py-4 rounded-full overflow-hidden cursor-pointer"
              style={{
                border: '1.5px solid var(--limestone)',
                background: 'transparent',
              }}
            >
              <div
                className="absolute inset-[1.5px] rounded-full overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, #D4AF37 0%, #FFDF8F 50%, #D4AF37 100%)',
                  transform: 'scale(0)',
                  transformOrigin: 'center center',
                }}
                ref={(el) => {
                  if (el) {
                    const btn = el.parentElement;
                    if (btn) {
                      btn.addEventListener('mouseenter', () => {
                        gsap.to(el, { scale: 1, duration: 0.8, ease: 'elastic.out(1, 0.5)' });
                      });
                      btn.addEventListener('mouseleave', () => {
                        gsap.to(el, { scale: 0, duration: 0.5, ease: 'power2.in' });
                      });
                    }
                  }
                }}
              />
              <span
                className="relative z-10 flex items-center gap-3 select-none"
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 500,
                  fontSize: 'clamp(1rem, 1.6vw, 1.2rem)',
                  letterSpacing: '0.1em',
                  color: 'var(--dust-white)',
                }}
              >
                <Activity size={16} />
                LAUNCH TEST
                <ChevronRight size={16} />
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ── Inline Styles ─────────────────────────────────────────────────── */}
      <style>{`
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
          background: #D4AF37;
          border: 2px solid #FFDF8F;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(212,175,55,0.4);
        }

        input[type="range"]::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #D4AF37;
          border: 2px solid #FFDF8F;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(212,175,55,0.4);
        }
      `}</style>
    </div>
  );
};
