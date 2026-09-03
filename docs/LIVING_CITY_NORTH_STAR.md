# CivStrategy Living City North Star

This document defines the long-term product direction for making CivStrategy feel like a **massive living city builder that remains a real RTS**.

It extends the global quality bar in `NORTH_STAR.md`. The global North Star still wins on correctness, smoothness, readability, and AAA-level execution. This document defines what future city, population, economy, logistics, settlement, and urban-combat work should converge toward.

The core fantasy is simple:

> **The player does not build an RTS base. The player grows a civilization that becomes the battlefield.**

CivStrategy should eventually combine the settlement identity and life of Manor Lords, the density and directness of Stronghold, the command readability of Age of Empires, and CivStrategy's own large-scale liquid combat and systemic simulation.

This is a direction, not permission to add every city-builder mechanic at once. Each feature must earn its complexity by improving what the player can **see, understand, feel, or strategically act on**.

---

## 1. Product promise

A successful late-game CivStrategy settlement should no longer read as a collection of buildings placed on terrain.

It should read as a city.

The player should be able to look at the world and immediately understand:

- where people live,
- where people work,
- which roads are busy,
- where goods are moving,
- which parts of the city are rich, poor, industrial, civic, rural, or military,
- where the economy is healthy or failing,
- how the city changed as the civilization advanced,
- what is at risk when an enemy attacks.

The game should remain enjoyable to watch at 1x speed even when the player is not issuing commands.

The city-builder layer must strengthen the RTS layer, not replace it.

---

## 2. The fundamental simulation rule

### Population is not the same thing as simulated entities

Do not model every citizen as a full `GameUnit`.

CivStrategy needs multiple simulation layers with different costs and responsibilities.

### Layer A: gameplay entities

These are agents whose exact state matters strategically.

Examples:

- villagers and workers when they perform gameplay-critical jobs,
- soldiers,
- siege units,
- scouts,
- special units,
- explicitly interactable or selectable agents.

They may use real pathfinding, combat state, selection state, collisions, inventories, or other expensive systems when required.

### Layer B: lightweight world actors

These create believable movement and local economic activity without carrying the full cost of gameplay units.

Examples:

- ambient citizens,
- market crowds,
- children,
- dock workers,
- carts,
- porters,
- civilians traveling between homes and civic anchors,
- farmers moving visually between nearby farm structures.

They should normally use pooled data, deterministic/simple steering, cheap route abstractions, culling, batching, and LOD.

### Layer C: statistical population

Most citizens can exist only as settlement data.

Examples:

- households,
- dependents,
- occupations,
- class or wealth distribution,
- workforce availability,
- migration pressure,
- military manpower.

A population of 2,000 must not require 2,000 full simulation actors.

The visible world should still make 2,000 people **feel present** through representative crowds, traffic, activity, housing density, props, production, sound, and district behavior.

### Current foundation

The repository already contains `AmbientPopulationSystem`, which follows this philosophy: decorative civilians are rendered as lightweight Blitter bobs and deliberately avoid physics, spatial hashes, selection, combat, and pathfinder requests. Future work should evolve this architecture instead of turning ambient citizens into full units by default.

---

## 3. The city must grow visually with population

Population growth must produce visible world growth.

If the population statistic changes but the settlement looks almost identical, the system is failing the North Star.

Growth should create some combination of:

- more occupied housing,
- denser pedestrian movement,
- busier markets,
- more carts and deliveries,
- more smoke and workshop activity,
- fuller roads,
- additional cosmetic extensions and props,
- more visible farm labor,
- larger civic gathering areas,
- increasingly dense residential clusters.

The exact visible actor count can remain bounded by performance budgets. Perceived population should scale through density and representation, not one-rendered-person-per-citizen.

---

## 4. Player-built function, system-built texture

The player should remain responsible for strategically meaningful placement.

The game should automatically provide much of the visual texture that makes those decisions look like a believable settlement.

### The player places

