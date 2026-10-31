# Canada Language Map

An interactive web map of the language most often spoken at home across Canada,
from the 2021 Census. Each geography is coloured by its most common
non-official language (English and French excluded), with a hover tooltip
showing the language and its share of the population.

**Live site:** <https://peterincan95.github.io/canada-language-map/>

## Branches and releases

- `dev` is the default branch. Feature branches start from `dev` and merge back
  into it by pull request.
- `main` is production. Every push to `main` deploys `web/` to GitHub Pages
  (see `.github/workflows/deploy-pages.yml`); the colour editor is left out.
- To release, open a pull request from `dev` into `main` and merge it.

## Run it locally

From the repo root:

```bash
python -I scripts/dev_server.py 8081
```

- Map app: <http://localhost:8081>
- Colour editor: <http://localhost:8081/editor.html>

The app needs a local server (opening `index.html` directly won't work), and the
editor's **Save** button needs `dev_server.py` specifically.

## Layout

| Path | What it is |
|---|---|
| `web/` | The app: `index.html`, `app.js`, `style.css`, plus the colour editor (`editor.*`) |
| `web/colors.json` | Language colours: one per family, with optional per-language overrides |
| `web/palette.js` | Loads and resolves `colors.json`; shared by the app and the editor |
| `scripts/dev_server.py` | Local server; also lets the editor save `colors.json` |
| `scripts/pivot_home_language.py` | Pivots the raw StatCan tables to one row per geography, one column per language |
| `scripts/flatten_language_hierarchy.py` | Builds the `*_languages_hierarchy.csv` tables (one column per hierarchy depth) |
| `scripts/predominant_language_fieldcalc.py` | ArcGIS Pro Field Calculator code block for `PredomLang` / `PredomCnt` |
| `data/processed/` | Outputs of the scripts above |

## Colours

Edit colours in the colour editor rather than by hand. A language uses its own
colour if it has one, otherwise its family's. Edits preview live in any open app
tab; **Save** writes `web/colors.json`.

The map layers themselves live in ArcGIS Online (web map item
`58b237790eba453bb35c7cd2c407bc18`). The app recolours them from `colors.json`
when it loads, so the `Hex` field in the layers is only a fallback.

## Data

Statistics Canada, 2021 Census of Population:

- [98-10-0193-01](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=9810019301): Canada, provinces and territories, census divisions, census subdivisions
- [98-10-0194-01](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=9810019401): census metropolitan areas, census agglomerations, census tracts

The raw downloads (~1.8 GB) aren't in the repo. To rebuild `data/processed/`:

```bash
curl -L -o data/raw/98100193-eng.zip https://www150.statcan.gc.ca/n1/tbl/csv/98100193-eng.zip
curl -L -o data/raw/98100194-eng.zip https://www150.statcan.gc.ca/n1/tbl/csv/98100194-eng.zip
python -I scripts/pivot_home_language.py data/raw/98100193-eng.zip data/processed
python -I scripts/pivot_home_language.py data/raw/98100194-eng.zip data/processed
python -I scripts/flatten_language_hierarchy.py data/processed/98100193_languages.csv
python -I scripts/flatten_language_hierarchy.py data/processed/98100194_languages.csv
```
