# 0 A.D. Game-Logic & Design Mechanics — Research Report

**Audience:** designers/engineers building a smaller RTS (Phaser/TypeScript) who want to borrow
polish-level mechanics from a mature open-source RTS.
**Sources:** 0 A.D. source (`github.com/0ad/0ad`, `binaries/data/mods/public/simulation/…`) and official
docs/wiki. Direct URLs are cited per section.

> Note on the damage formula: the `Resistance` component lives in JS but the final reduction is applied
> in the engine. The community-documented and code-consistent model is **effectiveDamage = attack ×
> 10 / (armor + 10)** per damage type (each armor point ≈ 9.1% reduction, i.e. ×0.9 per point).
> See `https://wildfiregames.com/forum/topic/79341-resistance-calculations/`.

---

## 1. Resource Economy

**Resources:** Food, Wood, Stone, Metal (4 tradeable) + **Population** (a cap, not gathered).
Source: `https://play0ad.com/category/game-manual/`, `https://0ad.fandom.com/wiki/Resource`

### Workers
- **Female Citizens** (Support class): specialize in **Food**, gather it faster than males, and emit an
  **aura that boosts nearby male workers' gather rate by ~10%**. Cannot build military buildings; weak in
  combat. `https://0ad.fandom.com/wiki/Female_Citizen`
- **Citizen Soldiers** (male, e.g. spear/bow/cavalry): slower at food but relatively faster at
  wood/stone/metal, can build military buildings, and fight. Cavalry gather food (hunting) quickly.
- This **gendered split** is a real design lever: women = safe economic backbone + aura buffer; men = dual
  economy/combat role. A smaller game can use a simpler "villager + soldier" dual-role unit.

### Gather model (from `components/ResourceGatherer.js`)
- `BaseSpeed` = resource units/second baseline (default `1.0`).
- `Rates` = per-subtype multipliers, e.g. template defaults: `food.fish 1`, `metal.ore 3`, `stone.rock 3`,
  `wood.tree 2`. Final rate = `BaseSpeed × Rates[subtype]`.
- `Capacities` = carry limit per resource (default `10` each). `MaxDistance` = gather reach (default `2.0`).
- The timer is `1000 / rate` ms and exactly `1` resource is taken per tick → **rate == units/second**, and
  the engine caches rates (cheap to recompute only on tech/owner change).
- Subtypes matter: `food.meat`, `food.fruit`, `food.grain`, `food.fish`, `metal.ore`, `stone.rock`,
  `wood.tree`. Different sources give different rates — a polished game differentiates gather speed by
  resource type, not just by unit.

### Diminishing returns (from `components/ResourceSupply.js`)
- Each supply can set `DiminishingReturns` (geometric ratio `r`, default `0.8`) and `MaxGatherers`
  (default `25`).
- Average rate multiplier for `n` gatherers:
  `avgMult = (1 − rⁿ) / ((1 − r) · n)`
  i.e. the *first* gatherer is full speed, the next ~0.8×, then 0.64×… and the **average** shrinks, so
  piling workers on one node is inefficient → players are pushed to **spread across nodes**. Strong,
  simple anti-stacking mechanic worth copying.
- Supplies are **finite** (`Max`/`Initial`) or **Infinite** (farms). Finite nodes can `Change` over time
  (regrow/rot/decay) via `Growth`/`Rotting`/`Decay` states with `Interval`/`UpperLimit`.

### Drop-off points (from `https://0ad.fandom.com/wiki/Dropsite`)
| Dropsite | Accepts | Notes |
|---|---|---|
| Civic Centre | Food, Wood, Stone, Metal | Also trains units, expands territory |
| Storehouse | Wood, Stone, Metal | Cheap; econ techs |
| Farmstead | Food | Cheap; farm techs |
| Dock | All 4 | Buildable in **neutral** territory |
| Mill | (gather aura) | Buildable in **any** territory; broadcasts gather aura |
| Worker Elephant (Maurya) | All 4 | Mobile dropsite |

