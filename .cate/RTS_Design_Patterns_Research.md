# RTS Game Design Patterns Research
## Comprehensive Analysis: Age of Empires, Stronghold, and Classic RTS Mechanics

**Date:** 2025-06-11 | **Project:** CivStrategy (React 18 + Phaser 3 + TypeScript)

---

## 1. Resource Economy Design

### 1.1 Gathering Rates and Scarcity (AoE2 Model)

AoE2 establishes strategic bottlenecks through differential gathering rates:

| Resource | Method | Rate/s | Relative Speed |
|----------|--------|--------|----------------|
| Food | Farms | 0.319 | Slowest |
| Food | Hunting | 0.408 | 1.28x |
| Food | Deep Fish | 0.487 | 1.53x |
| Wood | Lumber Camp | 0.39-0.5 | Fastest |
| Gold | Mining Camp | 0.33 | Intermediate |
| Stone | Mining Camp | 0.33-0.38 | Intermediate |

Food = primary bottleneck; wood = abundant for buildings; gold/stone = finite map deposits force map control timing.

### 1.2 Technology Scaling

Stacking multipliers preserve scarcity while rewarding investment:
- Wheelbarrow: +15% all gathering (Castle Age)
- Hand Cart: +15% all gathering (Imperial Age)
- Civ bonuses: +5% to +15% specific resources (e.g. Slavs +15% farms)

Multiplicative model: `Base × (1.15) × (1.15) × Civ_bonus` — later upgrades give larger absolute gains while maintaining inter-resource ratios.

### 1.3 Stronghold Popularity/Morale Economy

Stronghold adds happiness as economic multiplier:
- Popularity = function of: tax rate, food variety (+2 for 4+ types), rations, housing quality
- Below 30 popularity → peasants flee → labor shortage → economic collapse
- High popularity (80-100) = production bonus and population growth

**Key insight:** Happiness is not cosmetic — it directly gates labor pool and military recruitment capacity.

### 1.4 Resource Drop-Off Logistics

AoE2 walk-time creates efficiency gradient:
- Gatherer fills internal capacity → walks to drop-off point → deposits → returns
- Carry capacity upgrades increase efficiency
- Building placement optimization is ~15-20% economic efficiency difference

### 1.5 CivStrategy Applicability

Current state: happiness system present, multiple resources, job assignment.
Gaps: no differential gathering rates, no drop-off walk-time mechanics, happiness not tightly coupled to economy output.

**Recommendation:** Add per-resource gathering multipliers; tie happiness to production rates; implement drop-off distance bonus.

---

## 2. Military Unit Design and Counter Systems

### 2.1 Rock-Paper-Scissors Counter Triangle (AoE Series)

Classic AoE counter system uses hard/soft counter distinction:

**Hard counters** (large damage bonuses, definitive):
- Spearmen/Pikemen +15-32 bonus damage vs cavalry
- Skirmishers +3-4 bonus damage vs archers, +3 vs spearmen
- Cavalry +5-10 bonus damage vs siege units

**Soft counters** (moderate advantage, can be overcome by numbers/upgrades):
- Archers outrange infantry but vulnerable to cavalry flank
- Infantry cost-efficient but need support vs ranged
- Cavalry fast but expensive, countered by cheap spearmen

**Basic Counter Triangle:**
```
Infantry > Cavalry > Archers > Infantry
  (spears)  (speed)   (range/flanking)
```

**Extended Counter Matrix (AoE IV):**

| Unit Type | Strong vs | Weak vs |
|-----------|-----------|---------|
| Spearman | Cavalry (+15-32 bonus) | Archers, Men-at-Arms |
| Archer | Spearmen, Infantry | Cavalry, Skirmishers |
| Cavalry (Knights) | Archers, Siege | Spearmen, Camels |
| Skirmisher | Archers, Spearmen | Cavalry, Men-at-Arms |
| Men-at-Arms | Spearmen, Skirmishers | Archers, Knights |
| Crossbowman | Heavy Infantry | Cavalry, Skirmishers |
| Siege (Mangonel) | Massed Infantry/Archers | Cavalry, Bombard |

