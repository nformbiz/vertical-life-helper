# Wild Apricot → Vertical Life Extractor — Progress

## What this is

A standalone HTML/JS app that bridges two climbing event systems:
- **Wild Apricot** — athlete registration platform, exports XLS/XLSX/CSV
- **Vertical Life** — scoring software, requires a specific CSV import format

Runs as a **web app** (open `public/index.html` from any static host) or as a **native Windows desktop app** (Tauri 2 wrapper, produces a standalone `.exe`).

---

## File structure

```
public/
  index.html        — shell, all CSS, loads vendor libs + src modules
  src/app.js        — CSV Export wizard (steps 0-6) + home screen
  src/parser.js     — SheetJS XLS/XLSX + PapaParse CSV parsing, date normalisation
  src/transformer.js — filtering, discipline/category grouping, CSV generation
  src/exporter.js   — file saving (native dialog in Tauri, blob download in browser)
  src/bibs.js       — Bib Printer module (standalone, IIFE pattern)
  vendor/           — vendored JS libs: xlsx.full.min.js, papaparse.min.js, jszip.min.js

src-tauri/          — Tauri 2 Rust shell + config
  tauri.conf.json   — app config (frontendDist: ../docs, window 1100×800)
  src/lib.rs        — custom save_text_file / save_binary_file commands
  permissions/      — save-files.toml (Tauri permission definitions for custom commands)
  capabilities/     — default.json
  icons/            — app icons

package.json        — npm scripts: dev (tauri dev), build (tauri build)

sample_data/        — test files (not committed to prod)
apps_scripts/       — legacy Google Apps Script (superseded by this app)
```

No build step for the web assets. Vendor libraries are local (not CDN) so the app works fully offline.

---

## Tauri setup — COMPLETE

### Running / building
```
npm run dev     # opens live dev window (JS changes hot-reload, Rust changes require restart)
npm run build   # produces installers in src-tauri/target/release/bundle/
```

### Distribution
- **Standalone exe**: `src-tauri/target/release/app.exe` — single file, no install needed, ~9 MB.
- **Installer (NSIS)**: `bundle/nsis/Vertical Life Helper_0.1.0_x64-setup.exe`
- **Installer (MSI)**: `bundle/msi/Vertical Life Helper_0.1.0_x64_en-US.msi`
- Requires WebView2 (pre-installed on Windows 11 / most Windows 10 machines).
- No code signing cert — SmartScreen will warn on first run; users click "More info → Run anyway".

### Tauri-specific behaviours
- **Drag-and-drop**: `dragDropEnabled: false` in `tauri.conf.json` — disables Tauri's interception so the browser's native drag-drop events fire normally.
- **File saving**: Detected via `window.__TAURI_INTERNALS__`. In Tauri, downloads use native OS save/folder-picker dialogs (`plugin:dialog|save`, `plugin:dialog|open`) then write via custom Rust commands (`save_text_file`, `save_binary_file`). In browser, falls back to blob URL download.
- **Home navigation**: "← Home" button injected into the step nav at steps 1–6 (CSV wizard). Bib Printer already has its own home button in its nav bar.

### Key Tauri 2 notes for future reference
- App command permissions must be manually defined in `src-tauri/permissions/*.toml` (they are NOT auto-generated). Reference them in capabilities WITHOUT a namespace prefix (e.g. `"allow-save-text-file"`, not `"app:allow-save-text-file"`).
- Dialog invoke args are wrapped: `{ options: { defaultPath, filters } }` for `plugin:dialog|save` and `plugin:dialog|open`.
- `tauri-plugin-fs` was intentionally avoided — its scope system blocks writes to user-selected paths when called via raw invoke. Custom Rust commands with `std::fs::write` are used instead.

---

## Feature 1: CSV Export tool (`src/app.js`) — COMPLETE

### Wizard flow (steps 0–6)

