# Phaser 3 Testing Workflow — CivStrategy

> Research-backed testing strategy for Phaser 3 + React + TypeScript games.
> Sources: Phaser Discourse, DEV Community (David Morais), Xebia, philscode.com, samme/phaser-component-health, Phaser GitHub issues. July 2025.

---

## Stack

| Layer | Tool | Status |
|---|---|---|
| Unit tests | Vitest v2.1.8 | ✅ Installed |
| Integration | Vitest + `Phaser.HEADLESS` | Needs setup |
| Visual regression | Playwright `toHaveScreenshot()` | Needs install |
| Coverage | `@vitest/coverage-v8` | Needs install |
| E2E | Playwright | Needs install |

---

## Mocking Tiers

### Tier 1: Mock Phaser entirely (pure logic)

Already proven in `ProceduralSoundSystem.test.ts`:

```ts
vi.mock('phaser', () => ({
    default: { Math: { Clamp: (v, min, max) => Math.min(max, Math.max(min, v)) } },
}));
vi.mock('../MainScene', () => ({ MainScene: class {} }));
```

Use for: combat math, resource calculations, tech prereqs, pathfinding logic.

### Tier 2: Headless Phaser Game (integration)

```ts
let game: Phaser.Game;
let scene: Phaser.Scene;

beforeAll((done) => {
    game = new Phaser.Game({
        type: Phaser.HEADLESS,
        scene: { init() { scene = this; done(); } },
        callbacks: { postBoot() { game.loop.stop(); } },
    });
});

afterAll(() => {
    game.destroy(true, true);
    game.runDestroy();
});
```

Use for: system interactions (Research+Economy, Unit+Pathfinding, Terrain+Water).

### Tier 3: jsdom + canvas (DOM tests)

```ts
// vitest.config.ts
test: {
    environment: 'jsdom',
    threads: false,  // REQUIRED on Windows — canvas native module crashes in workers
}
```

---

## Mocking MainScene

**Unit tests — empty class with stubs:**
```ts
vi.mock('../MainScene', () => ({
    MainScene: class {
        add = { sprite: vi.fn(() => ({ setOrigin: vi.fn() })) };
        time = { now: 0 };
        terrainSystem = { getHeightAt: vi.fn(() => 0.5) };
        // stub only what the system touches
    },
}));
```

**Integration — real headless game:**
```ts
const game = new Phaser.Game({ type: Phaser.HEADLESS, scene: MainScene });
const scene = game.scene.getScene('MainScene') as MainScene;
```

---

## Test Plan (4 phases, ~40 tests)

### Phase 1 — Pure logic units (~20 tests)

| Module | What to test | Mock level |
|---|---|---|
| `ResearchManager` | Tech prereqs, cost validation, progress tick, unlock order, cancel+escrow | Mock Phaser.Math |
| `TerrainSystem` utils | `getHeightInterpolated`, `isWater`, `toIsoElev`, `isoElevDepth` | None (pure) |
| `Pathfinder` | A* correctness, blocked paths, diagonal movement, flow field generation | Mock scene grid |
| `EntityFactory` | Damage calc (`computeDamage`), range check, targeting priority | Mock entities |
| `EconomySystem` | Resource gen, job assignment, population growth, happiness | Mock scene |
| Utils (5 files) | Pure function tests — lowest effort, highest value | None |

### Phase 2 — System integration (~15 tests)

| Combination | What to test |
|---|---|
| `ResearchManager` + `EconomySystem` | `gatherMult` affects resource rate, escrow blocks spending |
| `UnitSystem` + `Pathfinder` | Spawn → path → arrive flow |
| `TerrainSystem` + water | Elevation affects water boundary, tree placement blocks water |
| `EnemyAISystem` + `EconomySystem` | AI builds, recruits, attacks on schedule |

### Phase 3 — Visual regression (~5 tests, needs Playwright)

| Scenario | Approach |
|---|---|
| Terrain rendering | `toHaveScreenshot` with threshold 0.15 |
| Water animation (frozen) | Mock `scene.time` to freeze waves |
| Unit selection highlight | Mock spritesheets with solid colors |
| MainMenu screens | Mask dynamic elements |

### Phase 4 — E2E smoke tests (~5 tests, needs Playwright)

| Scenario | Approach |
|---|---|
| Full game boot | Page loads, canvas renders, no console errors |
| Place building | Click terrain, verify building appears |
| Train unit | Click TC, click train, verify unit spawns |
| Research tech | Click tech tree, verify unlock |

---

## Coverage Targets

| Area | Target | Notes |
|---|---|---|
| `game/systems/*` | 80%+ | Focus on logic, skip rendering |
| `game/utils/*` | 90%+ | Pure functions, easy wins |
| `game/MainScene.ts` | Skip | God-class, low ROI |
| `components/*` | 60%+ | React Testing Library |
| Overall | 40-50% | Rendering-heavy code excluded |

### Coverage config

```ts
// vitest.config.ts
coverage: {
    provider: 'v8',
    include: ['game/systems/**/*.ts', 'game/utils/**/*.ts'],
    exclude: ['**/*.test.ts', 'game/MainScene.ts'],
    reporter: ['text', 'html'],
}
```

**Windows gotcha:** `threads: false` required — canvas native module crashes in worker threads, and Windows + jsdom = 0% coverage without it.

---

## Visual Regression with Playwright

```ts
import { test, expect } from '@playwright/test';

test('game renders correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.gameReady === true);
    await expect(page.locator('canvas')).toHaveScreenshot('game-initial.png', {
        threshold: 0.1,
        mask: [page.locator('.dynamic-ui')],
    });
});
```

**Rules:**
- Consistent viewport + `deviceScaleFactor` across runs
- Disable animations or freeze game state before capture
- Use `mask` for dynamic UI (counters, timers)
- Commit baseline images to repo
- Mock spritesheets with solid-color PNGs for determinism

---

## E2E without browser (headless ticks)

```ts
const game = new Phaser.Game({ type: Phaser.HEADLESS, scene: CombatScene });
game.loop.stop();

const scene = game.scene.getScene('CombatScene');
scene.update(0, 16);   // time=0, delta=16ms
scene.update(16, 16);
scene.update(32, 16);

expect(scene.units[0].health).toBe(80);
```

Good for: pathfinding, combat, spawning. Bad for: rendering, depth sorting.

---

## Key Principles

1. **Don't mock rendering.** Extract logic into pure functions, test the functions.
2. **`Phaser.HEADLESS`** for integration tests needing real Phaser objects.
3. **Mock MainScene as stub class** for unit tests; real headless game for integration.
4. **Don't test what Phaser already tests** — lifecycle, rendering, input.
5. **Test what can break:** math, state transitions, edge cases.
6. **Target 70-80% on logic modules**, accept lower on rendering.

---

## References

- [samme/phaser-component-health](https://github.com/samme/phaser-component-health) — gold-standard Phaser test example (933 lines)
- [David Morais — Testing Phaser with Vitest](https://dev.to/davidmorais/testing-phaser-games-with-vitest-3kon)
- [philscode — E2E Testing a Video Game](https://philscode.com/blog/e2e-testing-a-video-game/)
- [Phaser Discourse — Testing](https://phaser.discourse.group/)
