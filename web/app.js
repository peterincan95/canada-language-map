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

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Arcade for the composition view: split each multiple response evenly between
// the categories it names, then blend the three category colours by share
// (a weighted average of their RGB values)
function compositionExpression() {
  const { English, French, "Non-official languages": other } = palette.composition;
  const [english, french, nonOfficial] = [English, French, other].map(hexToRgb);
  const channel = (i) => `channel(${english[i]}, ${french[i]}, ${nonOfficial[i]})`;
  const reads = Object.entries(COUNT_FIELDS).map(([v, field]) => `var ${v} = DefaultValue($feature.${field}, 0);`);
  return `${reads.join("\n")}
var shares = [e + ef / 2 + en / 2 + efn / 3, f + ef / 2 + fn / 2 + efn / 3, n + en / 2 + fn / 2 + efn / 3 + nn];
var total = shares[0] + shares[1] + shares[2];
if (total <= 0) { return "${NO_DATA_COLOR}"; }
var digits = "0123456789ABCDEF";
function channel(english, french, other) {
  var v = Round((shares[0] * english + shares[1] * french + shares[2] * other) / total);
  return Mid(digits, Floor(v / 16), 1) + Mid(digits, v % 16, 1);
}
return "#" + ${channel(0)} + ${channel(1)} + ${channel(2)};`;
}

const mapEl = document.querySelector("arcgis-map");
const anchor = document.getElementById("tooltip-anchor");
const tooltip = document.getElementById("hover-tooltip");
const swatch = document.getElementById("tooltip-swatch");
const label = document.getElementById("tooltip-label");
const pct = document.getElementById("tooltip-pct");

// Feature layers in the web map that carry both tooltip fields
const hoverLayers = [];

async function registerLayer(layer) {
  if (layer.type !== "feature") return;
  await layer.load();
  const names = layer.fields.map((f) => f.name);
  if (!names.includes(LANG_FIELD) || !names.includes(HEX_FIELD)) return;
  // hitTest only returns attributes the layer has fetched
  const extra = names.includes(PCT_FIELD) ? [PCT_FIELD] : [];
  layer.outFields = [...new Set([...(layer.outFields ?? []), LANG_FIELD, HEX_FIELD, ...extra])];
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
};

document.getElementById("view-switch").addEventListener("calciteSegmentedControlChange", (event) => {
  currentView = event.target.value;
  hoverLayers.forEach(applyColors);
});

function colorFor(attributes) {
  const hex = String(attributes[HEX_FIELD] ?? "").trim();
  return colors[attributes[LANG_FIELD]] ?? (/^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : null);
}

function hideTooltip() {
  tooltip.open = false;
}

function showTooltip(view, screenPoint, attributes) {
  const color = colorFor(attributes);
  swatch.hidden = !color;
  if (color) swatch.color = color;
  label.textContent = attributes[LANG_FIELD] ?? "No data";
  const share = attributes[PCT_FIELD];
  pct.hidden = typeof share !== "number";
  if (!pct.hidden) pct.textContent = pctFormat.format(share);

  const rect = view.container.getBoundingClientRect();
  anchor.style.left = `${rect.left + screenPoint.x}px`;
  anchor.style.top = `${rect.top + screenPoint.y}px`;
  tooltip.open = true;
  tooltip.reposition();
}

async function init() {
  const view = mapEl.view;
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
}

await mapEl.viewOnReady();
init();
