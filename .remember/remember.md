# Handoff

## State
Branch `main` is clean, synced with origin. Performance sprint concluded: **42.81 avg FPS @ 5,000 units** on Intel UHD iGPU (target: 60 FPS). Bob pooling, viewport culling, flat terrain shortcuts applied. GPU bottleneck is Phaser display-list overhead (5,000 Arc+Container objects), not the Bob renderer. 2,500-unit ceiling verified at 60+ FPS.

All verification passes: lint ✓, tsc ✓, build ✓. `HANDOFF.md`, `PROGRESS.md`, `RELEASE_CHECKLIST.md` track current state.

## Next
1. **Decide ceiling:** ship at 2,500 units (pragmatic, meets "1,000+" bar) or pursue scene-graph flattening (1–2 days, breaks entity pipeline).
2. **Visual polish:** pick 1–2 gaps from `VISUAL_GAP_AUDIT.md` — HUD cards, MainMenu faction animations, or building shading (medium priority).
3. **Pre-ship cleanup:** remove `window.__civStrategyGame`, stress keybindings (F5/F6/F7), `?stress=N` param.

## Context
- Performance profiler: `node scripts/profile-stress.mjs` after `npm run dev`. Results → `profile-results.json` + `progress.html` dashboard.
- 5,000 units run full logic (orbital movement verified via `window.__perf.hogs`). Rendering bottleneck is GPU fill-rate + Phaser scene-graph traversal, not CPU.
- Option B (scene graph flattening): replace Arc/Container with `Float32Array` + custom render pass. Estimated 1–2 days, risk: breaks selection/HP bars/combat visuals.
- Discrete GPU (GTX 1050+) would remove iGPU constraint entirely — consider documenting GPU minimum instead of rewriting renderer.
