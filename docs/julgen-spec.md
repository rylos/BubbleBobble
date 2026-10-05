> Written while planning the remake (2026-10-05). Paths under `/tmp/...scratchpad` referred to temporary build experiments and no longer exist.

# Bubble Bobble (Julgen) — technical spec & extend-vs-rewrite assessment

Studied: `/home/marco/dev/BubbleBobble` @ `6a59ee9` (2024-11-03, author Julian Rijken, 126 commits) and submodule
`Julgen` @ `2e05bd7`. Nothing in the repo was modified. All build experiments live in the scratchpad.

License: **GPL-3.0-or-later** (both game and engine). Any extension/derivative must stay GPL.

---

## 0. TL;DR

* Small codebase: game `src/` = **5,599 lines** (60 files), engine `Julgen/src/` = **5,067 lines**. Vendored externals ~320k lines.
* It is a polished *student-project vertical slice*: main menu, intro, **3 playable levels**, 2 enemy types (Zen-Chan, Maita),
  capture bubbles, fruit pickups, 1P / 2P co-op / "VS" mode, score entry + top-10 leaderboard. Upstream also ships a web build.
* **Builds and runs natively on this machine** only after supplying deps the system lacks (glm, SDL2_ttf, SDL2_image) and
  pinning fmt to 10.x (system fmt 12.2 breaks the game code). With those, compile is clean at `-Wall -Wextra -Wpedantic -Werror`
  (GCC 16.2) and the binary runs (smoke-tested 8 s under Xvfb, no crash).
* Physics-driven (Box2D 2.3.2) platforming: feels "floaty/physicsy", not arcade-exact. Levels are PNG collision masks only;
  enemies are hard-coded per level in C++ scene functions.
* Assets are richer than the code: `Enemys.png` contains NES sprites for ~9 enemy types + Baron, `Items.png` has 144 items,
  `LevelTiles.png` has 25 level tilesets, 21 SFX (only 4 used).
* **Verdict: extend the engine, rewrite most of the gameplay layer.** Details in section 6.

---

## 1. Engine (Julgen) architecture

### 1.1 Main loop (`Julgen/src/Main/Julgen.cpp`)
`main()` constructs `jul::Julgen`, whose ctor does everything: `PreInit()` (implemented **by the game**, `src/GameEntry.cpp`),
`SDL_Init(VIDEO|GAMECONTROLLER)`, window, services, `GameStart()` (also game-implemented), then `Run()`.
Native: `while(!quit) RunOneFrame()`. Web: `emscripten_set_main_loop_arg`.

Per frame (`RunOneFrame`), tracked in global `Julgen::g_LoopState` (asserts use it to enforce destroy ordering):
1. `GameTime::Update` (dt clamped to 1/30 s; timeScale supported)
2. `Input::ProcessInput` (SDL event pump)
3. Fixed-step loop at **120 Hz** (`g_FixedDeltaTime = 1/120`): `Physics::UpdateIsActive` -> `SceneManager::FixedUpdate` -> `b2World::Step(vel 6, pos 2)`
4. `Update` -> `MessageQueue::Dispatch` -> `TweenEngine::Update` -> `LateUpdate`
5. `RenderManager::PickCamera` + `Render` (sprites at logical render size, then ImGui at window size)
6. `SceneManager::ProcessScenes` (unload, destroy marked objects, load queued scenes; recursive if a load queues another)

### 1.2 Object model (Unity-like)
* `Object` (name, `Destroy()`, `DestroyDelayed(t)` via tween, `OnDestroyedEvent`) -> `GameObject` / `Component`.
* `GameObject` owns `vector<unique_ptr<Component>>`; always has a `Transform` (hierarchy, dirty-flag world matrices, `SetParent`, world/local pos).
  `AddComponent<T>(args...)` constructs `T(GameObject*, args...)`; `GetComponent<T>` is a linear `dynamic_cast` scan (works with interfaces such as `IDamageable`).
* Components override `Update / LateUpdate / FixedUpdate`; `SetEnabled`, `SetActive` propagate through hierarchy.
* Destruction is deferred: `Destroy()` marks; actual delete happens in `CleanupGameObjects` (asserts if deleted otherwise).
* `Scene` = flat list of root-owned GameObjects; objects added mid-frame go to `m_GameObjectsAdded` and are moved in at end of frame.
* `SceneManager`: scenes are **integer ids bound to C++ functions** (`BindScene(id, void(Scene&))`). Load modes: `Override`, `OverrideForce`, `Additive`.
  Game uses one "mode" scene (camera, players, HUD, walls) + an **additive level scene** per level.
