# CivStrategy — Gauntlet Loop Feature Handoff

**Branch:** `gauntlet-loop-feature`
**HEAD:** `069d785`
**Remote:** `origin/gauntlet-loop-feature`
**Quality bar:** Manor Lords (primary), Stronghold (secondary)
**Pattern:** builder + fresh-context critic, side-by-side and blind comparison, real-game inspection, iterative until AAA parity or the user stops the run.

---

## Objective

Make CivStrategy feel like a genuinely AAA-quality strategy / city‑building game.
Compare the running game against Manor Lords at every playable moment: visual
cohesion, settlement believability, lighting, animation, camera feel, interaction
feedback, gameplay feel, and polish. Use Stronghold as the secondary bar for
clarity, responsiveness, and satisfying RTS interactions.

---

## Loop in one paragraph

For every important piece, spawn **one builder** subagent and **one fresh‑context
critic** subagent. The builder improves the piece, runs `npx tsc --noEmit`,
`npm run lint`, and `npm run test`, and appends a result section to
`LIVE_PROGRESS.md`. The critic inspects the real running game (dev server at
`http://127.0.0.1:5173`), captures screenshots, compares against the bar
side‑by‑side and blind when possible, names the single biggest remaining gap,
and appends a verdict section to `LIVE_PROGRESS.md`. The next round's builder
picks up the biggest remaining gap and ships a slice. Loop until the running
game is at parity with the bar or the user stops the run.

The lead agent (this orchestrator) only delegates. It does not edit source.

---

## Progress dashboard

`LIVE_PROGRESS.md` is the live progress page. It contains:

- the **quality bar** statement;
- an **active improvement board** table that tracks every open slice;
- a **round log** of every builder result and critic verdict in chronological
  order, each with summary, files touched, and a how‑to‑verify line.

Every builder and critic **appends** a new section using the established format
(`### Round N — <slice> (builder result)` or `### Round N — <slice> (critic
verdict)`). They never overwrite earlier sections. If the edit tool fails
because the file changed concurrently, re‑read and retry the append.

---

## What shipped on this branch (rounds 1–2)

### Round 1

- **HUD hierarchy and contextual tooltips** — builder result + critic verdict.
  Cinzel serif headings, brass gradient top bar with diamond dividers, amber
  age‑pulse, `HudTooltip` wrappers with 150 ms delay, opacity/contrast tuning
  for the body text.
  - `components/GameUI.tsx`, `components/HudTooltip.tsx` (new),
    `index.html`, `LIVE_PROGRESS.md`.
- **Building grounding, construction and damage readability** — builder
  result + critic verdict. Soft warm‑dark contact ellipse under every
  building (0x1a1208 at 0.35 α, 62 % × 42 % of footprint); faint contact
  discs for villagers and military units; pulsing brass selection ring;
  hover‑brightens the contact shadow.
  - `game/systems/EntityFactory.ts`, `game/systems/BuildingManager.ts`,
    `game/systems/VillagerSystem.ts`.

### Round 2

- **Camera feel and command acknowledgement** — builder result + critic
  verdict. Edge pan with zoom‑varying speed, smooth zoom (0.4× → 2.0×),
  expanding `showCommandRing` visual on ground clicks. The critic flagged
  that the ring exists but was never wired into the right‑click path, and
  that the `C` / `Home` recenter binding is missing.
- **HUD contrast** — builder result. Raised `--hud-muted` opacity `.62 → .85`,
  set tooltip body to fully opaque `var(--dust-white)` for ≥ 4.5:1 contrast,
  brightened seven secondary labels to `text‑stone‑300`‑equivalent. (Critic
  verdict pending — see "Open verdicts" below.)
- **Dynamic shadows** — builder result. Building contact shadows and villager
  discs now modulate alpha and colour from the live `dayNightState` published
  by `DayNightSystem` (~250 ms cadence). The warm‑dark ellipse cools as the
  sun lowers; villager discs scale their 0.25 α proportionally. (Critic
  verdict pending — see below.)

---

## Open verdicts (critics were spawned but interrupted)