- A unit only drops at a site it **owns or shares with an ally** (`HasSharedDropsites`). This makes
  **travel time the dominant economic cost** → the #1 skill is *minimizing walkways* (build dropsites near
  remote nodes). Takeaway: **dropsite placement > gather rate** in economic skill expression.

### Territory
- Buildings (esp. Civic Centre) project a **territory**; inside your territory units get an **armour
  bonus**, and you may build/gather. Outside it (enemy or unclaimed) you generally cannot gather without
  capturing a settlement or building a Mill. `https://docs.wildfiregames.com/design/gameplay/main/war-story.html`
- **Design takeaway:** territory turns map control into a tangible combat-economy axis (you can't just
  stealth-gather behind enemy lines). Even a small game benefits from "claimable zones" that gate
  building/gathering.

---

## 2. Combat Model

### Damage types (3) — `https://play0ad.com/9-combat/`, `https://0ad.fandom.com/wiki/Hack`
Every unit/building has **independent armour per type**: **Hack, Pierce, Crush**.
- **Hack** — melee (swords, spears, melee cavalry, siege rams). Buildings & siege very vulnerable.
- **Pierce** — ranged (archers, javelins, bolt shooters). Siege rams & buildings very resistant.
- **Crush** — splash/area, siege, trample, some elephants.

