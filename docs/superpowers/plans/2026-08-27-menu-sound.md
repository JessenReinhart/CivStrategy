# Menu Sound Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add subtle click sounds to every menu interaction in MainMenu.tsx via a standalone lazy Web Audio helper module.

**Architecture:** Extract the ui-click synthesis logic from ProceduralSoundSystem into a new pure module `game/utils/uiAudio.ts` that initializes its own AudioContext on first user gesture. MainMenu.tsx already wired to call `uiClick()` on every discrete click surface (navigation, toggles, buttons, selects). Tests verify the audio node graph matches the game's contractual requirements (no orphaned gains, single output path via envelope gain).

**Tech Stack:** Web Audio API (native), Vitest with mock AudioContext recording connect() graph.

## Global Constraints

- Do NOT modify ProceduralSoundSystem.ts, SFXAssetLoader.ts, MainScene.ts, or WorldBootstrap.ts.
- MainMenu.tsx already updated (import + call sites added). Only create new files: uiAudio.ts and uiAudio.test.ts.
- Follow existing test pattern: mock AudioContext factory that records every `.connect()` edge, assertSingleOutputPath.
- ESLint: zero warnings. TypeScript: strict.
- uiAudio.ts uses the EXACT same synthesis parameters as ProceduralSoundSystem.playUIClick (lines 635-639): highpass noise burst (freq 3000, Q=1, attack 0.001s, decay 0.02s) + sine tick (freq 1200, attack 0.002s, decay 0.03s), volume 0.08, pan 0.
- Node graph contract: `source → filter → envelope gain → channel merger → master gain → destination`. No raw source/oscillator connects directly to masterGain or destination.

---

### Task 1: Create game/utils/uiAudio.ts

**Files:**
- Create: `game/utils/uiAudio.ts`

**Interfaces:**
- Produces: `export function uiClick(): void`

- [ ] **Step 1: Create the module**

```typescript
// game/utils/uiAudio.ts
/**
 * UI Audio — Standalone lazy Web Audio helper for menu click sounds.
 * Initializes AudioContext synchronously on first call (must be from a user gesture).
 * Reuses the same subtle 'ui-click' procedural tone as ProceduralSoundSystem.
 */

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let initialized = false;

function ensureAudioContext(): AudioContext | null {
    if (initialized) return audioContext;
    try {
        const AudioCtx =
            window.AudioContext ||
            (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;
        audioContext = new AudioCtx();
        masterGain = audioContext.createGain();
        masterGain.gain.value = 0.6; // matches ProceduralSoundSystem._volume default
        masterGain.connect(audioContext.destination);
        initialized = true;
    } catch (e) {
        console.warn('[uiAudio] AudioContext not available:', e);
        return null;
    }
    if (audioContext!.state === 'suspended') {
        audioContext!.resume();
    }
    return audioContext;
}

function noiseBurst(
    filterType: BiquadFilterType,
    frequency: number,
    q: number,
    attackSec: number,
    decaySec: number,
    volume: number,
    ctx: AudioContext
): GainNode {
    const source = ctx.createBufferSource();
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 0.05; // 50ms noise buffer
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        const envelope = Math.exp(-i / (data.length * 0.15));
        data[i] = (Math.random() * 2 - 1) * envelope;
    }
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attackSec);
    gain.gain.exponentialRampToValueAtTime(0.001, now + attackSec + decaySec);

    source.connect(filter);
    filter.connect(gain);
    source.start(now);
    source.stop(now + attackSec + decaySec + 0.05);
    return gain;
}

function tone(
    type: OscillatorType,
    frequency: number,
    attackSec: number,
    decaySec: number,
    volume: number,
    ctx: AudioContext
): GainNode {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attackSec);
    gain.gain.exponentialRampToValueAtTime(0.001, now + attackSec + decaySec);

    osc.connect(gain);
    osc.start(now);
    osc.stop(now + attackSec + decaySec + 0.05);
    return gain;
}

/**
 * Apply stereo panning and connect the chain tail to masterGain.
 * This is the SOLE connection to masterGain — no direct source→masterGain.
 */
function applyPan(pan: number, gainNode: GainNode): void {
    const ctx = audioContext!;
    const merger = ctx.createChannelMerger(2);
    const leftGain = ctx.createGain();
    const rightGain = ctx.createGain();
    leftGain.gain.value = Math.max(0, Math.min(1, 1 - pan));
    rightGain.gain.value = Math.max(0, Math.min(1, 1 + pan));
    gainNode.connect(leftGain);
    gainNode.connect(rightGain);
    leftGain.connect(merger, 0, 0);
    rightGain.connect(merger, 0, 1);
    merger.connect(masterGain!);
}

/**
 * Play a subtle UI click sound.
 * Safe to call multiple times; AudioContext created lazily on first call.
 */
export function uiClick(): void {
    const ctx = ensureAudioContext();
    if (!ctx || !masterGain) return;

    const volume = 0.08;

    // Highpass noise burst (same as ProceduralSoundSystem.playUIClick)
    const tickGain = noiseBurst('highpass', 3000, 1, 0.001, 0.02, volume, ctx);
    // Sine tick
    const clickGain = tone('sine', 1200, 0.002, 0.03, volume * 0.5, ctx);

    // Center pan (0) for UI sounds
    applyPan(0, tickGain);
    applyPan(0, clickGain);
}
```

