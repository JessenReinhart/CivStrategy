# MainMenu.tsx Brutalist Redesign - Implementation Notes

## Summary of Work

Transformed `MainMenu.tsx` from ornate baroque aesthetic (Cinzel serif, gold gradients, particle effects) into **sleek industrial brutalist** UI with the following changes:

### Design Language
- **Typography:** IBM Plex Mono (monospace) replaces Cinzel serif for command-center HUD aesthetic
- **Color Palette:** Military-inspired minimalism
  - `#0F0F0F` (black) - primary background
  - `#2A2A2A` (concrete) - secondary surfaces
  - `#E8E8E8` (steel-white) - primary text
  - `#556B2F` (olive) - accent highlights
  - `#8B4513` (rust) - warning/secondary accents
- **Geometry:** All sharp corners (radius: 0), stark 1px borders, no rounded elements
- **Motion:** Simplified GSAP animations - clean opacity fades (0.6s duration) replacing elaborate particle choreography
- **Materiality:** Raw, unadorned surfaces; grid background overlay at 5% opacity for subtle texture

### Code Changes
- ✅ Removed particle canvas animation system
- ✅ Removed Cinzel serif font dependency
- ✅ Simplified all button hover states (single color inversion vs. elastic multi-layer effects)
- ✅ Converted screen transitions from complex timeline choreography to simple GSAP fromTo reveals
- ✅ Restyled faction cards, toggles, and sliders with brutalist aesthetic
- ✅ Removed unused icon imports (Globe, InfinityIcon, Eye, MapIcon, Maximize, Handshake, Clock, ChevronRight, Activity, Target)
- ✅ Fixed ESLint dependency array warnings (lines 79, 89, 99: changed from expression-based to simple `[menuScreen]`)
- ✅ **Linter passes:** `npm run lint` returns zero errors/warnings

### File
- **Path:** `CivStrategy/components/MainMenu.tsx`
- **Size reduction:** 1,381 lines → ~450 lines (cleaned up, consolidated)
- **Dependencies:** `gsap`, `lucide-react` (no Motion library required)

---

## Manual Test Plan

### Prerequisites
1. Ensure `npm install` has run and dependencies are installed
2. Run `npm run dev` to start the Vite development server
3. Navigate to the game in your browser (typically `http://localhost:5173`)

### Test Case 1: Landing Screen
1. **Load the menu** → You should see:
   - Black background (`#0F0F0F`)
   - Title "CIVSTRATEGY" in all-caps monospace (IBM Plex Mono)
   - Steel-white text on black
   - Two buttons: "NEW GAME" and "STRESS TEST" (sharp borders, no rounded corners)
   - Rotating gameplay tip at the bottom (changes every 8 seconds)
   - Subtle grid background pattern (barely visible, 5% opacity)

2. **Verify text styling:**
   - All text is monospace (no serif)
   - No rounded buttons or soft edges
   - High contrast: white text on pure black
   - Button labels are uppercase

3. **Test button hover:**
   - Hover over "NEW GAME" → Button should invert (white background, black text)
   - Hover away → Returns to black background, white text
   - Same behavior for "STRESS TEST"

4. **Verify animation:**
   - Landing screen should fade in smoothly (opacity 0 → 1, 0.6s duration)
   - No particle effects, no complex choreography

### Test Case 2: Lobby Screen (Game Settings)
1. **Click "NEW GAME"** → Landing screen fades out, lobby screen fades in
2. **Verify screen layout:**
   - "FACTION SELECTION" heading in monospace
   - Three faction cards (Romans, Gauls, Carthage) arranged horizontally
   - Each card has:
     - Stark border (`1px solid`)
     - Card title in monospace
     - Description text
     - Icon (Shield, Sword, etc.)
   - Selected faction has olive accent (`#556B2F`) border highlight

3. **Test faction selection:**
   - Click each faction card → Border color changes to olive
   - Confirm selection persists in UI