This `hack/pierce/crush` triad (vs AoE's melee/pierce) lets you express **rock-paper-scissors without
armour classes**: spearmen have high hack armour (beat swords) but low pierce (lose to archers); archers
have high pierce resist; buildings soak pierce but melt to hack. **Takeaway: 3 damage types + per-type
armour is enough to create deep counters with few numbers.**

### Damage formula
Per damage type: `effectiveDamage = attack × 10 / (armor + 10)` (then bonuses/penalties multiply).
- armor 0 → 100%, armor 1 → 90.9%, armor 2 → 83.3%, armor 5 → 66.7%, armor 10 → 50%.
- Smooth, never-zero, never-negative — **diminishing returns on armour investment** (extra armour is
  always useful but less so each point). This is preferable to AoE's `max(1, atk−armor)` flat-subtraction
  (which makes low armour trivial and creates hard breakpoints).

### Attack component (from `components/Attack.js`)
Each attack type carries:
- `Damage` (Hack/Pierce/Crush values), `MaxRange`, optional `MinRange` (ranged dead-zone),
  `PrepareTime` (wind-up synced to animation), `RepeatTime` (attack interval/rate),
  `Bonuses` (multiplier vs `Classes`/`Civ`, e.g. Cavalry Spearman `2.0× vs Infantry Swordsman`,
  `1.5× vs all Cavalry`), `RestrictedClasses` (cannot target, e.g. can't hit Champions),
  `PreferredClasses` (target-priority), `Splash` (Circular/Linear, `FriendlyFire`), `Projectile`
  (`Speed`, `Spread`, `Gravity`).

Concrete unit example (from wiki): **Infantry Spearman** — Attack `10 Hack`; Armour `2 Hack / 1 Pierce /
2 Crush`; bonus vs Cavalry. **Cavalry Spearman** — `6 Hack + 5 Pierce / 2s`, `4/3/15` armour, `2×` vs
Infantry Swordsman.

### Ranged accuracy & range falloff (from `Attack.js` `PerformAttack`)
- `distanceModifiedSpread = Spread × (distance / 100)`.
- Final impact point = predicted target position + `randomNormal2D() × distanceModifiedSpread`.
- So **accuracy decays ~linearly with distance**: point-blank is near-perfect, long shots scatter. This
  rewards closing distance and punishes kiting at max range — a cheap, readable accuracy model.
- Target leading: it predicts target position using `UnitMotion.EstimateFuturePosition` (velocity
  extrapolation), with a random fallback, so arrows hit moving units. `EffectDelay` = projectile travel
  time before damage applies.

### Trample / crush
Melee cavalry and war elephants apply **passive crush "trample" damage** to nearby enemies each tick
(Ptolemies list a "Trample Damage" aura). Simple AoE-on-movement that rewards cavalry charges into packs.

### Flank / rear bonuses (from `https://docs.wildfiregames.com/design/gameplay/main/formations.html`)
- **Unit-based directionality:** a unit has weaker armour on its back/sides; it turns to face attackers,
  so hitting its rear/flank gives a bonus.
- **Formation-based directionality:** formations have an orientation; attacking the **rear** of a
  formation applies a defence malus, wide formations are harder to flank.
- Combine the two and attacking a thin/wide formation from behind can double-dip (formation malus +
  unit rear malus). **Takeaway:** facing + formation orientation is what makes positioning matter beyond
  "click and they fight."

### Loot
Units drop a fraction of their cost as resources on death (scales with promotion: `+20% loot` on
Advanced/Elite). Gives economic incentive to fight, not just to win.

---

## 3. Unit AI & Stances

(from `components/UnitAI.js` — `g_Stances` table)

The stance system is a clean 2-axis design: **when do I acquire a target?** × **how far do I go to fight?**

| Stance | Acquire visible enemies | Chase | Hold/Stand ground | Flee |
|---|---|---|---|---|
| **violent** | yes (+attackers always) | yes (even beyond vision) | — | no |
| **aggressive** | yes | yes (within vision) | — | no |
| **defensive** | yes | no | **hold ground** | no |
| **standground** | yes | no | **stand, don't move** | no |
| **passive** | no | no | — | **flee** |
| **skittish** | no | no | — | **flee on sight** |
| **passive-defensive** | no | no | hold ground | no |

Mechanics worth copying:
- **Attackers-always:** a unit set to "defensive" still retaliates if *it* is hit (`targetAttackersAlways`).
- **Forced orders override** stances (`force: true`) so scripted moves aren't cancelled by AI.
- **Patrol** = walk waypoints, pause `PatrolWaitTime` at each, and **fight anything encountered en route**
  (WalkAndFight under the hood). Great for "sweep and hold" behavior.
- **Guard** = follow + protect a unit; if the guarded unit is hurt, the guard **heals/repairs** it instead
  of attacking. Elegant escort AI from one flag.
- **Auto-formation:** issuing a move/attack to ≥ N selected units auto-groups them into a formation.
- FSM architecture: `INDIVIDUAL` / `FORMATIONMEMBER` / `FORMATIONCONTROLLER` states with orders
  (Walk, WalkAndFight, Attack, Gather, Heal, Garrison, Flee). A small game can copy this **order-queue +
  state-machine** pattern instead of ad-hoc unit logic.

**Takeaway:** stances are the single biggest "feels like a real RTS" feature for almost no cost — give
every combat unit at least *aggressive / defensive / stand ground / passive*.

---

## 4. Formations

(from `components/Formation.js` + `https://docs.wildfiregames.com/design/gameplay/main/formations.html`)

Available shapes referenced in code: **Scatter, Box, ColumnClosed, LineClosed, ColumnOpen, LineOpen,
Flank, Skirmish, Wedge, Testudo, Phalanx, Syntagma, BattleLine**.

Each formation template defines:
- `RequiredMemberCount` (min members; "battalion" min ~6), `SpeedMultiplier`
  (`formationSpeed = min(member speed) × mult`),
- `FormationShape` (square / triangle / special), `WidthDepthRatio`, `ShiftRows`, `CenterGap`,
- `SortingClasses` (e.g. Cavalry placed before Infantry; most important units fill front/center),
- `UnitSeparationWidth/DepthMultiplier`, `Sloppiness` (position jitter in metres),
  `MinColumns`/`MaxColumns`/`MaxRows`, `MaxTurningAngle`, `AnimationVariants` (front row gets
  `testudo_front` anim, etc.).

Key rules:
- **Bonuses apply only when ~90% of units are in position** (prevents instant swap-cheese).
- **Directional bonuses:** front strong / side weaker / rear weakest (Phalanx & Testudo = near-invincible
  front, catastrophically weak rear → must be guarded).
- **Auto column↔box switch** at a walking-distance threshold (`g_ColumnDistanceThreshold = 128`): far
  moves use a thin column (fits through gaps), close combat uses a box.
- **Twin formations** merge when they get close (avoids two half-armies).
- **Morale/panic:** if enough % of the formation dies in time, it enters **panic** — reduced attack/armour,
  units scatter and stop fighting until pulled back / reformed. Smaller formations panic easier.

**Takeaway:** formations shouldn't just be "move together." Real value = (a) speed = slowest member,
(b) position-dependent combat bonuses, (c) directional vulnerability, (d) morale collapse. Even a 3-formation
system (line/box/column) plus a front-bonus + rear-malus gives 80% of the feel.

---

## 5. Pathfinding & Movement

(from `source/simulation2/.../Pathfinding.h`, `LongPathfinder.cpp`, `CCmpPathfinder.cpp`,
`ICmpPathfinder.h`, `HierarchicalPathfinder.h` — docs at
`https://docs.wildfiregames.com/pyrogenesis/`)

0 A.D. uses the classic **two-layer** design that every polished RTS needs:

1. **Long-range pathfinder** — tile/navcell grid (world split into `NxN` navcells, passability expanded
   by unit clearance +1). Uses **A\*** with a **Jump Point Search (JPS)** optimization and a cached jump-point
   grid for sparse maps. Ignores other units; outputs coarse waypoints.
2. **Hierarchical pathfinder** — connectivity via fixed-size **chunks → regions**; flood-filled into
   "global regions" so `IsGoalReachable` / `MakeGoalReachable` is O(1)-ish (can point A even reach point B
   across the map? which region?).
3. **Short-range (vertex / points-of-visibility) pathfinder** — A* over the **corners of rectangular
   obstructions** (quadrant optimization from GPG2), restricted to a small `range` box around the unit,
   and **avoids moving units** (`avoidMovingUnits`). This resolves local collisions/narrow gaps precisely.

Flow: `UnitMotion` requests a **long path** for the macro route and a **short path** continuously for
local avoidance; long path is recomputed rarely, short path every turn (async). The long pathfinder is
deliberately **stricter** (clearance +1) than the short one so units never get shoved into walls.

**"Pushing through units":** the short-range finder avoids moving units, but units still resolve overlaps
(obstruction system); when a formation controller is stuck while individuals aren't, it briefly tells
members to move individually (`veryObstructed` handling). Units can be pushed but the engine prevents
permanent overlaps.

**Takeaway for a Phaser/TS game:** do **not** pathfind the whole map per unit per frame. Use (a) a
grid A* for long routes computed on order, and (b) a cheap local separation/steering (boids-style push
apart) for unit-unit avoidance. The JPS + hierarchical connectivity trick is what keeps large armies fast.

---

## 6. Siege & Buildings

(from `components/Resistance.js`, `BuildingAI`, `Garrison` wiki `https://0ad.fandom.com/wiki/Garrison`)

- Buildings carry **Foundation** resistance (while unfinished) and **Entity** resistance (built) — often
  different values, so rushing a foundation is rewarded.
- **Siege Rams:** huge HP, vulnerable to **hack**, resistant to **pierce**, deal crush; garrisonable.
- **Bolt Shooters / catapults:** pierce + crush, splash damage (Circular/Linear), can hit behind walls.
- **Building attack** (`BuildingAI`): towers/fortresses/docks auto-fire at enemies in range; **garrisoned
  infantry/cavalry increase arrows fired** (arrow count scales with garrison). Towers take infantry (not
  cavalry). This makes "hide troops in towers" a real defensive multiplier.
- **Capture** (separate `Capture` attack + `Capture` resistance, see §2/§7): attacking a building/relic
  drains its **capture points**; when the current owner's share hits 0, ownership flips. Garrisoned units
  add capture defence. Relics (Capture-the-Relic mode) work the same way.
- **Decay:** buildings outside their territory lose capture points over time and can be **captured or
  destroyed**; some civs (Romans "Citizenship") get an armour bonus defending home territory.

**Takeaway:** (1) unfinished buildings should be weaker; (2) garrisoning should give visible, scaling
payoffs (more arrows, healing); (3) a **capture** mechanic adds a whole victory/raiding layer without
needing to destroy everything.

---

## 7. Ages / Phases

(from `https://play0ad.com/8-technologies-and-phases/`, `https://0ad.fandom.com/wiki/List_of_Technologies`)

Three phases, advanced at the **Civic Centre** (phases are "super-technologies"):

| Phase | Cost | Building requirement | Unlocks |
|---|---|---|---|
| **Village** (start) | — | — | basic units, houses, CC |
| **Town** | 500 Food + 500 Wood (~30s) | 5 Village-phase buildings (not palisades/fields) | new units, buildings, CC expansion, techs; **+10% territory influence** |
| **City** | 1000 Stone + 1000 Metal (~60s) (some civs 750/750) | 4 Town-phase buildings (not walls/CC) | late units, wonders; +10% territory |

- Requirements are **entity-count gates** ("build 5 structures"), not just resource cost → forces economic
  expansion before power spikes.
- Phasing also boosts territory influence, tying progression to map control.

**Takeaway:** gate age-ups on **both resources and a build/unit count**, and make each age unlock a
meaningful *set* of options rather than a single unit. The "+territory on age-up" couples progression
with map pressure.

---

## 8. Technologies & Upgrades

(from `simulation/data/technologies/*.json`, `components/...`, commit
`https://github.com/0ad/0ad/commit/1147cf5305cf417695d88e27caef625776c8bf37`)

- Techs are **JSON data**, not code. Each has `cost`, `researchTime`, `tooltip`, `requirements` (phase),
  and a `modifications` array of `{ "value": "Attack/Ranged/MaxRange", "add": 8 }` or `{ "multiply": 0.9 }`
  with optional `affects` (class filter).
- Values are applied through one central pipe: `ApplyValueModificationsToEntity(...)`, so **any numeric
  stat** (attack, armour, HP, gather rate, build time, vision, speed, loot, capture) can be modified by tech
  without special-casing. The engine caches derived values and only recomputes on tech/owner change.
- **Mutually-exclusive pairs:** two linked buttons, pick one per game (shown with a link icon). This gives
  meaningful *build-order/strategy* choice without bloating the tree.
- Some techs **auto-research** on promotion (`unit_advanced`/`unit_elite`): e.g. Advanced units get
  `+1 armor, +10% HP, +20% melee dmg, +20% loot, −30% gather` automatically when a unit is promoted.
- Research happens at **specific buildings** (Storehouse/Farmstead = economy; Forge/Barracks = military;
  Temple = healer; Dock = naval), enforcing building purpose.

Concrete examples (from the A24 commit above): `archery_tradition` → archers `−10% train time, +10 range,
−10% spread`; `unit_advanced` → melee `+20% damage`, elites `+0.8 capture`, healers `+5 heal`.

**Takeaway:** model techs as **data-driven modifiers over a flat stat list**, applied via one
modification pipeline. This is the scalable pattern — your TS game should avoid hard-coding upgrades.

---

## 9. AI Bot (Petra)

(from `simulation/ai/petra/*.js` — `headquarters.js`, `attackManager.js`, `baseManager.js`,
`researchManager.js`, `tradeManager.js`, `worker.js`, etc.
`https://play0ad.com/new-release-0-a-d-alpha-22-venustas/`)

Petra is a **modular JavaScript AI** (no engine cheating by default; difficulty = handicap multipliers,
e.g. gather-rate `1 + (idx−19)×0.05`). Manager breakdown:

- **HQ (headquarters.js):** high-level loop. Maintains `targetNumWorkers` and `supportRatio` to keep a
  **worker:soldier ratio**; decides phase-up, building priorities, attack timing.
- **Economy:** `pickMostNeededResources()` compares **wanted gather rates** (from planned queues) vs
  **current gather rates** and assigns new workers to the biggest gap — a demand-driven economy, not
  fixed ratios. `trainMoreWorkers` uses an exponential curve to decide support vs soldier mix at
  different pop levels.
- **Base expansion:** `findEconomicCCLocation` / `findStrategicCCLocation` score map cells using
  **resource maps + territory maps + distance-to-other-CC heuristics** (reject too-close/too-far, favor
  resource-rich, disfavor map borders/dangerous spots). Uses **accessibility/region maps** to know which
  land/sea regions connect.
- **Military/Attacks:** `attackManager` plans rushes and full attacks, choosing composition based on
  army and **victory condition** (Conquest, Regicide, Capture-the-Relic, Wonder). Avoids trade routes
  crossing enemy territory.
- **Defense:** `defenseManager`/`defenseArmy` react to attacks; `emergencyManager` handles crises;
  `garrisonManager` uses decaying/capturable structures.
- **Trade/Naval:** separate managers; `tradeManager` maximizes gain by market distance; `navalManager`
  handles transport/ship attacks.
- **Diplomacy & Victory:** managers for alliances and win-condition tracking.

**Takeaway for your bot:** you don't need one smart brain — use **separate specialist managers** (economy,
military, defense, research) sharing a blackboard of maps (resource/territory/accessibility) and a
priority queue. Drive worker allocation by **demand (wanted vs current rates)**, not static ratios, and
make attacks conditional on composition + victory type.

---

# Cross-cutting Design Takeaways (polished vs basic RTS)

1. **3 damage types + per-type armour** create deep counters with minimal data. Prefer
   `dmg × k/(armor+k)` over flat `max(1, atk−armor)` for smooth, never-trivial armour.
2. **Stances** (aggressive/defensive/stand-ground/passive) are cheap and define the feel.
3. **Formations** = slowest-member speed + position bonuses + directional (front/rear) vulnerability +
   morale collapse. Auto-group on multi-select.
4. **Two-layer pathfinding** (grid A* for routes + local separation/visibility for avoidance) is the
   performance + polish key; hierarchy/connectivity answers "can I even get there."
5. **Diminishing returns on gatherers per node** + **travel-time-dominated economy** → skill = dropsite
   & base placement, not just spamming workers.
6. **Territory** couples map control to economy/combat (gather & build rights + home armour bonus).
7. **Capture** as a first-class attack type enables relic/raiding/decay victory layers cheaply.
8. **Phases gated by both resources and building counts**, each boosting territory and unlocking option
   sets.
9. **Techs as data-driven modifiers** through one `ApplyValueModifications` pipeline — extensible without
   code changes.
10. **AI as cooperating managers** over shared maps, demand-driven economy, composition- and
    victory-condition-aware attacks.

# Primary Source URLs
- Game manual / technologies & phases: `https://play0ad.com/category/game-manual/`,
  `https://play0ad.com/8-technologies-and-phases/`
- Combat overview: `https://play0ad.com/9-combat/`
- Wiki (mechanics, units, civs): `https://0ad.fandom.com/wiki/`
- Official design docs: `https://docs.wildfiregames.com/design/gameplay/main/` (war-story, formations,
  civs) and engine docs `https://docs.wildfiregames.com/pyrogenesis/`
- Source (simulation): `https://github.com/0ad/0ad/tree/master/binaries/data/mods/public/simulation`
  - `components/Attack.js`, `components/ResourceGatherer.js`, `components/ResourceSupply.js`,
    `components/Resistance.js`, `components/UnitAI.js`, `components/Formation.js`
  - `ai/petra/headquarters.js` (+ attackManager, baseManager, researchManager, worker, …)
- Pathfinding source/docs: `source/simulation2/helpers/{LongPathfinder,Pathfinding,HierarchicalPathfinder}.h`,
  `source/simulation2/components/CCmpPathfinder*.cpp`, `ICmpPathfinder.h`
- Damage/armour discussion: `https://wildfiregames.com/forum/topic/79341-resistance-calculations/`
- Petra AI release notes: `https://play0ad.com/new-release-0-a-d-alpha-22-venustas/`
