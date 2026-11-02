import { loadPalette, resolvePalette, PALETTE_CHANNEL } from "./palette.js";

const LANG_FIELD = "PredomLang";
const HEX_FIELD = "Hex";
const PCT_FIELD = "PredomPct";

// 0.025 -> "2.5%"
const pctFormat = new Intl.NumberFormat(undefined, {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
// 1185 -> "1,185"
const countFormat = new Intl.NumberFormat();

// Every individual home language, in StatCan's order (from scripts/export_languages_json.py)
const LANGUAGES = await fetch("languages.json", { cache: "no-cache" }).then((r) => r.json());

// Languages whose layer field alias doesn't match the language name
// (StatCan's name has no final full stop, and the ArcGIS import named the field "e")
const LANGUAGE_FIELD_OVERRIDES = { "Austro-Asiatic languages, n.i.e": "e" };

// colors.json is the one place to change map and tooltip colours
let palette = await loadPalette();
// Language -> "#RRGGBB"
let colors = resolvePalette(palette);

// Which view the map shows: "predominant" (most common non-official language)
// or "composition" (English / French / non-official shares blended into one colour)
let currentView = "predominant";

// Arcade for the symbol's colour: look the language up in colors, falling
// back to the layer's Hex field for anything colors.json doesn't list
function colorExpression() {
  const pairs = Object.entries(colors).flatMap(([lang, hex]) => [JSON.stringify(lang), JSON.stringify(hex)]);
  return `Decode($feature.${LANG_FIELD}, ${pairs.join(", ")}, "#" + $feature.${HEX_FIELD})`;
}

// Count fields for each response type, keyed by the Arcade variable they're read into
const COUNT_FIELDS = {
  e: "English",
  f: "French",
  n: "Non_official_languages",
  ef: "English_and_French",
  en: "English_and_non_official_language_s_",
  fn: "French_and_non_official_language_s_",
  efn: "English__French_and_non_official_language_s_",
  nn: "Multiple_non_official_languages",
};
const NO_DATA_COLOR = "#BFBFBF";

// The three composition categories: key in colors.json "composition", tooltip
// label, and how much of each response type counts towards it (multiple
// responses split evenly between the categories they name). The map's Arcade
// and the tooltip both work from this table, so they always agree.
const CATEGORIES = [
  { key: "English", label: "English", split: { e: 1, ef: 1 / 2, en: 1 / 2, efn: 1 / 3 } },
  { key: "French", label: "French", split: { f: 1, ef: 1 / 2, fn: 1 / 2, efn: 1 / 3 } },
  { key: "Non-official languages", label: "Other", split: { n: 1, en: 1 / 2, fn: 1 / 2, efn: 1 / 3, nn: 1 } },
];

// Share of each category (summing to 1) for a feature's attributes, or null if it has no data
function compositionShares(attributes) {
  const counts = CATEGORIES.map(({ split }) =>
    Object.entries(split).reduce((sum, [v, weight]) => sum + (attributes[COUNT_FIELDS[v]] ?? 0) * weight, 0),
  );
  const total = counts.reduce((a, b) => a + b, 0);
  return total > 0 ? counts.map((c) => c / total) : null;
}

// Colour space the composition view blends in: "oklab" (perceptual, so mixes
// stay bright and look evenly spaced) or "rgb" (plain weighted average of RGB values)
const BLEND_SPACE = "oklab";

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// "#RRGGBB" -> [L, a, b] in OKLab (Björn Ottosson's matrices, via linear sRGB)
function hexToOklab(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// [r, g, b] (any numbers) -> "#RRGGBB", rounded and clamped to 0-255
const rgbToHex = (rgb) =>
  "#" +
  rgb
    .map((c) => Math.min(Math.max(Math.round(c), 0), 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

// [L, a, b] in OKLab -> "#RRGGBB" (inverse of hexToOklab)
function oklabToHex([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgbToHex(
    linear.map((c) => {
      const v = Math.min(Math.max(c, 0), 1);
      return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
    }),
  );
}

// Colour for a set of category shares (summing to 1), blended exactly as the
// map's Arcade does it; used for the triangle legend
function blendComposition(shares) {
  const toSpace = BLEND_SPACE === "oklab" ? hexToOklab : hexToRgb;
  const values = CATEGORIES.map(({ key }) => toSpace(palette.composition[key]));
  const mixed = [0, 1, 2].map((i) => shares.reduce((sum, share, j) => sum + share * values[j][i], 0));
  return BLEND_SPACE === "oklab" ? oklabToHex(mixed) : rgbToHex(mixed);
}

// Arcade for the composition view: compute each category's share as in
// compositionShares, then blend the category colours by share in BLEND_SPACE.
// The category colours are constants, so their RGB/OKLab values are worked out
// here and written into the expression; Arcade only does the per-feature part.
function compositionExpression() {
  const reads = Object.entries(COUNT_FIELDS).map(([v, field]) => `var ${v} = DefaultValue($feature.${field}, 0);`);
  const sums = CATEGORIES.map(({ split }) =>
    Object.entries(split)
      .map(([v, weight]) => `${v} * ${weight}`)
      .join(" + "),
  );
  const toSpace = BLEND_SPACE === "oklab" ? hexToOklab : hexToRgb;
  const values = CATEGORIES.map(({ key }) => toSpace(palette.composition[key]));
  // Share-weighted average of component i across the three category colours
  const mix = (i) => `(shares[0] * ${values[0][i]} + shares[1] * ${values[1][i]} + shares[2] * ${values[2][i]}) / total`;

  const blend =
    BLEND_SPACE === "oklab"
      ? `// Average in OKLab, then convert back: OKLab -> LMS -> linear sRGB -> sRGB
var okL = ${mix(0)};
var okA = ${mix(1)};
var okB = ${mix(2)};
var l_ = okL + 0.3963377774 * okA + 0.2158037573 * okB;
var m_ = okL - 0.1055613458 * okA - 0.0638541728 * okB;
var s_ = okL - 0.0894841775 * okA - 1.291485548 * okB;
var l = l_ * l_ * l_;
var m = m_ * m_ * m_;
var s = s_ * s_ * s_;
// Linear sRGB channel (0-1) -> gamma-encoded hex pair
function encode(c) {
  var v = Min(Max(c, 0), 1);
  return hex2(255 * IIf(v <= 0.0031308, 12.92 * v, 1.055 * Pow(v, 1 / 2.4) - 0.055));
}
return "#" +
  encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) +
  encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) +
  encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);`
      : `return "#" + hex2(${mix(0)}) + hex2(${mix(1)}) + hex2(${mix(2)});`;

  return `${reads.join("\n")}
var shares = [${sums.join(", ")}];
var total = shares[0] + shares[1] + shares[2];
if (total <= 0) { return "${NO_DATA_COLOR}"; }
var digits = "0123456789ABCDEF";
// 0-255 -> two hex digits
function hex2(v) {
  var c = Min(Max(Round(v), 0), 255);
  return Mid(digits, Floor(c / 16), 1) + Mid(digits, c % 16, 1);
}
${blend}`;
}

const mapEl = document.querySelector("arcgis-map");
const anchor = document.getElementById("tooltip-anchor");
const tooltip = document.getElementById("hover-tooltip");
const swatch = document.getElementById("tooltip-swatch");
const label = document.getElementById("tooltip-label");
const pct = document.getElementById("tooltip-pct");
const predominantContent = document.getElementById("tooltip-predominant");
const predominantGeoName = document.getElementById("tooltip-predominant-geo");
const compositionContent = document.getElementById("tooltip-composition");
const geoName = document.getElementById("tooltip-geo");
const bar = document.getElementById("composition-bar");
const barValues = document.getElementById("composition-values");

// Geography name fields, by layer; the composition tooltip shows whichever a feature has
const NAME_FIELDS = ["PRNAME", "CDNAME", "CTNAME", "CMANAME"];

// Credit shown in the map's attribution line for every data layer
const DATA_CREDIT = "Stats Canada, 2021 Canadian Census";

// Web map layers that only belong in the predominant view (TractOutline also carries the tract labels)
const PREDOMINANT_ONLY_LAYERS = ["TractOutline"];

// Feature layers in the web map that carry both tooltip fields
const hoverLayers = [];

async function registerLayer(layer) {
  if (layer.type !== "feature") return;
  await layer.load();
  const names = layer.fields.map((f) => f.name);
  if (!names.includes(LANG_FIELD) || !names.includes(HEX_FIELD)) return;
  // hitTest only returns attributes the layer has fetched
  const wanted = [LANG_FIELD, HEX_FIELD, PCT_FIELD, ...NAME_FIELDS, ...Object.values(COUNT_FIELDS)];
  layer.outFields = [...new Set([...(layer.outFields ?? []), ...wanted.filter((f) => names.includes(f))])];
  layer.copyright = DATA_CREDIT;
  hoverLayers.push(layer);
  applyColors(layer);
}

// The web map's own renderer for each layer; colours are always rebuilt from it
const baseRenderers = new Map();

const hasColorOverride = (symbol) => symbol?.data?.primitiveOverrides?.some((o) => o.propertyName === "Color");

// Copy of a CIM renderer with its Arcade colour override swapped for expression
function withColorExpression(base, expression) {
  const renderer = base.clone();
  renderer.symbol.data.primitiveOverrides.find((o) => o.propertyName === "Color").valueExpressionInfo.expression =
    expression;
  return renderer;
}

// Recolour a layer for the current view, keeping the rest of the web map's
// styling (outlines, size visual variables, and opacity in the predominant view)
function applyColors(layer) {
  // Keep a copy: the layer discards its old renderer (and its visual variables)
  // when a new one is assigned
  if (!baseRenderers.has(layer)) baseRenderers.set(layer, layer.renderer.clone());
  const base = baseRenderers.get(layer);

  if (currentView === "composition") {
    applyComposition(layer, base);
  } else if (hasColorOverride(base?.symbol)) {
    layer.renderer = withColorExpression(base, colorExpression());
  } else if (base?.symbol?.color) {
    layer.renderer = uniqueValueRenderer(base);
  } else {
    console.warn(`${layer.title}: unsupported symbol, colors.json not applied`);
  }
}

// Composition view: blended colour at full opacity (opacity visual variables dropped)
function applyComposition(layer, base) {
  const visualVariables = base.visualVariables?.filter((v) => v.type !== "opacity").map((v) => v.clone());
  if (hasColorOverride(base?.symbol)) {
    const renderer = withColorExpression(base, compositionExpression());
    renderer.visualVariables = visualVariables;
    layer.renderer = renderer;
  } else if (base?.symbol?.type === "simple-marker" && base.symbol.color.a === 0) {
    layer.renderer = base.clone(); // invisible markers (e.g. a labels-only layer) stay invisible
  } else if (base?.symbol?.type === "simple-marker") {
    layer.renderer = { type: "simple", symbol: cimCircle(base.symbol, compositionExpression()), visualVariables };
  } else {
    console.warn(`${layer.title}: unsupported symbol, composition view not applied`);
  }
}

// A CIM circle matching the web map's simple marker (size and outline), so its
// fill can take an Arcade colour like the polygon layers' CIM symbols
function cimCircle(marker, expression) {
  const ring = Array.from({ length: 37 }, (_, i) => {
    const angle = (i / 36) * 2 * Math.PI;
    return [Math.cos(angle), Math.sin(angle)];
  });
  const outline = marker.outline;
  const cimColor = (c) => [c.r, c.g, c.b, Math.round(c.a * 255)];
  return {
    type: "cim",
    data: {
      type: "CIMSymbolReference",
      primitiveOverrides: [
        {
          type: "CIMPrimitiveOverride",
          primitiveName: "fill",
          propertyName: "Color",
          valueExpressionInfo: { type: "CIMExpressionInfo", expression, returnType: "Default" },
        },
      ],
      symbol: {
        type: "CIMPointSymbol",
        symbolLayers: [
          {
            type: "CIMVectorMarker",
            enable: true,
            size: marker.size,
            anchorPointUnits: "Relative",
            frame: { xmin: -1, ymin: -1, xmax: 1, ymax: 1 },
            markerGraphics: [
              {
                type: "CIMMarkerGraphic",
                geometry: { rings: [ring] },
                symbol: {
                  type: "CIMPolygonSymbol",
                  // First layer draws on top: outline over fill
                  symbolLayers: [
                    ...(outline
                      ? [{ type: "CIMSolidStroke", enable: true, width: outline.width, color: cimColor(outline.color) }]
                      : []),
                    { type: "CIMSolidFill", enable: true, primitiveName: "fill", color: [191, 191, 191, 255] },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  };
}

// Simple symbols can't take an Arcade colour, so give each language its own
// copy of the web map's symbol in that language's colour, keeping the symbol's
// transparency; languages colors.json doesn't list keep the original symbol
function uniqueValueRenderer(base) {
  const alpha = base.symbol.color.a;
  return {
    type: "unique-value",
    field: LANG_FIELD,
    defaultSymbol: base.symbol.clone(),
    uniqueValueInfos: Object.entries(colors).map(([lang, hex]) => {
      const symbol = base.symbol.clone();
      const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      symbol.color = [...rgb, alpha];
      return { value: lang, symbol };
    }),
    visualVariables: base.visualVariables?.map((v) => v.clone()),
  };
}

// Live preview of unsaved edits from editor.html
new BroadcastChannel(PALETTE_CHANNEL).onmessage = ({ data }) => {
  palette = data;
  colors = resolvePalette(data);
  hoverLayers.forEach(applyColors);
  showInfo();
};

document.getElementById("view-switch").addEventListener("calciteSegmentedControlChange", (event) => {
  currentView = event.target.value;
  hoverLayers.forEach(applyColors);
  mapEl.view?.map.allLayers
    .filter((layer) => PREDOMINANT_ONLY_LAYERS.includes(layer.title))
    .forEach((layer) => (layer.visible = currentView === "predominant"));
  hideTooltip();
  showInfo();
});

// ---- Left column: details of the clicked geography ---------------------------

const infoEmpty = document.getElementById("info-empty");
const infoPredominant = document.getElementById("info-predominant");
const infoComposition = document.getElementById("info-composition");
const compositionTitle = document.getElementById("info-composition-title");
const compositionProse = document.getElementById("info-composition-prose");
const legend = document.getElementById("composition-legend");
const predominantTitle = document.getElementById("info-predominant-title");
const predominantProse = document.getElementById("info-predominant-prose");
const languageTable = document.getElementById("language-table");

const TOTAL_FIELD = "Total___Language_spoken_most_often_at_home";

// Left out of the language table, which is about non-official languages
const OFFICIAL_LANGUAGES = ["English", "French"];

// The geography the user last clicked, as { layer, attributes } with every field, or null
let selected = null;

// Show the info for the current view, or the placeholder when nothing is selected
function showInfo() {
  infoEmpty.hidden = !!selected;
  infoPredominant.hidden = !selected || currentView !== "predominant";
  infoComposition.hidden = !selected || currentView !== "composition";
  if (selected && currentView === "predominant") renderPredominantInfo(selected);
  if (selected && currentView === "composition") renderCompositionInfo(selected);
}

// Language name -> field name on a layer, found through the field aliases
const languageFieldsByLayer = new Map();
function languageFields(layer) {
  if (!languageFieldsByLayer.has(layer)) {
    const byAlias = new Map(layer.fields.map((f) => [f.alias, f.name]));
    const fields = new Map();
    for (const language of LANGUAGES) {
      const field = LANGUAGE_FIELD_OVERRIDES[language] ?? byAlias.get(language);
      if (field) fields.set(language, field);
    }
    languageFieldsByLayer.set(layer, fields);
  }
  return languageFieldsByLayer.get(layer);
}

function paragraph(...content) {
  const p = document.createElement("p");
  p.append(...content);
  return p;
}

function tableCell(text, alignment = "start") {
  const cell = document.createElement("calcite-table-cell");
  cell.alignment = alignment;
  cell.textContent = text;
  return cell;
}

// Most common other language view: name, prose about non-official languages,
// and a table of the non-official languages spoken in the area, most speakers first
function renderPredominantInfo({ layer, attributes }) {
  predominantTitle.textContent = geographyName(attributes);

  const total = attributes[TOTAL_FIELD];
  const nonOfficial = attributes.Non_official_languages;
  const language = attributes[LANG_FIELD];
  const share = attributes[PCT_FIELD];
  const prose = [];
  if (!total) {
    prose.push(paragraph("No data is available for this area."));
  } else {
    prose.push(
      paragraph(
        `About ${countFormat.format(nonOfficial ?? 0)} people in this area speak a language other than English or French at home.`,
      ),
    );
    if (language) {
      const name = document.createElement("span");
      name.className = "predominant-language";
      name.style.color = colorFor(attributes) ?? "";
      name.textContent = language;
      const shareText = typeof share === "number" ? pctFormat.format(share) : "an unknown share";
      prose.push(
        paragraph(
          "The predominant non-official language spoken in this area is ",
          name,
          `, spoken at home by about ${shareText} of residents.`,
        ),
      );
    }
  }
  predominantProse.replaceChildren(...prose);

  const rows = [...languageFields(layer)]
    .filter(([name]) => !OFFICIAL_LANGUAGES.includes(name))
    .map(([name, field]) => [name, attributes[field] ?? 0])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => {
      const row = document.createElement("calcite-table-row");
      row.append(
        tableCell(name),
        tableCell(countFormat.format(count), "end"),
        tableCell(total ? pctFormat.format(count / total) : "", "end"),
      );
      return row;
    });
  languageTable.querySelectorAll("calcite-table-row:not([slot])").forEach((row) => row.remove());
  languageTable.append(...rows);
  languageTable.hidden = !rows.length;
}

// A category name in its composition colour, e.g. "English" in red
function categoryWord(key, text) {
  const word = document.createElement("span");
  word.className = "category-word";
  word.style.color = palette.composition[key];
  word.textContent = text;
  return word;
}

// English / French / Other view: name, colour-coded counts, and the triangle legend
function renderCompositionInfo({ attributes }) {
  compositionTitle.textContent = geographyName(attributes);

  const shares = compositionShares(attributes);
  if (!shares) {
    compositionProse.replaceChildren(paragraph("No data is available for this area."));
  } else {
    const count = (field) => countFormat.format(attributes[field] ?? 0);
    compositionProse.replaceChildren(
      paragraph(
        `${count("English")} people in this area speak `,
        categoryWord("English", "English"),
        ` at home, ${count("French")} speak `,
        categoryWord("French", "French"),
        `, and ${count("Non_official_languages")} speak a `,
        categoryWord("Non-official languages", "Non-Official Language"),
        ".",
      ),
    );
  }
  drawLegend(shares);
}

// ---- Triangle legend ---------------------------------------------------------
// An equilateral triangle with one category at each corner (English bottom left,
// French bottom right, non-official top). Every point inside is a mix of the
// three; it's filled with small triangles coloured by the same blend as the map,
// and the selected geography is marked where its shares put it.

const SVG_NS = "http://www.w3.org/2000/svg";
const LEGEND_STEPS = 20; // small triangles per side
const LEGEND_SIDE = 240;
const LEGEND_HEIGHT = (LEGEND_SIDE * Math.sqrt(3)) / 2;
// Corner positions in the SVG's 300 x 262 viewBox, in CATEGORIES order
const LEGEND_CORNERS = [
  [30, 22 + LEGEND_HEIGHT], // English
  [270, 22 + LEGEND_HEIGHT], // French
  [150, 22], // Non-official languages
];

// Shares [English, French, Other] -> point in the triangle
function legendPoint(shares) {
  return [0, 1].map((axis) => shares.reduce((sum, share, i) => sum + share * LEGEND_CORNERS[i][axis], 0));
}

function svgElement(tag, attributes) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function drawLegend(shares) {
  const n = LEGEND_STEPS;
  const parts = [];
  // Grid point i steps from the top corner towards the base, j steps along that row;
  // its shares are English (i - j) / n, French j / n, Other (n - i) / n
  const shareAt = (i, j) => [(i - j) / n, j / n, (n - i) / n];
  const cell = (points) => {
    const centre = [0, 1, 2].map((c) => points.reduce((sum, p) => sum + p[c], 0) / 3);
    const color = blendComposition(centre);
    const coordinates = points.map((p) => legendPoint(p).map((v) => v.toFixed(2)).join(",")).join(" ");
    // Stroke in the same colour hides hairline gaps between neighbouring cells
    parts.push(svgElement("polygon", { points: coordinates, fill: color, stroke: color, "stroke-width": 0.6 }));
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      cell([shareAt(i, j), shareAt(i + 1, j), shareAt(i + 1, j + 1)]); // pointing up
      if (j < i) cell([shareAt(i, j), shareAt(i, j + 1), shareAt(i + 1, j + 1)]); // pointing down
    }
  }

  // Corner labels in their category colours
  const labels = [
    { text: "English", x: 30, y: 22 + LEGEND_HEIGHT + 18, anchor: "start" },
    { text: "French", x: 270, y: 22 + LEGEND_HEIGHT + 18, anchor: "end" },
    { text: "Other", x: 150, y: 14, anchor: "middle" },
  ];
  labels.forEach(({ text, x, y, anchor }, i) => {
    const label = svgElement("text", { x, y, "text-anchor": anchor, fill: palette.composition[CATEGORIES[i].key] });
    label.textContent = text;
    parts.push(label);
  });

  // The selected geography: its own blend colour, ringed so it stands out
  // (ring colours are in style.css)
  if (shares) {
    const [x, y] = legendPoint(shares);
    parts.push(svgElement("circle", { cx: x, cy: y, r: 7, class: "legend-marker-ring" }));
    parts.push(svgElement("circle", { cx: x, cy: y, r: 5, fill: blendComposition(shares), class: "legend-marker" }));
  }
  legend.replaceChildren(...parts);
}

function colorFor(attributes) {
  const hex = String(attributes[HEX_FIELD] ?? "").trim();
  return colors[attributes[LANG_FIELD]] ?? (/^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : null);
}

function hideTooltip() {
  tooltip.open = false;
}

function fillPredominantTooltip(attributes) {
  predominantGeoName.textContent = geographyName(attributes);
  const color = colorFor(attributes);
  swatch.hidden = !color;
  if (color) swatch.color = color;
  label.textContent = attributes[LANG_FIELD] ?? "No data";
  const share = attributes[PCT_FIELD];
  pct.hidden = typeof share !== "number";
  if (!pct.hidden) pct.textContent = pctFormat.format(share);
}

// Tracts are only numbered, so they're shown with their metro area: "Toronto (0286.00)"
function geographyName(attributes) {
  const { CTNAME: tract, CMANAME: metro } = attributes;
  if (tract) return metro ? `${metro} (${tract})` : tract;
  const nameField = NAME_FIELDS.find((field) => attributes[field]);
  return nameField ? attributes[nameField] : "";
}

// Geography name, a stacked bar of the English / French / Other split, and the shares beneath it
function fillCompositionTooltip(attributes) {
  geoName.textContent = geographyName(attributes);
  const shares = compositionShares(attributes);
  bar.hidden = !shares;
  barValues.replaceChildren();
  if (!shares) {
    barValues.textContent = "No data";
    return;
  }
  CATEGORIES.forEach(({ key, label: categoryLabel }, i) => {
    const color = palette.composition[key];
    const segment = bar.children[i];
    segment.style.width = `${shares[i] * 100}%`;
    segment.style.background = color;
    const value = document.createElement("div");
    value.className = "composition-value";
    value.style.setProperty("--category-color", color);
    const name = document.createElement("span");
    name.className = "composition-label";
    name.textContent = categoryLabel;
    value.append(name, pctFormat.format(shares[i]));
    barValues.append(value);
  });
}

function showTooltip(view, screenPoint, attributes) {
  const composition = currentView === "composition";
  predominantContent.hidden = composition;
  compositionContent.hidden = !composition;
  if (composition) fillCompositionTooltip(attributes);
  else fillPredominantTooltip(attributes);

  const rect = view.container.getBoundingClientRect();
  anchor.style.left = `${rect.left + screenPoint.x}px`;
  anchor.style.top = `${rect.top + screenPoint.y}px`;
  tooltip.open = true;
  tooltip.reposition();
}

// The panel floats over the map, so pad the view by the panel's width (plus
// the same gap on its far side): the map's centre, zoom-to and widgets then
// work within the visible part of the map rather than under the panel
function padViewForPanel(view) {
  const panel = document.getElementById("side-panel");
  const update = () => {
    const rect = panel.getBoundingClientRect();
    view.padding = { ...view.padding, left: Math.round(rect.right + rect.left) };
  };
  new ResizeObserver(update).observe(panel);
  update();
}

async function init() {
  const view = mapEl.view;
  padViewForPanel(view);
  await Promise.all(view.map.allLayers.toArray().map(registerLayer));

  // Ignore hit test results that come back after a newer pointer move
  let latestMove = 0;
  view.on("pointer-move", async (event) => {
    const move = ++latestMove;
    if (!hoverLayers.length) return;
    const { results } = await view.hitTest(event, { include: hoverLayers });
    if (move !== latestMove) return;
    const hit = results.find((r) => r.type === "graphic");
    if (hit) showTooltip(view, event, hit.graphic.attributes);
    else hideTooltip();
  });
  view.on("pointer-leave", () => {
    latestMove++;
    hideTooltip();
  });

  // Clicking a geography selects it; clicking anywhere else clears the selection.
  // The left column replaces the web map's own pop-ups, so those are switched off.
  view.popupEnabled = false;
  let latestClick = 0;
  view.on("click", async (event) => {
    const click = ++latestClick;
    const { results } = await view.hitTest(event, { include: hoverLayers });
    const graphic = results.find((r) => r.type === "graphic")?.graphic;
    let clicked = null;
    if (graphic) {
      // hitTest only carries the tooltip fields; the details need every language count
      const { features } = await graphic.layer.queryFeatures({
        objectIds: [graphic.getObjectId()],
        outFields: ["*"],
        returnGeometry: false,
      });
      if (features.length) clicked = { layer: graphic.layer, attributes: features[0].attributes };
    }
    if (click !== latestClick) return; // a newer click has taken over
    selected = clicked;
    showInfo();
  });
}

await mapEl.viewOnReady();
init();
