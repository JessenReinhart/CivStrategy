# CivStrategy: Ancient Realms — Project Overview

## What is CivStrategy?

CivStrategy is an experimental real-time strategy game built around the fantasy of commanding a growing settlement and army on a living, procedurally generated world.

The project draws inspiration from classic RTS games such as **Stronghold** and **Age of Empires**, but the goal is not to reproduce either game. CivStrategy is a playground for exploring what a modern, simulation-heavy RTS can feel like when built rapidly and iteratively with AI-assisted development.

## The Core Experience

The intended gameplay loop is:

1. **Explore** a procedurally generated map.
2. **Establish and grow** a settlement.
3. **Gather and manage** resources and population.
4. **Build an economy** that can support expansion.
5. **Train and command** military forces.
6. **Fight for territory** using terrain, formations, pathfinding, and unit behavior.
7. **Adapt and expand** as the world and opposing forces evolve.

The game should ultimately feel less like a collection of disconnected systems and more like one coherent simulation where economy, terrain, movement, combat, and AI influence each other.

## Current Technical Shape

CivStrategy is a browser-based TypeScript game using:

- **React** for application and interface UI.
- **Phaser** for the game world and real-time simulation/rendering.
- **Vite** for development and builds.
- **TypeScript** as the primary language.
- **Tailwind CSS** for UI styling.
- **GSAP** for animation and presentation.

The game uses an isometric presentation while keeping simulation logic in Cartesian/world coordinates. React and Phaser communicate through an event-based bridge so the game simulation and interface can evolve independently.

## Major Systems

The current codebase contains a broad collection of game systems, including:

- Procedural terrain and biome generation
- Isometric rendering
- Resource and economy simulation
- Population and happiness
- Unit spawning and management
- Combat and damage calculation
- Pathfinding and flow-field movement
- Fog of war
- Enemy AI
- Spatial queries and spatial hashing
- Minimap and strategic UI
- Procedural audio
- Level-of-detail and rendering optimizations

These systems currently converge around `game/MainScene.ts`, which acts as the central game orchestrator.

## Architectural Direction

The existing architecture is intentionally pragmatic: get the simulation working, then identify the boundaries that need to become cleaner as the game grows.

One of the major engineering goals is therefore to gradually move from a large central orchestrator toward clearer system ownership and explicit communication between systems. This should make individual mechanics easier to reason about, test, replace, and develop in parallel.

The architecture should favor:

- **Clear ownership** of game state.
- **Explicit communication** between systems.
- **Data-oriented approaches** where they improve simulation performance.
- **Deterministic behavior** where practical.
- **Small, testable systems** over hidden cross-system coupling.
- **Performance-aware simulation**, especially for large numbers of units.

## The RTS Problem We Care About

A long-term focus of CivStrategy is making large groups of units feel alive rather than behaving like independent sprites following isolated commands.

Movement, formations, separation, combat, terrain, and AI should eventually work together to produce convincing mass behavior. This includes exploring ideas such as flow-field navigation, formation-aware movement, local avoidance, deformation, and more fluid melee interactions.

The ambition is not simply to have more units on screen. It is to make **large-scale interaction readable, responsive, and believable**.

## Development Philosophy

CivStrategy is an AI-assisted, highly iterative project. The repository may change quickly, and experimental implementations are expected.

That does not mean architecture and engineering quality are unimportant. Quite the opposite: the project should use rapid iteration to discover what works, while continuously consolidating successful ideas into a maintainable codebase.

When making changes, prefer:

- Improving the actual player experience over adding complexity for its own sake.
- Fixing root causes instead of patching symptoms.
- Keeping systems understandable to both humans and coding agents.
- Making large refactors incrementally rather than destabilizing the whole game.
- Validating changes with the existing build, lint, and test workflow.

## Near-Term Priorities

The project should generally prioritize, in roughly this order:

1. **Core gameplay feel** — movement, combat, formations, responsiveness, and feedback.
2. **Simulation stability** — predictable state transitions and fewer system-level edge cases.
3. **MainScene decomposition** — reduce the central orchestrator's responsibilities without creating unnecessary abstraction.
4. **Mass-unit behavior** — improve movement and combat for groups rather than only individual units.
5. **Performance** — preserve responsiveness as world and unit counts increase.
6. **Player-facing polish** — UI, feedback, effects, audio, and presentation.

These are directional priorities rather than a rigid roadmap. The current implementation should always be considered when deciding what to tackle next.

## Repository Orientation

A useful starting point for contributors and coding agents is:

- `App.tsx` — application-level orchestration.
- `components/` — React-facing UI.
- `game/MainScene.ts` — current Phaser/game orchestration boundary.
- `game/systems/` — gameplay and simulation systems.
- `game/utils/` — reusable game and math utilities.
- `types.ts` — shared game types and interfaces.
- `constants.ts` — game configuration and gameplay constants.
- `assets/` — visual and audio resources.

The root `README.md` contains the basic local development commands. This document exists to explain **what the project is trying to become and why the major pieces exist**, rather than serving as an exhaustive technical manual.

## The North Star

CivStrategy should become a **deep, responsive, large-scale RTS sandbox** where the player can understand what is happening at a glance, give meaningful high-level orders, and watch those orders propagate through believable armies, economies, and battles.

The technical architecture exists to serve that experience—not the other way around.
