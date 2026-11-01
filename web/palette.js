// Shared by app.js and editor.js.
//
// colors.json holds the palette:
//   families:  { "Germanic languages": "#C0061B", ... }
//   languages: { "German": { "family": "Germanic languages" },
//                "Yiddish": { "family": "Germanic languages", "color": "#123456" } }
// A language uses its own "color" when it has one, otherwise its family's.
//   composition: { "English": "#CA0011", "French": ..., "Non-official languages": ... }
//                blended by population share in the English / French / Other view.

// editor.html posts the whole palette here on every change so open app tabs
// can preview it before it is saved
export const PALETTE_CHANNEL = "language-palette";

export async function loadPalette() {
  // no-cache: revalidate so an edited file shows up on a normal refresh
  const response = await fetch("colors.json", { cache: "no-cache" });
  return response.json();
}

// Language -> "#RRGGBB"
export function resolvePalette({ families, languages }) {
  return Object.fromEntries(
    Object.entries(languages).map(([lang, { family, color }]) => [lang, color ?? families[family]]),
  );
}