When the wrap‑up was requested, two fresh‑context critics were running and
had not yet appended their verdict sections to `LIVE_PROGRESS.md`. On resume,
re‑spawn a critic for each, or pick up directly from the slice in question
if the user has approved the underlying change:

- **Round 2 — HUD contrast (critic verdict)** — open.
- **Round 2 — Dynamic shadows (critic verdict)** — open.

Each critic must inspect the running game at `http://127.0.0.1:5173`,
capture screenshots, and append a verdict using the established format. If
the slice meets the bar, confirm and name the next biggest gap. If not, name
the single biggest remaining gap and the suggested next slice.

---

## Open follow‑ups

- **Round 3 — Camera feedback wiring (builder result)** — the camera‑feedback
  wiring builder (subagent `74fccef1`) was interrupted before it finished
  wiring `addCommandAck` into the right‑click command path and adding the
  `C` / `Home` recenter binding. Re‑spawn it. Required deliverables:
  1. Wire `addCommandAck` (or call `this.scene.feedbackSystem.showCommandRing(worldX, worldY)`
     directly) into the right‑click command issuance path in
     `game/systems/InputManager.ts`. The world coordinates must be the
     cartesian pointer location, not screen pixels.
  2. Add `C` and `Home` key bindings in `InputManager` that call
     `this.scene.centerCameraOnTownCenter()` (or a thin `recenterCamera()`
     wrapper that lerps the camera scroll to the player Town Center over
     ~0.5 s). If no Town Center exists, do nothing.
  3. Verify `npx tsc --noEmit` (exit 0), `npm run lint` (exit 0),
     `npm run test` (309 / 309 pass).
  4. Append `### Round 3 — Camera feedback wiring (builder result)` to
     `LIVE_PROGRESS.md`.
- **Settlement ambience and daily‑life motion** — still "In progress" on
  the improvement board. No builder or critic has been spawned for this
  slice yet. Suggested targets: ambient citizen bobs (already in
  `AmbientPopulationSystem`), wind‑sway particles, leaf‑drift, dust motes,
  ambient audio cues. After the builder ships, spawn a fresh‑context
  critic to evaluate the running game against Manor Lords.

---

## Active improvement board snapshot

| Slice | State |
|---|---|
| HUD hierarchy and contextual tooltips | Round 1 builder + critic landed. Round 2 contrast builder landed; critic verdict pending. |
| Building grounding, construction and damage readability | Round 1 builder + critic landed. Day/night integration (Round 2 dynamic shadows) builder landed; critic verdict pending. |
| Settlement ambience and daily‑life motion | Not yet started. |
| Camera feel and command acknowledgement | Round 2 builder landed; critic verdict recorded. Round 3 wiring builder was interrupted — needs to finish. |

---

## How to verify the branch

```bash
git fetch origin
git checkout gauntlet-loop-feature
npm install            # if needed
npx tsc --noEmit       # exit 0
npm run lint           # exit 0
npm run test           # 309 / 309 pass
npm run dev            # dev server at http://127.0.0.1:5173
```

Then in the browser:

- Top bar: brass gradient with diamond dividers, Cinzel headings, Inter body.
  Hover each resource / age / happiness / season / diplomacy chip — a
  tooltip appears after a brief delay. Tooltip body is fully opaque and
  clearly readable.
- Match start: every building has a soft warm‑dark contact shadow sized
  to its footprint; selecting a building raises a brass outline ring that
  pulses; the contact shadow brightens on hover.
- Time‑of‑day controls: advance the cycle. Building shadows cool and
  fade; villager discs scale their alpha. The day/night overlay and
  ambient colour track the solar cycle.
- Edge pan and zoom: cursor to a screen edge pans the camera; the wheel
  zooms between 0.4× and 2.0× with smooth easing.
- Ground click (after Round 3 lands): an expanding brass ring appears at
  the click location as command acknowledgement. `C` or `Home` recenters
  on the player Town Center.

---

## Resume instructions

1. `git checkout gauntlet-loop-feature && git pull`.
2. Confirm the dev server is running: `curl -s -o /dev/null -w "%{http_code}\n"
   http://127.0.0.1:5173` → `200`. If not, start it with
   `npm run dev &` (background).
