# Design tokeny — Tricho.app

Všechny tokeny extrahované z `landing-page.html`. Doporučuji implementovat jako CSS variables v `src/styles/tokens.css` a pak je referencovat v komponentách.

## Light & Dark mode

Stránka má dva režimy přepínané přes `data-theme` atribut na `<html>`. Dark mode je důležitý — design používá teplé tóny, ne čistou černou (sépiová tmavá).

```css
:root {
  /* Light mode (default) */
  --bg: #FDFAF3;
  --surface: #FFFFFE;
  --cream: #F7F0E2;
  --cream-2: #FAF5EC;

  --ink: #1C1917;        /* primary text */
  --ink-2: #44403C;      /* secondary text */
  --ink-3: #8B857D;      /* tertiary / muted */
  --ink-4: #BAB4AB;      /* very muted, dim */

  --line: #EBE4D5;       /* default border */
  --line-2: #F2ECE0;     /* subtle border */

  --teal-200: #A5E4EC;   /* selection bg */
  --teal-600: #0E7490;   /* phone-active state, links light */
  --teal-700: #155E75;   /* italic emphasis, primary buttons */
  --teal-900: #134E5E;   /* button hover */

  --copper: #B06E52;     /* eyebrow labels, accents */
  --copper-deep: #8C5640; /* tags text, deeper accent */
  --copper-soft: #F3E1D2; /* tag bg, photo placeholder */
  --copper-50: #FBF4EE;  /* very subtle copper bg */

  --phone-frame: #F8F2E4;
  --phone-frame-border: #D9D2C3;
  --phone-shadow: /* viz HTML */;

  --paper-blend: multiply;
  --paper-opacity: 0.5;

  --radius-card: 18px;
  --radius-ctrl: 12px;
}

:root[data-theme="dark"] {
  --bg: #211A15;
  --surface: #29211B;
  --cream: #2A2117;
  --cream-2: #32281F;

  --ink: #F5EDE0;
  --ink-2: #D4C8B8;
  --ink-3: #9D9385;
  --ink-4: #6F665C;

  --line: #3E3228;
  --line-2: #332921;

  --teal-200: #1B4F5C;
  --teal-600: #5FAFC5;
  --teal-700: #7BC0D2;
  --teal-900: #5FAFC5;

  --copper: #C48867;
  --copper-deep: #B37959;
  --copper-soft: #3A2920;
  --copper-50: #2C2018;

  --phone-frame: #100C09;
  --phone-frame-border: #2A211B;

  --paper-blend: screen;
  --paper-opacity: 0.45;
}
```

## Typografie

