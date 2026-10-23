# Remediation Follow-Up Backlog

Status: **all 29 planned defects resolved**, all Playwright E2E journeys green,
local 4-gate verification clean, CI coverage enforcement enabled. The strict
Phase 8 / Phase 9 exit gates below remain and are deliberately deferred.

---

## Phase 8 — GameContext ownership migration

Exit gate: systems take `GameContext`, not `MainScene`.

Current state:

- `MainScene.ts` still owns all 24 runtime system fields directly.
- `SystemRegistry`, `EntityRegistryService`, `GameStateService`,
  `SimulationContext` / `SimulationServices`, `WorldContext` / `WorldServices`,
  `ProgressionContext` / `ProgressionServices`, and the three `*RuntimeHost`
  adapters exist, but there is **no unified `GameContext`**.
- `createSimulationServices(scene: MainScene)` is an explicit temporary adapter
  (`game/runtime/SimulationServices.ts`) and is the single simulation-boundary
  adapter.

Work:

1. Introduce `GameContext` with read-only context objects per domain
   (simulation / world / progression) plus the authoritative state registry.
2. Migrate each of the 24 systems' constructors from `MainScene` to `GameContext`
   and replace `this.scene.*` call sites with context accessors.
3. Remove the `createSimulationServices(scene)` temporary adapter and derive
   services from `GameContext` in the runtime coordinators.
4. Constrain `MainScene` to Phaser binding only (no authoritative state reads).

Constraints:

- Keep cartesian → isometric conversion only at the rendering boundary
  (`game/utils/iso.ts`); do not mix coordinate systems.
- Preserve the fixed update-loop order documented in `AGENTS.md`.
- Owner convention unchanged: `0` player, `1` AI, `-1` neutral.
- No barrel files; use direct relative imports.

Risk: **High** — hundreds of `this.scene.*` call sites; subtle gameplay behavior
can regress (AI economy, formation bonuses, fog, pathing). Do one system at a
time and re-run all gates after each.

Verification after each system:

```bash
npx tsc --noEmit
npm run lint
npm run coverage
npm run build
node scripts/canonical-play-session-journey.mjs
node scripts/save-reload-journey.mjs
```

---

## Phase 9 — Coverage floor to plan aspiration

Exit gate: `game/**` v8 coverage ≥ 70% lines, bridge ≥ 60%.

Current state (measured this round):

```text
All files   38.19% lines | 71.87% branches | 48.90% functions
```

- CI currently enforces the existing reachable floor via `npm run coverage`.
- The 70/60 aspirational floor is **Open decision #3** and needs a human to set
  the final numbers before it becomes the CI gate.

Work:

1. Settle Open decision #3 (keep 35/45/50/35 vs raise to 70/60).
2. If raised, write co-located `*.test.ts` for untested modules (see
   `AGENTS.md` "Writing New Tests"; mock Phaser with `vi.mock('phaser')`).
3. Update `vite.config.ts` thresholds and `AGENTS.md` coverage claims once the
   floor changes.

---

## Phase 9 — `recommendedTypeChecked` audit

Current state: `eslint.config.js` disables several type-aware rules for the
`game/**` / `components/**` set by design. The plan requires an audited
allow-list with an explicit rationale per disabled rule.

Work:

1. For each disabled rule in `eslint.config.js`, remove the `off` override or
   document a page/file-specific justification and add a targeted inline
   suppression instead of a global override.
2. Run `npm run lint` with the tightened config and fix regressions.

---

## Open decisions (from REMEDIATION_PLAN.md lines 528-540)

These block a fully automated "done" and require owner input:

1. Seeded-save compatibility across mapgen changes.
2. AI economy symmetry (worker/deposit behavior).
3. Coverage floor: keep existing reachable thresholds or raise to 70/60.
4. Tailwind/CSS modernization scope.