* Communication: `Event<Args...>` (observer, auto-unsubscribe via `IEventListener`), `MessageQueue` (global, deferred, `std::any` args, int ids),
  `Command` pattern for input, `Locator` service locator (Physics, Sound), several `Singleton<T>` (Game, Input, RenderManager, SceneManager, TweenEngine).
* `TweenEngine`: tween struct {delay, from, to, duration, ease, onStart/onUpdate/onEnd}, bound to a target `Object` (auto-cancel on destroy). Used everywhere as timer/coroutine replacement.

### 1.3 Rendering
* **SDL2 `SDL_Renderer`** (tries the "opengl" driver index, ACCELERATED|PRESENTVSYNC). No shaders, no batching; window is `SDL_WINDOW_OPENGL|RESIZABLE`.
* `SDL_RenderSetLogicalSize(256x224)` for the game, then window size for ImGui. Window = 4x = **1024x896**.
* `Camera` component: orthographic, `orthoSize=14` (=> 28 world units tall), highest priority camera wins. World->screen done on CPU per sprite.
* `RenderComponent` registry (static `unordered_set`); every frame: copy to vector, remove inactive, sort by z then `stable_sort` by render layer, call `Render()`. (Author's own TODO: "horrible CPU sorting every frame".)
* `SpriteRenderer`: `Sprite` = texture + pixelsPerUnit + pivot + grid (rows x cols) + named `SpriteAnimation`s; draws one cell, supports flipX/flipY, rotation, scale.
* `Animator`: plays a named animation (list of cells + fps), looping or one-shot, normalized time. No events/callbacks; game polls `IsPlaying()`.
* `TextRenderer`: SDL_ttf -> texture, regenerated only when text/colour changes. Font: `NES_Font.ttf` size 8.
* Units: **1 world unit = 1 tile = 8 px** (PPU 8 for all game sprites; character/enemy sprites are 16x16 => 2x2 units).

### 1.4 Physics (Box2D 2.3.2, vendored fork `tobanteGaming::Box2D`)
* `Physics` service owns `b2World` (gravity -9.81) and is the `b2ContactListener`.
* `Rigidbody` component (Static/Kinematic/Dynamic, gravityScale, fixedRotation, bullet...). `BoxCollider` component: box only, friction/restitution/density, `isSensor`, category/mask/group. A collider attaches to the nearest Rigidbody in parent, otherwise creates its own static body (each level tile = its own body).
* Contacts: `HandleContact` iterates **all bodies and all fixtures in the world per contact callback** to find the owning Rigidbody (O(N) per Begin/End/PreSolve/PostSolve) and forwards to components implementing `ICollisionListener` (`OnCollisionBegin/End/PreSolve/PostSolve`).
* `Physics::RayCast(from, dir, dist, [result], mask)` — used for ground checks, wall turning, bubble placement.
* Only boxes; no circles, no polygons, no tilemap collider, no queries by AABB.

**One-way platforms** (`src/Components/OneWayPlatform.cpp`): in `PreSolve`, for dynamic bodies only, computes
`delta = other.AABB.lower.y - vel.y*fixedDt - platform.AABB.upper.y` and `contact->SetEnabled(delta > -0.05)`. So you pass through from below and land from above. Semi-solid tiles get a static Rigidbody + OneWayPlatform + BoxCollider (layer `TILE_SEMI_SOLID`).

Collision layers (`Game.h`, `bb::layer`): ENEMY=1<<1, ENEMY_DEAD=1<<2, PICKUP=1<<3, PLAYER=1<<4, CAPTURE_BUBBLE=1<<5, TILE=1<<6, TILE_SEMI_SOLID=1<<7, INVIS_WALLS=1<<8, BOULDER=1<<9.

### 1.5 Audio (SoLoud, vendored `SoLoud-CMake` fork)
* `Sound` service interface with `PlaySound(int id)`; impls `Sound_System` (SoLoud, pImpl), `Sound_Null`, `Sound_Logging`.
* Backend: **miniaudio** natively, **SDL2** on web. SoLoud multithreading removed for web (commit "SOLOUD MULTITHREAD REMOVED").
* Sounds are bound by int id -> path (`Resources::BindSound`), lazily loaded as `SoLoud::Wav` (wav/ogg). Fixed volume 0.3, play speed follows timeScale.
* No music channel, no looping, no stop/fade, no volume control. "Mute" (M key) swaps the whole service between `Sound_System` and `Sound_Null` (re-inits SoLoud).

### 1.6 Input
* `Input` singleton. Game registers *actions* (`AddAction(enum, {scancodes}, {controller buttons}, {axes})`) then *binds* actions to commands per `(controllerIndex, allowKeyboard)` (`Input::Bind(action, ctrlIdx, allowKbd, obj, &Class::Method)` -> `EventCommand`).
* Event driven only (Down/Up callbacks, key repeat ignored); axes delivered as float/vec2 with deadzone 0.15. No polling API ("is key held"), no rebinding UI.
* Keyboard binds ignore controllerIndex, i.e. keyboard is "one more device" that can be attached to any bind.
* Gamepads via `SDL_GameController`, opened on the fly. Note: controller index used is the joystick index.
* Binds are **never removed** (author TODO: memory leak); dead listeners are auto-detached from their Event but `InputBinding` entries accumulate with every scene load.

### 1.7 Resources, ImGui, misc
* `Resources` (static): fonts, sprites (and their textures), sounds, keyed by string/int. Asset root: `./Assets/` or `../Assets/` (native), `/Assets/` (web, preloaded). CMake symlinks `Assets` into the build dir (copy on Windows).
* ImGui 1.90.5 + implot (vendored, SDL2 + SDL_Renderer2 backends). Only use: optional "Debug Info" overlay listing active tweens (`EngineGUI::ShowDebugInfo`; the game defines a ToggleDebug action on `T` but never binds it).
* `Achievement`: Steamworks stub (`USE_STEAMWORKS` option, off), listener commented out.
* `MathExtensions`: random, lerp, LerpSmooth, MoveTowards, ClampLoop01. Easing functions for tweens.

### 1.8 Dependencies: system vs vendored
| Dependency | Linux native | Windows / Emscripten |
|---|---|---|
| SDL2, SDL2_image, SDL2_ttf | **system** (`find_package`) | FetchContent (Win) / emscripten ports `-sUSE_SDL=2 -sUSE_SDL_IMAGE=2 -sUSE_SDL_TTF=2` |
| glm | **system** | FetchContent glm 1.0.1 |
| fmt | **system** | FetchContent fmt 10.2.1 |
| Box2D 2.3.2 | vendored submodule (`external/box2D`, JulianRijken/Box2D-CMake-Julgen) | same |
| SoLoud | vendored submodule (`external/soloud`, git.allpurposem.at/mat/SoLoud-CMake) | same |
| Dear ImGui 1.90.5 + implot | vendored in tree (`external/imgui`) | same |

---

## 2. The game

### 2.1 Entry & settings (`src/GameEntry.cpp`)
* Render resolution **256 x 224** (`GRID_SIZE_X=32` x `GRID_SIZE_Y=28` tiles x 8 px), window 4x (1024x896). Target: NES version look ("going for https://www.youtube.com/watch?v=VyK_cpp9pT4 BubbleBobble NES").
* `LoadResources()` loads all sprites with inline animation tables, the font and 4 sounds.
* `PreInit()` defines input actions; `GameStart()` loads resources, `Game::Initialize()`, binds scenes, loads MainMenu, plays "The Quest Begins".

### 2.2 Level data — `Assets/Levels.png`
* 32 x 84 RGBA PNG = **3 levels** stacked vertically (28 rows each). `levelCount = height / 28`.
* Pixel encoding (`Game::ParseMaps`), checked in this order:
  * R==255 -> `BlockSolidity::None` (tile drawn, no collider) — used for the ceiling row (row 2).
  * G==255 -> `Semi` (one-way platform).
  * B==255 -> `Solid` (walls + floor; full collision).
  * anything else -> empty.
* Coordinates: tile (x,y) -> world `(x-16, (28-y)-14)`, collider box 1x1 offset (0.5,-0.5).
* Tile sprite: `LevelTiles.png` (40x200 = 5 cols x 25 rows of 8 px); **row = level index, column 0 only** => graphics for 25 levels exist; columns 1-4 (shadow/edge variants) unused, so no drop shadows.
* **Enemies are not in the PNG.** Each level is a C++ function in `src/Scenes.cpp` (`Level1Scene`..`Level3Scene`) passing a `vector<EnemySpawn{type, delay, location}>` to `LevelState`.
* Level list is a compile-time array `Game::LEVELS = {IntroLevel, Level1, Level2, Level3}` + scene enum ids. Adding a level = new enum value + function + bind + array entry + PNG rows.
  * L1: ZenChan(-2,6), Maita(0,6) delay 1, ZenChan(2,6) delay 2
  * L2: 4x ZenChan
  * L3: 4x ZenChan (two with delay 2)
* Parser assumes 32-bit pixels with no row padding (`pixels[(y+lvl*28)*32+x]`), ignores `pitch`/format — works for the current RGBA PNG only.

### 2.3 Game states & flow
`GameState {MainMenu, Intro, Game, ScoreScreen}`; `GameMode {P1, P2, VS}`.
1. **MainMenu scene**: logo drop + bubble particles (AutoMove), then select screen: 1P START / 2P START / VS START / LEADERBOARD.
2. **Mode scene** (`OnePlayerMode` / `TwoPlayerMode` / `VersusMode`): camera, players, PlayerHUD(s), LevelHUD, invisible side walls; then `TryTransitionLevel(0)`.
3. **IntroLevel** (additive): "Now it is the beginning of a fantastic story..." text, BubbleSpiral, players orbit for 7 s, then level 1.
4. **Level transition** (`Game::TryTransitionLevel`): 4 s tween scrolling the camera down from y=28 to 0 (new tiles spawned above, old tiles destroyed after), players flown in bubbles to start positions (P1 (-12,-10), P2 (12,-10)), then the level scene loads additively.
5. **LevelState**: spawns enemies above screen, tweens them down over 2 s; when all `Enemy` objects are destroyed -> wait 7 s -> next level. After level 3 -> ScoreScreen.
6. **ScoreScreen**: initials entry (3 letters, cycle with up/down, select) for P1 then P2, appended to file, top-10 shown. Also reachable from menu ("LEADERBOARD").
* Debug keys: `Esc/F3` (pad Start/L3) reset to menu, `P/F1` (pad Back) skip level, `F2` end game -> score screen, `[`/`]` time scale.
* **No game over**: when lives drop below 0, `Health::m_OnDeath` fires but **nothing listens** — the player just stays in the death state and the game continues; it only ends by clearing level 3 or pressing F2/Esc.

### 2.4 Players (`Components/Character/Player/*`)
* Bub (`BubbleCharacter.png`, green) = index 0, Bob (`BobbleCharacter.png`, blue) = index 1. 3 lives (`STARTING_LIVES`, displayed in hex!).
* `Player` = `Character` + `IDamageable` + `ICollisionListener`, with a 2-slot state machine: main state {Walking, Jumping, Death, Bubble} + attack state {Attacking, Null}.
  * Walk: velocity x = 8 u/s, gravity scale 3. Jump: v.y = 18, manual gravity -30, air control only after reversing input; falling = constant -6 u/s with 4 u/s air speed.
  * Grounded = 3 downward raycasts against tiles and capture bubbles (so you can **bounce on bubbles**).
  * Attack: 0.4 s cooldown, spawns a CaptureBubble 1.5 units in front at 20 u/s (or against the wall if blocked).
  * Death: body static+sensor, death animation, `Health::Damage()`, respawn at default position with 3 s blink invulnerability.
  * Bubble state: used for level transitions (player floats in a large bubble).
* Controls: keyboard Left/A, Right/D, Jump = Space/W/X/Up, Attack = E/Z, mute M; pad D-pad/left stick, B=jump, A=attack.
* **1P**: player 0 on keyboard + controller 0. **2P co-op**: P1 = controller 0 only, P2 = keyboard + controller 1 (so 2P needs a gamepad). **VS**: one player (keyboard + pad 0) vs a randomly chosen ZenChan or Maita **controlled by controller 1** (`LevelState` replaces the normal enemy list with that single enemy). Both HUDs are shown in VS.

### 2.5 Enemies (`Components/Character/Enemys/*`)
Each enemy = "body" component (`ZenChan`/`Maita`: `Enemy` + `Character` + `IBubbleable` + `ICollisionListener`, physics state machine Walking/Falling/Jumping) + optional AI component (`ZenChanBehaviour` / `MaitaBehaviour`) that feeds it inputs exactly like `CharacterInput` does — which is how VS mode lets a human drive an enemy.
* **ZenChan**: walk 8 u/s, fall 5, jump ("climb") 10. AI: walks, turns on wall/enemy raycast (min 1 s between turns), jumps when the target player is >1 unit above, a platform is within 5 units above, it's facing the player's side and 1-1.5 s passed. Targets the nearest player. Touch = damage (`OnCollisionBegin` -> `IDamageable::OnDamage`). After escaping a bubble it becomes "charging" (1.8x speed, angry sprite). Human-controlled attack toggles charge.
* **Maita**: same movement skeleton (walk 6, fall 8, climb 12) + throws a **Boulder** every 5 s (AI) / 4 s cooldown, regardless of player position, forward with ±0.5 rad noise at 15 u/s.
* "Face the player" logic never triggers: `m_TargetDirection.length()` on a `glm::vec3` returns the component count (3), not the distance, so `> 5` is always false (bug in both behaviours).
* Death: popped-bubble enemy becomes a `DeadEnemy` (spinning sprite, restitution 1, random 50-70 deg launch, 15-20 u/s impulse), after 3 bounces turns into a fruit pickup.

### 2.6 Bubbles (`Components/CaptureBubble.cpp`)
* Dynamic body, gravity 0, box 1.5x1.5, restitution 0.8. Each fixed step: random jitter force ±20, drag, after 1 s float up while y < 3, plus attraction toward the centroid of all bubbles (clustering at the top).
* Hitting an `IBubbleable` -> capture (enemy object deactivated, enemy's `*_bubble` animation shown in the bubble).
* Pop: when (relative speed + float time) >= 15 on any contact after 1 s (players popping by touching/jumping), or automatically after **8 s** — then the captured enemy escapes (angry).
* Popping with an enemy inside -> `KillCapturedTarget` -> dead-enemy prefab.
* No chain popping, no combo multipliers, no bubble colour stages, players can stand on bubbles.

### 2.7 Pickups, items, boulders, score
* `PickupType` only {Fries, Watermelon}: ZenChan -> Watermelon (100 pts, `Items` cell (19,0)), Maita -> Fries (200 pts, cell (25,0)). Pickups fall at a fixed -9 u/s, despawn after 10 s, collected in the player's PreSolve.
* `Items.png` = 576x64 = 36 x 4 cells of 16 px = **144 item sprites** (fruit, candy, rings, shoes, umbrellas, potions, crosses, books, chests...). Only 2 are used.
* Boulder (Maita projectile): dynamic, restitution 0.9, damages `IDamageable` on contact, self-destroys after 3 s.
* **Score**: `GameScore` (owned by Game) only adds pickup values; nothing for popping bubbles/enemies. `-1` sentinel = "player did not play". HUD counts visually at 400 pts/s. Floating score text spawns on pickup.
* `Player::m_Score` exists but is unused.

### 2.8 High scores (`Scores/Scores.txt`)
* Path is **cwd-relative** `./Scores/Scores.txt` (not under Assets, not symlinked by CMake). Format per line: `score round NAME` (space separated; lines that don't parse are skipped; names may not contain digits). The repo copy contains junk/test lines.
* If the file does not exist it is created empty — and `ParseScores` then **throws "File Empty"** => opening the LEADERBOARD on a fresh install (or running from the build dir) crashes the game, unless a game was finished first (WriteScore appends a line before reading).
* Web: reading/writing disabled (`#ifdef __EMSCRIPTEN__ return {}`), so no leaderboard persistence on web.

### 2.9 HUD
* `PlayerHUD`: score top (P1 left/right-aligned at x=-4, P2 at x=4, colours green/blue), lives bottom corners in hex with a black tile background. Hidden during transitions and the intro.
* `LevelHUD`: two-digit round number top centre.
* `FpsCounter`, `AutoRotateAround` exist but unused.

### 2.10 Sound mapping (`src/GameEntry.cpp` + `Game::OnMessage`)
| `bb::Sounds` id | File | Trigger |
|---|---|---|
| 0 GameStart | `SFX/The Quest Begins.ogg` (1.6 MB, music) | once at app start (`Game::Initialize`), not looped, not replayed |
| 1 FireBubble | `SFX/Bubble Bobble SFX (2).wav` | `MessageType::PlayerAttack` |
| 2 Death | `SFX/Bubble Bobble SFX (3).wav` | `MessageType::PlayerDied` |
| 3 Jump | `SFX/Jump.wav` | `MessageType::PlayerJump` |
Unused: SFX (1), (4)-(8), (10)-(21) (no (9)); unlabelled rips 1.2-4.6 s long — would need listening to map to pop/fruit/extend/hurry-up/etc. No in-level BGM, no hurry-up music, no game-over jingle.

### 2.11 Assets inventory (useful for extension)
* `Enemys.png` 256x192 = 16 cols x 12 rows of 16 px. Per enemy row: normal(2) + angry(2) + bubble green/blue/pink (6) + dead(4). Rows visually: 0 Zen-Chan, 1 Maita, 2 boulder, 3 Monsta, 4 (Pulpul-like), 5 Banebou (spring), 6 Hidegons / Mighta-like, 7 fireball, 8 Invader-like, 9 another, 10 bottles (Drunk projectile), 11 Skel-Monsta / Baron von Blubba. Only rows 0-2 are wired up (and the bubble animation uses only the green pair).
* `Bubble.png` (320x32) and `AttackBubbleColored.png` (112x32) exist but are unused (likely colour-stage bubbles).
* `BubbleLarge.png`, `BubbleParticle.png`, `Logo.png`, `Julgen_Logo_BB_Retro.png`, `Dot*.png`, `DebugCube.png`, `NES_Font.ttf`.

---

## 3. Missing vs. arcade Bubble Bobble

| Feature | Status |
|---|---|
| 100 rounds (+ 100/101 boss/ending, secret rooms) | **3 levels**; tile art for 25 |
| Data-driven enemy placement | hard-coded C++ per level |
| Screen wrap (fall through bottom gaps -> top) | missing (floors are solid; ceiling row non-colliding) |
| Hurry Up! + Baron von Blubba / Skel-Monsta after time limit | missing (sprite exists) |
| Enemy anger after timeout | partial (only after escaping bubble, ZenChan only) |
| Enemy roster: Mighta (rock throw — Maita here is the NES name), Monsta, Pulpul, Banebou, Hidegons (fire), Invader, Drunk (bottles), Super Drunk boss | only Zen-Chan + Maita; sprites present for most |
| Bubble lifecycle: green -> blue -> pink -> pop, enemies escape at pink | single colour, 8 s timer |
| Chain-pop combos & multiplier scoring (1000/2000/4000/... per enemy in chain) | missing; no points for kills at all |
| Fruit tiers by chain count / position, 144 item types | 2 fixed items |
| Special bubbles: water (flood), fire (flame carpet), lightning, EXTEND letter bubbles | missing |
| EXTEND letters -> extra life & skip level | missing |
| Powerups (candies: bubble range/speed/rate, sneakers, umbrellas = skip levels, potions = fill screen bonus, crosses, rings, necklace, lamp, books, clock...) | missing |
| Bonus stages / secret rooms, end-of-level bonus (100k for all-in-one-pop etc.) | missing |
| Boss Super Drunk (round 100) | missing |
| Game over, continue, "insert coin", attract mode / demo | **no game over at all** |
| Extra lives by score (30k/100k...) | missing |
| In-game BGM, hurry music, SFX coverage | only 3 SFX + intro tune once |
| 2P co-op | yes (needs 1 pad) |
| Versus mode | non-arcade extra (human-controlled enemy) |
| High-score table w/ initials | yes (native only, crash bug when empty) |
| Hiscore/round display "ROUND xx", 1UP/2UP blinking, credits | minimal |
| Pause | none |

---

## 4. Code quality, size, extensibility

**Good:**
* Consistent modern C++20, clang-format/clang-tidy configs, builds warning-free at `-Werror` on GCC 16.
* Clean, small, readable components; Unity-like mental model (GameObject/Component, prefabs as free functions, tweens as timers).
* Characters decoupled from controllers (AI behaviour vs `CharacterInput` both drive `Character::OnMoveInput/OnJumpInput/OnAttackInput`) — easy to add new enemies and to keep VS mode.
* Interfaces `IBubbleable` / `IDamageable` make new capturable/damageable types straightforward.
* Web build path already exists.

**Weak / hacks:**
* Gameplay is built on Box2D dynamics (velocity overwrites every fixed step, manual gravity, PreSolve contact disabling, restitution, random forces). Hard to make arcade-exact, nondeterministic-feeling, and every new mechanic (water flow, fire, lightning travel, wrap-around, bubble riding) has to be fought through the physics engine.
* Levels/enemies not data-driven; level list is an enum + `std::array` + one function per level.
* Globals everywhere: singletons, static registries, global `MessageQueue` with `std::any` payloads (type-unsafe; wrong `any_cast` = exception at runtime).
* `GetComponent` via `dynamic_cast` scans; `HandleContact` O(bodies) per contact callback; every tile is a separate Box2D body; CPU sort of all renderers each frame. Fine at this scale, would matter at 100 levels with many objects only modestly.
* Rendering is SDL_Renderer only: no shaders, palettes, screen effects, render targets.
* Input: event-only, binds never released, keyboard can't be split between two local players without a pad.
* Old Box2D 2.3.2 (current is 3.x with a different C API).

**Bugs found:**
1. No game over (final-death event unhandled) — player stays dead forever (`src/Components/Health.cpp`, nobody subscribes to `GetOnFinalDeath`).
2. Leaderboard crash on empty/new `Scores.txt` (`ScoreScreen::ParseScores` throws "File Empty"); path is cwd-relative.
3. `m_TargetDirection.length()` (glm component count) instead of `glm::length()` in `ZenChanBehaviour.cpp:~77` and `MaitaBehaviour.cpp:77` -> "turn to face player" never runs.
4. Misleading nested `if` without braces in `HandleTurning` (both behaviours) — logic only blocks re-turn while walking.
5. `Locator::Get<T>()` dereferences `end()` if the service is missing; `MuteGameCommand` discards/re-creates SoLoud.
6. `ParseMaps` ignores surface format/pitch (works only for 32-bit RGBA PNG with pitch = width*4).
7. `Input::Bind` leak (bindings accumulate across scene loads).
8. Code uses `fmt::format` while including only `<fmt/core.h>`: breaks with fmt >= 11 (system fmt 12 on Arch).
9. `.gitignore` ignores `build/` but `build_web.sh` writes `Build/Web` (case) inside the repo.
10. Maita throws boulders regardless of where the player is; pickup `Pick()` may be called by multiple PreSolve callbacks in the same step before destruction (potential double score).
11. Web build has heavy debug link flags (`-s ASSERTIONS -s GL_DEBUG -s DEMANGLE_SUPPORT=1 -g -gsource-map -pthread`); `DEMANGLE_SUPPORT` is deprecated/removed in recent emsdk and may need deleting.

**Extension difficulty (rough):**
* New enemy type with simple AI using existing sprites: easy (~150-250 LOC each: body + behaviour + prefab + animations).
* More levels: easy for tiles (append 28 rows to `Levels.png`), tedious for enemies (C++ per level) — first refactor to data-driven (e.g. encode enemy spawns as extra pixel colours or a JSON/Tiled file) — medium.
* Game over, chain scoring, bubble colours, fruit tables, EXTEND, hurry-up/Baron, pause: medium, mostly game-layer code.
* Water/fire/lightning bubbles, wrap-around, faithful movement/jump arcs, Super Drunk boss: hard on top of Box2D; easier after replacing character physics with tile-based kinematic movement.

---

## 5. Build

### 5.1 Native Linux (Arch)
Required system packages (per `Julgen/cmake/Libraries.cmake`, non-Windows path uses `find_package`):
`cmake gcc|clang sdl2 (sdl2-compat ok) sdl2_image sdl2_ttf glm fmt` (+ git for submodules).
Present here: cmake 4.4.4, gcc 16.2.1, clang 23, `sdl2-compat 2.32.74`, `fmt 12.2.0`.
**Missing here: `glm`, `sdl2_image`, `sdl2_ttf`** (and `emscripten` for web).

Expected steps once deps are present:
```sh
git submodule update --init --recursive
cmake -S /home/marco/dev/BubbleBobble -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j16
cd build && ./BubbleBobble      # Assets is symlinked into build/; run from a dir that has Assets/ (or ../Assets/)
# for the leaderboard: also have ./Scores/Scores.txt with at least one valid line in the cwd
```
Caveat: with system **fmt 12** the game fails to compile (`'format' is not a member of 'fmt'` in Prefabs.cpp, Game.cpp, FpsCounter.cpp, MainMenu.cpp, ScoreScreen.cpp — they include only `<fmt/core.h>`). Fix options: add `#include <fmt/format.h>` in those files, or use fmt 10.x (what the Win/Web path pins).

**What I actually ran:**
1. Plain `cmake -S repo -B scratchpad/build-native` -> **configure fails**: `Could not find a package configuration file provided by "glm"`.
2. Scratch wrapper project (`scratchpad/wrapper/CMakeLists.txt`) that FetchContent's glm 1.0.1, SDL2_ttf 2.22.0 (vendored freetype), SDL2_image 2.8.2 with `OVERRIDE_FIND_PACKAGE`, then `add_subdirectory(repo)`:
   * needed `-DCMAKE_POLICY_VERSION_MINIMUM=3.5` (CMake 4 rejects SDL_ttf's vendored freetype `cmake_minimum_required < 3.5`);
   * then the engine (`libjulgen.a`), Box2D and SoLoud compiled fine, but the game failed with the fmt 12 errors above (21 errors);
   * adding fmt 10.2.1 via FetchContent -> **full build succeeds, 0 warnings** with `-Werror`.
3. Smoke test: `xvfb-run ./BubbleBobble` from a dir with an `Assets` symlink ran 8 s until the timeout with no crash (audio fell back silently; `SDL_VIDEODRIVER=dummy` fails because the window requires OpenGL).
   Binary: `scratchpad/build-native/bb/BubbleBobble` (links the fetched SDL2_ttf/SDL2_image .so from `_deps`).

So on a normal setup: `sudo pacman -S glm sdl2_image sdl2_ttf` + either patch the 5 includes or provide fmt 10 => builds.

### 5.2 Web (Emscripten)
* Not installed here (`emcc`/`emcmake` absent) => not tested. Arch: `emscripten` package or emsdk.
* `./build_web.sh` = `emcmake cmake -B Build/Web && cd Build/Web && emmake make -j$(nproc)` then optionally `emrun Build/Web/*.html`.
* Emscripten path: FetchContent glm 1.0.1 + fmt 10.2.1 (needs network at configure), SDL2/SDL2_image/SDL2_ttf from emscripten ports, SoLoud SDL2 backend, `--preload-file Assets@Assets`, `-sALLOW_MEMORY_GROWTH`, `--shell-file shell_minimal.html`, output `.html`.
* Expected friction: debug flags listed in bug 11; `-pthread` at compile time; no leaderboard on web; may need the same `CMAKE_POLICY_VERSION_MINIMUM` flag with CMake 4. Upstream has a working deployment at julianrijken.com/BubbleBobbleWeb.

---

## 6. Extend vs rewrite — recommendation

**Keep:** Julgen engine (loop, scenes, GameObject/Component, tweens, resources, SDL rendering, SoLoud audio, input, web build), the asset pack, menu/score-screen UI, prefab style, character/controller split.

**Replace/rewrite inside this codebase:**
1. Character & projectile movement: drop Box2D dynamics for players/enemies/bubbles/items in favour of a small tile-grid kinematic controller (AABB vs tile map, one-way platforms, wrap-around, fixed arcade jump arcs). Box2D can stay for nothing or for dead-enemy bounce only.
2. Data-driven levels: one file (JSON or Tiled `.tmx`, or extend `Levels.png` with enemy colour codes) -> tiles, tileset row, enemy list/types/positions/delays, special bubble spawns, wind/bubble-flow directions. Generic `LevelScene` instead of an enum entry per level.
3. Proper game-flow state machine: game over, continue, pause, hurry-up timer + Baron, extend, round bonuses.
4. Scoring system: chain pops, fruit tables, extra lives by score.
5. Audio: music channel (loop/stop/fade), full SFX mapping.

Estimated effort for a "rich" remake (100 data-driven rounds, ~9 enemy types, special bubbles, EXTEND, powerups, boss): the existing gameplay code that survives is maybe 30-40 % (UI, HUD, prefabs pattern, state machines); engine fixes are small. Compared with a full rewrite (e.g. Godot/raylib/plain SDL), extending saves the engine/web/asset pipeline work but keeps GPL-3, C++ build friction and an SDL_Renderer-only renderer.

* Choose **extend** if: C++ is fine, GPL is fine, NES look at 256x224 is the target, and web export matters.
* Choose **rewrite elsewhere** if: arcade-exact behaviour/deterministic physics, tooling (level editor), faster iteration, or a non-GPL license is the priority — a tile-based engine (Godot 4 with TileMap, or a small raylib/SDL3 C++ core) would make most missing arcade features simpler; the assets (Levels/Enemys/Items/LevelTiles/SFX) can be reused either way (check their provenance/licensing: they are NES rips).
