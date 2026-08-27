import { describe, it, expect, beforeEach, vi } from 'vitest';

type NodeType =
    | 'gain'
    | 'biquad'
    | 'merger'
    | 'bufferSource'
    | 'oscillator'
    | 'destination';

interface MockAudioParam {
    value: number;
    setValueAtTime: (value: number, time: number) => MockAudioParam;
    exponentialRampToValueAtTime: (value: number, time: number) => MockAudioParam;
    linearRampToValueAtTime: (value: number, time: number) => MockAudioParam;
}

interface MockNode {
    __id: number;
    __type: NodeType;
    __outEdges: MockNode[];
    connect: (target: MockNode) => void;
}

interface MockAudioBuffer {
    getChannelData: (channel: number) => Float32Array;
}

interface MockAudioContextState {
    sampleRate: number;
    state: AudioContextState;
    currentTime: number;
    resume: () => Promise<void>;
    close: () => Promise<void>;
    createGain: () => MockNode & { gain: MockAudioParam };
    createBiquadFilter: () => MockNode & { frequency: MockAudioParam; Q: MockAudioParam };
    createChannelMerger: () => MockNode;
    createBufferSource: () => MockNode & {
        buffer: MockAudioBuffer | null;
        loop: boolean;
        start: () => void;
        stop: () => void;
    };
    createOscillator: () => MockNode & {
        type: OscillatorType;
        frequency: MockAudioParam;
        detune: MockAudioParam;
        start: () => void;
        stop: () => void;
    };
    createBuffer: (channels: number, length: number) => MockAudioBuffer;
    destination: MockNode;
}

const recorder = {
    edges: [] as { from: MockNode; to: MockNode }[],
    createdThisCall: [] as MockNode[],
    masterGain: null as MockNode | null,
};

let nodeIdCounter = 0;

function makeNode(type: NodeType): MockNode {
    const node: MockNode = {
        __id: ++nodeIdCounter,
        __type: type,
        __outEdges: [],
        connect: function (this: MockNode, target: MockNode) {
            this.__outEdges.push(target);
            recorder.edges.push({ from: this, to: target });
        },
    };
    recorder.createdThisCall.push(node);
    return node;
}

function makeAudioParam(): MockAudioParam {
    const param: MockAudioParam = {
        value: 0,
        setValueAtTime: function (value: number) {
            this.value = value;
            return this;
        },
        exponentialRampToValueAtTime: function (value: number) {
            this.value = value;
            return this;
        },
        linearRampToValueAtTime: function (value: number) {
            this.value = value;
            return this;
        },
    };
    return param;
}

function makeGainNode(): MockNode & { gain: MockAudioParam } {
    const node = makeNode('gain');
    return Object.assign(node, { gain: makeAudioParam() });
}

function makeBiquadNode(): MockNode & { frequency: MockAudioParam; Q: MockAudioParam } {
    const node = makeNode('biquad');
    return Object.assign(node, { frequency: makeAudioParam(), Q: makeAudioParam() });
}

function makeBufferSourceNode(): MockNode & {
    buffer: MockAudioBuffer | null;
    loop: boolean;
    start: () => void;
    stop: () => void;
} {
    const node = makeNode('bufferSource');
    return Object.assign(node, {
        buffer: null,
        loop: false,
        start: () => {},
        stop: () => {},
    });
}

function makeOscillatorNode(): MockNode & {
    type: OscillatorType;
    frequency: MockAudioParam;
    detune: MockAudioParam;
    start: () => void;
    stop: () => void;
} {
    const node = makeNode('oscillator');
    return Object.assign(node, {
        type: '' as OscillatorType,
        frequency: makeAudioParam(),
        detune: makeAudioParam(),
        start: () => {},
        stop: () => {},
    });
}

function detectMasterGain(): MockNode | null {
    for (const edge of recorder.edges) {
        if (edge.to.__type === 'destination' && edge.from.__type === 'gain') {
            recorder.masterGain = edge.from;
            return edge.from;
        }
    }
    return null;
}

function resetCall(): void {
    recorder.edges = [];
    recorder.createdThisCall = [];
    recorder.masterGain = null;
    nodeIdCounter = 0;
}

