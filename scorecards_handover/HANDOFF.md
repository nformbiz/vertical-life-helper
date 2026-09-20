# Bouldering scorecard – handoff brief for Claude Code

Paste this file (or point Claude Code at it) together with `scorecard-reference.html`
into the folder of the application that will generate the cards.

## Goal
Generate printable, self-scoring cards for boulder jams (6–30 boulders). One card per athlete,
name/bib/category filled from the app's data (mail-merge style), optionally left blank for hand entry.
Output should be a print-ready PDF (or HTML that prints cleanly), one card per page.

`scorecard-reference.html` is the approved design as a standalone page. Open it in Chrome to see it;
`?paper=a4&zones=0&judge=1&boulders=24&merge=0&columns=2&rows=12` etc. exercise every option. **Port it into the app's
own templating/PDF pipeline; do not depend on the reference file itself.** Match the app's existing
conventions for templates, config and PDF generation.

## Variants (all combinations must work)
| Option | Values | Notes |
|---|---|---|
| Paper | A5 landscape (default), A4 landscape | Same design; A4 is A5 scaled by 1.4142. Frames: A5 = 794×559 px, A4 = 1123×794 px (96 dpi). Print with `@page { size: A5 landscape; margin: 0 }` (or A4). |
| Scoring | Tops + Zones, or Tops only | Tops-only drops the Zone column, the Zone total and the "Zone" symbol in the key. |
| Judge column | on / off | Extra narrow column headed **Judge** after Top, for judges' initials. |
| Boulders | 6–30 | Rows per column never exceed 10: 1 column up to 10, 2 columns 11–20, 3 columns 21–30. Rows are split evenly (13 → 7 + 6). Row height = min(available height ÷ rows per column, 52 px). Available height grows by 28 px when the header is prefilled (no labels). |
| Columns (override) | Auto, 1, 2, 3 | Auto = the rule above. A number forces that many columns, rows split evenly. Max 3 (a 4th leaves the Attempts box too narrow). |
| Rows per column (override) | Auto, or 5–30 | Forces the rows per column; columns fill left to right (13 boulders at 10 rows → 10 + 3). If both overrides are set, columns wins for the count and rows is raised if needed so every boulder fits. Columns that would be empty are dropped. Row height shrinks as rows increase (min(area ÷ rows, 52 px)), so warn or limit values that make rows too short to write in. |
| Athlete details | Merge fields / blank lines | Merged: Name, Bib, Category printed on the lines. Blank: empty lines to write on. |

## Layout (A5 landscape, top to bottom, 24 px page padding)
1. **Header, two blocks side by side.**
   - Left: **Name** (flexible width, 34 px) and **Bib #** (120 px wide, 34 px) on the same line, with **Category** (300 px wide, 22 px) on its own line underneath. Barlow Condensed 700. This is the most important text on the card. **When prefilled (merge) show only the big text: no labels and no rule lines.** In blank mode (hand entry) show a 12 px uppercase label above and a 2 px writing line underneath each field.
   - Right (250 px wide, right-aligned): the competition / event name (Barlow Condensed 800, 26 px, uppercase, may wrap to two lines), with the **venue** and the **date** each on their own line beneath (14 px).
2. **Key + example**: symbols for Attempt / Zone / Top, then a worked example box and the text
   "Zone 3 · Top 4 · blank if not reached" (tops-only: "Top 4 · blank if not topped").
3. **Score table**, one bordered grid per column (1.5 px outer border, 1 px cell rules, **no shading, no zebra stripes**):
   `#` (30 px) | **Attempts** (one wide free-form box, takes the remaining width) | Zone (36 px) | Top (36 px) | Judge (44 px, optional). **Every grid line is the same 1 px weight**, including the line before the Top column.
   Header row 26 px. Boulder numbers are plain bold numerals (Barlow Condensed 800).
4. **Footer**: "Totals" label, then large **Tops** box and **Zones** box (each 76 × 48 px, same 1.5 px border, Zones only on zones cards), an Athlete signature line (flexible), and two 70 × 48 px boxes labelled **Checked** and **Entered** for officials' initials.

## How athletes mark the card (drawn as inline SVG in the key)
- Attempt = a vertical line, one per go, in the wide Attempts box.
- Zone = an upside-down T (vertical line with a horizontal foot at the bottom).
- Top = the vertical line with a circle around it.
- Then write the attempt number of the first zone / top in the Zone / Top boxes; leave blank if not reached.

## Style rules (from the client)
- **Pure black (#000000) on white only.** No colours, no greys, no shading. Force `print-color-adjust: exact`.
- No "self score card" wording, no version tag/chip on the card.
- Body/label text never below 12 px at A5 (9 pt); strokes ≥ 1 px.
- Fonts: Barlow Condensed (700/800) and Barlow (500–700), from Google Fonts in the reference. For the app, self-host or bundle them so PDF generation works offline, with a condensed sans fallback.
- Keep the wide Attempts box free of any inner marks or tick boxes: people make many attempts.

## Data
Per athlete: name, bib, category. Event-level: event name, venue, date. Everything else is layout.
Placeholders in the reference (`[Event name]`, `[Venue]`, `[Date]`, `[Name]`, `[Bib]`, `[Category]`) show where merge values go.
Long names must not wrap: single line, clipped or auto-shrunk rather than pushed onto a second line.

## Suggested first steps for Claude Code
1. Look at how this app already generates documents/PDFs and where templates live; reuse that.
2. Port the reference into a template plus a small function that takes `{paper, zones, judge, boulders, merge, event, venue, date, athlete}`.
3. Add a generator that emits one page per athlete (and a blank-lines variant with no athlete data).
4. Render test PDFs for: A5 & A4, zones on/off, judge on/off, boulders = 6, 10, 11, 20, 21, 30, and check nothing overflows the page or the footer.
5. Check that the printed size is exactly A5 / A4 landscape with no margins or scaling.

## Design source
The interactive design canvas (four artboards: A5 and A4, Tops + Zones and Tops only; Boulders, Judge and Athlete details are tweakable on each) is the artifact "Bouldering Scorecard". The reference HTML above is the portable version of the same design.