- houses,
- farms,
- workshops,
- barracks,
- markets,
- temples and civic structures,
- storage buildings,
- walls and defensive structures,
- major roads when direct control is eventually useful.

### The simulation may decorate

- fences,
- barrels,
- crates,
- firewood stacks,
- carts,
- benches,
- awnings,
- market stalls,
- hay piles,
- workshop clutter,
- laundry,
- tools,
- tiny sheds,
- gardens,
- livestock pens,
- street debris,
- military racks and training props.

These decorations must remain non-blocking unless explicitly promoted into gameplay objects.

The objective is:

> **The player builds the functional city. The game fills in the visual city.**

This reduces micromanagement while allowing extremely dense-looking settlements.

---

## 5. Urban density is a feature

CivStrategy should support the crowded, contiguous settlement feel associated with Stronghold rather than forcing unnatural empty gaps between structures.

Future placement work should favor:

- tight valid footprints,
- readable but small collision margins,
- houses placed directly beside compatible houses,
- farms that can touch or form coherent fields,
- workshops forming streets or clusters,
- walls that connect without awkward gaps,
- entrances and activity spaces that remain usable even in dense areas.

Density must not break selection, pathfinding, building readability, construction, or combat navigation.

A dense city should feel intentional rather than like collision bugs stacked together.

---

## 6. Roads should emerge from life

Roads are not only decoration. They should become visible evidence of how the settlement functions.

The long-term target is a movement/traffic heat system:

`home -> workplace -> storage -> market -> civic buildings -> gates -> nearby settlements`

Repeated movement should increase local travel intensity.

Possible visual progression:

`grass -> worn ground -> dirt path -> established road -> paved road`

This does not require expensive per-citizen permanent path histories. Heat may be accumulated from representative actors, job routes, transport routes, or abstracted flow samples.

Roads can eventually affect:

- civilian travel speed,
- cart throughput,
- military movement,
- desirability,
- building entrance orientation,
- district formation,
- invasion routes.

A successful road system should make the city's history readable from above.

---

## 7. Districts should emerge instead of being painted

Avoid immediately becoming a zoning game.

District identity should primarily be inferred from the city the player actually built.

Examples:

- dense houses -> Residential Quarter,
- blacksmiths + workshops + storage -> Craftsmen Quarter,
- farms + barns -> Farmlands,
- Town Center + market + temple -> Civic Center,
- barracks + walls + training structures -> Military Quarter,
- docks + warehouses + markets -> Harbor District.

Districts can later create lightweight modifiers or events, but their first job is to make the city legible and memorable.

The player should eventually be able to rename important districts.

Notifications become more meaningful when the game can say:

- `Old Quarter is burning`,
- `North Farmlands are under raid`,
- `Harbor District has stopped receiving grain`.

---

## 8. Population should become society

The current population number can remain the top-level readable value, but long-term simulation should distinguish population from workforce and military manpower.

A future population model may contain:

- households,
- working-age population,
- dependents,
- farmers,
- laborers,
- artisans,
- merchants,
- specialists,
- soldiers,
- available recruits.

The UI must not expose every statistic simply because it exists.

The important strategic relationship is:

> **People who fight are also people who could have worked.**

Mobilization should eventually create real opportunity cost.

Large military losses should matter to the settlement without requiring the player to manage individual family trees.

---

## 9. Production chains should be short, visible, and physical

CivStrategy should not become an accounting spreadsheet disguised as an RTS.

Prefer short production relationships that create visible city movement.

Examples:

- wheat -> mill -> food/bread,
- wood -> carpenter/workshop -> finished goods,
- iron -> blacksmith -> weapons,
- stone -> mason -> advanced construction,
- livestock -> food/leather.

The exact resource model may evolve, but the world should communicate production through:

- workers entering/leaving relevant buildings,
- carts moving between nodes,
- storage filling or emptying,
- visible props changing,
- production audio and animation,
- local congestion when logistics fail.

The player should be able to diagnose many economy problems by watching the city before opening a panel.

---

## 10. Logistics must create strategic geography