3. Read `LIVE_PROGRESS.md` to see the latest state of every slice and
   the most recent critic verdicts.
4. For each open verdict, re‑spawn a fresh‑context critic and let it
   append its section.
5. For the Round 3 camera wiring, re‑spawn the builder with the
   instructions in "Open follow‑ups" above.
6. Pick the next biggest gap (likely settlement ambience) and run the
   builder + critic pair.
7. Keep the goal active in the goal system until a critic verdict records
   that the running game is at parity with the Manor Lords bar. Only then
   run `update_goal({ action: 'complete' })`.

---

## File map (what's new on this branch)

- `LIVE_PROGRESS.md` — live progress page (new).
- `components/HudTooltip.tsx` — reusable tooltip with 150 ms delay, brass
  border, serif title, sans body, `placement="top" | "bottom"`.
- `components/GameUI.tsx` — Cinzel headings, brass gradient border, diamond
  dividers, amber age pulse, brighter secondary labels.
- `index.html` — `.hud-tooltip*` rules, `.divider-diamond`, `.font-cinzel`,
  `.age-block-advance`, `--hud-muted` opacity raised `.62 → .85`.
- `game/systems/EntityFactory.ts` — soft contact ellipse at container
  index 0 for every building; `registerBuildingShadow` /
  `handleDayNightDataChange` plumbing for the day/night cycle; cool/warm
  shadow colour modulation.
- `game/systems/BuildingManager.ts` — pulsing brass selection ring,
  hover‑brightens contact shadow, clears previous ring.
- `game/systems/VillagerSystem.ts` — faint black disc under every
  villager (10×5 px at 0.25 α).
- `game/systems/InputManager.ts` — edge pan, smooth zoom, `addCommandAck`
  defined (not yet wired into the right‑click path).
- `game/systems/FeedbackSystem.ts` — `showCommandRing` public method.
- `game/systems/DayNightSystem.ts` — publishes `EVENTS.DAY_NIGHT_STATE_CHANGED`
  / `scene.data.set('dayNightState', ...)` for the dynamic shadow hook.
- `artifacts/` — automation telemetry (`day-night-journey.json` etc.).

---

## What was cleaned up (this handoff)

Removed files that were from the previous (performance‑sprint) gauntlet
loop and unrelated to the current AAA‑quality task:

- `GAUNTLET_PROMPT.md` (old gauntlet spec, 5000‑unit performance bar).
- `GAUNTLET_PROGRESS.md` (old cycle tracker, perf metrics).
- `gauntlet-progress.json` (old perf gauntlet JSON).
- `HANDOFF.md` (old performance‑sprint handoff).
- `PROGRESS.md` (old performance‑sprint progress dashboard).
- `VISUAL_GAP_AUDIT.md` (stale visual audit from a prior task).
- `WORKBENCH.md` (stale workbench notes).
- `traces/GPU_VERIFICATION_INTERIM.md`,
  `traces/GPU_VERIFICATION_FINAL.md`,
  `traces/PERF_RESULTS.md` (stale GPU/perf traces).
- `docs/specs/2026-08-27-menu-sound-design.md`,
  `docs/superpowers/plans/2026-08-27-menu-sound.md` (stale menu‑sound
  spec / plan).
- `docs/MAINSCENE_DECOMPOSITION_HANDOFF.md`,
  `docs/refactoring/MAINSCENE_REFACTOR.md`,
  `docs/refactoring/MAINSCENE_PHASE3_GOAL.md` (stale refactor handoffs).
- `docs/LIVING_CITY_NORTH_STAR.md` (stale living‑city north star from a
  prior phase).

The full deletion set is in the "chore(gauntlet-loop): clean stale docs
from previous gauntlet" commit on this branch.

---

## Reference

- `AGENTS.md` — repository guidelines, verification workflow, code
  conventions.
- `NORTH_STAR.md` — durable product‑quality reference.
- `GEMINI.md` — comprehensive game‑mechanics context.
- `LIVE_PROGRESS.md` — the live progress page itself.
