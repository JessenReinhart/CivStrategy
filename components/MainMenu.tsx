
import React, { useState } from 'react';
import { FactionType, MapMode } from '../types';
import { FACTION_COLORS } from '../constants';
import { Shield, Users, Sword, Globe, Infinity as InfinityIcon } from 'lucide-react';

interface MainMenuProps {
  onStart: (faction: FactionType, mode: MapMode) => void;
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

  return (
    <div className="absolute inset-0 bg-stone-900 flex flex-col items-center justify-center text-stone-100 z-50 bg-[url('https://picsum.photos/1920/1080?grayscale&blur=2')] bg-cover">
      <div className="absolute inset-0 bg-black/60" />
      
      <div className="relative z-10 max-w-5xl w-full p-8 flex flex-col items-center">
        <h1 className="text-7xl font-serif text-center mb-2 text-amber-500 drop-shadow-lg tracking-wider">CIV STRATEGY</h1>
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
        <div className="bg-stone-800/90 backdrop-blur p-6 rounded-xl border border-stone-600 w-full max-w-lg flex flex-col gap-6 mb-8">
            <div className="space-y-4">
                <h4 className="text-amber-500 font-bold flex items-center gap-2">
                    <Globe size={18} /> Map Mode
                </h4>
                <div className="flex flex-row gap-2">
                    <button 
                        onClick={() => setMapMode(MapMode.FIXED)}
                        className={`flex-1 flex items-center gap-3 p-3 rounded border transition-colors ${mapMode === MapMode.FIXED ? 'bg-amber-700 border-amber-500 text-white' : 'bg-stone-700 border-stone-600 text-stone-400 hover:bg-stone-650'}`}
                    >
                        <Globe size={20} />
                        <div className="text-left">
                            <div className="font-bold">Fixed Map</div>
                            <div className="text-[10px] opacity-70">Standard size.</div>
                        </div>
                    </button>
                    <button 
                        onClick={() => setMapMode(MapMode.INFINITE)}
                        className={`flex-1 flex items-center gap-3 p-3 rounded border transition-colors ${mapMode === MapMode.INFINITE ? 'bg-amber-700 border-amber-500 text-white' : 'bg-stone-700 border-stone-600 text-stone-400 hover:bg-stone-650'}`}
                    >
                        <InfinityIcon size={20} />
                        <div className="text-left">
                            <div className="font-bold">Infinite Realm</div>
                            <div className="text-[10px] opacity-70">Endless expansion.</div>
                        </div>
                    </button>
                </div>
            </div>
        </div>

        <button
          onClick={() => onStart(selectedFaction, mapMode)}
          className="bg-amber-600 hover:bg-amber-500 text-white font-serif text-3xl px-12 py-4 rounded-full border-b-4 border-amber-800 active:translate-y-1 active:border-b-0 transition-all shadow-2xl hover:shadow-amber-500/20"
        >
          CONQUER
        </button>
      </div>
    </div>
  );
};
