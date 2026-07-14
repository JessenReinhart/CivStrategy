# MainMenu.tsx - Brutalist Redesign Plan

## Objective
Transform `MainMenu.tsx` from its current ornate/baroque aesthetic (Cinzel serif, heavy gold gradients, particle effects) into a **sleek industrial brutalist** interface with:
- Raw material aesthetic (steel, concrete, vellum)
- Geometric, rectilinear composition
- Minimal ornamentation; let materials & contrast do the work
- Smooth, purposeful motion (not kinetic excess)
- Military / command-center vibe

## Current State Audit
- **Aesthetic:** Ornate serif-heavy (Cinzel), baroque gold accents, particle canvas, rounded buttons, elaborate hover effects
- **Dial readings (inferred):**
  - `DESIGN_VARIANCE: 6` (moderate asymmetry, but mostly traditional layouts)
  - `MOTION_INTENSITY: 8` (heavy GSAP, stagger animations, multiple parallax layers)
  - `VISUAL_DENSITY: 4` (spacious, generous padding)

## Target State (Dials)
- `DESIGN_VARIANCE: 7` (split-screen asymmetry, raw geometry, negative space)
- `MOTION_INTENSITY: 6` (smooth spring physics, minimal stagger, purposeful reveals)
- `VISUAL_DENSITY: 4` (maintain spaciousness; brutalism ≠ cramped)

## Proposed Changes

### Phase 1: Material & Color System
- [ ] **Replace serif (Cinzel) with sans-serif monospace** → use `IBM Plex Mono` or `Courier New` for command-center feel
- [ ] **Redefine palette:**
  - Backgrounds: charcoal (`#0F0F0F`), concrete gray (`#2A2A2A`), vellum (`#F5F3EE`)
  - Accents: steel-cold white (`#E8E8E8`), rust-red (`#8B4513`), military olive (`#556B2F`)
  - Remove all warm gold gradients
- [ ] **Remove particle canvas** → replace with SVG grid background (optional geometric pattern overlay)

### Phase 2: Landing Screen (Seal + Menu Items)
- [ ] **Hero seal button:** Simplify from ornate → stark geometric (square or circle, single-stroke border)
- [ ] **Title styling:** Keep the split-text animation, but use mono + minimal tracking
- [ ] **Menu items:** Grid-based button layout, stark borders, no rounded corners
- [ ] **Background:** Simple gradient or flat color, optional SVG grid overlay

### Phase 3: Lobby (Faction Selection & Settings)
- [ ] **Faction cards:** Change from horizontal scroll to grid (2-3 columns); use monospace labels, stark borders
- [ ] **Settings panels:** 2-column layout (Gameplay left, Visuals right) with sharp dividers, no soft shadows
- [ ] **Toggle switches:** Replace rounded toggles with geometric switches (checkbox-style)
- [ ] **Sliders:** Replace gradient sliders with stark monochrome

### Phase 4: Motion & Interaction
- [ ] **Eliminate stagger animations** → use simple spring reveals (Motion library, `stiffness: 100, damping: 20`)
- [ ] **Button hover:** Single transform (scale-down slightly, then scale-up elastically) instead of multi-layer effects
- [ ] **Screen transitions:** Simple fade + scale, no elaborate timelines
- [ ] **Respect reduced-motion** globally

### Phase 5: Stress Test Screen
- [ ] **Simplify layout:** Centered title, stark controls, minimal ornamentation
- [ ] **Range inputs:** Monochrome styling with geometric thumb

## Execution Checklist
- [x] Phase 1: Update color tokens (CSS variables) and typography
- [x] Phase 1: Remove particle canvas or replace with static SVG grid
- [x] Phase 2: Refactor landing screen JSX & styles
- [x] Phase 3: Refactor lobby screen JSX & styles
- [x] Phase 4: Simplify GSAP animations → Motion-based springs
- [x] Phase 5: Refactor stress-test screen
- [x] Pre-Flight Check: No em-dashes, color consistency, motion motivated

## Technical Constraints
- Keep `onStart` callback and state management intact
- Preserve all game settings logic (faction, map mode, size, FOW, peaceful, treaty, AI, stress-test params)
- Use Motion (`motion/react`) for spring animations instead of hand-rolled GSAP timelines where possible
- No new dependencies required

## Styling Strategy
- CSS variables for brutalist palette (already in place: `--dust-white`, `--parchment`, `--gold-leaf`, `--shadow`, etc.)
- Replace with new token names: `--steel`, `--concrete`, `--vellum`, `--rust`, `--olive`
- Preserve layout grid structure; simplify borders & shadows

## References
- Brutalism: raw materials, stark geometry, minimal ornament
- Military HUD aesthetic: monospace type, geometric glyphs, high contrast
- Examples: Tesla UI, old UNIX terminals, military control panels (modern minimal versions)