**Step 0 — Home screen**
Two feature cards: "CSV Export" → `goTo(1)` | "Bib Printer" → `Bibs.init()`.
`App.goTo(0)` is the public API for returning home from any mode.

**Step 1 — Upload**
Drag-and-drop or browse. Accepts `.xls`, `.xlsx`, `.csv`. Calls `Parser.parseFile()`.
After parse, fingerprints the header row with `Parser.hashHeaders()` and auto-loads
any saved config for this format from localStorage. Advances to step 2 after 700ms.

**Step 2 — Column mapping**
Maps 6 required Vertical Life fields to Wild Apricot columns: First Name, Last Name,
Gender, Date of Birth, State/Affiliation, Category. Auto-detection uses keyword hints.
Saved per header fingerprint in localStorage (`wa_vl_colmap_<fp>`).
"Preview source data" opens the category diagnostic modal showing the raw file.

**Step 3 — Filters**
Exclude rows based on column values. Three match modes: "By value" (checkboxes),
"Contains text" (substring), "Is blank". Multiple filters stacked (OR logic — excluded
by any). Auto-detects payment status column and pre-checks cancellation keywords.
Live counter shows included/excluded row totals. "Show excluded" expands a table showing
each excluded row, which column matched, and the reason.

**Step 4 — Discipline**
Single or multi-discipline toggle.
- Single: user types the discipline name (e.g. "Lead") → used as filename suffix.
- Multi: user picks a column and defines "if column contains X → label Y" rules.
  An athlete can match multiple rules (e.g. "Lead & Boulder") and appears in both files.
  Shows unique column values as chips, live unmatched-row warning, and a value→label mapping table.

**Step 5 — Categories**
Lists every unique category value from filtered data. Each gets a short label (used in
filenames) and a type: Athlete / Official / Exclude. Auto-classifies staff keywords
(coach, manager, official, etc.) and parses age-group prefixes (U13, Open, etc.).
"Preview" opens a filterable modal showing the raw rows for that category.

**Step 6 — Export**
Lists output files with row counts. Per-file "Preview" modal (table or raw CSV view,
copy to clipboard). Download buttons: single file, all CSVs separately, or ZIP bundle.
In Tauri: single file and ZIP show a Save As dialog; "Download all" shows a folder picker.

### Output format
No header row. 5 quoted CSV columns per row: `"FirstName","LastName","Gender","DOB","State"`
DOB normalised to `yyyy-MM-dd`. One file per category × gender × discipline, e.g. `U13_Female_Lead.csv`.
Officials go to `<label>.csv` (no gender/discipline split). Unconfigured rows → `_uncategorised.csv`.

### localStorage persistence
All config keyed by header fingerprint so it auto-loads when the same export format is re-uploaded.
Keys: `wa_vl_colmap_<fp>`, `wa_vl_disc_<fp>`, `wa_vl_filters_<fp>`, `wa_vl_catconf_<fp>`.

---

## Feature 2: Bib Printer (`src/bibs.js`) — COMPLETE

### Overview
Parses **Vertical Life athlete export CSVs** (semicolon-delimited, different from the Wild Apricot input).
Renders printable **A5 landscape bib cards** (210mm × 148mm). Prints via `window.print()` with
`@page { size: A5 landscape; margin: 0 }`. Scaled to 65% on screen for preview.

### Flow (4 views inside `#bib-content`)

**Upload** — drop/browse a Vertical Life export CSV.

**Config** — enter event name (not in the CSV, persisted in localStorage); upload up to 3 images
each with a 6-position selector (↖↑↗↙↓↘) and placement saved to config.

**Design** — live bib preview (leftmost column) alongside sliders for:
- Text sizes: Event name (6–48pt), Bib number (36–250pt), Athlete name (10–60pt), Category (7–36pt)
- Vertical positions (mm from top of bib): all 4 text elements independently, range 0–140mm
- Image sizes (5–65%) — only shown for uploaded images
Sliders update the live bib instantly via direct DOM manipulation (`updateLiveBib()`),
no re-render. Slider input has `min-width:0` so it compresses in the narrow right column
without the browser's intrinsic minimum causing horizontal overflow.