### Fonty (Google Fonts)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500&family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..600&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=Patrick+Hand&display=swap" rel="stylesheet">
```

### Role fontů

| Font | Použití |
|---|---|
| **Fraunces** | Nadpisy (H1–H4), velké citace. Weight 300 pro hero, 400 pro section title, 500 pro důraz. Italic vždy v teal-700 pro emphasis. |
| **Geist** (sans) | Body text, lede, popisky, CTA labely. Weight 400 default, 500 pro důraz/buttons, 600 pro phone status bar. |
| **Geist Mono** | Eyebrows, mikrolabel, plan names, status meta, version markery, footer column titles. Vždy uppercase, letter-spacing 0.1–0.14em. |
| **Patrick Hand** | Drobné ručně psané akcenty: "volno 1 h 30 min" v phone mockup, plan microcopy ("Vyjde to na 25 Kč…"), risk-reversal ve final CTA, voices fineprint, hand-soft v privacy. |
| **Caveat** | Pouze tagy alergenů v ukázkové kartě klientky a `+` glyph v phone slot. Weight 600. |

### Velikosti

| Role | Font | Size | Weight | Line-height | Letter-spacing |
|---|---|---|---|---|---|
| H1 hero | Fraunces | `clamp(40px, 5.5vw, 64px)` | 300 | 1.04 | -0.03em |
| H2 section title | Fraunces | `clamp(26px, 3.4vw, 36px)` | 400 | 1.1 | -0.02em |
| H2 final CTA | Fraunces | `clamp(30px, 4.2vw, 44px)` | 300 | 1.1 | -0.025em |
| Privacy lead prose | Fraunces | `clamp(20px, 2.4vw, 26px)` | 300 | 1.45 | -0.015em |
| Story quote | Fraunces | `clamp(20px, 2.4vw, 26px)` | 300 | 1.45 | -0.015em |
| Free block H3 | Fraunces | `clamp(28px, 3.4vw, 38px)` | 300 | 1.1 | -0.025em |
| Plan amount | Fraunces | 38px | 300 | 1 | -0.025em |
| Voice blockquote | Fraunces | 17px | 300 | 1.5 | -0.01em |
| FAQ summary | Fraunces | 18px | 400 | 1.4 | -0.01em |
| Body text (lede, p) | Geist | 14–17px | 400 | 1.5–1.65 | 0 |
| Eyebrow / monolabel | Geist Mono | 10–11px | 400 | 1.4 | 0.08–0.14em |
| Hand-soft, microcopy | Patrick Hand | 14–16px | 400 | 1.4–1.5 | 0 |

**Italic emphasis pattern:** Kdykoli v Fraunces nadpisu nebo prose vidíš `<em>...</em>`, je to **italic v teal-700 (light) / teal-700 (dark)**, NE jen italic. To je signature design move stránky.

## Spacing

- Section padding: `96px 0` desktop, `72px 0` mobile (≤800px)
- Page max-width: `1100px`
- Page horizontal padding: `40px` desktop, `24px` mobile (≤600px)
- Karta padding: `28–48px` dle velikosti karty
- Mezi prvky: standardně 18–28px

## Breakpointy

```css
/* Mobile-first, ale prototyp je psán desktop-first s max-width media queries */
@media (max-width: 880px) { /* Hero, plans grid, voices grid */ }
@media (max-width: 800px) { /* Story, free block, status */ }
@media (max-width: 720px) { /* Pillars, plans grid (final), footer */ }
@media (max-width: 600px) { /* Page padding, section sub */ }
@media (max-width: 480px) { /* Footer columns */ }
```

## Speciální efekty

### Paper grain overlay

Celá stránka má jemný paper-grain noise overlay přes phone screens a body radial gradients. Inline SVG noise je v `--paper-grain` proměnné. Aplikuje se přes `body::before` a `.phone-screen::after`.

### Body background gradients

```css
body::before {
  content: '';
  position: fixed; inset: 0;
  background:
    radial-gradient(ellipse 1400px 700px at 10% -10%, rgba(176, 110, 82, 0.06), transparent 60%),
    radial-gradient(ellipse 1000px 500px at 100% 110%, rgba(14, 116, 144, 0.05), transparent 60%);
  pointer-events: none;
  z-index: 0;
}
```

### Phone shadow (light mode)

```css
--phone-shadow:
  0 1px 0 rgba(255,255,255,0.8) inset,
  0 0 0 1px var(--phone-frame-border),
  0 2px 4px rgba(69, 48, 28, 0.04),
  0 24px 48px -12px rgba(69, 48, 28, 0.12),
  0 40px 80px -20px rgba(14, 116, 144, 0.08);
```

### Hand-underline SVG

V některých nadpisech je dekorativní hand-drawn underline pod slovem. Implementováno jako absolute SVG background-image:

```css
.hand-underline::after {
  content: '';
  position: absolute;
  left: -2px; right: -2px; bottom: -5px;
  height: 7px;
  background-image: url("data:image/svg+xml;utf8,<svg ... />");
}
```

(Viz `landing-page.html` pro plný SVG.)

## Buttons

### Primary
```css
.btn-primary {
  background: var(--teal-700);
  color: #FFFFFE;
  padding: 12px 22px;
  border-radius: var(--radius-ctrl);
  font-family: 'Geist', sans-serif;
  font-size: 14px;
  font-weight: 500;
}
.btn-primary:hover { background: var(--teal-900); }
```

### Secondary (light border)
```css
.btn-secondary {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--line);
  padding: 12px 22px;
  border-radius: var(--radius-ctrl);
}
.btn-secondary:hover { border-color: var(--copper); color: var(--copper); }
```

V současné stránce je primárně **jen jeden CTA "Začít zdarma"**, opakovaný 4× na různých místech (header, hero, free block, final CTA). Žádné secondary buttons na page samé.

## Quote dekoratéry

Citace (Ludmila quote, voices) mají copper quotation marks `„"` jako pseudo-elementy:

```css
.quote::before { content: '\201E'; color: var(--copper); /* … */ }
.quote::after  { content: '\201C'; color: var(--copper); /* … */ }
```

České typografické uvozovky, dolní/horní variant.

---

Pro plné CSS nahlédni `landing-page.html` — všechno je v jednom `<style>` bloku okomentované sekcemi.
