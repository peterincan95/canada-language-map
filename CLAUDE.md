# CLAUDE.md

Notes for Claude sessions in this repo. README.md covers what the project is,
the file layout and how to rebuild the data; this file covers how to work on it.

## Running and checking changes

- Start the server with the `canada-language-map` entry in `.claude/launch.json`
  (`python -I scripts/dev_server.py 8081`). If 8081 is taken, the user's own
  server is probably already running; use it rather than starting another.
- App at `/`, colour editor at `/editor.html`. The app must be served (ES modules);
  saving from the editor needs `dev_server.py`, not `python -m http.server`.
- `dev_server.py` sends `Cache-Control: no-cache`, so a normal reload picks up edits.
- There is no test suite. Check changes in the browser pane: hover a polygon and
  confirm the tooltip, and read the console. The pane is often hidden; `goTo`
  animations can then hang, so set `view.center`/`view.zoom` directly instead.
- A `esri.views.2d.engine.webgl...meshWriterUtils` console error is known and
  comes from the MetroPoints layer's styling; it predates the app code.

## How the app works

- ArcGIS Maps SDK for JavaScript 4.34 (`<arcgis-map>` component) and Calcite
  3.3.2, both from the js.arcgis.com CDN. Keep the two versions paired.
- The web map lives in ArcGIS Online (item `58b237790eba453bb35c7cd2c407bc18`,
  public). Its layers (TractSimplified, CensusDivisionsSimplified, MetroPoints)
  carry `PredomLang`, `Hex` and `PredomPct`. Layer data and web map styling are
  changed in ArcGIS Online/Pro by the user, not from this repo.
- `app.js` picks up every feature layer that has `PredomLang` and `Hex`; nothing
  is keyed to layer names. For each it:
  - recolours from `colors.json`: layers with a CIM symbol get their Arcade
    colour override swapped for a `Decode()` lookup; layers with simple symbols
    get a unique-value renderer. Both are rebuilt from the web map's original
    renderer, keeping its visual variables (opacity, size). `Hex` is only a
    fallback for languages missing from `colors.json`.
  - drives the hover tooltip via `hitTest` (a `calcite-tooltip` anchored to an
    invisible element that follows the cursor).
- `colors.json` holds `families` (name to `#RRGGBB`) and `languages` (name to
  `{ family, color? }`). `palette.js` loads and resolves it for both pages.
- The editor posts unsaved palettes on the `language-palette` BroadcastChannel;
  open app tabs re-render live. Save is a `PUT /colors.json`, validated by
  `dev_server.py` and written atomically.

## Conventions

- Use Calcite components wherever possible.
- Keep `index.html` minimal: JavaScript goes in `app.js`, styling in `style.css`.
- Language names must match `PredomLang` exactly (accents and brackets included).
- `editor.*` and `dev_server.py` are local tools, not part of a deployed site.

## Data

- `data/raw/` (the 1.8 GB StatCan zips) is git-ignored and exists only in the
  user's main checkout, not in worktrees. The pivot script streams the CSVs out
  of the zips; never unzip them (8-11 GB each).
- StatCan values are randomly rounded to multiples of 5, and suppressed cells
  (`x`) are blank in the processed tables, so small mismatches in subtotals are
  expected and are not bugs.
- Run Python on downloaded data with `-I`.

## Git

- Work on a branch and open a PR; don't commit straight to `main`.
- Commit, push and open PRs only when the user asks.