Goods should not teleport invisibly across the realm forever.

The mature game should have a lightweight concept of local distribution, storage, and transport.

Important routes may include:

- farm -> granary,
- forest -> lumber storage,
- mine -> warehouse,
- warehouse -> workshop,
- workshop -> market,
- satellite settlement -> capital.

This creates targets for warfare:

- road raids,
- bridge control,
- convoy interception,
- warehouse destruction,
- siege starvation,
- disrupted rural production.

Logistics complexity must be layered so casual play remains understandable.

---

## 11. The city is the battlefield

Do not create a separate city-builder mode and combat mode.

The city itself must become tactically meaningful terrain.

During an attack, civilians may:

- flee from approaching enemies,
- move toward protected civic areas,
- abandon carts,
- reduce market activity,
- hide or despawn into safe statistical state,
- create visible panic without becoming collision spam.

Combat should interact naturally with the settlement:

- roads become army corridors,
- alleys constrain movement,
- walls redirect fronts,
- farms can be raided,
- markets and warehouses become strategic targets,
- fire and destruction alter activity,
- military quarters reinforce defenses,
- citizens may be mobilized through explicit gameplay systems.

The emotional target is that losing a district feels worse than losing an isolated RTS building because the player has watched that place become alive.

---

## 12. Realm scale: from city to civilization

Late game should eventually extend beyond one oversized capital.

Possible settlement hierarchy:

- capital,
- villages,
- farming settlements,
- mining towns,
- forts,
- ports,
- frontier outposts.

Secondary settlements should be lower-management than the capital but strategically important.

They may provide:

- resources,
- manpower,
- regional control,
- trade routes,
- defensive depth,
- forward military infrastructure.

This should allow territory control to become more meaningful than raw building counts.

A future dominance/realm model should consider actual settlement presence, routes, strategic nodes, and military control rather than treating territory as only a ratio of structures.

---

## 13. Ages should visibly transform the civilization

Age advancement must feel like civilization advancement, not only an unlock table.

### Early settlement

- rough structures,
- dirt trails,
- sparse markets,
- scattered farms,
- small civic center.

### Established town

- denser housing,
- recognizable roads,
- workshops and storage clusters,
- larger markets,
- stronger walls,
- civic plazas.

### Mature city

- paved major roads,
- multi-part or larger residences,
- monumental structures,
- dense central districts,
- major logistics traffic,
- sophisticated defenses.

### Realm / imperial scale

- monumental civic architecture,
- satellite settlements,
- busy regional routes,
- large armies,
- highly differentiated districts,
- clear contrast between capital and countryside.

Visual evolution should be implemented without requiring every building to be completely replaced at each age. Modular upgrades, props, skins, extensions, and district decoration can provide much of the transformation.

---

# Sprite and Asset Generation North Star

The Living City direction will require far more visual variety than the current asset count. Hand-authoring every citizen, house variant, cart, stall, barrel, fence, workshop extension, and age variant would become a bottleneck.

Sprite generation should therefore become a first-class content pipeline.

## 14. Build on the current generator approach

The repository already contains code-driven generators:

- `scripts/gen-sprites.ts` creates transparent isometric building PNGs,
- `scripts/gen-unit-sprites.ts` creates 48x48 unit sprites with tintable white faction regions,
- `scripts/pixel-builder.ts` and `scripts/png-encode.ts` provide low-level generation infrastructure.

This is a strong foundation because generated assets are:

- deterministic,
- version controlled,
- reproducible,
- cheap to expand,
- easy for development agents to modify,
- less likely to drift stylistically than unrelated one-off assets.

Do not abandon this for a folder full of unrelated AI-generated images.

AI image generation can be useful for **concept exploration, visual references, silhouettes, and art-direction discovery**, but final shipping sprites should pass the same perspective, scale, palette, grounding, readability, and consistency rules as generated or curated assets.

## 15. Create an explicit sprite art bible

Every generated city sprite should follow shared rules.

At minimum define:

