# Verification Workflow

## Overview

Comprehensive code verification workflow to prevent type errors, lint violations, and technical debt from reaching production.

## Quick Start

```bash
# Run full verification locally
npm run verify

# Individual checks
npx tsc --noEmit          # TypeScript type check
npm run lint              # ESLint
npm run test              # Unit tests
npm run build             # Production build
npx fallow dead-code      # Find unused code
npx fallow                # Full analysis
```

## What Gets Checked

### 1. TypeScript Type Check ✅ BLOCKING
- Runs `tsc --noEmit` with strict mode
- Filters known-safe errors (`vite.config.d.ts`)
- **Catches:** `this.isPendingLoad()` vs `isPendingLoad()` type errors

### 2. ESLint ✅ BLOCKING
- Zero-warning policy (`--max-warnings 0`)
- React hooks rules, TypeScript rules, unused directives

### 3. Unit Tests ✅ BLOCKING
- Vitest (33 tests currently passing)
- `game/utils/combatPath.test.ts` (15 tests)
- `game/systems/ProceduralSoundSystem.test.ts` (18 tests)

### 4. Fallow Dead Code Detection ⚠️ INFORMATIONAL
- Unused files (4 script files)
- Unused exports (13 found)
- Unused class members (30 found)
- Circular dependencies (20 found: MainScene ↔ all systems)

### 5. Fallow Full Analysis ⚠️ INFORMATIONAL
- Code duplication (39 clone groups)
- Complexity hotspots (192 above threshold)
- Maintainability index: 88.1 (good)

### 6. Production Build ✅ BLOCKING
- Vite build to `dist/`
- Ensures all imports resolve and bundling succeeds

## Git Hooks (Husky)

### Pre-commit (`.husky/pre-commit`)
- TypeScript type check (full output, filtered)
- ESLint

**Prevents:** Committing code with type errors or lint violations

### Pre-push (`.husky/pre-push`)
- TypeScript type check
- ESLint
- Unit tests
- Fallow dead-code detection (non-blocking)

**Prevents:** Pushing broken code to remote

## CI/CD (`.github/workflows/verify.yml`)

Runs on:
- Push to `main`, `develop`, `feat/**`
- Pull requests to `main`, `develop`

Same checks as local workflow, ensures consistency.

## Why This Matters

### The Problem
TypeScript caught `this.isPendingLoad()` error during implementation, but incomplete verification output (`| head -30`) truncated the error. The bug only surfaced at runtime when the user tested.

### The Solution
1. **Full tsc output** checked (no truncation)
2. **Known-safe errors** filtered (vite.config.d.ts)
3. **New errors block commit/push** before reaching production
4. **Dead code surfaced** via Fallow (keep codebase lean)

### Impact
- Pre-commit hook catches type errors **before commit**
- Pre-push hook catches type errors + test failures **before push**
- CI catches everything **before merge**
- Fallow surfaces technical debt **proactively**

## Fallow Findings (Current State)

**Dead Code:**
- 4 unused script files (`gen-sprites.ts`, `gen-terrain-tiles.ts`, `pixel-builder.ts`, `png-encode.ts`)
- 13 unused exports (SaveSystem helpers, constants)
- 30 unused class members (mostly public methods never called)

**Architecture:**
- 20 circular dependencies (MainScene ↔ systems)
- God-class pattern: MainScene owns all systems

**Quality:**
- 39 code duplication groups
- Maintainability index: 88.1 (good)

These are **informational** — not blocking the workflow. Review periodically and clean up incrementally.

## Best Practices

1. **Always run `npm run verify` before claiming "done"**
2. **Never truncate tsc output** (`| head` hides errors)
3. **Review Fallow findings** during refactoring work
4. **Keep hooks fast** (pre-commit < 5s, pre-push < 30s)
5. **Update AGENTS.md** when adding new verification steps

## Troubleshooting

### "TypeScript errors found" but output looks empty
- The filter might be too aggressive
- Check `/tmp/tsc-filtered.txt` manually
- Run `npx tsc --noEmit` directly to see full output

### Fallow fails with "unresolved imports"
- Normal for script files not in the main dependency graph
- Non-blocking, safe to ignore

### Pre-commit hook is slow
- TypeScript check takes ~2-3s
- ESLint takes ~1-2s
- Total ~5s is acceptable for safety

### Need to skip hooks temporarily
```bash
git commit --no-verify    # Skip pre-commit
git push --no-verify      # Skip pre-push
```
**Use sparingly** — only when hooks are genuinely blocking valid work.

## Future Improvements

1. **Make Fallow blocking** once dead code is cleaned up
2. **Add coverage thresholds** when test coverage improves
3. **Add E2E tests** (Playwright) for critical user flows
4. **Parallel test execution** when test suite grows
5. **Pre-commit linting of staged files only** (currently lints entire project)

---

Last updated: 2026-08-05  
Related: AGENTS.md § Verification Workflow