### 2.2 Damage Calculation Pattern (AoE2)

```
Damage = max(1, Attack + Bonus_Attack - Melee_Armor)
         or
Damage = max(1, Attack + Bonus_Attack - Pierce_Armor)
```

Armor types (melee vs pierce) create additional counter layer: high-pierce-armor units (rams, knights) resist archers; high-melee-armor units resist infantry.

### 2.3 Upgrade Tiers and Blacksmith System

AoE2 Blacksmith upgrades follow a tiered pattern:
- **Feudal Age**: +1 attack, +1 armor (cheap: 100F, 40G)
- **Castle Age**: +2 attack, +2 armor (moderate: 200F, 100G)
- **Imperial Age**: +3-4 attack (expensive: 300F, 200G)

Attack upgrades affect base + bonus damage → higher-tier upgrades provide exponentially more value when combined with counter bonuses.

### 2.4 Unit Roles Beyond Counters

**AoE2 unit design layers three roles:**
1. **Counter role** — beats specific unit type (hard counter)
2. **Raiding role** — fast, cheap, effective vs economy (light cavalry, archers)
3. **Siege role** — anti-building, area damage (mangonels, rams, trebuchets)

### 2.5 Cost-to-Power Ratios

| Unit | Typical Cost | Power Duration | Role Window |
|------|-------------|----------------|-------------|
| Spearman | 35F, 25W | Early-Mid | Anti-cavalry all game |
| Archer | 25W, 45G | Early-Late | Mass-damage scaling |
| Knight | 60F, 75G | Mid-Late | Power spike, then countered |
| Trebuchet | 200W, 200G | Late only | Siege finisher |

### 2.6 CivStrategy Applicability

Current: ClashSystem, UnitSystem, FormationSystem, LiquidCombatSystem, SquadSystem — all present and well-developed. Counter bonuses exist on unit definitions.

**Recommendations:**
- Formalize hard/soft counter classification with clear bonus damage tiers
- Add armor type distinction (melee vs pierce) to damage pipeline
- Blacksmith-equivalent upgrade tiers tied to age/research progression

---

## 3. Building Placement and Territory Control

### 3.1 Stronghold Castle Design Philosophy

Stronghold makes building placement = survival:
- **Keep placement**: Central defensible position, ideally elevated
- **Continuous walls**: No gaps allowed — single breach = catastrophic
- **Gatehouses**: Chokepoint control, regulates troop movement
- **Towers**: Extends line-of-sight, flanking fire zones
- **Multi-tiered walls**: Outer → inner concentric defense layers

**Resource cost is immediate** — no construction time, but resources deducted instantly. This forces pre-planning vs AoE's construction-time model.

### 3.2 Territory Control Models

**AoE2 Town Center/Tower claim model:**
- Town Centers claim territory radius (~6 tiles)
- Towers extend influence but don't claim
- Resources within territory = safe gathering
- Forward TC = aggressive territory claim

**Stronghold Castle model:**
- Castle area defines economic zone
- Farms, quarries, workshops must be within walls or risk raiding
- Popularity drops when economic buildings destroyed
- Territory = physical wall perimeter, not abstract radius

### 3.3 Building Interdependence (AoE2)

```
Dependency chain:
Stone Mine → Mining Camp → Town Center → Barracks → Stable → Blacksmith → Castle
  (resource)    (drop-off)     (eco hub)     (infantry)  (cavalry) (upgrades) (power spike)
```

Each building tier gates the next; destroyed prerequisite = can't produce dependent units until rebuilt.

### 3.4 Map Control Tiers

| Control Tier | Buildings Needed | What It Enables |
|-------------|-----------------|-----------------|
| Base zone | TC, houses, mill | Economic safety |
| Forward resource | Mining/Lumber camp | Map resources |
| Forward military | Barracks/Stable/Archery | Pressuring opponent |
| Siege position | Castle, Siege Workshop | Territory denial |

