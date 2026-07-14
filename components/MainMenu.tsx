import React, { useState, useEffect, useRef } from 'react';
import { FactionType, MapMode, MapSize } from '../types';
import { Shield, Users, Sword, X } from 'lucide-react';
import gsap from 'gsap';

interface MainMenuProps {
  onStart: (faction: FactionType, mode: MapMode, size: MapSize, fow: boolean, peaceful: boolean, treaty: number, aiDisabled: boolean) => void;
}

type MenuScreen = 'landing' | 'lobby' | 'stress-test';

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

  useEffect(() => {
    const tipInterval = setInterval(() => {
      setTipIndex(prev => (prev + 1) % GAMEPLAY_TIPS.length);
    }, 8000);
    return () => clearInterval(tipInterval);
  }, []);

  useEffect(() => {
    if (menuScreen === 'landing' && landingRef.current) {
      gsap.fromTo(
        landingRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.6, ease: 'power2.out' }
      );
    }
  }, [menuScreen]);

  useEffect(() => {
    if (menuScreen === 'lobby' && lobbyRef.current) {
      gsap.fromTo(
        lobbyRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.6, ease: 'power2.out' }
      );
    }
  }, [menuScreen]);

  useEffect(() => {
    if (menuScreen === 'stress-test' && stressRef.current) {
      gsap.fromTo(
        stressRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.6, ease: 'power2.out' }
      );
    }
  }, [menuScreen]);

  const handleStart = () => {
    onStart(selectedFaction, mapMode, mapSize, fowEnabled, peacefulMode, treatyLength, aiDisabled);
  };

  const handleStressTestStart = () => {
    const event = new CustomEvent('stressTestStart', {
      detail: { unitCount: stressUnitCount, enableEnemies: stressEnableEnemies }
    });
    window.dispatchEvent(event);
    onStart(selectedFaction, mapMode, mapSize, fowEnabled, peacefulMode, treatyLength, aiDisabled);
  };

  const handleNavigate = (screen: MenuScreen) => {
    gsap.to([landingRef.current, lobbyRef.current, stressRef.current], {
      opacity: 0,
      duration: 0.3,
      ease: 'power2.in',
      onComplete: () => setMenuScreen(screen)
    });
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full min-h-screen bg-black overflow-hidden"
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {/* Brutalist grid background */}
      <svg className="absolute inset-0 w-full h-full opacity-5 pointer-events-none" preserveAspectRatio="none">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* ═══════════════════ LANDING SCREEN ═══════════════════ */}
      {menuScreen === 'landing' && (
        <div
          ref={landingRef}
          className="relative z-10 w-full h-screen flex flex-col items-center justify-center px-6"
          style={{ opacity: 0 }}
        >
          {/* Title */}
          <div className="mb-16 text-center">
            <h1
              className="text-5xl md:text-7xl font-bold tracking-tighter leading-none mb-4"
              style={{ color: '#E8E8E8', letterSpacing: '0.05em' }}
            >
              CIV STRATEGY
            </h1>
            <div
              className="h-px w-32 mx-auto"
              style={{ backgroundColor: '#556B2F' }}
            />
          </div>

          {/* Menu buttons grid */}
          <div className="flex flex-col gap-6 mb-16">
            <button
              onClick={() => handleNavigate('lobby')}
              className="group relative px-12 py-4 border border-white transition-all duration-300 hover:bg-white"
              style={{
                color: '#E8E8E8',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: '0.9rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget;
                el.style.color = '#0F0F0F';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget;
                el.style.color = '#E8E8E8';
              }}
            >
              New Game
            </button>

            <button
              onClick={() => handleNavigate('stress-test')}
              className="group relative px-12 py-4 border border-white transition-all duration-300 hover:bg-white"
              style={{
                color: '#E8E8E8',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: '0.9rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget;
                el.style.color = '#0F0F0F';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget;
                el.style.color = '#E8E8E8';
              }}
            >
              Stress Test
            </button>
          </div>

          {/* Tip carousel */}
          <div className="max-w-md text-center">
            <h3
              className="text-sm font-bold uppercase tracking-widest mb-3"
              style={{ color: '#556B2F', letterSpacing: '0.2em' }}
            >
              {GAMEPLAY_TIPS[tipIndex].title}
            </h3>
            <p
              className="text-xs leading-relaxed"
              style={{ color: '#B0B0B0' }}
            >
              {GAMEPLAY_TIPS[tipIndex].text}
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════════ LOBBY SCREEN ═══════════════════ */}
      {menuScreen === 'lobby' && (
        <div
          ref={lobbyRef}
          className="relative z-10 w-full min-h-screen flex flex-col py-12 px-6"
          style={{ opacity: 0 }}
        >
          {/* Header */}
          <div className="max-w-6xl mx-auto w-full mb-12">
            <div className="flex items-center justify-between mb-8">
              <h2
                className="text-3xl md:text-4xl font-bold tracking-tight"
                style={{ color: '#E8E8E8', letterSpacing: '0.05em' }}
              >
                New Game
              </h2>
              <button
                onClick={() => handleNavigate('landing')}
                className="p-2 hover:bg-white/10 transition-colors"
              >
                <X size={24} color="#E8E8E8" />
              </button>
            </div>
            <div className="h-px" style={{ backgroundColor: '#2A2A2A' }} />
          </div>

          {/* Content */}
          <div className="max-w-6xl mx-auto w-full flex-1">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-12">
              {/* Faction Selection */}
              <div>
                <h3
                  className="text-sm font-bold uppercase tracking-widest mb-6"
                  style={{ color: '#556B2F', letterSpacing: '0.2em' }}
                >
                  Faction
                </h3>
                <div className="space-y-4">
                  {Object.values(FactionType).map((faction) => {
                    const info = FACTION_INFO[faction];
                    const Icon = info.icon;
                    const isSelected = faction === selectedFaction;
                    return (
                      <button
                        key={faction}
                        onClick={() => setSelectedFaction(faction)}
                        className="w-full p-4 border transition-all duration-300 text-left"
                        style={{
                          borderColor: isSelected ? '#E8E8E8' : '#2A2A2A',
                          backgroundColor: isSelected ? '#2A2A2A' : 'transparent',
                        }}
                      >
                        <div className="flex items-start gap-3 mb-2">
                          <Icon size={16} style={{ color: '#556B2F', marginTop: '2px', flexShrink: 0 }} />
                          <h4
                            className="text-sm font-bold uppercase tracking-wide"
                            style={{ color: '#E8E8E8' }}
                          >
                            {faction}
                          </h4>
                        </div>
                        <p className="text-xs leading-relaxed mb-2" style={{ color: '#B0B0B0' }}>
                          {info.desc}
                        </p>
                        <div className="flex justify-between text-[11px]">
                          <span style={{ color: '#556B2F' }}>{info.bonus}</span>
                          <span style={{ color: '#8B7355' }}>{info.playStyle}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Game Settings */}
              <div className="space-y-6">
                {/* Map Mode */}
                <div>
                  <h4
                    className="text-xs font-bold uppercase tracking-widest mb-3"
                    style={{ color: '#556B2F', letterSpacing: '0.2em' }}
                  >
                    Map Mode
                  </h4>
                  <div className="space-y-2">
                    {[MapMode.FIXED, MapMode.INFINITE].map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setMapMode(mode)}
                        className="w-full p-3 border text-left transition-all duration-300 text-xs uppercase tracking-wide"
                        style={{
                          borderColor: mapMode === mode ? '#E8E8E8' : '#2A2A2A',
                          backgroundColor: mapMode === mode ? '#2A2A2A' : 'transparent',
                          color: '#E8E8E8',
                        }}
                      >
                        {mode === MapMode.FIXED ? 'Fixed Map' : 'Infinite Realm'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Map Size */}
                <div>
                  <h4
                    className="text-xs font-bold uppercase tracking-widest mb-3"
                    style={{ color: '#556B2F', letterSpacing: '0.2em' }}
                  >
                    Map Size
                  </h4>
                  <div className="space-y-2">
                    {[MapSize.SMALL, MapSize.MEDIUM, MapSize.LARGE].map((size) => (
                      <button
                        key={size}
                        onClick={() => setMapSize(size)}
                        className="w-full p-3 border text-left transition-all duration-300 text-xs uppercase tracking-wide"
                        style={{
                          borderColor: mapSize === size ? '#E8E8E8' : '#2A2A2A',
                          backgroundColor: mapSize === size ? '#2A2A2A' : 'transparent',
                          color: '#E8E8E8',
                        }}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Toggles */}
                <div className="space-y-3">
                  {[
                    { label: 'Fog of War', value: fowEnabled, onChange: setFowEnabled },
                    { label: 'Peaceful Mode', value: peacefulMode, onChange: setPeacefulMode },
                    { label: 'Disable Enemy AI', value: aiDisabled, onChange: setAiDisabled },
                  ].map((toggle) => (
                    <button
                      key={toggle.label}
                      onClick={() => toggle.onChange(!toggle.value)}
                      className="w-full p-3 border flex items-center justify-between transition-all duration-300"
                      style={{
                        borderColor: '#2A2A2A',
                        backgroundColor: toggle.value ? '#2A2A2A' : 'transparent',
                      }}
                    >
                      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#E8E8E8' }}>
                        {toggle.label}
                      </span>
                      <div
                        className="w-4 h-4 border"
                        style={{
                          borderColor: toggle.value ? '#556B2F' : '#2A2A2A',
                          backgroundColor: toggle.value ? '#556B2F' : 'transparent',
                        }}
                      />
                    </button>
                  ))}
                </div>

                {/* Treaty Length */}
                {peacefulMode && (
                  <div>
                    <h4
                      className="text-xs font-bold uppercase tracking-widest mb-3"
                      style={{ color: '#556B2F', letterSpacing: '0.2em' }}
                    >
                      Peace Duration: {treatyLength} turns
                    </h4>
                    <input
                      type="range"
                      min="1"
                      max="60"
                      value={treatyLength}
                      onChange={(e) => setTreatyLength(parseInt(e.target.value))}
                      className="w-full"
                      style={{
                        accentColor: '#556B2F',
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-6 justify-center">
              <button
                onClick={() => handleNavigate('landing')}
                className="px-8 py-3 border border-white text-white transition-all duration-300 hover:bg-white hover:text-black text-sm uppercase tracking-widest font-bold"
              >
                Cancel
              </button>
              <button
                onClick={handleStart}
                className="px-8 py-3 border-2 text-sm uppercase tracking-widest font-bold transition-all duration-300"
                style={{
                  borderColor: '#556B2F',
                  color: '#556B2F',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  el.style.backgroundColor = '#556B2F';
                  el.style.color = '#E8E8E8';
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  el.style.backgroundColor = 'transparent';
                  el.style.color = '#556B2F';
                }}
              >
                Commence
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════ STRESS TEST SCREEN ═══════════════════ */}
      {menuScreen === 'stress-test' && (
        <div
          ref={stressRef}
          className="relative z-10 w-full min-h-screen flex flex-col items-center justify-center px-6 py-12"
          style={{ opacity: 0 }}
        >
          <div className="max-w-md w-full">
            {/* Header */}
            <div className="mb-12 text-center">
              <h2
                className="text-3xl md:text-4xl font-bold tracking-tight mb-4"
                style={{ color: '#E8E8E8', letterSpacing: '0.05em' }}
              >
                Flow Field Test
              </h2>
              <p className="text-xs leading-relaxed" style={{ color: '#B0B0B0' }}>
                Benchmark pathfinding with thousands of concurrent units
              </p>
            </div>

            {/* Controls */}
            <div className="space-y-6 mb-8">
              {/* Unit Count */}
              <div className="border p-4" style={{ borderColor: '#2A2A2A' }}>
                <div className="flex justify-between items-center mb-4">
                  <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#556B2F' }}>
                    Unit Count
                  </span>
                  <span className="text-sm font-bold" style={{ color: '#E8E8E8' }}>
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
                  className="w-full"
                  style={{ accentColor: '#556B2F' }}
                />
              </div>

              {/* Enable Enemies */}
              <button
                onClick={() => setStressEnableEnemies(!stressEnableEnemies)}
                className="w-full p-4 border flex items-center justify-between transition-all duration-300"
                style={{
                  borderColor: stressEnableEnemies ? '#8B4513' : '#2A2A2A',
                  backgroundColor: stressEnableEnemies ? '#2A2A2A' : 'transparent',
                }}
              >
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#E8E8E8' }}>
                  Spawn Enemy Units
                </span>
                <div
                  className="w-4 h-4 border"
                  style={{
                    borderColor: stressEnableEnemies ? '#8B4513' : '#2A2A2A',
                    backgroundColor: stressEnableEnemies ? '#8B4513' : 'transparent',
                  }}
                />
              </button>
            </div>

            {/* Action buttons */}
            <div className="flex gap-4">
              <button
                onClick={() => handleNavigate('landing')}
                className="flex-1 px-6 py-3 border border-white text-white transition-all duration-300 hover:bg-white hover:text-black text-xs uppercase tracking-widest font-bold"
              >
                Back
              </button>
              <button
                onClick={handleStressTestStart}
                className="flex-1 px-6 py-3 border-2 text-xs uppercase tracking-widest font-bold transition-all duration-300"
                style={{
                  borderColor: '#556B2F',
                  color: '#556B2F',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  el.style.backgroundColor = '#556B2F';
                  el.style.color = '#E8E8E8';
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  el.style.backgroundColor = 'transparent';
                  el.style.color = '#556B2F';
                }}
              >
                Launch
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        input[type="range"] {
          appearance: none;
          -webkit-appearance: none;
          width: 100%;
          height: 2px;
          border-radius: 0;
          background: #2A2A2A;
          outline: none;
        }

        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 0;
          background: #556B2F;
          cursor: pointer;
          border: 1px solid #556B2F;
        }

        input[type="range"]::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 0;
          background: #556B2F;
          cursor: pointer;
          border: 1px solid #556B2F;
        }

        input[type="range"]::-moz-range-track {
          background: transparent;
          border: none;
        }
      `}</style>
    </div>
  );
};
