# VL Helper — Design System

Tailwind-palette vanilla CSS, no framework.

---

## Color Palette

All colors come from the Tailwind slate/blue families.

| Role | Value | Tailwind equiv |
|---|---|---|
| Page background | `#f1f5f9` | slate-100 |
| Body text | `#1e293b` | slate-900 |
| Muted text | `#64748b` | slate-500 |
| Faint muted text | `#94a3b8` | slate-400 |
| Borders | `#e2e8f0` | slate-200 |
| Input borders | `#d1d5db` | gray-300 |
| Primary blue | `#2563eb` | blue-600 |
| Primary blue hover | `#1d4ed8` | blue-700 |
| Header / accent | `#1e3a8a` | blue-900 |

---

## Cards

```css
background: #fff;
border: 1px solid #e2e8f0;
border-radius: .6rem;
padding: 1.5rem;
box-shadow: 0 1px 4px rgba(0,0,0,.06);
```

---

## Buttons

Two variants sharing: `border-radius: .375rem`, `font-size: .875rem`, `font-weight: 500`, `transition: background .15s`.

**Primary**
```css
background: #2563eb;
color: #fff;
/* hover */
background: #1d4ed8;
```

**Ghost**
```css
background: #fff;
color: #374151;
border: 1px solid #d1d5db;
/* hover */
background: #f9fafb;
```

**Small modifier** — add `padding: .3rem .65rem; font-size: .8rem`.

---

## Form Inputs

Applies to `select` and `input[type="text"]`:

```css
width: 100%;
padding: .4rem .6rem;
border: 1px solid #d1d5db;
border-radius: .375rem;
font-size: .875rem;
color: #1e293b;
background: #fff;
transition: border-color .15s, box-shadow .15s;
```

**Focus state:**
```css
outline: none;
border-color: #3b82f6;
box-shadow: 0 0 0 3px rgba(59,130,246,.15);
```

---

## Typography

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
font-size: 15px; /* base */
color: #1e293b;
```

| Role | Size | Weight | Color |
|---|---|---|---|
| Card heading (`h2`) | `1.1rem` | 700 | inherited |
| Subtitle | `0.875rem` | 400 | `#64748b` |
| Field label | `0.8rem` | 600 | `#475569` |
| Small / muted | `0.875rem` | 400 | `#94a3b8` |

---

## Layout

```css
/* Sticky header */
header {
  background: #1e3a8a;
  color: #fff;
  padding: .85rem 1.5rem;
  position: sticky;
  top: 0;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0,0,0,.25);
}

/* Main content area */
#content {
  max-width: 820px;
  margin: 2rem auto;
  padding: 0 1rem 4rem;
}
```

---

## Spacing Rhythm

- Gap between inline elements: `0.5rem`–`0.75rem`
- Gap between stacked form rows: `0.5rem`–`0.75rem`
- Gap between sections within a card: `1.25rem`–`1.5rem`
- Gap between cards: `1.5rem`
- All spacing in `rem` units throughout

---

## Alerts

Three tinted variants, each with a light background, matching `1px` border, and dark text in the same hue.

```css
.alert-info    { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; }
.alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; color: #14532d; }
.alert-warning { background: #fffbeb; border: 1px solid #fcd34d; color: #78350f; }
```

---

## Interactions

- All interactive elements have short transitions: `0.12s`–`0.2s`
- Hover states are subtle: slightly darker button fill, light blue tint on cards, blue border on inputs
- Focus rings use a soft blue glow (`box-shadow: 0 0 0 3px rgba(59,130,246,.15)`) rather than the browser default outline
- Checkboxes and range inputs use `accent-color: #2563eb` to match the primary blue