### 3.5 Space Efficiency Patterns

AoE2 optimal farm placement: 3x3 grid around Mill/TC with 1-tile gap for villager pathing.
Stronghold: Compact castle designs maximize defended area per stone spent.

**Key pattern:** Buildings with production queues need pathable adjacency — blocked buildings create idle production time.

### 3.6 CivStrategy Applicability

Current: BuildingManager with placement validation, territory control, construction mechanics. Isometric map with terrain constraints.

**Recommendations:**
- Building dependency chains (destroyed Barracks → no infantry until rebuilt)
- Territory radius scaling by building type (TC claims large, Outpost claims small)
- Construction-time model (Stronghold instant placement is niche; AoE build-time is standard)
- Forward building aggression as AI strategy

---

## 4. AI Behavior Patterns

### 4.1 Age of Empires II AI Architecture

**Difficulty-Based Handicaps (Definitive Edition):**
| Difficulty | Resource Multiplier | Village Efficiency | Unit Micro | Cheats? |
|------------|-------------------|-------------------|-----------|---------|
| Easy | 1.0x | 60% efficiency | None | No |
| Standard | 1.0x | 75% efficiency | Minimal | No |
| Moderate | 1.0x | 85% efficiency | Basic | No |
| Hard | 1.2x | 95% efficiency | Yes (retreat/ kite) | No |
| Hardest | 1.3x | 100% efficiency | Advanced (focus fire) | No |
| Extreme | 1.25x | 100% efficiency | Advanced micro | No |

**AI Personalities (AoE2 DE):**
- **Attacker (Spirited Charge)**: Frequent raids, minimal defenses, early military focus
- **Defender (Art of War)**: Fortifies, counters attacks, builds forward bases
- **Economist (Builder)**: Prioritizes economy, delays military, focuses booming
- **Balanced (Standard)**: Generic all-rounder

**AI Tactics Unlocked at Higher Difficulties:**
- Idle Town Center elimination (auto-villager production)
- Efficient lumber/gold/stone allocation
- Forward base construction
- Trio-Unit rushing (3 TC push)
- Unit micro: hit-and-run, kiting, focus fire

**Source:** AoE Fandom AI page — Extreme difficulty uses sophisticated scripting, not cheats.

### 4.2 Civilian AI Patterns

**Worker Allocation (AoE2):**
- Auto-assign to most-needed resource based on current deficit
- Avoid resource waste (overcrowding a single bush/mine)
- Path to nearest drop-off building

**Stronghold Peasant AI:**
- Peasants happiness affects gathering speed (productivity)
- Peasants defend themselves when attacked (no standing army effect on economy)
- Tax policy adjustment changes labor pool size

### 4.3 Combat AI State Machine

```
Idle → Scout (early game) → Build Army → Attack/Defend based on:
  - Enemy military size/threat level
  - Map control (vision range)
  - Resource surplus (can afford units?)
  - Age/tech advantage
```

**Aggression scoring** (simplified):
```
AttackScore = (MyArmyStrength - EnemyArmyStrength) × RiskFactor - MyEconDeficit
If AttackScore > threshold → send raiding party
If AttackScore >> threshold → commit main army
```

### 4.4 Civilian Unit AI Improvements in CivStrategy

**CivStrategy VillagerSystem:**
- Job assignment: lumber, farming, mining, scouting, military support
- Resource pathfinding to nearest valid source
- Auto-switch when source depleted (semi-intelligent)
- Can garrison buildings during attack

**Gaps vs AoE2:**
- No dynamic reallocation based on resource stockpile deficits
- No drop-off distance optimization (walk time ignored)
- No idle villager auto-production (manual build required)

**EnemyAISystem Strengths:**
- Personality-driven playstyles (Aggressor/Defender/Economist/Balanced)
- Attack planning based on strength comparison
- Forward base construction logic
- Resource management at scale