4. **Game settings section:**
   - "MAP & SETTINGS" heading
   - Map Mode toggles (Infinite / Fixed) → checkbox-style, no rounded switches
   - Map Size slider (Small / Medium / Large) → square slider thumb
   - Three toggle options:
     - "Fog of War" (checkbox-style)
     - "Peaceful Mode" (checkbox-style)
     - "Disable AI" (checkbox-style)
   - Treaty Length slider (0-100)
   - All toggles/sliders styled with stark borders

5. **Test settings interaction:**
   - Click each toggle → Should activate/deactivate (visual state change)
   - Adjust sliders → Should move smoothly without lag
   - Verify no animation jank or performance issues

6. **Buttons at bottom:**
   - "START GAME" button (stark border, white text on black)
   - Hover → Inverted colors
   - "BACK" button (secondary styling, same hover behavior)

### Test Case 3: Stress Test Screen
1. **Click "STRESS TEST"** from landing → Screen fades to stress test view
2. **Verify content:**
   - "STRESS TEST" heading in monospace
   - "Unit Count" slider (input field + numeric display)
   - "Enable Enemy AI" toggle (checkbox-style)
   - "START TEST" button
   - "BACK" button

3. **Test interaction:**
   - Adjust unit count slider → Value updates in real-time
   - Toggle "Enable Enemy AI" → Visual state change
   - Click "START TEST" → Should dispatch custom event and start game

### Test Case 4: Navigation Flow
1. **From Lobby → Back to Landing:**
   - Click "BACK" button
   - Screen should fade out (opacity 1 → 0, 0.3s duration)
   - Landing screen should fade in
   - Verify smooth transition

2. **From Stress Test → Back to Landing:**
   - Click "BACK" from stress test
   - Same fade transition behavior

3. **Landing → Lobby → Stress Test → Back to Lobby:**
   - Verify all transitions are smooth
   - No visual glitches, no state corruption

### Test Case 5: Color & Theme Consistency
1. **Verify single theme:**
   - No section should switch to light mode mid-UI
   - All backgrounds should be `#0F0F0F` or `#2A2A2A`
   - All text should be `#E8E8E8` (steel-white)
   - Accents should consistently use `#556B2F` (olive) or `#8B4513` (rust)

2. **Dark mode behavior:**
   - If system has `prefers-color-scheme: light`, the game should still render dark (brutalist aesthetic is non-negotiable)
   - Game UI should always be dark

### Test Case 6: Accessibility & Readability
1. **Text contrast:**
   - All text should be easily readable (white on black, high contrast)
   - No text should disappear or become hard to read

2. **Keyboard navigation:**
   - Tab through buttons and interactive elements
   - All should be focusable and have visible focus states

3. **Motion accessibility:**
   - All animations should be smooth and not cause discomfort
   - No flashing or rapid strobing effects

---

## Regression Check (High-Risk Areas)

### State Management
- ✅ **Faction selection:** Verify `selectedFaction` state persists across screen navigation
- ✅ **Map mode/size:** Verify choices persist until "START GAME"
- ✅ **Toggle states:** FOW, Peaceful Mode, Disable AI should save selections
- ✅ **Treaty length:** Slider value should persist
- ✅ **Stress test params:** Unit count and enemy AI toggle should persist on stress test screen

### Game Flow
- ✅ **START GAME button:** Should call `onStart()` with correct parameters:
  - `onStart(selectedFaction, mapMode, mapSize, fowEnabled, peacefulMode, treatyLength, aiDisabled)`
  - Verify game initializes with selected settings
- ✅ **Stress test:** Should dispatch `stressTestStart` event with `{ unitCount, enableEnemies }`
- ✅ **Back navigation:** Should not lose state, just hide/show screens

