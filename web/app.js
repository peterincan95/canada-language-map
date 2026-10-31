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

// Language -> "#RRGGBB"; colors.json is the one place to change map and tooltip colours
let colors = resolvePalette(await loadPalette());

// Arcade for the symbol's colour: look the language up in colors, falling
// back to the layer's Hex field for anything colors.json doesn't list
function colorExpression() {
  const pairs = Object.entries(colors).flatMap(([lang, hex]) => [JSON.stringify(lang), JSON.stringify(hex)]);
  return `Decode($feature.${LANG_FIELD}, ${pairs.join(", ")}, "#" + $feature.${HEX_FIELD})`;
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

// Recolour a layer from colors, keeping the rest of the web map's styling
// (outlines, size and opacity visual variables)
function applyColors(layer) {
  if (!baseRenderers.has(layer)) baseRenderers.set(layer, layer.renderer);
  const base = baseRenderers.get(layer);

  // CIM symbol with an Arcade colour override: swap in colorExpression
  if (base?.symbol?.data?.primitiveOverrides?.some((o) => o.propertyName === "Color")) {
    const renderer = base.clone();
    renderer.symbol.data.primitiveOverrides.find((o) => o.propertyName === "Color").valueExpressionInfo.expression =
      colorExpression();
    layer.renderer = renderer;
  } else if (base?.symbol?.color) {
    layer.renderer = uniqueValueRenderer(base);
  } else {
    console.warn(`${layer.title}: unsupported symbol, colors.json not applied`);
  }
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
  colors = resolvePalette(data);
  hoverLayers.forEach(applyColors);
};

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