- the existing 2:1 isometric projection used by `toIso`,
- canonical world-to-sprite scale bands,
- anchor/origin conventions,
- light direction,
- shadow direction and softness,
- palette ranges by material,
- faction-color usage,
- minimum silhouette readability,
- transparent background requirements,
- outline/no-outline policy,
- saturation and contrast limits,
- age/faction variation rules.

Generated sprites must look like they belong in one game.

A technically valid PNG that violates the art bible is not complete.

## 16. Prefer modular generation over hundreds of bespoke functions

The next generation of building tooling should move from one draw function per building toward reusable visual modules.

Possible modules:

- wall material,
- roof material,
- roof shape,
- foundation,
- door,
- windows,
- chimney,
- awning,
- fence,
- porch,
- banners,
- crates,
- barrels,
- market stall,
- hay,
- tool racks,
- garden,
- smoke socket,
- damage overlays.

A house definition could then combine modules plus a deterministic seed.

Example conceptual output family:

`house_roman_town_01`
`house_roman_town_02`
`house_roman_town_03`
`house_roman_town_corner_01`

These should share gameplay footprint rules while varying visual shape enough to break repetition.

## 17. Deterministic variants, not random visual soup

Procedural variety must remain reproducible.

Given the same:

- faction,
- building type,
- age,
- variant seed,

we should generate the same visual result.

This keeps screenshots, saves, debugging, tests, and agent workflows stable.

Variation should be curated through bounded palettes and compatible modules rather than unrestricted random combinations.

## 18. Ambient citizen sprite tiers

Ambient people should use LOD-specific representations rather than one sprite scaled infinitely.

Suggested direction:

### Near LOD

Use small but readable citizen sprites with limited role variants:

- civilian,
- worker,
- merchant,
- porter,
- farmer,
- child/family silhouette where appropriate.

Animation should be extremely cheap: a few walk frames or subtle generated pose variants are enough.

### Mid LOD

Use simplified 6-12 px silhouettes or tiny atlas sprites.

The current runtime-generated ambient citizen is already close to this concept.

### Far LOD

Use Blitter dots/rectangles or group-density hints.

At this distance the goal is motion and density, not identity.

Do not spend pathfinding, animation, or texture-switch cost on citizens the player cannot resolve visually.

## 19. Generate props as families

Living City needs prop variety more than giant numbers of unique major buildings.

High-value procedural families include:

- market stalls,
- crates,
- barrels,
- sacks,
- carts,
- wagons,
- hay piles,
- fences,
- benches,
- lamps/torches,
- firewood,
- workshop clutter,
- training equipment,
- garden patches,
- street debris,
- harbor cargo.

Each family should have several silhouette/material variants that share footprint and anchor metadata.

The decoration system can then select context-appropriate variants based on district, building, age, wealth, and faction.

## 20. Move toward atlases

As asset counts grow, do not load hundreds of tiny independent textures if an atlas is more efficient.

Generated content should eventually support:

- sprite atlas output,
- metadata manifests,
- frame names,
- anchor data,
- category tags,
- LOD tags,
- faction/age tags.

This will improve batching, loading behavior, content discovery, and tooling.

The generator should produce both image output and machine-readable metadata.

## 21. Suggested future content pipeline

A mature pipeline may look like:

`art bible + modular definitions + deterministic seed`

-> `sprite generator`

-> `PNG/atlas + manifest`

-> `visual regression contact sheet`

-> `game integration`

-> `in-game screenshot critic`

The contact sheet is important. Generation should produce a grid preview of every variant so a critic can immediately spot:

- broken anchors,
- scale drift,
- inconsistent lighting,
- unreadable silhouettes,
- ugly random combinations,
- palette drift,
- accidental duplicates.

Do not evaluate generated assets only by reading generator code.

---

## 22. Performance budget for a living city

The Living City feature is successful only if it preserves CivStrategy's smoothness target.

General rules:

