# CivStrategy North Star

This document is the persistent quality reference for CivStrategy development.

The target is not merely feature completeness. CivStrategy should feel like a polished commercial RTS: deliberate, responsive, readable, cohesive, stable, and smooth. A feature is not done because it exists. It is done when it survives gameplay, regression checks, performance measurement, and a fresh critic pass.

The execution model is Gauntlet-style: **inspect -> criticize -> improve -> verify -> repeat**.

## Core product direction

CivStrategy should feel like a living medieval strategy game rather than a collection of disconnected systems.

Primary gameplay inspiration is **Manor Lords** for grounded settlement feel, atmosphere, readable large-scale movement, and the sense that a town is alive. This is not a Manor Lords clone. Existing CivStrategy systems remain part of the identity: large-scale RTS combat, formations, ages, factions, economy, terrain, and systemic simulation.

For UI, use **Stronghold + Manor Lords + Age of Empires + the current CivStrategy UI** as references:

- Stronghold: tactile medieval character, compact controls, strong category/icon language.
- Manor Lords: restrained presentation, atmosphere, clean hierarchy, world-first framing.
- Age of Empires: strong information density, predictable commands, fast recognition, readable economy/production state.
- Current CivStrategy UI: the default foundation. Iterate before redesigning.

## Non-negotiable quality pillars

### 1. Rock-solid gameplay

Correctness outranks adding more features.

- No known critical or high-severity gameplay bugs.
- No reproducible soft locks, stuck units, broken commands, invalid state transitions, corrupted saves, disappearing resources, or impossible progression paths.
- Core commands must be trustworthy: select, move, attack, build, gather, garrison, research, save/load, and camera interactions.
- Systems must remain correct when combined, not only in isolation.
- AI should recover from normal world conditions instead of silently bricking.
- Severe regressions become tests or explicit recurring verification scenarios.
- Prefer systemic root-cause fixes over narrow special cases.

"Bugless" is the shipping target: zero known release-blocking defects, not a claim that undiscovered bugs can never exist.

### 2. Smoothness is a feature

- Target stable 60 FPS during representative gameplay.
- Preserve the 5,000-unit stress target where applicable.
- p95 frame time matters as much as average FPS.
- Avoid visible simulation hitches, selection lag, delayed command acknowledgement, camera judder, bursty pathfinding, GC spikes, and UI stalls.
- Expensive effects should degrade gracefully through culling, LOD, batching, throttling, pooling, or equivalent techniques.

### 3. Complete interaction feedback

Every important action should communicate:

**intent -> acknowledgement -> action -> impact -> readable result**

Examples:

- Unit command: immediate acknowledgement, readable path/formation response, natural motion, clear arrival or engagement state.
- Combat: wind-up/readiness, contact/projectile, impact response, consequence, death/retreat transition.
- Building placement: clear footprint, valid/invalid state, terrain relationship, placement feedback, construction state, completion payoff.
- Economy: visible cause-and-effect between worker/building activity and resource changes.

Nothing important should feel silent, mushy, delayed, or ambiguous.

### 4. Large battles should feel fluid

The target is an organic clash, not a rigid wall of locked formation offsets.

- Formations express intent and cohesion, not positional imprisonment.
- Front lines can bend, compress, split, reform, and react to local pressure.
- Avoid obvious overlap, teleporting, jittering, orbiting, and snapping.
- Local collision and combat pressure should create a convincing liquid clash.
- Large groups remain controllable and readable while individual units retain local freedom.
- Infantry, ranged, cavalry, siege, and villagers should feel behaviorally distinct.

### 5. Living world

The settlement should communicate activity even when the player is not issuing commands.

Villagers, animals, ambient civilians, workers, smoke, seasons, vegetation, water, resource depletion, construction, damage, research, peace/war, and prosperity should reinforce world state without creating visual noise or harming frame pacing.

The world should be enjoyable to watch at 1x speed.

## UI North Star

Do not redesign the current UI from zero just because a new reference exists. Replace an existing pattern only when the change demonstrates a concrete improvement in readability, discoverability, decision speed, hierarchy, screen-space efficiency, consistency, accessibility, interaction feedback, or visual quality.

Principles:

- The world is the hero; UI frames the battlefield instead of covering it.
- Important information should be glanceable in under a second.
- Common actions should require minimal pointer travel and menu depth.
- Progressive disclosure is better than showing every control at once.
- Selection context should drive available actions.
- Avoid generic SaaS/dashboard aesthetics, excessive glassmorphism, floating-card clutter, and decorative motion with no gameplay purpose.
- Hover, pressed, selected, disabled, warning, affordable/unaffordable, valid/invalid, queued, researching, and cooldown states must be unmistakable.
- Motion should be quick and physical rather than floaty.
- Tooltips should explain consequence, not merely repeat labels.
- UI must remain readable over bright terrain, dark terrain, fog, combat effects, and seasonal tinting.