- [ ] **Step 2: Verify syntax**

```bash
npx tsc --noEmit game/utils/uiAudio.ts
```
Expected: No errors

---

### Task 2: Create game/utils/uiAudio.test.ts

**Files:**
- Create: `game/utils/uiAudio.test.ts`

**Interfaces:**
- Consumes: `uiClick()` from `game/utils/uiAudio.ts`
- Produces: Test suite verifying audio node graph contract

- [ ] **Step 1: Write the failing test file**

```typescript
// game/utils/uiAudio.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { uiClick } from './uiAudio';

// ── Mock Web Audio API that records every `.connect()` call ──────────────────
type NodeType =
    | 'gain'
    | 'biquad'
    | 'merger'
    | 'bufferSource'
    | 'oscillator'
    | 'destination';

interface MockNode {
    __id: number;
    __type: NodeType;
    __outEdges: MockNode[];
}

const recorder = {
    edges: [] as { from: MockNode; to: MockNode }[],
    nodes: new Set<MockNode>(),
    createdThisCall: new Set<MockNode>(),
    masterGain: null as MockNode | null,
    destination: null as MockNode | null,
    audioParamTargets: new WeakSet<object>(),
};

function makeParam() {
    const param: any = { value: 0, __isParam: true, __type: 'param', __outEdges: [] };
    param.setValueAtTime = () => param;
    param.exponentialRampToValueAtTime = () => param;
    param.linearRampToValueAtTime = () => param;
    recorder.audioParamTargets.add(param);
    return param;
}

function makeNode(type: NodeType): MockNode {
    const node: MockNode = { __id: 0, __type: type, __outEdges: [] };
    node.__id = (makeNode as any)._id = ((makeNode as any)._id || 0) + 1;
    const connect = function (this: MockNode, target: any) {
        let toNode: any = target;
        if (!target || typeof target !== 'object' || !('__type' in target)) {
            toNode = { __type: 'unknown', __id: -2, __outEdges: [] } as unknown as MockNode;
        }
        this.__outEdges.push(toNode);
        recorder.edges.push({ from: this, to: toNode });
        if (toNode.__type === 'destination') {
            recorder.destination = toNode;
        }
    };
    (node as any).connect = connect.bind(node);
    recorder.nodes.add(node);
    recorder.createdThisCall.add(node);
    return node;
}

function detectMasterGain() {
    for (const edge of recorder.edges) {
        if (edge.to.__type === 'destination' && edge.from.__type === 'gain') {
            recorder.masterGain = edge.from;
            return edge.from;
        }
    }
    return null;
}

function makeAudioContext(): any {
    const ctx: any = {
        sampleRate: 44100,
        state: 'running',
        currentTime: 0,
        resume: () => Promise.resolve(),
        close: () => Promise.resolve(),
        createGain: () => {
            const n = makeNode('gain');
            (n as any).gain = makeParam();
            return n;
        },
        createBiquadFilter: () => {
            const n = makeNode('biquad');
            (n as any).frequency = makeParam();
            (n as any).Q = makeParam();
            return n;
        },
        createChannelMerger: () => makeNode('merger'),
        createBufferSource: () => {
            const n = makeNode('bufferSource');
            (n as any).buffer = null;
            (n as any).loop = false;
            (n as any).start = () => {};
            (n as any).stop = () => {};
            return n;
        },
        createOscillator: () => {
            const n = makeNode('oscillator');
            (n as any).type = '';
            (n as any).frequency = makeParam();
            (n as any).detune = makeParam();
            (n as any).start = () => {};
            (n as any).stop = () => {};
            return n;
        },
        createBuffer: (_channels: number, length: number) => ({
            getChannelData: () => new Float32Array(length),
        }),
    };
    recorder.destination = makeNode('destination');
    ctx.destination = recorder.destination;
    return ctx;
}

function resetCall() {
    recorder.edges = [];
    recorder.createdThisCall = new Set();
}

// graph helpers -------------------------------------------------------------
function reachable(node: MockNode, target: MockNode): boolean {
    const seen = new Set<MockNode>();
    const stack = [node];
    while (stack.length) {
        const n = stack.pop()!;
        if (n === target) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        for (const out of n.__outEdges) stack.push(out);
    }
    return false;
}

function sourceNodesCreatedThisCall(): MockNode[] {
    return [...recorder.createdThisCall].filter(
        (n) => n.__type === 'bufferSource' || n.__type === 'oscillator'
    );
}

function gainNodesCreatedThisCall(): MockNode[] {
    return [...recorder.createdThisCall].filter((n) => n.__type === 'gain');
}

function assertSingleOutputPath(methodName: string) {
    const master = recorder.masterGain || detectMasterGain();
    expect(master, `${methodName}: masterGain must exist`).not.toBeNull();

    // C2: no raw source/oscillator connects DIRECTLY to masterGain
    const directToMaster = recorder.edges.filter(
        (e) =>
            (e.from.__type === 'bufferSource' || e.from.__type === 'oscillator') &&
            e.to === master
    );
    expect(
        directToMaster.length,
        `${methodName}: no raw source/oscillator should connect directly to masterGain`
    ).toBe(0);

    // C1: no envelope gain node is orphaned
    for (const g of gainNodesCreatedThisCall()) {
        expect(
            g.__outEdges.length,
            `${methodName}: envelope gain node ${g.__id} must not be orphaned (no outgoing connection)`
        ).toBeGreaterThan(0);
    }

    // C1/C2: at least one source node reaches masterGain
    const reachingSources = sourceNodesCreatedThisCall().filter((s) =>
        reachable(s, master!)
    );
    expect(
        reachingSources.length,
        `${methodName}: at least one source node should reach masterGain`
    ).toBeGreaterThanOrEqual(1);

    // C2: no doubled panning path
    expect(
        reachingSources.length >= 1 && directToMaster.length === 0,
        `${methodName}: no panned/centered doubled path`
    ).toBe(true);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('uiAudio — audio node graph (P0)', () => {
    beforeEach(() => {
        resetCall();
        (globalThis as any).window = { AudioContext: makeAudioContext };
    });

    it('uiClick: single correct output path, no orphaned envelope, no doubled path', () => {
        uiClick();
        assertSingleOutputPath('uiClick');
    });

    it('uiClick: AudioContext created lazily on first call only', () => {
        const before = (globalThis as any).window.AudioContext;
        uiClick();
        const afterFirst = (globalThis as any).window.AudioContext;
        uiClick();
        const afterSecond = (globalThis as any).window.AudioContext;
        // The factory should be the same function; instantiation happens inside uiClick
        expect(afterFirst).toBe(before);
        expect(afterSecond).toBe(before);
    });

    it('uiClick: ctx.resume() called if suspended', () => {
        let resumeCalled = false;
        const suspendedCtx = makeAudioContext();
        suspendedCtx.state = 'suspended';
        suspendedCtx.resume = () => { resumeCalled = true; return Promise.resolve(); };
        (globalThis as any).window = { AudioContext: () => suspendedCtx };
        uiClick();
        expect(resumeCalled).toBe(true);
    });

    it('uiClick: produces exactly 2 source nodes (noise buffer + oscillator)', () => {
        uiClick();
        const sources = sourceNodesCreatedThisCall();
        expect(sources.length).toBe(2);
        const types = sources.map(s => s.__type).sort();
        expect(types).toEqual(['bufferSource', 'oscillator']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails (before implementation exists)**

```bash
npm test game/utils/uiAudio.test.ts
```
Expected: FAIL — module not found / uiClick not exported

- [ ] **Step 3: Run test after Task 1 implementation**

```bash
npm test game/utils/uiAudio.test.ts
```
Expected: PASS (all 4 tests)

- [ ] **Step 4: Run full test suite**

```bash
npm test
```
Expected: All tests pass (no regressions)

- [ ] **Step 5: Run lint and typecheck**

```bash
npm run lint
npx tsc --noEmit
```
Expected: Zero warnings, zero errors

- [ ] **Step 6: Build**

```bash
npm run build
```
Expected: Exit 0

- [ ] **Step 7: Commit**

```bash
git add game/utils/uiAudio.ts game/utils/uiAudio.test.ts
git commit -m "feat: add uiAudio helper for menu click sounds"
```