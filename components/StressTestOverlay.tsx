import React, { useState, useEffect } from 'react';
import Phaser from 'phaser';
import { Activity, LogOut, Target, Zap, Users, Gauge } from 'lucide-react';

interface StressTestOverlayProps {
  unitCount: number;
  onQuit: () => void;
  gameInstance: Phaser.Game | null;
}

export const StressTestOverlay: React.FC<StressTestOverlayProps> = ({ unitCount, onQuit, gameInstance }) => {
  const [fps, setFps] = useState(0);
  const [selectedCount, setSelectedCount] = useState(0);
  const [usingFlowField, setUsingFlowField] = useState(false);

  useEffect(() => {
    if (!gameInstance) return;

    const interval = setInterval(() => {
      setFps(Math.round(gameInstance.loop.actualFps));
    }, 500);

    const selectionHandler = (data: number | { count: number; counts: Record<string, number> }) => {
      if (typeof data === 'number') {
        setSelectedCount(data);
      } else {
        setSelectedCount(data.count);
      }
    };

    gameInstance.events.on('selection-changed', selectionHandler);

    return () => {
      clearInterval(interval);
      gameInstance.events.off('selection-changed', selectionHandler);
    };
  }, [gameInstance]);

  useEffect(() => {
    setUsingFlowField(selectedCount >= 12);
  }, [selectedCount]);

  const handleCenterCamera = () => {
    window.dispatchEvent(new CustomEvent('center-camera-ui'));
  };

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 overflow-hidden">
      {/* Top Bar */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-1 pointer-events-auto">
        <div className="flex items-center gap-6 px-8 py-3 bg-black/60 backdrop-blur-xl rounded-full border border-white/10 shadow-2xl text-stone-100">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-amber-400" />
            <span className="text-xs font-bold uppercase tracking-wider">Stress Test</span>
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex items-center gap-2">
            <Users size={16} className="text-blue-400" />
            <span className="font-mono font-bold">{unitCount}</span>
            <span className="text-[10px] text-stone-400">units</span>
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex items-center gap-2">
            <Gauge size={16} className={fps >= 55 ? 'text-emerald-400' : fps >= 30 ? 'text-yellow-400' : 'text-red-400'} />
            <span className="font-mono font-bold">{fps}</span>
            <span className="text-[10px] text-stone-400">FPS</span>
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex items-center gap-2">
            <Zap size={16} className={usingFlowField ? 'text-amber-400' : 'text-stone-500'} />
            <span className={`text-[10px] font-bold uppercase tracking-wider ${usingFlowField ? 'text-amber-400' : 'text-stone-500'}`}>
              {usingFlowField ? 'Flow Field Active' : 'Individual Paths'}
            </span>
          </div>
        </div>
      </div>

      {/* Top Right Controls */}
      <div className="absolute top-6 right-6 flex flex-col items-end gap-3 pointer-events-auto">
        <div className="flex items-center gap-2 p-2 bg-black/60 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl">
          <button
            onClick={handleCenterCamera}
            className="p-2 rounded-xl transition-all duration-300 text-stone-400 hover:text-white hover:bg-white/5"
            title="Center Camera"
          >
            <Target size={20} />
          </button>
          <div className="w-px h-6 bg-white/10 mx-1" />
          <button
            onClick={onQuit}
            className="p-2 rounded-xl transition-all duration-300 text-stone-400 hover:text-red-400 hover:bg-white/5"
            title="Quit to Menu"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>

      {/* Bottom Center Instructions */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-auto">
        <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl px-6 py-3 shadow-2xl">
          <div className="flex items-center gap-4 text-xs text-stone-300">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Left-click drag to select units
            </span>
            <span className="w-px h-4 bg-white/10" />
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Right-click to command move (flow field kicks in at 12+)
            </span>
            <span className="w-px h-4 bg-white/10" />
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-[10px] font-mono">F3</kbd> for debug stats
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
