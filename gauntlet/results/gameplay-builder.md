# Gameplay Feel Builder — Round 2

## Reference bar
- Age of Empires IV official gameplay: https://www.youtube.com/watch?v=5TnynE3PuDE — immediate selection/order state readability.
- Total War: WARHAMMER III Zhatan showcase: https://www.youtube.com/watch?v=PTI3-gIUzTo — readable formation facing, contact fronts, damage persistence.

## Implemented
Round 1 delivered `A` + left-click attack-move, 250 ms target scans, route resumption after contact, red destination confirmation, and pooled 120 ms hit flashes.

Round 2 improves normal-zoom formation state readability without replacing existing squad/liquid-combat presentation:

- Persistent selected-unit health bars now remain visible throughout attack-move, chasing, and attacking states, not only after damage.
- Individual unit selection rings are state-colored: green idle, amber advancing, high-alpha red attack-move/contact.
- Squad formation outlines use the same green/amber/red state language, making advance and contact fronts legible across the whole selected formation.
- Existing SquadSystem formation-angle behavior continues facing formations toward velocity while moving and toward target while chasing/attacking.
- Existing hit flash, hit spark, damage number, and LiquidCombat deformation remain the contact-reaction layer.

## Deterministic runtime evidence procedure
Automation can reproduce a combat-heavy live scene at normal zoom:

1. Start `npm run dev -- --host 127.0.0.1`.
2. Open `http://127.0.0.1:5173/?stress=24&enableEnemies=true` at 1280×720.
3. Start a fixed-map match. The stress setup creates 12 player and 12 enemy combat units on distinct opposing fronts near map center.
4. Record continuously at normal gameplay zoom. Select the player formation, press `A`, left-click through the enemy front, and retain recording through advance, contact, damage, one enemy death, and resumed path travel.
5. Evidence checkpoints: green selection outline and health bars; crosshair plus red destination marker; amber advancing outline and facing; red contact outline across front; persistent HP/damage/contact effects; selected survivors resuming toward destination.

The earlier still remains `gauntlet/results/gameplay-after.png`. It only proves the live match rendered; the critic correctly requires the continuous six-checkpoint recording for an OURS verdict.

## Verification
- `npx vitest run game/systems/UnitSystem.readability.test.ts game/systems/UnitSystem.balance.test.ts game/systems/UnitSystem.pathOverlay.test.ts game/systems/InputManager.selection.test.ts` — PASS, 4 files / 17 tests.
- `npx tsc --noEmit` — PASS, no diagnostics.
- `npm run build` — PASS, 1,839 modules transformed and production bundle emitted. Existing chunk-size warning retained.

## Biggest remaining gap
Continuous 1280×720 capture is still required to prove the temporal sequence end-to-end. The deterministic 24-unit combat URL and exact interaction procedure above remove setup ambiguity, but are not themselves visual proof.