**Preview/Print** — shows all bibs sorted by bib number. Print button calls `window.print()`.
Print CSS hides everything except `#bib-content`; bib cards render at full 210mm × 148mm.

### CSV parsing
PapaParse with `delimiter: ';'`. Category derived from event columns whose name matches
`/^(LEAD|BOULDER|SPEED)\s+(U\d+)\s+(Female|Male)$/i` and whose value is `"registered"`.
All-caps names (Vertical Life export format) normalised to Title Case via `normalizeName()`.

### Bib card HTML
All 4 text elements are `position: absolute` with `top` in mm and `font-size` in pt
set as inline styles, so sliders update them directly without re-render.
Images use `POS_STYLE` map for absolute positioning + `width` percentage for size.

### localStorage
Key: `wa_vl_bib_config_v1`. Stores: `{ eventName, images: [{data, position, size}×3], fontSizes, positions }`.
`loadConfig()` has backward-compat: missing `fontSizes`/`positions` keys are filled from defaults.

### Mode switching
`Bibs.init()` — hides `#content`, shows `#bib-content`, replaces `#step-nav` with "← Home | Bib Printer" bar.
`exitBibs()` (private) — reverses the above and calls `App.goTo(0)`.

---

## Key CSS/layout notes

- `#content` and `#bib-content` are siblings; only one is visible at a time.
- `#bib-content` has `max-width: 820px; margin: 2rem auto; padding: 0 1rem 4rem`.
- `.bib-scale-wrap`: `width: calc(210mm * 0.65); height: calc(148mm * 0.65)` — clips the scaled card.
- `.bib-card`: `transform: scale(0.65); transform-origin: top left` — scales from 210mm actual to screen size.
- Print media query overrides `.bib-scale-wrap` to `210mm × 148mm` and `.bib-card` to `transform: none`.
- Design step grid: `calc(210mm * 0.65) 1fr` — bib gets its natural scaled width, controls get the rest (~248px on an 820px container). Sliders use `min-width:0` on the range input to avoid browser minimum width overflow.
- MutationObserver watches both `#content` and `#bib-content` to drive the scroll-to-bottom button.

---

## What's NOT done / possible next steps

- **Code signing** — no cert; SmartScreen warns on first run. Buy OV cert (~£100–300/yr) to eliminate.
- **Auto-updater** — users re-download manually for new versions. `tauri-plugin-updater` could automate this but needs a hosted update manifest.
- **Bib background colour/logo** — no per-bib customisation beyond images.
- **Multiple CSV files for bibs** — currently only one CSV upload at a time.
- **Export bibs as PDF** — currently relies on the browser's print-to-PDF.
- **WebView2 bundling** — NSIS installer could bundle the WebView2 bootstrapper for older Windows 10 machines.
- **TODO (before next event): self-host a Google Font for bib text.** Bib text currently uses the system-UI font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`), so `.bib-number`'s `font-weight: 900` may not render as a true black weight on every OS (e.g. Windows/Segoe UI). Fix: pick a Google Font with a real 900 weight, vendor the `.woff2` locally under `docs/vendor/fonts/` (same pattern as the other vendored libs — no CDN, keeps the app offline-capable), add `@font-face`, and await `document.fonts.ready` before `window.print()` in `bindPreview()` (`src/bibs.js`) so print doesn't race the font load.
  Fonts to review:
  - **Inter** — variable weight range (100–900) with a real Black, very legible at large sizes.
  - **Archivo Black** — single-weight (900 only) ultra-bold display font, purpose-built for big bold numerals.
  - **Barlow Condensed (Black)** — condensed width, useful if bib numbers ever run 3–4 digits and need to fit without shrinking font size.
  - **Oswald** — classic condensed display font often used on race bibs/posters; only goes up to Bold/700, no true 900 black.
