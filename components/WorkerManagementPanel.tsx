import React, { useEffect, useMemo, useState } from 'react';
import Phaser from 'phaser';
import { BriefcaseBusiness, ChevronDown, ChevronUp, Minus, Plus, Users, X } from 'lucide-react';

import {
  WORKFORCE_EVENTS,
  type WorkforceBuildingSnapshot,
  type WorkforceSnapshot,
} from '../game/systems/StrongholdWorkforceSystem';

interface WorkerManagementPanelProps {
  gameInstance: Phaser.Game;
}

const EMPTY_SNAPSHOT: WorkforceSnapshot = {
  totalVillagers: 0,
  assignedVillagers: 0,
  idleVillagers: 0,
  filledSlots: 0,
  openSlots: 0,
  enabledSlots: 0,
  totalSlots: 0,
  buildings: [],
};

function WorkerSlots({ workplace }: { workplace: WorkforceBuildingSnapshot }) {
  const slots = useMemo(
    () => Array.from({ length: workplace.capacity }, (_, index) => ({
      index,
      enabled: index < workplace.target,
      filled: index < workplace.filled,
    })),
    [workplace.capacity, workplace.filled, workplace.target],
  );

  return (
    <div className="flex items-center gap-1" aria-label={`${workplace.filled} of ${workplace.capacity} worker slots filled`}>
      {slots.map((slot) => (
        <span
          key={slot.index}
          title={slot.filled ? 'Filled worker slot' : slot.enabled ? 'Open worker slot' : 'Disabled worker slot'}
          className={[
            'block h-3 w-3 rounded-sm border transition-colors',
            slot.filled
              ? 'border-amber-300/90 bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.35)]'
              : slot.enabled
                ? 'border-stone-400/70 bg-stone-950/80'
                : 'border-stone-700/60 bg-stone-900/30 opacity-40',
          ].join(' ')}
        />
      ))}
    </div>
  );
}

export const WorkerManagementPanel: React.FC<WorkerManagementPanelProps> = ({ gameInstance }) => {
  const [snapshot, setSnapshot] = useState<WorkforceSnapshot>(EMPTY_SNAPSHOT);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const update = (next: WorkforceSnapshot) => setSnapshot(next ?? EMPTY_SNAPSHOT);
    gameInstance.events.on(WORKFORCE_EVENTS.SNAPSHOT, update);
    gameInstance.events.emit(WORKFORCE_EVENTS.REQUEST_SNAPSHOT);

    return () => {
      gameInstance.events.off(WORKFORCE_EVENTS.SNAPSHOT, update);
    };
  }, [gameInstance]);

  const setTarget = (buildingId: string, target: number) => {
    gameInstance.events.emit(WORKFORCE_EVENTS.SET_TARGET, { buildingId, target });
  };

  return (
    <div className="pointer-events-none fixed bottom-6 right-4 z-[80] flex flex-col-reverse items-end gap-2 font-sans text-stone-100">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="pointer-events-auto flex min-w-[210px] items-center gap-3 rounded-md border border-stone-500/40 bg-stone-950/90 px-3 py-2 text-left shadow-xl backdrop-blur-md transition hover:border-amber-400/50 hover:bg-stone-900/95"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded bg-amber-950/70 text-amber-300 ring-1 ring-amber-500/25">
          <Users size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">Workforce</div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-sm font-bold text-stone-100">{snapshot.assignedVillagers} working</span>
            <span className="text-xs text-stone-400">{snapshot.idleVillagers} idle</span>
          </div>
        </div>
        {snapshot.openSlots > 0 && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/20">
            {snapshot.openSlots} OPEN
          </span>
        )}
      </button>

      {open && (
        <section className="pointer-events-auto w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-stone-500/40 bg-[#171512]/95 shadow-2xl backdrop-blur-xl">
          <header className="flex items-center gap-3 border-b border-stone-700/70 bg-stone-950/70 px-4 py-3">
            <BriefcaseBusiness size={18} className="text-amber-300" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-stone-100">Worker Management</h2>
              <p className="mt-0.5 text-[11px] text-stone-400">Workers fill enabled building slots automatically.</p>
            </div>
            <button
              type="button"
              title={collapsed ? 'Expand' : 'Collapse'}
              onClick={() => setCollapsed((value) => !value)}
              className="rounded p-1.5 text-stone-400 transition hover:bg-stone-800 hover:text-stone-100"
            >
              {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
            <button
              type="button"
              title="Close"
              onClick={() => setOpen(false)}
              className="rounded p-1.5 text-stone-400 transition hover:bg-stone-800 hover:text-stone-100"
            >
              <X size={16} />
            </button>
          </header>

          {!collapsed && (
            <>
              <div className="grid grid-cols-3 border-b border-stone-700/60 bg-stone-900/35">
                <div className="px-3 py-2.5 text-center">
                  <div className="text-lg font-bold tabular-nums text-stone-100">{snapshot.totalVillagers}</div>
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-stone-500">Workers</div>
                </div>
                <div className="border-x border-stone-700/60 px-3 py-2.5 text-center">
                  <div className="text-lg font-bold tabular-nums text-emerald-300">{snapshot.filledSlots}</div>
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-stone-500">Filled slots</div>
                </div>
                <div className="px-3 py-2.5 text-center">
                  <div className={`text-lg font-bold tabular-nums ${snapshot.openSlots > 0 ? 'text-amber-300' : 'text-stone-300'}`}>
                    {snapshot.openSlots}
                  </div>
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-stone-500">Unfilled</div>
                </div>
              </div>

              <div className="max-h-[min(420px,calc(100vh-16rem))] overflow-y-auto p-2">
                {snapshot.buildings.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-stone-500">
                    Build a workplace to create worker slots.
                  </div>
                ) : (
                  snapshot.buildings.map((workplace) => (
                    <div
                      key={workplace.id}
                      className="mb-1.5 rounded border border-stone-700/55 bg-stone-900/45 px-3 py-2.5 last:mb-0"
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold text-stone-200">{workplace.name}</div>
                          <div className="mt-1.5 flex items-center gap-2">
                            <WorkerSlots workplace={workplace} />
                            <span className="text-[10px] tabular-nums text-stone-500">
                              {workplace.filled}/{workplace.capacity}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center overflow-hidden rounded border border-stone-600/60 bg-stone-950/70">
                          <button
                            type="button"
                            title="Close one worker slot"
                            disabled={workplace.target <= 0}
                            onClick={() => setTarget(workplace.id, workplace.target - 1)}
                            className="flex h-7 w-7 items-center justify-center text-stone-300 transition hover:bg-red-950/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-25"
                          >
                            <Minus size={13} />
                          </button>
                          <span className="min-w-8 border-x border-stone-700/60 px-1 text-center text-[11px] font-bold tabular-nums text-amber-200">
                            {workplace.target}
                          </span>
                          <button
                            type="button"
                            title="Open one worker slot"
                            disabled={workplace.target >= workplace.capacity}
                            onClick={() => setTarget(workplace.id, workplace.target + 1)}
                            className="flex h-7 w-7 items-center justify-center text-stone-300 transition hover:bg-emerald-950/60 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-25"
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <footer className="flex items-center justify-between border-t border-stone-700/60 bg-stone-950/45 px-3 py-2 text-[10px] text-stone-500">
                <span>{snapshot.enabledSlots}/{snapshot.totalSlots} slots enabled</span>
                <span>{snapshot.idleVillagers} available workers</span>
              </footer>
            </>
          )}
        </section>
      )}
    </div>
  );
};
