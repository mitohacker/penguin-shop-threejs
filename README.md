# Penguin Shop — Three.js rewrite

This is an independent browser game. The existing Godot projects are read only
references; this directory contains independent copies of the deployment assets.
There are no junctions, symbolic links, shared save files, or source-project edits.

## Play locally

Online test build: <https://mitohacker.github.io/penguin-shop-threejs/>
Source repository: <https://github.com/mitohacker/penguin-shop-threejs>

Use F3 to display rendering statistics. For low-end device testing, select Low
in Settings and compare the same camera position and window size. Online hosting
does not establish Chromebook performance; test this URL on the target hardware.
Saves are specific to the browser and origin, so the online test starts separately
from localhost.

Run `launch-penguin-threejs.cmd`, then open <http://127.0.0.1:5178>.
The launcher prefers the production build. A web server is required; opening
`index.html` directly as a file cannot load the game modules and models.

For development, run `pnpm install` followed by `pnpm dev` in this directory.
Dependencies are pinned in `package.json` and `pnpm-lock.yaml`.

## GitHub Pages deployment

`main` contains the standalone source and independent asset/reference copies.
GitHub Pages serves the production build from the root of the `gh-pages` branch.
The build uses relative paths and includes `.nojekyll` so assets work beneath
the repository URL. Changes to `main` must be rebuilt with `pnpm build` and the
contents of `dist` published to `gh-pages` before they appear online.

On a fresh checkout, install Node.js 22 or newer and pnpm, run
`pnpm install --frozen-lockfile`, then `pnpm build` and `pnpm test`. Building does
not require the original Godot project. The source-integrity test explicitly
skips its external-original check when that project is absent; the inventory,
independent assets, reference hashes, floor layouts and physics checks still run.

## Implemented game

- All 160 penguin designs, 10 collections, 100 shelf faces, 400 rows, and 4,000 items.
- Original shelf transforms and dimensions: 2.7 m bay pitch, 5.5 m bank pitch,
  central 2.4 m cross-aisle gap, two lines of five slots per row, and framed
  32 cm row pictures high on each back panel. Walking collision follows each bay.
- Choose-your-rows and assigned-row sorting, ten matching penguins per row.
- Carrying, bag selection/cycling, picking stocked penguins back up, rotating
  the carried model, dropping, and a complete-store win screen.
- Original CSV upgrade prices and effects: bag visibility/capacity, sprint,
  zoom, matching-floor lift and highlights, and shelf compass with cooldowns.
- One coin for the first stocking of each item; ten coins per completed row.
  Reward flags prevent repeated pickup/placement from generating extra coins.
- Overview orbit camera and first-person walking, keyboard/mouse and touch controls.
- Games open in first person at the original position and eye height. New games
  pour 500 penguins every 0.2 seconds onto an original cached floor arrangement,
  using the original gravity, stagger and 30-degree settling turn.
- Hand drops check the complete collision hull before release and fall with gravity;
  loose penguins cannot roll into empty shelf rows.
- Walk-mode clicks work when embedded browsers deny mouse capture; drag to look.
- Mouse-wheel bag cycling, R/Shift+R rotation, and ten-slot shelf ghost previews.
- Matching ability lifts the held design to shelf height; remaining items return on expiry.
  Saves retain original resting positions while the lift is active.
- Autosaves, manual saves, validated import/export, and recovery generation.
- Responsive menus, collection browser/search, graphics/audio settings, sound
  feedback, optional procedural background music, and performance overlay (F3).
- Standalone fullscreen; CrazyGames uses the platform's own fullscreen control.

The browser version uses its own save format and keys. Godot saves are not imported.
Starting piles use independent copies of the original game's 32 settled layouts;
only the chosen layout is fetched for a new game. The opening pour animates drawn
transforms while keeping the saved destination poses intact. Moving penguins use
Rapier. The marketing shot editor and offline mesh-authoring tools are not part
of this player-facing rewrite. The renderer recreates the shop rather than copying
Godot shaders, so lighting and decorative props can still differ. Shelf transforms,
slot positions and row cards are checked against copies of the original layout rules.

## Rendering and physics

Models use instancing per design, sharing geometry, materials, and 13 penguin
texture sheets. Copied penguin textures are capped at 1024 pixels; thumbnails at
160 pixels. Original artwork remains unchanged. Meshoptimizer generates separate
distant index buffers while retaining the original full geometry for nearby items
and the carried penguin. The generated `tools/mesh-optimization.json` records counts.

Shelf boards and department signs are merged. All 400 row pictures use one
instanced draw and one atlas. Shadows and expensive postprocessing are omitted;
Low/Balanced/High cap pixel ratio at 1/1.35/2 respectively.

Only moving penguins have dynamic Rapier bodies (maximum 96). Nearby settled
penguins temporarily become static supports. The physics step is fixed at 60 Hz
and catch-up is bounded. Picking a supporting penguin wakes its local stack;
sleeping bodies return to render-only transforms. Floorplan collision keeps
walking out of shelves and counters. Keyboard movement is time-based.

## Build and validation

`pnpm test` runs inventory, economy, completion, save corruption, asset-reference,
and original-source SHA256 checks. `pnpm build` generates the mesh LODs and the
standalone static build in `dist`. It also imports the 32 original floor layouts
from the independent reference copies in `tools/reference`.

`node tools/browser-check.mjs` uses the bundled Playwright installation on this
machine and installed Chrome. Set `PLAYWRIGHT_MODULE` to a different Playwright
module path if necessary. Set `GAME_URL` to the desired server URL; both development
and production previews are supported. Screenshots and the report are written
to `test-results`. Browser tests are functional checks, not a physical-device FPS
benchmark. Low-end Chromebooks and real mobile Safari still need device QA.

`tools/prepare_assets.py` recreates deployment assets using Pillow and the original
project at `C:\Dev\AIPrimitiveFun`. It only writes under this project's directory.
`tools/source-integrity.json` records the source hashes. Run the optimizer again
after preparing assets. `tools/package_build.py` packages and verifies the build.

## CrazyGames

The SDK v3 adapter activates on CrazyGames hosts, or with `?platform=crazygames`
for local SDK testing. It initializes before play, reports loading and gameplay
start/stop, and uses the SDK Data module for saves when enabled. On standalone
hosts it uses separate browser localStorage keys. An unavailable/disabled Data
module reports the save failure; it does not silently replace platform saves.

Select the Data Module progress-save option when submitting. No ads are requested
in this Basic Launch build. Gameplay events are emitted when the game is actually
playable, and stopped for menus, pause, backgrounding, and completion.

Upload the contents of `dist` to the developer portal (the ZIP has one
`PenguinShopThreeJS` folder). Preview the game there, test native fullscreen,
resizing, input, cloud saves, and SDK events before submitting. The local build
has not been published or reviewed by CrazyGames.

Requirements checked against:
- <https://docs.crazygames.com/requirements/technical/>
- <https://docs.crazygames.com/requirements/gameplay/>
- <https://docs.crazygames.com/sdk/intro/>
- <https://docs.crazygames.com/sdk/data/>

The desktop initial-download limit is 50 MB; mobile homepage eligibility requires
20 MB. This complete build targets desktop eligibility; it is not within the
20 MB mobile-homepage budget. Full Launch additionally depends on CrazyGames QA
and engagement results.
