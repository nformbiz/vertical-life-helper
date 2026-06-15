# Wild Apricot → Vertical Life Extractor — Progress

## What this is

A standalone browser-based HTML/JS app (no build step, no framework) that bridges two climbing event systems:
- **Wild Apricot** — athlete registration platform, exports XLS/XLSX/CSV
- **Vertical Life** — scoring software, requires a specific CSV import format

It lives entirely in `index.html` + `src/` and runs directly from the filesystem or any static host.

---

## File structure

```
index.html          — shell, all CSS, loads vendor CDN libs + src modules
src/app.js          — CSV Export wizard (steps 0-6) + home screen
src/parser.js       — SheetJS XLS/XLSX + PapaParse CSV parsing, date normalisation
src/transformer.js  — filtering, discipline/category grouping, CSV generation
src/exporter.js     — JSZip bundle + browser download
src/bibs.js         — Bib Printer module (standalone, IIFE pattern)

sample_data/        — test files (not committed to prod)
apps_scripts/       — legacy Google Apps Script (superseded by this app)
```

Vendor libraries loaded from CDN in `index.html`: SheetJS, PapaParse, JSZip.

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

- **Offline vendor files** — currently CDN-dependent (SheetJS, PapaParse, JSZip). Could vendor them locally for offline/Tauri use.
- **Tauri wrapper** — mentioned as Phase 3 (desktop app packaging).
- **Bib background colour/logo** — no per-bib customisation beyond images.
- **Multiple CSV files for bibs** — currently only one CSV upload at a time.
- **Export bibs as PDF** — currently relies on the browser's print-to-PDF.
