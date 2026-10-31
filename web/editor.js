import { loadPalette, PALETTE_CHANNEL } from "./palette.js";

const palette = await loadPalette();
const channel = new BroadcastChannel(PALETTE_CHANNEL);

const familiesEl = document.getElementById("families");
const popover = document.getElementById("picker-popover");
const picker = document.getElementById("picker");
const saveButton = document.getElementById("save-button");
const alertEl = document.getElementById("save-alert");

// Each row registers a function that redraws it from the palette
const refreshers = [];
let dirty = false;

// The swatch the picker is currently editing: { set(hex) }
let activeEdit = null;

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function changed() {
  dirty = true;
  saveButton.disabled = false;
  refreshers.forEach((refresh) => refresh());
  channel.postMessage(palette);
}

// A swatch that opens the shared picker; getColor/setColor read and write the palette
function swatchButton(label, getColor, setColor) {
  const swatch = el("calcite-color-picker-swatch", { scale: "m" });
  const button = el("button", { className: "swatch-button", type: "button", title: label }, [swatch]);
  button.setAttribute("aria-label", label);
  button.addEventListener("click", (event) => {
    event.stopPropagation(); // don't toggle the block the swatch sits in
    activeEdit = { set: setColor };
    picker.value = getColor();
    popover.referenceElement = button;
    popover.open = true;
  });
  refreshers.push(() => (swatch.color = getColor()));
  return button;
}

function languageItem(name) {
  const lang = palette.languages[name];
  const familyColor = () => palette.families[lang.family];
  const item = el("calcite-list-item", { label: name });

  const swatch = swatchButton(`Colour for ${name}`, () => lang.color ?? familyColor(), (hex) => (lang.color = hex));
  swatch.slot = "content-start";

  const reset = el("calcite-action", { icon: "reset", text: "Use family colour", slot: "actions-end" });
  reset.addEventListener("click", () => {
    delete lang.color;
    changed();
  });

  item.append(swatch, reset);
  refreshers.push(() => {
    item.description = lang.color ? "Custom colour" : "Family colour";
    reset.hidden = !lang.color;
  });
  return item;
}

function familyBlock(family) {
  const members = Object.keys(palette.languages)
    .filter((name) => palette.languages[name].family === family)
    .sort((a, b) => a.localeCompare(b));
  const block = el("calcite-block", { heading: family, collapsible: true });

  const familySwatch = swatchButton(
    `Colour for ${family}`,
    () => palette.families[family],
    (hex) => (palette.families[family] = hex),
  );
  familySwatch.slot = "content-start";

  const list = el("calcite-list", { label: `${family} languages`, selectionMode: "none" }, members.map(languageItem));
  block.append(familySwatch, list);

  refreshers.push(() => {
    const custom = members.filter((name) => palette.languages[name].color).length;
    const count = `${members.length} ${members.length === 1 ? "language" : "languages"}`;
    block.description = count + (custom ? ` · ${custom} custom` : "");
  });
  return block;
}

function showAlert(kind, title, message) {
  alertEl.kind = kind;
  alertEl.querySelector('[slot="title"]').textContent = title;
  alertEl.querySelector('[slot="message"]').textContent = message;
  alertEl.open = true;
}

function download(text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  el("a", { href: url, download: "colors.json" }).click();
  URL.revokeObjectURL(url);
}

async function save() {
  const text = JSON.stringify(palette, null, 2) + "\n";
  try {
    const response = await fetch("colors.json", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: text,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    dirty = false;
    saveButton.disabled = true;
    showAlert("success", "Saved", "web/colors.json updated. Refresh the app to load it.");
  } catch (err) {
    // Served by something other than scripts/dev_server.py: hand the file over instead
    download(text);
    showAlert("warning", "Couldn't save on the server", `${err.message}. colors.json was downloaded instead; replace web/colors.json with it.`);
  }
}

picker.addEventListener("calciteColorPickerInput", () => {
  if (!activeEdit || !picker.value) return;
  activeEdit.set(picker.value.toUpperCase());
  changed();
});
saveButton.addEventListener("click", save);
window.addEventListener("beforeunload", (event) => {
  if (dirty) event.preventDefault();
});

const families = Object.keys(palette.families).sort((a, b) => a.localeCompare(b));
familiesEl.append(...families.map(familyBlock));
refreshers.forEach((refresh) => refresh());