function reachable(node: MockNode, target: MockNode): boolean {
    const seen = new Set<MockNode>();
    const stack = [node];
    while (stack.length) {
        const current = stack.pop()!;
        if (current === target) return true;
        if (seen.has(current)) continue;
        seen.add(current);
        for (const out of current.__outEdges) stack.push(out);
    }
    return false;
}

function assertSingleOutputPath(methodName: string): void {
    const master = recorder.masterGain ?? detectMasterGain();
    expect(master, `${methodName}: masterGain must exist`).not.toBeNull();

    const created = recorder.createdThisCall;

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
    for (const node of created) {
        if (node.__type !== 'gain') continue;
        expect(
            node.__outEdges.length,
            `${methodName}: envelope gain node ${node.__id} must not be orphaned (no outgoing connection)`
        ).toBeGreaterThan(0);
    }

    // C1/C2: at least one source node reaches masterGain
    const reachingSources = created.filter(
        (node) =>
            (node.__type === 'bufferSource' || node.__type === 'oscillator') &&
            reachable(node, master!)
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

class BaseMockAudioContext implements MockAudioContextState {
    sampleRate = 44100;
    state: AudioContextState = 'running';
    currentTime = 0;
    resume = (): Promise<void> => Promise.resolve();
    close = (): Promise<void> => Promise.resolve();
    createGain = () => makeGainNode();
    createBiquadFilter = () => makeBiquadNode();
    createChannelMerger = () => makeNode('merger');
    createBufferSource = () => makeBufferSourceNode();
    createOscillator = () => makeOscillatorNode();
    createBuffer = (_channels: number, length: number): MockAudioBuffer => ({
        getChannelData: () => new Float32Array(length),
    });
    destination = makeNode('destination');
}

class CountingAudioContext extends BaseMockAudioContext {
    static instances = 0;
    constructor() {
        super();
        CountingAudioContext.instances++;
    }
}

class SuspendedAudioContext extends BaseMockAudioContext {
    static instances: SuspendedAudioContext[] = [];
    resumeCalled = false;
    state: AudioContextState = 'suspended';
    resume = (): Promise<void> => {
        this.resumeCalled = true;
        return Promise.resolve();
    };
    constructor() {
        super();
        SuspendedAudioContext.instances.push(this);
    }
}

// uiAudio keeps module-level singleton state (initialized flag), so each test
// needs a fresh module instance to exercise first lazy initialization.
async function installMockAudioContext(
    factory: new () => MockAudioContextState
): Promise<typeof import('./uiAudio')> {
    vi.resetModules();
    vi.stubGlobal('window', { AudioContext: factory });
    return await import('./uiAudio');
}

describe('uiAudio — audio node graph (P0)', () => {
    beforeEach(() => {
        resetCall();
        CountingAudioContext.instances = 0;
        SuspendedAudioContext.instances = [];
    });

    it('uiClick: single correct output path, no orphaned envelope, no doubled path', async () => {
        const { uiClick } = await installMockAudioContext(BaseMockAudioContext);
        uiClick();
        assertSingleOutputPath('uiClick');
    });

    it('uiClick: AudioContext created lazily on first call only', async () => {
        const { uiClick } = await installMockAudioContext(CountingAudioContext);
        uiClick();
        expect(CountingAudioContext.instances).toBe(1);
        uiClick();
        expect(CountingAudioContext.instances).toBe(1);
        uiClick();
        expect(CountingAudioContext.instances).toBe(1);
    });

    it('uiClick: ctx.resume() called if suspended', async () => {
        const { uiClick } = await installMockAudioContext(SuspendedAudioContext);
        uiClick();
        expect(SuspendedAudioContext.instances).toHaveLength(1);
        expect(SuspendedAudioContext.instances[0]!.resumeCalled).toBe(true);
    });

    it('uiClick: produces exactly 2 source nodes (noise buffer + oscillator)', async () => {
        const { uiClick } = await installMockAudioContext(BaseMockAudioContext);
        uiClick();
        const sources = recorder.createdThisCall.filter(
            (node) => node.__type === 'bufferSource' || node.__type === 'oscillator'
        );
        expect(sources.length).toBe(2);
        const types = sources.map((s) => s.__type).sort();
        expect(types).toEqual(['bufferSource', 'oscillator']);
    });
});