**Opportunity:** Add AI difficulty tiers with scaling handicaps

---

## 5. Technology Progression and Research Systems

### 5.1 Age-Up Systems (AoE Series)

**Age of Empires II Age Progression:**
```
Dark Age → Feudal Age (500F, 200W) → Castle Age (800F, 200G) → Imperial Age (1000F, 800G)
```

**Age-Up Effects:**
- **Feudal**: Barracks/Stable/Archery Range unlock; +2 building hp
- **Castle**: Castle building; unique units; siege workshops; university
- **Imperial**: all units/techs unlock; elite unit upgrades (+25% attack)

**Design pattern:** Age is gating mechanism — forces economy investment before military expansion.

### 5.2 Research Tree Topologies

**Linear Chains (AoE2 Blacksmith):**
```
Feudal: +1 Attack, +1 Armor
  ↓
Castle: +2 Attack, +2 Armor
  ↓
Imperial: +3 Attack, specialized weapon techs
```

**Branching Choices (Age of Mythology):**
- Choose one of 3 minor gods after major god selection
- Each path grants unique units/abilities
- Creates asymmetric game plans based on deity choice

**Civ-Unique Techs (AoE2):**
- Byzantines: Elite Cataphract (+50% hp)
- Spanish: Conquistador +10 attack range
- Mongols: Siege Ram +150% speed

### 5.3 Technology Costs and Timing

**Cost curve per age:**
| Resource | Feudal (~100-200) | Castle (~300-600) | Imperial (~800-1500) |
|----------|------------------|------------------|---------------------|
| Food | 100-150 | 200-400 | 500-1000 |
| Wood | 50-150 | 200-300 | 400-800 |
| Gold | 0-100 | 300-600 | 800-1500 |

**Research time:** 25s (Feudal) → 50s (Castle) → 75s (Imperial)

**Design insight:** Later techs more expensive but leveragable across entire army vs early techs affect limited unit pool.

### 5.4 ResearchManager Patterns for CivStrategy

**Current CivStrategy ResearchManager:**
- Age progression system
- Tech unlock tree
- Research multipliers (attack, defense, gathering)

**Recommendations:**
- Mandatory prerequisite chains (no skipping tiers without penalty)
- Technology cooldowns or "research slots" to limit parallel techs
- One-time civilization bonuses that persist after research
- Tech failures with debuff risk (experimental research adds unpredictability)

---

## 6. Map Generation and Terrain Interaction

### 6.1 AoE2 Map Generation Pipeline

**Three-layer generation (based on AoE2 map scripting docs):**

1. **Elevation layer** (heightmap): Low/medium/high zones
2. **Moisture layer**: Dry → grass → forest → rain forest
3. **Biome assignment**: Combines elevation+moisture → predefined biomes (snow, tundra, desert, etc.)

**Resource Placement:**
- **Local distribution**: Resources tied to specific terrain types (gold on hills, stone in mountains)
- **Balanced Resource Settings**: Takes player positions into account; places resources symmetrically for multiplayer
- **Special terrain markers**: "Gold bounty" flag spawns gold deposit within radius
- **Density controls**: Global resource density vs guaranteed resources

**Design Note:** Symmetry matters for competitive maps; no player should have significantly better resource access.

### 6.2 Terrain Mechanics in CivStrategy

**Current TerrainSystem:**
- Height mapping and isometric elevation
- Biome generation (sand, grass, forest, scrub, stone)
- Tileable procedural textures (toroidal seamless)

**Stronghold Terrain Interaction:**
- Terrain affects unit movement speed (mud slows, hills defenders bonus)
- Building constructability: some terrains unbuildable (water, steep cliffs)
- Farm productivity varies by soil type (grass > sand)

**Recommendation:** Add movement speed modifiers per biome; integrate with Pathfinder for route cost calculation.

### 6.3 Resource Distribution Patterns

