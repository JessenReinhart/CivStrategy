
import React, { useState } from 'react';
import { FactionType, MapMode, MapSize } from '../types';
import { FACTION_COLORS } from '../constants';
import { Shield, Users, Sword, Globe, Infinity as InfinityIcon, Eye, EyeOff, Map as MapIcon, Maximize, Handshake, Clock } from 'lucide-react';

interface MainMenuProps {
  onStart: (faction: FactionType, mode: MapMode, size: MapSize, fow: boolean, peaceful: boolean, treaty: number, aiDisabled: boolean) => void;
}

const FACTION_INFO = {
  [FactionType.ROMANS]: {
    desc: 'Balanced economy and strong infantry.',
    bonus: '+10% Gold Generation',
    icon: Shield
  },
  [FactionType.GAULS]: {
    desc: 'Fast movement and cheap buildings.',
    bonus: '-10% Building Cost',
    icon: Sword
  },
  [FactionType.CARTHAGE]: {
    desc: 'Naval and trade focus. High population.',
    bonus: '+5 Max Population',
    icon: Users
  }
};

export const MainMenu: React.FC<MainMenuProps> = ({ onStart }) => {
  const [selectedFaction, setSelectedFaction] = useState<FactionType>(FactionType.ROMANS);
  const [mapMode, setMapMode] = useState<MapMode>(MapMode.FIXED);
  const [mapSize, setMapSize] = useState<MapSize>(MapSize.MEDIUM);
  const [fowEnabled, setFowEnabled] = useState<boolean>(true);
  const [peacefulMode, setPeacefulMode] = useState<boolean>(false);
  const [treatyLength, setTreatyLength] = useState<number>(10);
  const [aiDisabled, setAiDisabled] = useState<boolean>(false);

  return (
    <div className="absolute inset-0 bg-stone-900 flex flex-col items-center justify-center text-stone-100 z-50 bg-[url('https://picsum.photos/1920/1080?grayscale&blur=2')] bg-cover">
      <div className="absolute inset-0 bg-black/60" />

      <div className="relative z-10 max-w-6xl w-full p-8 flex flex-col items-center h-screen overflow-y-auto">
        <h1 className="text-7xl font-serif text-center mb-2 text-amber-500 drop-shadow-lg tracking-wider mt-4">CIV STRATEGY</h1>
        <p className="text-center text-stone-300 mb-8 text-xl italic">Ancient Realms</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 w-full">
          {Object.values(FactionType).map((faction) => {
            const info = FACTION_INFO[faction];
            const Icon = info.icon;
            const isSelected = selectedFaction === faction;
            const colorHex = '#' + FACTION_COLORS[faction].toString(16).padStart(6, '0');

            return (
              <button
                key={faction}
                onClick={() => setSelectedFaction(faction)}
                className={`group relative bg-stone-800/80 backdrop-blur-sm border-2 rounded-xl p-6 transition-all duration-300 ${isSelected ? 'border-amber-500 scale-105 bg-stone-700/90' : 'border-stone-600 hover:border-amber-500/50'}`}
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mb-4 mx-auto"
                  style={{ backgroundColor: colorHex }}
                >
                  <Icon size={32} className="text-white" />
                </div>
                <h3 className="text-2xl font-bold text-center mb-2">{faction}</h3>
                <p className="text-stone-400 text-xs text-center mb-4 min-h-[32px]">{info.desc}</p>
                <div className="bg-stone-900/50 rounded p-2 text-center">
                  <span className="text-amber-400 text-[10px] font-bold uppercase tracking-widest">Bonus</span>
                  <p className="text-stone-300 text-sm">{info.bonus}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Game Settings */}
        <div className="bg-stone-800/90 backdrop-blur p-6 rounded-xl border border-stone-600 w-full flex flex-col gap-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {/* Map Mode */}
            <div className="space-y-4">
              <h4 className="text-amber-500 font-bold flex items-center gap-2">
                <Globe size={18} /> Map Mode
              </h4>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setMapMode(MapMode.FIXED)}
                  className={`flex items-center gap-3 p-3 rounded border transition-colors ${mapMode === MapMode.FIXED ? 'bg-amber-700 border-amber-500 text-white' : 'bg-stone-700 border-stone-600 text-stone-400 hover:bg-stone-650'}`}
                >
                  <Globe size={20} />
                  <div className="text-left">
                    <div className="font-bold">Fixed Map</div>
                  </div>
                </button>
                <button
                  onClick={() => setMapMode(MapMode.INFINITE)}
                  className={`flex items-center gap-3 p-3 rounded border transition-colors ${mapMode === MapMode.INFINITE ? 'bg-amber-700 border-amber-500 text-white' : 'bg-stone-700 border-stone-600 text-stone-400 hover:bg-stone-650'}`}
                >
                  <InfinityIcon size={20} />
                  <div className="text-left">
                    <div className="font-bold">Infinite Realm</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Map Size (Only for Fixed) */}
            <div className={`space-y-4 transition-opacity ${mapMode === MapMode.INFINITE ? 'opacity-30 pointer-events-none' : ''}`}>
              <h4 className="text-amber-500 font-bold flex items-center gap-2">
                <Maximize size={18} /> Map Size
              </h4>
              <div className="flex flex-col gap-2">
                {Object.values(MapSize).map((size) => (
                  <button
                    key={size}
                    onClick={() => setMapSize(size)}
                    className={`flex items-center gap-3 p-2 rounded border transition-colors ${mapSize === size ? 'bg-amber-700 border-amber-500 text-white' : 'bg-stone-700 border-stone-600 text-stone-400 hover:bg-stone-650'}`}
                  >
                    <MapIcon size={16} />
                    <span className="font-bold text-sm">{size}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Diplomacy */}
            <div className="space-y-4">
              <h4 className="text-amber-500 font-bold flex items-center gap-2">
                <Handshake size={18} /> Diplomacy
              </h4>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => setPeacefulMode(!peacefulMode)}
                  className={`w-full flex items-center justify-between gap-3 p-3 rounded border transition-colors ${peacefulMode ? 'bg-emerald-900/50 border-emerald-500 text-emerald-200' : 'bg-stone-800 border-stone-700 text-stone-500'}`}
                >
                  <span className="font-bold text-sm">Peaceful Mode</span>
                  <Handshake size={20} />
                </button>

                <div className={`transition-opacity ${peacefulMode ? 'opacity-30 pointer-events-none' : ''}`}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-stone-400 font-bold flex items-center gap-1"><Clock size={12} /> Treaty Length</span>
                    <span className="text-xs text-amber-500 font-mono">{treatyLength}m</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="60"
                    step="5"
                    value={treatyLength}
                    onChange={(e) => setTreatyLength(parseInt(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                  <div className="text-[10px] text-stone-500 mt-1 text-center">
                    {treatyLength === 0 ? "No Treaty - War Immediately" : `No attacks for ${treatyLength} minutes`}
                  </div>
                </div>

                <button
                  onClick={() => setAiDisabled(!aiDisabled)}
                  className={`w-full flex items-center justify-between gap-3 p-3 rounded border transition-colors ${aiDisabled ? 'bg-red-900/50 border-red-500 text-red-200' : 'bg-stone-800 border-stone-700 text-stone-500'}`}
                >
                  <span className="font-bold text-sm">Disable Enemy AI</span>
                  {aiDisabled ? <EyeOff size={20} className="text-red-400" /> : <Sword size={20} className="text-stone-400" />}
                </button>
              </div>
            </div>

            {/* Visual Options */}
            <div className="space-y-4">
              <h4 className="text-amber-500 font-bold flex items-center gap-2">
                <Eye size={18} /> Visuals
              </h4>
              <button
                onClick={() => setFowEnabled(!fowEnabled)}
                className={`w-full flex items-center justify-between gap-3 p-3 rounded border transition-colors ${fowEnabled ? 'bg-stone-700 border-stone-500 text-stone-200' : 'bg-stone-800 border-stone-700 text-stone-500'}`}
              >
                <span className="font-bold text-sm">Fog of War</span>
                {fowEnabled ? <Eye size={20} className="text-emerald-400" /> : <EyeOff size={20} className="text-red-400" />}
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={() => onStart(selectedFaction, mapMode, mapSize, fowEnabled, peacefulMode, treatyLength, aiDisabled)}
          className="bg-amber-600 hover:bg-amber-500 text-white font-serif text-3xl px-12 py-4 rounded-full border-b-4 border-amber-800 active:translate-y-1 active:border-b-0 transition-all shadow-2xl hover:shadow-amber-500/20 mb-8"
        >
          START GAME
        </button>
      </div>
    </div>
  );
};