## Visual and audio quality bar

AAA does not mean "add more effects." It means every element looks and sounds intentional together.

- Keep scale, perspective, grounding, shadows, depth, anchors, and origin points consistent.
- No floating markers, broken z-order, coordinate drift, or distracting LOD popping.
- Terrain, water, foliage, buildings, units, particles, fog, lighting, and post-processing should read as one scene.
- VFX should clarify state and impact before adding spectacle.
- Important actions should receive immediate audio acknowledgement where appropriate.
- Repetitive sounds need variation and sensible concurrency limits.
- Audio, particles, camera response, animation, and UI feedback should reinforce the same event rather than fire independently.

Prefer a coherent 9/10 scene over one 10/10 effect surrounded by 6/10 systems.

## The AAA Gauntlet loop

For major gameplay/UI work:

1. **Inspect the real artifact.** Run the game. Use screenshots/video for visual/UI judgement and profiling data for smoothness. Do not judge quality from code alone.
2. **Find the largest gap.** Prioritize correctness, responsiveness, performance, readability/feedback, systemic coherence, visual polish, then additional content.
3. **Implement the smallest coherent improvement.** Fix root causes and keep the slice independently testable.
4. **Fresh critic pass.** A separate critic should look for regressions, awkward interactions, edge cases, visual inconsistency, unreadable states, performance loss, and fake polish that hides weak gameplay.
5. **Measure.** Use automated tests, type/lint/build checks, gameplay scenarios, save/load round trips, screenshots, recordings, frame-time/FPS profiles, stress tests, and input-response observations as appropriate.
6. **Repeat.** Continue until no critical/high defect remains in scope and the largest remaining improvement would require meaningful scope expansion.

When code and documentation disagree, prefer measured current-game evidence and update stale documentation.

## Recurring representative scenarios

Grow and preserve regression coverage around these flows:

- New game -> first resources -> first construction -> first military unit -> first combat.
- Economy running for an extended period with multiple resource chains.
- Large multi-squad movement across terrain and around obstacles.
- Large melee clash with ranged units and cavalry involved.
- Formation changes during movement and combat.
- Building placement near terrain, water, and other structures.
- AI base development and attack progression.
- Save during active game -> reload -> continue normally.
- Age advancement and research progression.
- Win/lose/dominance transitions.
- Camera pan/zoom, minimap, and selection during heavy simulation load.
- Stress scenarios at increasing unit counts, including the established 5,000-unit target.

Every previously fixed severe regression should join this suite when practical.

## Definition of Done

Relevant major work is not done until:

- Core behavior works in real gameplay, not only unit tests.
- No known critical/high regression remains.
- A fresh critic has inspected the result.
- Relevant automated checks pass.
- Representative integration scenarios pass.
- Performance is measured and stays within the agreed budget.
- Interaction feedback is immediate and readable.
- Visual/UI states remain coherent with the existing design language.
- Large-scale behavior remains usable and readable.
- Save/load and long-running state are checked when affected.
- Significant remaining gaps are fixed or explicitly recorded.

## Anti-goals

Do not reach for "AAA" by:

- adding particles everywhere,
- increasing bloom or screen shake,
- replacing the current UI with a fashionable web dashboard,
- over-animating menus,
- making formations rigid for visual neatness,
- hiding simulation problems behind LOD,
- lowering unit counts until performance looks good,
- shipping severe bugs because the feature demo works,
- adding breadth while core loops are unreliable,
- copying Manor Lords, Stronghold, or Age of Empires literally.

The target is their quality discipline and readability, expressed through CivStrategy's own systems.

## Relationship to existing repository guidance

- `GAUNTLET_PROMPT.md` defines the execution pattern and performance-oriented development loop.
- `GAUNTLET_PROGRESS.md` records measured gaps and cycle evidence.
- `AGENTS.md` defines repository architecture and engineering constraints.
- `docs/LIVING_CITY_NORTH_STAR.md` defines the long-term city-builder, population, logistics, urban-combat, and sprite-generation direction.
- This file defines the product-quality bar those workflows should optimize toward.

The desired outcome is simple: a player can build, manage, command, fight, save, reload, and continue without thinking about the implementation underneath.

The highest compliment is not "this has a lot of features."

It is: **"This feels finished."**
