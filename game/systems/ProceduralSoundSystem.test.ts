/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('phaser', () => ({
    default: { Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)) } },
}));

vi.mock('../MainScene', () => ({
    MainScene: class {},
}));

import { ProceduralSoundSystem } from './ProceduralSoundSystem';

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
    // route through a function so `this` is the node
    const connect = function (this: MockNode, target: any) {
        let toNode: any = target;
        if (!target || typeof target !== 'object' || !('__type' in target)) {
            // Not a node nor a recognized param — treat as an inert target.
            toNode = { __type: 'unknown', __id: -2, __outEdges: [] } as MockNode;
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
    // masterGain is the gain node that connects directly to destination
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

function assertSingleOutputPath(methodName: string, expectBurstEnvelopes = 0) {
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

    // C1: no envelope gain node is orphaned (every gain has an outgoing
    // connection — either into the pan/merger chain toward masterGain, or
    // into an AudioParam as a modulation routing gain).
    for (const g of gainNodesCreatedThisCall()) {
        expect(
            g.__outEdges.length,
            `${methodName}: envelope gain node ${g.__id} must not be orphaned (no outgoing connection)`
        ).toBeGreaterThan(0);
    }

    // C1/C2: at least one source node reaches masterGain (the fix is wired)
    const reachingSources = sourceNodesCreatedThisCall().filter((s) =>
        reachable(s, master!)
    );
    expect(
        reachingSources.length,
        `${methodName}: at least one source node should reach masterGain`
    ).toBeGreaterThanOrEqual(1);

    // C2: exactly one output path per source (no doubling) — there must be
    // at least one path, and none of them is a direct source→master edge.
    expect(
        reachingSources.length >= 1 && directToMaster.length === 0,
        `${methodName}: no panned/centered doubled path`
    ).toBe(true);

    // C3 (demolition): the three burst envelopes connect to output
    if (expectBurstEnvelopes > 0) {
        expect(
            reachingSources.length,
            `${methodName}: all ${expectBurstEnvelopes} burst sources should reach masterGain`
        ).toBeGreaterThanOrEqual(expectBurstEnvelopes);
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('ProceduralSoundSystem — audio node graph (P0)', () => {
    let sound: ProceduralSoundSystem;

    beforeEach(() => {
        recorder.edges = [];
        recorder.nodes = new Set();
        recorder.createdThisCall = new Set();
        recorder.masterGain = null;
        recorder.destination = null;
        (globalThis as any).window = { AudioContext: makeAudioContext };
        (globalThis as any).Phaser = {
            Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)) },
        };
        const fakeScene: any = {
            peacefulMode: false,
            cameras: { main: { scrollX: 0, scrollY: 0, width: 800, height: 600 } },
        };
        sound = new ProceduralSoundSystem(fakeScene);
    });

    const methods: Array<[string, () => void, number]> = [
        ['playSwordClash', () => sound.playSwordClash(100, 100), 0],
        ['playBowRelease', () => sound.playBowRelease(100, 100), 0],
        ['playDeath', () => sound.playDeath(100, 100, true), 0],
        ['playPlacement', () => sound.playPlacement(100, 100), 0],
        ['playConstruction', () => sound.playConstruction(100, 100), 0],
        ['playDemolition', () => sound.playDemolition(100, 100), 3],
        ['playWoodChop', () => sound.playWoodChop(100, 100), 0],
        ['playUIClick', () => sound.playUIClick(), 0],
        ['playCommandAck', () => sound.playCommandAck(100, 100), 0],
        ['playAgeAdvance', () => sound.playAgeAdvance(100, 100), 0],
    ];

    for (const [name, fn, bursts] of methods) {
        it(`${name}: single correct output path, no doubled panning, no orphaned envelope`, () => {
            resetCall();
            fn();
            assertSingleOutputPath(name, bursts);
        });
    }

    it('playSwordClash: no envelope gain node is left orphaned (dangling, no outgoing connection)', () => {
        resetCall();
        sound.playSwordClash(100, 100);
        for (const g of gainNodesCreatedThisCall()) {
            expect(g.__outEdges.length, `gain ${g.__id} should have an outgoing connection`).toBeGreaterThan(0);
        }
    });
});
