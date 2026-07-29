<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# CivStrategy: Ancient Realms

A Civilization-style real-time strategy game. Build settlements, manage resources and population happiness, train military units, and expand territory across procedurally generated isometric maps.

**Tech stack:** React 18 + Phaser 3 + TypeScript 5.2 + Vite 5 + Tailwind CSS (CDN) + GSAP

## Run Locally

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev
```

Open the URL printed by Vite (default `http://localhost:5173`).

## Development

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint (zero-warning policy) |
| `npm run test` | Run Vitest tests |

**Git hooks (Husky):** pre-commit runs lint, pre-push runs build.

## Project Structure

```
CivStrategy/
├── index.html          # SPA shell + Tailwind CDN + fonts
├── index.tsx           # React mount point
├── App.tsx             # Top-level React orchestrator
├── types.ts            # All enums & interfaces
├── constants.ts        # Game config, stats, event names, damage formula
├── components/         # React UI (MainMenu, GameUI, PhaserGame, etc.)
├── game/
│   ├── MainScene.ts    # Central orchestrator (~1100 lines, 20 systems)
│   ├── systems/        # 20 game systems (TerrainSystem, UnitSystem, etc.)
│   └── utils/          # Isometric projection, spatial hash, noise, etc.
└── assets/textures/    # Sprites, terrain tiles, water shader
```

## Architecture

- **God-class orchestrator:** `MainScene` owns all systems, game state, and Phaser groups
- **20 systems:** Terrain generation, pathfinding (JPS + flow fields), combat (0 A.D.-style hack/pierce/crush), economy, AI enemy, fog of war, minimap, procedural audio, and more
- **Isometric rendering:** 2:1 diamond projection; game logic in cartesian, render in iso
- **Dual-channel React ↔ Phaser bridge:** Game emits events → React stats HUD; React dispatches custom events → game
- **Performance:** SpatialHash O(1) queries, budgeted per-frame processing, 4-level LOD, tree visual pooling, flow fields for mass movement

## Branches

- `main` — stable release
- `feat/terrain-elevation` — elevation rendering, multi-biome cells, N·L lighting, rocky cliffs