**Classic RTS resource placement:**
- **Starting resources**: Small guaranteed deposits near each player
- **Expansion resources**: Medium deposits at contested midfield
- **Rich deposits**: Large clusters far from players (end-game)
- **Resource types per map**: 
  - Arabia (open): Farms, gold, stone scatter
  - Black Forest (closed): Dense forests, limited gold
  - Islands: Fishing bonus, land resources scarce

**Balance Principle:** Resource density determines game pacing — sparse = longer boom, dense = early conflict.

### 6.4 Map Generation System (CivStrategy)

**MapGenerationSystem. Current capabilities:**
- Procedural terrain generation with isometric projection
- Resource distribution (needs balancing)
- Tileable textures via toroidal pattern (TEX_PERIOD 768)

**Gaps vs AoE2:**
- No player-symmetry enforcement for multiplayer
- No biome-specific resource weighting
- No special marker system for gold bounty/elite resources

**Implementation pattern:**
```
seed → elevation (Perlin/Simplex) → moisture → biome_id → resources (based on biome tags) → symmetric adjustment (if multiplayer)
```

**Actionable Takeaway:** Add player position awareness to resource placement; each player gets comparable total resource density and variety within starting area radius.

---

## 7. User Interface and Controls for RTS

### 7.1 AoE2 UI Layout (Industry Standard)

```
┌──────────────────────────────────────────────────────┐
│  [Resource Bar: Food | Wood | Gold | Stone | Pop]    │
│                                     [Minimap]        │
│                                                      │
│                   Game World (main view)             │
│                                                      │
│                                                      │
│  [Selected Unit Info] [Command Panel]  [Units in      │
│                [Unit Portrait] [Commands]  Selection] │
└──────────────────────────────────────────────────────┘
```

### 7.2 Key UI Principles from Classic RTS

1. **Persistent Resource Display** (top bar): Always visible, no navigation needed
2. **Contextual Command Panel** (bottom): Commands change based on selection
3. **Minimap Zone** (top-right, ~12% screen): Pings, terrain, fog of war
4. **Control Groups** (0-9 keys): Save/recall unit groups
5. **Unit Portrait**: Quick visual identification + stats
6. **Event Queue**: Visible pending production/build/research items
7. **Fog of War Toggle**: Full exploration history display

### 7.3 Hotkey Conventions

**AoE2 Default Hotkeys:**
| Action | Key | Rationale |
|--------|-----|-----------|
| Build | B | Bottom-left hand reach |
| Unit Production | V | Second hand row |
| Housing | H | "Home" association |
| Minimap toggle | M | Mnemonic |
| Select All on Screen | Ctrl+A | Familiar convention |
| Control Group Assign | Ctrl+0-9 | Standard grouping |
| Control Group Recall | 0-9 | Quick recall |
| Queue Production | Shift+Click | Progressive building |
| Attack Move | Right-Click/Shift | Contextual action |

**Design Insight:** Hotkeys group by building type first letter (B=Barrack, S=Stable, A=Archery) or second letter when first is taken (mArket, bLacksmith).

### 7.4 Minimap Functionality

|- Click: Camera jump to location
|- Right-Click: Issue move/attack order
|- Ping: Player alert notification
|- Fog/unit/reference layers: Toggle individually
|- Territory highlight: Own/contested/ally zones

### 7.5 CivStrategy HUD Assessment

**Current GameUI.tsx:**
- Resource display (food, wood, gold, stone, population happiness)
- Game controls (speed, pause, save, load)
- Unit selection panel
- MinimapSystem: overview and navigation

**Gaps vs AoE2:**
- No control groups (0-9)
- No command panel hotkeys (muscle memory shortcuts)
- No production queue overlay

**Recommendations:**
- Add numeric control group binding
- Add hotkey hints next to buttons (discoverability)
- Queue status indicator with cancel/reorder interactions

---

## 8. Balance Considerations: Multiplayer vs Singleplayer

### 8.1 Multiplayer Balance Data (AoE2 DE)