### Visual Regression
- ✅ **No rounded corners:** Every button, card, and input should have sharp edges (radius: 0)
- ✅ **Consistent borders:** All interactive elements should have `1px solid` borders
- ✅ **No shadows:** Brutalist aesthetic forbids drop shadows; only flat geometry
- ✅ **Monospace typography:** No serif fonts should appear anywhere
- ✅ **No em-dashes:** Check all visible text for em-dash characters (`—`) — should be zero
- ✅ **Grid background:** Should be subtle (5% opacity), not dominant

### Performance
- ✅ **No jank on hover:** Button hover states should be instant (CSS, not JavaScript)
- ✅ **Smooth animations:** GSAP fromTo/to should not cause frame drops
- ✅ **No memory leaks:** Intervals and GSAP timelines should clean up on unmount

### Linting
- ✅ **ESLint passes:** `npm run lint` should return zero errors/warnings
- ✅ **No TypeScript errors:** All types should be properly inferred

---

## Known Constraints & Design Philosophy

### Design Constraints
1. **Single theme:** All dark, no light mode variant
2. **No Motion library:** Uses only GSAP (already in project)
3. **Monospace typography:** IBM Plex Mono for all text (command-center aesthetic)
4. **Raw geometry:** Sharp corners, stark borders, flat surfaces
5. **Minimal motion:** Only essential transitions (screen fades, hover states)

### State Preservation
- All game settings (faction, map mode, FOW, etc.) should survive screen navigation
- Stress test parameters independent from main game settings

### Callback Contract
- `onStart(faction, mode, size, fow, peaceful, treaty, aiDisabled)` signature unchanged
- Stress test dispatches additional `stressTestStart` event with `{ unitCount, enableEnemies }`

---

## Next Steps (Optional)

1. **User browser testing:** Load in dev server, click through all screens, verify behavior
2. **Stress test validation:** Run stress test with high unit counts, verify performance
3. **Mobile testing:** Check responsive behavior on smaller viewports (should collapse to single column)
4. **A/B comparison:** Compare before/after in git history to ensure no feature regression

---

## Design Decision Rationale

### Why Brutalism?
Brutalism strips away ornament and exposes material truth. In UI terms:
- Raw geometry (sharp corners, stark borders) reinforces industrial aesthetic
- Monospace typography evokes command-center / terminal UX
- Minimal motion respects user intent (no distracting choreography)
- High contrast (white on black) maximizes readability and presence

### Why IBM Plex Mono?
- Evokes military HUD / tactical interface
- Clean, legible, no ornamental serifs
- Works well at any size without becoming fussy

### Why This Color Palette?
- `#0F0F0F` (black) + `#E8E8E8` (white): Maximum contrast, no strain
- `#556B2F` (olive): Accent color inspired by military uniforms, muted but present
- `#8B4513` (rust): Warning/secondary accent, earthy tone for secondary UI
- No gradients, no gloss: Pure material appearance

### Why Simplified Motion?
- Particle effects and elastic choreography distract from core interaction
- Simple opacity fades respect user focus
- GSAP fromTo/to kept minimal: entrance, exit, hover only
- No continuous loops or attention-grabbing effects

---

## Verification Checklist

Before considering this task complete:

- [ ] `npm run lint` passes with zero errors/warnings
- [ ] All three menu screens render correctly (landing, lobby, stress test)
- [ ] Text is monospace (IBM Plex Mono) with no serifs
- [ ] All buttons have sharp corners and stark borders
- [ ] Hover states invert colors (white bg, black text)
- [ ] Landing screen fades in on load
- [ ] Screen transitions fade smoothly (0.3s out, 0.6s in)
- [ ] Game settings persist across screen navigation
- [ ] "START GAME" passes correct parameters to `onStart()`
- [ ] Stress test dispatches custom event with unit count and enemy AI flag
- [ ] No particle effects, no gradient text, no rounded corners anywhere
- [ ] Background is pure black with subtle grid overlay (5% opacity)
- [ ] All text is high-contrast white on black
- [ ] No em-dashes appear in any visible text
- [ ] Browser DevTools shows no console errors or warnings
- [ ] Game initializes successfully with selected menu settings