- Ambient citizens should not enter the main units group unless strategically necessary.
- Use Blitter/Batch/atlas-friendly rendering where practical.
- Pool visible actors and props.
- Cull before terrain-height or other expensive work when possible.
- Update distant ambient movement at lower frequency.
- Use representative traffic instead of simulating every citizen trip.
- Keep pathfinding reserved for gameplay-critical actors and selected transport cases.
- Cap visible ambient density independently from statistical population.
- Degrade detail through LOD before reducing the apparent scale of the city.
- Stress-test city simulation together with military simulation. A city that runs at 60 FPS only when no army exists is not acceptable.

The existing ambient population design provides a useful architectural precedent: cheap visual actors should remain separate from expensive gameplay units.

---

# Development sequence

The following sequence is directional. Bugs and core gameplay correctness still outrank roadmap order.

## Phase 1: Living City foundation

Build on the existing ambient population work.

Target capabilities:

- population-linked ambient density,
- stronger civilian anchor/routine model,
- market/farm/workshop activity,
- lightweight carts,
- prop decoration around active buildings,
- panic/quiet-state hooks for warfare,
- LOD behavior.

Acceptance target:

> A 300+ population settlement clearly looks more populated and active than a 30-population settlement without requiring hundreds of full units.

## Phase 2: Organic density and roads

Target capabilities:

- dense placement rules,
- building adjacency polish,
- movement heat,
- emergent paths,
- contextual building entrances,
- road-aware ambient movement.

Acceptance target:

> The settlement starts to develop recognizable streets and neighborhoods instead of reading as objects scattered across terrain.

## Phase 3: Households and workforce

Target capabilities:

- statistical households,
- workforce availability,
- occupation distribution,
- migration/population growth inputs,
- military manpower relationship.

Acceptance target:

> Population, employment, and warfare create understandable trade-offs without requiring individual-citizen micromanagement.

## Phase 4: Production and logistics

Target capabilities:

- short production chains,
- local storage,
- representative goods movement,
- cart traffic,
- readable bottlenecks.

Acceptance target:

> The player can often understand why the economy is healthy or failing by watching movement in the city.

## Phase 5: Realm scale

Target capabilities:

- secondary settlements,
- regional routes,
- trade/supply links,
- raiding,
- strategic regional control,
- improved dominance model.

Acceptance target:

> Late game feels like governing and defending a realm rather than expanding one giant RTS base.

---

# Living City feature gate

Before merging a major Living City feature, ask:

1. Does it make the settlement more visibly alive, legible, or strategically meaningful?
2. Does the city-builder mechanic strengthen RTS decisions rather than distract from them?
3. Can the player perceive the new simulation in the world?
4. Does it preserve responsive combat and camera/input behavior?
5. Does it avoid turning statistical population into thousands of expensive full entities?
6. Does it degrade gracefully with LOD/culling when the city becomes large?
7. Does it remain coherent with the sprite art bible and existing visual direction?
8. Was it tested together with a meaningful military load?
9. If it adds complexity, is that complexity earning its place?

If the answer to several of these is no, the feature is probably not aligned with this North Star.

---

# Anti-goals

Do not pursue the Living City fantasy by:

- simulating every citizen as a full Phaser physics unit,
- adding Anno-level production-chain complexity by default,
- turning the game into a zoning spreadsheet,
- separating combat into a disconnected mode,
- creating huge empty roads only for visual neatness,
- requiring the player to manually place every cosmetic prop,
- generating unlimited random sprite combinations with no art direction,
- loading hundreds of inconsistent AI-generated assets directly into production,
- hiding severe simulation problems behind decorative crowds,
- sacrificing army scale so the city can look busy,
- adding invisible statistics that never affect the world or player decisions.

---

# The guiding test

Every meaningful city-system addition should pass this question:

> **If this simulation changes, what changes in the world that the player can see, hear, understand, or strategically respond to?**

If the answer is "only a number in the UI," the design is not finished.

The desired end state is a game where the player can zoom out and see a civilization, zoom in and see everyday life, then watch that same place transform into a battlefield without switching games.