**Civ Win Rates (AoE2, 1v1 Ranked):**
| Civilization | Win Rate | Notes |
|-------------|----------|-------|
| Romans | 54% | Strong infantry, balanced |
| Bulgarians | 53% | Flexible upgrades |
| Byzantines | 48% | Defensive, slow start |
| Georgians | 47% | Niche bonuses |

**Balance Principle:** Ideal = 50% ± 2% win rate across all civs in large sample size.

**Balance Levers:**
- Unit cost adjustment (+/- 5-10 gold)
- Gathering rate bonuses (+/- 5-15%)
- Unique unit stats (attack/hp)
- Tech tree exclusions (what can't each civ research?)

### 8.2 Singleplayer Balance

**Key Differences from MP:**
- AI is not perfectly optimal → exploits different strengths per civ
- Campaign scenarios have scripted economies → balance not tested the same way
- Fun > competitive fairness (can have overpowered civs in SP)

**AoE2 SP Design:**
- Easy AI: 1.0x resource multiplier
- Moderate: 1.0x + 85% villager efficiency
- Hard: 1.2x + full efficiency
- Hardest: 1.3x + advanced tactics

### 8.3 CivStrategy Balance Considerations

**Current CivStrategy AI (EnemyAISystem):**
- Personality-based playstyles: Aggressor, Defender, Economist, Balanced
- Resource management at scale
- Attack planning

**Balance Implications:**
- Aggressor AI needs counter-detection (too predictable at high level)
- Defensive AI needs proactive expansion logic
- Economist AI needs mid-game military commitment

**Recommendation:** Implement difficulty scaling with diminishing returns:
```
Easy AI: 1.0x resources, no micro
Normal AI: 1.0x resources, basic tactics
Hard AI: 1.2x resources, counter-detection
Expert AI: 1.3x resources, advanced micro (kiting, focus fire)
```

### 8.4 Map-Specific Balance

**Map types with different balance needs:**
- **Open maps (Arabia)**: Infantry/cavalry focus; early aggression dominant
- **Closed maps (Black Forest)**: Defensive play; siege units more valuable
- **Islands**: Naval + economy priority; land military secondary
- **Hills**: Elevation advantages create chokepoints

- "Standard" (balanced)
- "Abundant" (easier booming)
- "Scarce" (forces early aggression)
- "Naval" (water resources prominent)

---

## Summary: Priority Recommendations for CivStrategy

| # | Area | Recommendation | Impact | Effort |
|---|------|---------------|--------|--------|
| 1 | Economy | Per-resource gathering multipliers (food slow, wood fast) | High | Low |
| 2 | Combat | Hard/soft counter classification + melee vs pierce armor | High | Medium |
| 3 | AI | Difficulty tiers with resource handicaps + villager efficiency | High | Medium |
| 4 | UI | Numeric control groups (0-9) + hotkey hints | Medium | Low |
| 5 | Map | Player-symmetric resource placement + biome-specific weighting | Medium | Medium |
| 6 | Tech | Mandatory prerequisite chains + research cooldown mechanism | Medium | Low |
| 7 | Economy | Happiness-to-productivity coupling (Stronghold model) | Medium | High |
| 8 | Balance | Gold/stone finite deposits → map control timing incentives | Medium | Medium |

**Highest-ROI Quick Wins:**
1. Differential gathering rates — changes one multiplier, dramatically alters economic flow
2. Control groups — QoL improvement matching industry standard
3. Hard/soft counter flags on existing unit definitions — formalizes combat design

**Structural Investments:**
1. AI difficulty tier system — scales player engagement from beginner to expert
2. Player-symmetric map generation — prerequisite for multiplayer
3. Happiness-to-production coupling — differentiates CivStrategy from AoE clones

---

*Sources: Age of Empires Fandom Wiki, AoE2 DE AI documentation, Stronghold Definitive Edition economy guide, Wayward Strategy RTS analysis, GameDeveloper RTS UI design patterns, AoE2 random map scripting documentation.*
