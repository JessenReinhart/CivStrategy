# Gameplay Critic Verdict

## Verdict

`REFERENCE`

Age of Empires IV / Total War: WARHAMMER III remains the bar. The builder closed a real controls gap: `A` then left-click now arms and issues attack-move, units scan/engage/resume, the command has a red ground marker, and damaging hits add a pooled 120 ms flash. The submitted evidence does not demonstrate parity. `gameplay-after.png` shows no selection rings, active attack-move state, destination marker, enemy target, health/damage read, hit flash, or engaged formation — only a compact idle-looking unit group. The builder confirms that shot was taken at match start before any order, so those states could not appear in it; that makes the capture insufficient as combat evidence rather than disproof of the feature. The builder also states squads still read as compact sprite groups rather than articulated fronts.

## Largest observable gap

**Formation-scale combat state is not visually readable.** At gameplay zoom, the submitted evidence does not let a viewer distinguish selected, advancing, targeting, contacting, damaged, or disengaging ranks from a compact idle sprite group. Persistent facing, distinct opposing fronts, rank deformation, and contact reactions define the intended reference bar; direct footage playback was unavailable in the harness, so these details are not claimed as independently observed in this pass.

Relevant implementation:

- `game/systems/UnitSystem.ts`: `commandAttackMove`, `updateAttackMove`, `handleCombatState`, `resumeAttackMove`, `moveAlongPath`
- `game/systems/LiquidCombatSystem.ts`: formation contact/deformation behavior
- `game/systems/SquadSystem.ts`: soldier formation/facing presentation
- `game/systems/FeedbackSystem.ts`: `showHitFlash`, `showHitSpark`, `showDamageNumber`
- `game/systems/InputManager.ts`: `setAttackMoveArmed`, `issueAttackMove`

## Concrete acceptance check

Record one uninterrupted 1280×720 live sequence at normal gameplay zoom: select at least 12 units, press `A`, left-click through an enemy formation, and continue recording until the enemy is destroyed and survivors resume the route. A blind reviewer must correctly identify, without narration or debug overlays: (1) the selected army, (2) attack-move being armed and confirmed, (3) movement direction and formation facing, (4) two distinct opposing fronts at contact, (5) which front is taking damage from persistent health/contact reactions rather than a single paused-frame particle, and (6) route resumption after combat. If any state is ambiguous in the recording, the check fails.

The builder has offered a mid-order capture (units selected, attack-move armed, marker mid-fade) for the next pass. That is required but not sufficient on its own: a single mid-order still covers points 1, 2, and part of 3 only. Points 4 through 6 require the continuous recording above.

## Evidence reviewed

- `gauntlet/evidence/references.md`
- Cited Age of Empires IV and Total War: WARHAMMER III bars; direct playback was unavailable in the harness, so no parity claim is inferred from unseen frames.
- `gauntlet/results/gameplay-builder.md`
- `gauntlet/results/gameplay-after.png` (1280×720)
- Current `InputManager.ts`, `UnitSystem.ts`, and `FeedbackSystem.ts` implementation
- Builder verification: 15 targeted tests, TypeScript, production build, and live smoke test passed

The still capture proves the live match rendered. It does not prove the temporal control/combat acceptance path above.