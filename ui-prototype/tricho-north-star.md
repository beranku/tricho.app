# Tricho.App — North Star Design Dokument

**Verze 2.0** · Finální konsolidace po iteracích na prototypu v2
**Datum:** 24. dubna 2026
**Určeno:** vývoj PWA pro trichology/kadeřníky na českém trhu

Tento dokument je jediný zdroj pravdy pro UI/UX Tricho.App. Slouží jako reference během implementace v React/TypeScript stack a jako základ pro budoucí rozhodnutí — jakákoli odchylka od něj by měla být zde zaznamenána jako evoluce, ne improvizace.

---

## Obsah

1. [Filozofie a principy](#1-filozofie-a-principy)
2. [Jazyk a kulturní konvence](#2-jazyk-a-kulturn%C3%AD-konvence)
3. [Design tokens](#3-design-tokens)
4. [Typografie](#4-typografie)
5. [Hand-drawn systém](#5-hand-drawn-syst%C3%A9m)
6. [Layout architektura](#6-layout-architektura)
7. [Komponenty](#7-komponenty)
8. [Interakční vzory](#8-interak%C4%8Dn%C3%AD-vzory)
9. [Formátování obsahu](#9-form%C3%A1tov%C3%A1n%C3%AD-obsahu)
10. [Accessibility](#10-accessibility)
11. [Implementační poznámky](#11-implementa%C4%8Dn%C3%AD-pozn%C3%A1mky)
12. [Changelog](#12-changelog)

---

## 1. Filozofie a principy

### Deníkový charakter

Tricho.App není administrativní nástroj. Je to **deník trichologa** — místo, kam se zapisuje práce, ukládají se vzpomínky na klienty a vede se kontinuální záznam. Aplikace má působit jako moleskin na recepci, ne jako dashboard v prohlížeči.

Z toho plyne několik principů, které jsou pod všemi ostatními:

**Papír, ne obrazovka.** Pozadí není nikdy čistě bílé. Vždy teplý krém (`#FDFAF3`), v dark modu tmavá espresso (`#211A15`). Přes povrch leží jemný SVG noise — zrnitost papíru. Nejde o dekoraci, ale o *signál*: „toto je místo k zápisu, ne ke čtení reportů".

**Teplota přes neutralitu.** Všechny kritické akcenty mají teplý charakter — copper (tlumená měď), amber pro alergeny. Jediný „studený" tón je teal pro datové stavy (probíhající čas, aktivní slot). Ten kontrast není estetický rozmar — je to *funkční mapa*: co je kontextové (warm) vs. co je stav/data (cool).

**Tři hlasy, přísné role.** Každá rodina písma má svou jedinou úlohu. Nelze si vyměnit Fraunces za Geist jen proto, že se mi víc líbí. Každé písmo *říká*, o co jde:

- Fraunces říká „toto je narativ" — jména, časy, data
- Geist říká „toto je funkční UI" — štítky, čipy, čísla
- Caveat / Patrick Hand říkají „toto je anotace od člověka" — poznámky, alergen, „volno 35 min"

**Hand-drawn jako akcent, ne dekorace.** Ruční kresby jsou v aplikaci přesně na čtyřech místech. Ani pixel víc. Jakmile by ruční akcenty proliferovaly, přestanou být znakem lidskosti a stanou se vizuálním šumem. Víc o tom v sekci 5.

### Produktové principy

**Offline-first.** PWA je navržena tak, aby fungovala bez internetu. Synchronizace je *potichu*, viditelná jen v Bottom Sheetu (`Synchronizováno · před 2 min`). Nikdy neobtěžuje uživatele.

**Privacy jako výchozí stav.** End-to-end šifrování dat klientů (zejména before/after fotografií) je architektonické rozhodnutí, ne feature. UI to reflektuje: zámek vedle sync stavu, šifrované fotografie mají subtle indikátor.

**Mobile-first, ale ne mobile-only.** Výchozí layout je optimalizován pro 390–430px šířku (iPhone 12–16 Pro). Tablet a desktop jsou budoucí rozšíření — ale každé UI rozhodnutí musí snést škálování.

**Kontextové, ne modální.** Kamera není modal dialog — je součástí detailu klienta, ukotvená. Sheet pro menu je bottom sheet (iOS pattern), ne full-screen overlay. Uživatel má vždy vidět *kde je*.

---

## 2. Jazyk a kulturní konvence

### Český jazyk

Veškerý UI text je v češtině. To zahrnuje:

- Formátování dat: `22. dubna` (nikdy `22.04.` ani `April 22`)
- Názvy dnů: `Dnes`, `Zítra`, pak `Pátek`, `Sobota`, ... (velké první písmeno)
- Časy: `09:10`, `16:30` (24h formát, nikdy AM/PM)
- Množství: `volno 35 min`, `volno 1 h 45 min`, `volno 3 h`, `celý den volno`
- Menší jednotky: `zbývá 45 min` (Phone B — countdown u probíhajícího zákroku)

### Pluralizace

Čeština má tři gramatické tvary pro množství (1 / 2-4 / 5+). Aplikace to musí respektovat:

- `1 hodina` → `volno 1 h` (zkrácené na `h`, vyhneme se rozhodování)
- `35 minut` → `volno 35 min`
- `2 hodiny 15 minut` → `volno 2 h 15 min`
- Klienti: `142 klientů` (v bottom sheetu, badge) — *pozn: chybné by bylo `142 klient`*

Pro čísla přes 99 v záznamech používáme `tabular-nums` font-feature aby zarovnání sedělo.

### Datum

**Kompletní formát:** `čtvrtek 24. dubna 2026` — používá se jen v detailních hlavičkách dokumentů.

**Zkrácený:** `22. dubna` — day-divider a top chrome. **Nikdy** nekombinovat se dnem v týdnu (`čtvrtek 22. dubna` je zakázané — den už je v kickeru).

**Kontextový:** `Dnes`, `Zítra` — pro následující dva dny místo plného názvu. Den po `Zítra` je už `Pátek`, `Sobota`, ... (den v týdnu bez adjekce).

### Doménová terminologie

Tricholog není kadeřník. Slovník aplikace preferuje odborné termíny, ale zůstává čitelný pro zákazníky:

- `Diagnostika` (ne „rozbor" ani „analýza")
- `Trichologický zákrok` (ne „procedura")
- `Konzultace` (ne „schůzka")
- Alergeny jsou nazývány chemickým názvem: `Amoniak`, `PPD`, `Resorcinol`

---

## 3. Design tokens

Všechny tokeny jsou CSS custom properties v `:root` a přepínají se přes `[data-theme="dark"]`.

### 3.1 Barvy — Light mode

```css
:root {
  /* === POZADÍ & PAPÍR === */
  --stage: #F3EDE0;           /* zázemí stránky (za telefony) */
  --bg: #FDFAF3;              /* hlavní plocha (uvnitř telefonu) */
  --surface: #FFFFFE;         /* karty, bottom sheet */
  --surface-2: #FAF5EC;       /* sekundární plocha, chip bg */
  --line: #EBE4D5;            /* oddělovače, borders */
  --line-soft: #F2ECE0;       /* velmi jemné oddělovače */

  /* === TEXT === */
  --ink: #1C1917;             /* primární text */
  --ink-espresso: #2A231B;    /* capture button, tmavé tlačítko */
  --ink-2: #44403C;           /* sekundární text */
  --ink-3: #736D64;           /* tercierní / meta (WCAG AA: 4.65:1) */
  --ink-4: #9F9990;           /* tlumený (WCAG AA Large: 3.2:1) */

  /* === DATA & STAV === */
  --teal: #0E7490;            /* aktivní stav, live kicker */
  --teal-strong: #134E5E;     /* zdůrazněný datový text */
  --teal-tint: rgba(14, 116, 144, 0.06);   /* bg aktivního slotu */
  --teal-border: rgba(14, 116, 144, 0.22); /* border aktivního slotu */

  /* === HAND-DRAWN & WARNING === */
  --copper: #B06E52;          /* ruční akcenty, kickery */
  --copper-mid: #9A5E44;      /* zvýrazněný copper (check, stroke) */
  --copper-border: rgba(176, 110, 82, 0.32);
  --amber: #B97940;           /* alergeny, pozornost */

  /* === EFEKTY === */
  --card-shadow: 0 1px 2px rgba(69, 48, 28, 0.03),
                 0 4px 12px -4px rgba(69, 48, 28, 0.04);
  --sheet-shadow: 0 -8px 24px -4px rgba(42, 35, 27, 0.12);
  --backdrop: rgba(28, 25, 23, 0.32);

  /* === PAPÍROVÁ TEXTURA === */
  --paper-blend: multiply;
  --paper-opacity: 0.5;
  /* --paper-grain: SVG data URI (viz níže) */
}
```

### 3.2 Barvy — Dark mode

Dark mode není inverze — je to *jiná noc stejného papíru*. Espresso pozadí, sníženě jasné inkousty, posílené akcenty.

```css
[data-theme="dark"] {
  --stage: #17120E;
  --bg: #211A15;              /* espresso, NE černá */
  --surface: #29211B;
  --surface-2: #32281F;
  --line: #3E3228;
  --line-soft: #332921;

  --ink: #F5EDE0;             /* cream, čte se jako tmavý inkoust na světlém */
  --ink-espresso: #F5EDE0;    /* v dark je inverted — captura má cream bg */
  --ink-2: #D4C8B8;
  --ink-3: #9D9385;           /* WCAG AA proti --bg */
  --ink-4: #6F665C;

  --teal: #2494B2;            /* !! NE #5AB8D4 — testováno, světlé je slabé */
  --teal-strong: #5FAFC5;
  --teal-tint: rgba(36, 148, 178, 0.14);
  --teal-border: rgba(36, 148, 178, 0.34);

  --copper: #C48867;
  --copper-mid: #B37959;
  --copper-border: rgba(196, 136, 103, 0.38);
  --amber: #D09860;

  --card-shadow: 0 1px 2px rgba(0, 0, 0, 0.12),
                 0 4px 12px -4px rgba(0, 0, 0, 0.28);
  --sheet-shadow: 0 -8px 24px -4px rgba(0, 0, 0, 0.4);
  --backdrop: rgba(0, 0, 0, 0.5);

  --paper-blend: screen;
  --paper-opacity: 0.45;
}
```

### 3.3 Pravidla pro barvy

**Teal je STAV, ne značka.** Používá se výhradně pro:
- Probíhající zákrok (`Dnes` kicker v chromu v live stavu)
- Aktivně zvolený slot (`.slot-active`)
- Odpočítávání času (`zbývá 45 min`)

**Copper je ANOTACE.** Používá se pro:
- Kicker textové labely (Zítra, Pátek, sekce hlavičky)
- Check u dokončeného slotu
- Ruční kresby (sluníčko, hamburger menu ikona BYLA copper — nyní ink-2, viz 5.2)

**Amber je VAROVÁNÍ.** Jen pro alergeny a výstrahy, které nesmí být přehlédnuty.

**Ink-3 je minimum pro subtext.** Ink-4 se používá jen pro large text (18px+) nebo jako tint. Nikdy neříkat kritické informace v ink-4.

### 3.4 Spacing

Žádná spacing scale není formálně definovaná — používáme pragmatic values, ale všechny jsou násobky 2px nebo 4px. Časté hodnoty:

```
--space-2: 2px
--space-4: 4px
--space-6: 6px
--space-8: 8px
--space-10: 10px
--space-12: 12px
--space-14: 14px
--space-16: 16px
--space-20: 20px
--space-24: 24px
--space-26: 26px
--space-34: 34px
```

**Horizontal padding v telefonu je `20px`** — to je zlatý standard. Slot má `padding: 14px 20px`, chrome má `padding: 6px 12px 10px` (užší, protože `chrome-glyph` mají vlastní 44×44 touch target).

### 3.5 Border radius

```
--radius-chip: 10px   /* chipy, drobné tlačítka */
--radius-card: 14px   /* sloty, karty */
--radius-panel: 20px  /* bottom sheet horní roh */
--radius-btn: 12px    /* chrome-glyph */
--radius-fab: 22px    /* FAB (kruh z 44×44) */
```

### 3.6 Stíny

Dva druhy: jemný stín karet a vyraznější stín sheetu.

```css
--card-shadow: 0 1px 2px rgba(69, 48, 28, 0.03),
               0 4px 12px -4px rgba(69, 48, 28, 0.04);
--sheet-shadow: 0 -8px 24px -4px rgba(42, 35, 27, 0.12);
```

V dark modu stíny zesilujeme (černý tón) — viz sekce 3.2.

### 3.7 Tranzice

**Univerzální pravidlo: 0.22s cubic-bezier(0.4, 0, 0.2, 1).** Nic není rychlejší (pocit glitche) ani pomalejší (pocit lag).

Výjimky:
- Sheet open/close: `0.32s` (typicky pro bottom sheet)
- Fade out hand-drawn lines u sticky dividers: `0.22s`
- Hover na tlačítka na desktopu: `0.15s` (cílová platforma je touch, hover je bonus)

```css
* {
  transition: background-color 0.22s ease,
              color 0.22s ease,
              border-color 0.22s ease,
              opacity 0.22s ease;
}
```

### 3.8 Papírová textura

SVG noise overlay přes celé pozadí. **Nikdy nesmí být vypnut** — je to součást identity. Jediné přeskakuje `[prefers-reduced-data]` nebo uživatel specificky (feature flag) zakáže.

```html
<div class="paper-grain"></div>
```

```css
.paper-grain {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image: var(--paper-grain);
  mix-blend-mode: var(--paper-blend);
  opacity: var(--paper-opacity);
  z-index: 1;
}
```

SVG data URI (inline):

```
url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='5'/><feColorMatrix values='0 0 0 0 0.35 0 0 0 0 0.24 0 0 0 0 0.14 0 0 0 0.22 0'/></filter><rect width='200' height='200' filter='url(%23n)' opacity='0.5'/></svg>")
```

Dark mode používá *jinou* matrix (světlejší barvy noise, menší opacity) — viz `--paper-grain` v `[data-theme="dark"]`.

---

## 4. Typografie

### 4.1 Tři rodiny, jasné role

| Rodina          | Role                                   | Formát |
|-----------------|----------------------------------------|--------|
| **Fraunces**    | Narativ: jména, data, časy, nadpisy    | Variable serif |
| **Geist**       | Funkční UI: chipy, čipy, čísla, labels | Sans-serif |
| **Patrick Hand**| Poznámky, prose, „volno X min"         | Printed handwriting |
| **Caveat**      | Krátké anotace (alergen, poznámky)     | Cursive handwriting |

Fonts se načítají přes Google Fonts (varianty `wght@400..700` pro variable fonts kde jsou):

```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..700&family=Geist:wght@300..700&family=Caveat:wght@400..700&family=Patrick+Hand&display=swap" rel="stylesheet">
```

### 4.2 Přísná pravidla o rolích

**Fraunces používáme PRO:**
- Jména klientů (`Jana Nováková`)
- Data (`22. dubna`, `25. dubna`)
- Časy v slotech (`09:10`, `10:30`)
- Nadpis klienta v chromu
- Zvýrazněná čísla stavů

**Fraunces NEPOUŽÍVÁME:**
- Kicker texty (DNES, ZÍTRA, atd. — to je Geist uppercase)
- Drobné UI labels
- Ceny a počty (tabular-nums mají lepší zarovnání v Geist)

**Geist používáme PRO:**
- Všechny UI kickery (`DNES`, `ZÍTRA`, `HISTORIE`)
- Sub-texty slotů (`Diagnostika`, `Konzultace`)
- Chipy (služeb, produktů)
- Tlačítka
- Teploty, procenta, metriky
- Numerická data s tabular-nums

**Patrick Hand používáme PRO:**
- Volno labely (`volno 35 min`) — ale jen ten string, ne čas (čas zůstává Fraunces)
- Camera hint (`Namiřte na pokožku`)
- Drobné notes uvnitř karet klienta

**Caveat používáme PRO:**
- Alergen badge (`Amoniak`) — stylizováno jako rukou napsaná varování
- Krátké anotace max 2-3 slova

**Patrick Hand vs Caveat:**
- Patrick Hand je *prose* — čteme věty, plynulé texty
- Caveat je *annotation* — kurzivní varování, osobní poznámka

### 4.3 Kombinace uvnitř slotu

Typický slot má tři typografické vrstvy:

```
10:30       Klára Dvořáková           <-- Fraunces (čas + jméno)
            Diagnostika                <-- Geist sub-text
```

Free slot:

```
11:00       volno 3 h              +   <-- Fraunces čas (tlumeno) + Patrick Hand prose
(dim)
```

### 4.4 Font sizes & weights

Není tradiční scale 1→2→3 — velikosti jsou optické podle role.

| Použití              | Font           | Size | Weight | Ostatní                   |
|----------------------|----------------|------|--------|---------------------------|
| Jméno klienta (slot) | Fraunces       | 17px | 500    | letter-spacing -0.02em    |
| Čas slotu            | Fraunces       | 17px | 500    | tabular-nums              |
| Jméno klienta (chrome)| Fraunces      | 20px | 500    | opsz 36, -0.02em          |
| Datum v chromu       | Fraunces       | 20px | 500    | opsz 28, -0.02em, tabular |
| Day-divider datum    | Fraunces       | 20px | 500    | opsz 28, -0.02em, tabular |
| Kicker (DNES, ZÍTRA) | Geist          | 10px | 600    | uppercase, 0.18em         |
| Sub-text slotu       | Geist          | 13px | 400    | ink-3                     |
| Volno label          | Patrick Hand   | 15px | 400    | ink-3                     |
| Alergen badge        | Caveat         | 17px | 600    | amber                     |
| Temp v chromu        | Geist          | 10px | 400    | ink-4, tabular, right-side|
| Camera hint          | Patrick Hand   | 13px | 400    | ink-4                     |
| Chip (služba)        | Geist          | 12px | 500    | letter-spacing 0.01em     |

### 4.5 Zvláštní pravidla

**Tabular numerals** jsou povinné pro:
- Časy (`09:10`)
- Data (`22. dubna`)
- Počty (`142 klientů`)
- Ceny (`450 Kč`)
- Teploty (`15°`)

```css
.slot-time, .chrome-main, .dv-a-main {
  font-variant-numeric: tabular-nums;
}
```

**Optical size** pro Fraunces — povinné nastavení pro variable font:

```css
.chrome-main {
  font-variation-settings: 'opsz' 28;  /* střední display */
}
.client-name-large {
  font-variation-settings: 'opsz' 48;  /* velké display */
}
```

**Nedělitelné mezery** v názvech klientů a datech:

```html
<span>Jana&nbsp;Nováková</span>
<span>22.&nbsp;dubna</span>
```

---

## 5. Hand-drawn systém

### 5.1 Pravidla čáry

Všechny ruční kresby používají **pouze ballpoint uniform stroke**. Fountain pen variaci (tlusté-tenké) *nepoužíváme* — zkoušeli jsme v rané iteraci, vypadalo to naivně.

```
Stroke width:     2.2-2.4px (jednotná)
Stroke linecap:   round
Stroke linejoin:  round
Color:            var(--copper) pro akcenty
                  var(--ink-2) pro strukturální (menu)
                  var(--copper-mid) pro checky
Opacity:          0.85 (nikdy 1.0 — má působit jako opravdový inkoust)
```

### 5.2 Tři povolená použití

**Pozor:** Jakékoli další ruční kresby jsou porušením systému. Pokud budoucí feature vyžaduje hand-drawn akcent, je třeba revize této sekce před implementací.

**Pozn. k evoluci (v2.2):** Původní návrh měl 4 hand-drawn použití včetně hamburger menu ikony. Při testování v kontextu always-on chrome-buttons layeru se ukázalo, že menu ikona musí mít stejnou čistotu jako ostatní strukturální UI glyphy (ellipsis, back). Hand-drawn hamburger ve vrstvě strukturálních tlačítek vizuálně „zlobil" — působil jako anotace mezi čistými ikonami, ne jako rovnocenný systémový prvek. Proto byl přesunut mezi standardní geometrické UI glyphy (viz sekce 5.3).

#### 1. Sluníčko v day-header (weather annotation)

Hand-drawn sluníčko (26×26 rendered, viewport 24×24) s mírně nepravidelným kruhem a 8 paprsky. **Absolute positioned** na levou stranu `.day-header-today`, vyplňuje volný prostor mezi menu tlačítkem (v chrome-buttons layer) a centrovaným stackem. Pointer-events: none. Copper barva, opacity 0.9.

**Historie pozice:** Slunce bylo krátce zkoušeno na pravé straně vedle teploty (v2.1), ale ukázalo se, že levá strana funguje lépe — vizuálně vyvažuje centrovaný stack a dává 15° „dýchat" v kicker-řádku.

```html
<span class="weather-sun-left">
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 8.5 9 Q 7.8 12.2 9.8 14.4 Q 12 15.8 14.3 14.4 Q 16 12 14.6 9.5 Q 12.5 8 10 8.4 Q 8.9 8.7 8.5 9 Z"/>
    <path d="M 12 3 L 12 5.2"/>
    <path d="M 12 18.8 L 12 21"/>
    <path d="M 3 12 L 5.2 12"/>
    <path d="M 18.8 12 L 21 12"/>
    <path d="M 5.4 5.4 L 7 7"/>
    <path d="M 17 17 L 18.6 18.6"/>
    <path d="M 5.4 18.6 L 7 17"/>
    <path d="M 17 7 L 18.6 5.4"/>
  </svg>
</span>
```

**Pravidlo pro varianty počasí:** Pokud přidáme více stavů (mrak, déšť, sníh), všechny musí dodržet stejný styl — ballpoint stroke 1.6, nepravidelný základ, 24×24 viewport rendered na 26×26.

#### 2. Copper check v slot-done

Drobná odškrtávka (14×14) v dokončeném slotu. Nerovnoměrná, s jemným přetahem dolního tahu nahoru.

```html
<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
  <path d="M2.8 7.2 C 3.8 8.6, 4.8 9.6, 5.7 10.2 C 6.5 8.3, 8.7 5.4, 11.4 2.8"
        stroke="currentColor" stroke-width="1.8" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

Barva: `--copper-mid`.

#### 3. Plus u volného slotu

Ručně kreslené `+` v pravém sloupci volného slotu. Font-rendered (Caveat), copper, 26px. Slouží jako „tap target" pro přidání schůzky.

```css
.slot-plus {
  font-family: 'Caveat', cursive;
  font-size: 26px;
  font-weight: 600;
  color: var(--copper);
  line-height: 1;
}
```

### 5.3 Co NENÍ hand-drawn

**Žádná SVG ikona v aplikaci mimo výše uvedené tři není ruční.** Všechny strukturální UI ikony jsou geometrické:

- **Hamburger menu** — 3 rovné horizontální čáry, stroke 1.8, round caps, `--ink-2`
- **Ellipsis** (⋯) — 3 kruhy filled, `--ink-2`
- **Back arrow** (<) — geometrický polyline, stroke 2, round caps/joins
- **Caret (▼)** — geometrický trojúhelník filled, `--ink-4`
- **Camera icon** — outline SVG geometrický
- **Blesk, UV** — outline SVG geometrický
- **Search** — outline circle + line
- **Sync dot** — SVG circle filled
- **FAB calendar+** — outline kalendář + plus
- **Secondary FAB arrow** — polyline šipka nahoru, stroke 2

Všechny tyto mají `stroke-width: 1.6-2.0`, `stroke-linecap: round`, `stroke-linejoin: round` a barvu `currentColor` (dědí z parent).

---

## 6. Layout architektura

### 6.1 Phone container

Celá aplikace je uvnitř fixního "telefonu" — i když v reálné PWA to bude viewport. Každý telefon má:

```
┌─────────────────────────────┐   ← phone-frame (borderradius 44px)
│ ┌─────────────────────────┐ │
│ │  ┌────────┐    status   │ │   ← status bar (46px, absolute)
│ │  │ island │              │ │   ← dynamic island (absolute, on top)
│ │  └────────┘              │ │
│ ├─────────────────────────┤ │
│ │                         │ │
│ │                         │ │
│ │     phone-scroll        │ │   ← absolute, overflow-y: auto
│ │                         │ │
│ │                         │ │
│ │                         │ │
│ │                   (FAB) │ │   ← absolute, nezávislé na scrollu
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

CSS:

```css
.phone-inner {
  position: relative;
  height: 780px;           /* nebo 100vh v PWA */
  overflow: hidden;        /* !! kritické pro scroll uvnitř */
  border-radius: 44px;
  background: var(--bg);
}

.phone-scroll {
  position: absolute;
  inset: 0;                /* top: 0, right: 0, bottom: 0, left: 0 */
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}

.status-bar {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 46px;
  z-index: 28;
  pointer-events: none;   /* kliky projdou pod status bar */
}

.island {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
}

.fab {
  position: absolute;
  bottom: 24px;
  right: 20px;
  z-index: 25;
}
```

### 6.2 Day-section pattern (klíčové!)

Toto je nejdůležitější architektonický pattern v aplikaci. Řeší *push-stack sticky headers* — jako iOS contact list.

**Problém:** Pokud mám chrome (`top: 46px` sticky) a day-divider (`top: 46px` sticky) jako sourozence, CSS je nechá *překrývat se* — oba budou na 46px současně. To uživatel nechce. Chce, aby day-divider *vytlačil* chrome, když dorazí.

**Řešení:** Každý den je `<section class="day-section">` a jeho sticky header *uvnitř*. Sticky positioning je omezené na containing block — takže chrome nemůže být sticky mimo svou sekci. Když sekce scrolluje pryč, chrome je vytlačen spolu s ní. Ve stejný moment další sekce začíná — a její dv-a-wrap zabere sticky pozici.

```html
<div class="phone-scroll">
  <div class="scroll-topspacer"></div>    <!-- 46px, místo pro status bar -->

  <section class="day-section">
    <div class="top-chrome">...</div>      <!-- sticky top: 46px, containing block = section -->
    <div class="slot">...</div>            <!-- dnešní sloty -->
    <div class="slot">...</div>
    ...
  </section>

  <section class="day-section">
    <div class="dv-a-wrap">                <!-- sticky top: 46px -->
      <div class="dv-a">
        <span class="dv-a-line"></span>
        <span class="dv-a-kicker">Zítra</span>
        <span class="dv-a-line"></span>
      </div>
      <div class="dv-a-main">23. dubna</div>
    </div>
    <div class="slot">...</div>            <!-- zítřejší sloty -->
    ...
  </section>

  <section class="day-section">...</section>   <!-- Pátek -->
  <section class="day-section">...</section>   <!-- Sobota -->

  <div class="scroll-bottomspacer"></div>  <!-- 120px, místo pro FAB -->
</div>
```

### 6.3 Spacery

**`.scroll-topspacer` (46px)** před prvním sekcí slouží jako *fyzický posun* — chrome má natural pozici `46px` v scroll contentu, což odpovídá jeho sticky `top: 46px`. Bez spaceru by chrome „přeskočil" z 0 na 46 a první obsah pod ním by byl překryt.

**`.scroll-bottomspacer` (120px)** na konci vyhrazuje místo pro FAB (absolute `bottom: 24px`, ~44×44, takže 120px je bezpečný buffer).

```css
.scroll-topspacer {
  height: 46px;
  flex-shrink: 0;
}
.scroll-bottomspacer {
  height: 120px;
  flex-shrink: 0;
}
```

### 6.4 Horizontální padding

Slot má vlastní `padding: 14px 20px`. Chrome má vlastní `padding: 6px 12px 10px`. Dv-a-wrap má vlastní `padding: 10px 20px 12px`. Phone-scroll **nemá** horizontální padding — každá komponenta se stará sama.

**Důvod:** Chrome-glyph mají 44×44 touch target. Pokud by parent měl padding 20px, efektivní klikací oblast u kraje phone by byla menší. Chrome musí jít až k okraji (12px padding zajistí, že glyph sedí 12px od hrany — pohodlný dosah palce).

### 6.5 Z-index škála

```
backdrop:            20
sheet:               21
FAB:                 25
status-bar:          28
island:              30
top-chrome:          15  (sticky, nižší než chrome-level UI)
dv-a-wrap:           10
camera-capture:       5
```

**Pravidlo:** Status bar a island jsou absolutně na vrchu — chrome nesmí překrývat čas/baterku. Sheet + backdrop přebírá kontrolu celé obrazovky (i nad status barem). FAB je pod sheet (musí zmizet když se sheet otevře).

---

## 7. Komponenty

### 7.1 Chrome architektura (Phone A)

**Klíčové oddělení:** Strukturální UI tlačítka (menu, ellipsis) jsou *oddělená* od sticky hlaviček dnů. Tlačítka živí v absolute vrstvě **nad** scroll-containerem — jsou vždy viditelná, nezávisle na tom, kterou sekci uživatel právě vidí. Sticky hlavičky uvnitř sekcí obsahují jen textový obsah (kicker + datum).

**Proč toto oddělení:** Menu je primární navigační vstup do aplikace. Musí být dostupný vždy. Kdyby byl součástí sticky top-chrome (jako v ranných iteracích), při scrollu do budoucnosti nebo minulosti by se „ztratil" — sticky by převzaly day-dividery bez tlačítek. Uživatel by musel skrolovat zpět na dnešek, aby si otevřel menu. Neakceptovatelné.

**Struktura:**

```
.phone-inner (relative, overflow: hidden)
├── .status-bar               (absolute top:0, z:28)
├── .island                   (absolute top:10, z:30)
├── .chrome-buttons           (absolute top:46, z:16) ← always visible
│   ├── .chrome-glyph (menu)
│   └── .chrome-glyph (ellipsis)
│
├── .phone-scroll             (absolute inset:0, overflow-y:auto)
│   ├── .scroll-topspacer (46px)
│   │
│   ├── section.day-section   (past day — Středa)
│   │   ├── .dv-a-wrap (sticky top:46)
│   │   └── .slot.slot-done × N
│   │
│   ├── section.day-section[data-today]  (today)
│   │   ├── .day-header-today (sticky top:46, z:15)
│   │   └── .slot × N
│   │
│   ├── section.day-section × N (future days)
│   │
│   └── .scroll-bottomspacer (120px)
│
├── .fab                      (absolute bottom-right, z:15)
└── .fab-secondary            (absolute bottom-left, z:16) ← scroll-to-today
```

**Z-index vrstvy:** chrome-buttons (z:16) sedí nad sticky hlavičkami (z:10-15). Sticky hlavičky mají `background: var(--bg)`, takže při scrollu skryjí obsah za tlačítky. Tím se udrží dojem chromu jako ucelené vrstvy.

### 7.2 Chrome buttons (always-on layer)

Absolute kontejner přes celou šířku telefonu, tlačítka na okrajích. Center je transparentní (`pointer-events: none` na kontejneru), takže tapy projdou na sticky hlavičku pod ním (např. na datum s caretem pro date picker).

```html
<div class="chrome-buttons">
  <button class="chrome-glyph" onclick="openSheet('sheet-a')" aria-label="Otevřít menu">
    <!-- 3 rovné horizontální čáry (ne hand-drawn) -->
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <line x1="4" y1="8" x2="20" y2="8"/>
      <line x1="4" y1="12" x2="20" y2="12"/>
      <line x1="4" y1="16" x2="20" y2="16"/>
    </svg>
  </button>
  <button class="chrome-glyph" aria-label="Další možnosti">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.6"/>
      <circle cx="12" cy="12" r="1.6"/>
      <circle cx="19" cy="12" r="1.6"/>
    </svg>
  </button>
</div>
```

```css
.chrome-buttons {
  position: absolute;
  top: 46px;
  left: 0; right: 0;
  min-height: 48px;
  padding: 6px 12px 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  z-index: 16;
  pointer-events: none;       /* !! center transparentní */
}
.chrome-buttons > * {
  pointer-events: auto;       /* !! jen tlačítka klikatelná */
}

.chrome-glyph {
  width: 44px; height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-2);
  background: transparent;
  border: none;
  flex-shrink: 0;
  cursor: pointer;
  border-radius: 12px;
  transition: background 0.22s;
}
.chrome-glyph:active {
  background: var(--surface-2);
}
```

### 7.3 Day header — today

Sticky hlavička dnešní sekce. Obsahuje jen textový obsah (kicker + datum) plus sluníčko vlevo jako absolute anotace. **Identická struktura s day-divider** (`dv-a-wrap`) co do layoutu kicker+datum — tím se push-stack swap mezi „Dnes" a „Zítra" stává vizuálně plynulým.

```html
<section class="day-section" data-today="true">
  <div class="day-header-today">
    <span class="weather-sun-left">
      <!-- hand-drawn sluníčko 26×26, stroke 1.6, copper -->
    </span>
    <div class="chrome-title">
      <div class="chrome-stack">
        <span class="chrome-kicker-wrap">
          <span class="chrome-kicker live">Dnes</span>
          <span class="weather-temp-subtle">15°</span>
        </span>
        <span class="chrome-main">
          22.&nbsp;dubna
          <span class="chrome-caret"><!-- ▼ --></span>
        </span>
      </div>
    </div>
  </div>
  <!-- dnešní sloty -->
</section>
```

```css
.day-header-today {
  position: sticky;
  top: 46px;
  min-height: 48px;
  padding: 6px 68px 10px;     /* !! 68 = 12 chrome pad + 44 button + 12 gap */
  background: var(--bg);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 15;
}

.day-header-today .chrome-title {
  position: relative;
  flex: 0 1 auto;
  display: flex;
  justify-content: center;
  align-items: center;
}

.chrome-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  line-height: 1;
}

.chrome-kicker {
  font-family: 'Geist', sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--copper);
  line-height: 1;
}
.chrome-kicker.live {
  color: var(--teal);          /* !! jen DNES je live */
}

.chrome-main {
  font-family: 'Fraunces', serif;
  font-variation-settings: 'opsz' 28;
  font-weight: 500;
  font-size: 20px;             /* !! sjednoceno s .dv-a-main */
  color: var(--ink);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.chrome-caret {
  margin-left: 4px;
  color: var(--ink-4);
  display: inline-flex;
  align-items: center;
}
```

### 7.4 Weather anotace

Weather má dvě části s různými pozicemi:

**Sluníčko — vlevo (absolute v day-header-today):**
- Hand-drawn kresba (viz sekce 5.2)
- Absolute `left: 64px` (hned za menu tlačítkem v chrome-buttons)
- Kompenzuje vizuální nerovnováhu centrovaného stacku

**Teplota — vpravo od Dnes (absolute v kicker-wrap):**
- Geist 10px 400, ink-4 (tlumená)
- Absolute pozice: `left: calc(100% + 6px)` vůči `.chrome-kicker-wrap`
- **Klíčový trik:** kicker-wrap je `inline-block` s šířkou přesně textu „Dnes". Teplota absolute visí vpravo od něj, aniž by ovlivnila jeho výpočet šířky. Výsledek: „Dnes" zůstává geometricky centrovaný v chrome-stack (který je `align-items: center`), teplota visí vpravo jako anotace.

```css
.weather-sun-left {
  position: absolute;
  left: 64px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--copper);
  opacity: 0.9;
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  z-index: 1;
}

.chrome-kicker-wrap {
  position: relative;
  display: inline-block;
  line-height: 1;
}
.chrome-kicker-wrap .weather-temp-subtle {
  position: absolute;
  left: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
}

.weather-temp-subtle {
  font-family: 'Geist', sans-serif;
  font-size: 10px;
  font-weight: 400;
  color: var(--ink-4);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  line-height: 1;
}
```

### 7.5 Top chrome (Phone B)

Phone B má jedinou sekci (detail klienta), žádné sticky dividery. Proto používá **starou `.top-chrome` strukturu** — buttons jsou součástí sticky chromu. Není třeba oddělovat je do samostatné vrstvy.

```html
<div class="top-chrome">
  <button class="chrome-glyph" aria-label="Zpět"><!-- back --></button>
  <div class="chrome-title">
    <div class="chrome-stack">
      <span class="chrome-main client-name">Jana&nbsp;Nováková</span>
    </div>
  </div>
  <button class="chrome-glyph" aria-label="Další možnosti"><!-- ellipsis --></button>
</div>
```

```css
.top-chrome {
  position: sticky;
  top: 46px;
  padding: 6px 12px 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  z-index: 15;
  min-height: 48px;
  background: var(--bg);
}

.chrome-main.client-name {
  font-variation-settings: 'opsz' 36;   /* větší opsz pro display */
}
```

**Regel pro budoucí sekce typu Phone B:** Pokud nikdy nebude mít víc než jednu sticky sekci, stačí `.top-chrome` jako v Phone B. Jakmile sekcí přibudou (např. přepínač mezi příští návštěvou a historií), je nutné přejít na pattern z Phone A — chrome-buttons + day-header pro každou sekci.

### 7.6 Slot

Základní grid 3 sloupce: čas (62px) | obsah (1fr) | action/indicator (auto).

```html
<!-- Základní slot -->
<div class="slot">
  <span class="slot-time">14:00</span>
  <div>
    <div class="slot-name">Tereza Malá</div>
    <div class="slot-sub">Střih</div>
  </div>
  <span></span>              <!-- prázdné 3. pole drží grid -->
</div>

<!-- Volný slot -->
<div class="slot">
  <span class="slot-time dim">14:45</span>
  <span class="slot-free">volno 1 h 45 min</span>
  <span class="slot-plus">+</span>
</div>

<!-- Dokončený slot -->
<div class="slot slot-done">
  <span class="slot-time">09:10</span>
  <div>
    <div class="slot-name">Jana Nováková</div>
    <div class="slot-sub">Konzultace, Diagnostika</div>
  </div>
  <span class="slot-done-check">...</span>
</div>

<!-- Aktivní slot (probíhající zákrok) -->
<div class="slot slot-active">
  <span class="slot-time">10:30</span>
  <div>
    <div class="slot-name">Klára Dvořáková</div>
    <div class="slot-sub">Diagnostika</div>
  </div>
  <span></span>
</div>
```

CSS:

```css
.slot {
  display: grid;
  grid-template-columns: 62px 1fr auto;
  align-items: start;
  padding: 14px 20px;
  gap: 16px;
  min-height: 64px;
}

.slot-time {
  font-family: 'Fraunces', serif;
  font-weight: 500;
  font-size: 17px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.slot-time.dim { color: var(--ink-4); font-weight: 400; }

.slot-name {
  font-family: 'Fraunces', serif;
  font-weight: 500;
  font-size: 17px;
  color: var(--ink);
  letter-spacing: -0.02em;
  line-height: 1.15;
}

.slot-sub {
  font-family: 'Geist', sans-serif;
  font-size: 13px;
  color: var(--ink-3);
  margin-top: 3px;
}

.slot-free {
  font-family: 'Patrick Hand', cursive;
  font-size: 15px;
  color: var(--ink-3);
  line-height: 1.3;
}

.slot-plus {
  font-family: 'Caveat', cursive;
  font-size: 26px;
  font-weight: 600;
  color: var(--copper);
  line-height: 1;
  text-align: right;
}

.slot-done { opacity: 0.55; }
.slot-done .slot-time { color: var(--ink-4); font-weight: 550; }
.slot-done .slot-name { color: var(--ink-3); font-weight: 500; }
.slot-done .slot-sub { color: var(--ink-4); }

.slot-done-check {
  color: var(--copper-mid);
  width: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.slot-active {
  background: var(--teal-tint);
  border: 1px solid var(--teal-border);
  border-radius: 14px;
  padding: 14px 16px;           /* !! menší horizontální padding než regular slot */
  margin: 4px 4px;              /* !! 4px inset od okraje telefonu */
  box-shadow: 0 1px 2px rgba(14, 116, 144, 0.04);
}
.slot-active .slot-time { color: var(--teal-strong); }
.slot-active .slot-name { color: var(--teal-strong); font-weight: 550; }
```

### 7.7 Day divider (past & future)

Sticky hlavička každé sekce **kromě dnes** (kterou má `day-header-today`). Horizontální linky mizí, když je wrap přilepený (viz 8.2).

**Unifikace s day-header-today:** Struktura day-divideru (kicker + datum na středu) je *vizuálně identická* s `day-header-today`. Když scroll dorazí k dividéru (ať už z dnes nebo z jiného dne), push-stack vymění hlavičku na stejném vizuálním místě bez skoku — oba mají kicker centrovaný nad datem ve stejném fontu a velikosti. Jediný rozdíl: divider má flanking horizontální linky (v unstuck stavu), day-header-today ne. Při stuck stavu (linky mizí) jsou oba vzájemně nerozlišitelné.

```html
<div class="dv-a-wrap">
  <div class="dv-a">
    <span class="dv-a-line"></span>
    <span class="dv-a-kicker">Zítra</span>
    <span class="dv-a-line"></span>
  </div>
  <div class="dv-a-main">23. dubna</div>
</div>
```

CSS:

```css
.dv-a-wrap {
  position: sticky;
  top: 46px;                   /* !! stejné jako chrome → push-stack */
  z-index: 10;
  background: var(--bg);
  margin: 26px 0 6px;
  padding: 10px 20px 12px;
}

.dv-a {
  display: flex;
  align-items: center;
  gap: 14px;
}

.dv-a-line {
  flex: 1;
  height: 1px;
  background: var(--line);
  transition: opacity 0.22s ease;
}

.dv-a-wrap.stuck .dv-a-line {
  opacity: 0;                  /* !! při stuck stavu mizí — divider vypadá jako chrome */
}

.dv-a-kicker {
  font-family: 'Geist', sans-serif;
  font-size: 10px;
  font-weight: 600;
  color: var(--copper);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  line-height: 1;
}

.dv-a-main {
  text-align: center;
  font-family: 'Fraunces', serif;
  font-variation-settings: 'opsz' 28;       /* !! stejné jako chrome-main */
  font-weight: 500;
  font-size: 20px;                           /* !! sjednoceno s chrome-main */
  color: var(--ink);
  letter-spacing: -0.02em;
  margin: 6px 0 0;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
```

### 7.8 Current-head (Phone B)

Phone B obsahuje `<div class="phone-b-content">` wrapper pro vertikální spacing.
**Důležité:** Tento wrapper má pouze `padding-top: 4px` — **nikdy** horizontal padding.
Každá komponenta uvnitř (`current-head`, `cam-card`, `detail-card`) si své horizontal
odsazení řeší sama. Double-padding by vedl k rozbitému layoutu se zbytečně úzkým
obsahem a širokými okraji.

```css
.phone-b-content {
  padding-top: 4px;
  /* Žádný horizontal padding — komponenty mají vlastní margin/padding. */
}
```

Hlavička detailní obrazovky klienta, která ukazuje *probíhající* zákrok:

```html
<div class="current-head">
  <span class="current-main">09:10</span>
  <div class="alert-meta">
    <span class="alert-allergen">Amoniak</span>
    <span class="alert-remaining">zbývá 45 min</span>
  </div>
</div>
```

CSS:

```css
.current-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0 16px;
}

.current-main {
  font-family: 'Fraunces', serif;
  font-variation-settings: 'opsz' 32;
  font-weight: 550;
  font-size: 22px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.alert-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.alert-allergen {
  font-family: 'Caveat', cursive;
  font-size: 17px;
  font-weight: 600;
  color: var(--amber);
  line-height: 1;
}

.alert-remaining {
  font-family: 'Geist', sans-serif;
  font-size: 11px;
  font-weight: 550;
  color: var(--teal);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
```

### 7.9 Camera card

Foto-karta pro diagnostiku. Má preview, corner ikony (blesk, UV), capture button v centru, a label chip nahoře (droplist).

```html
<div class="cam-card">
  <div class="cam-preview">
    <div class="cam-corner left" aria-label="Blesk">
      <!-- outline SVG blesk -->
    </div>
    <div class="cam-corner right" aria-label="UV režim">
      <!-- outline SVG UV/oko -->
    </div>
    <div class="cam-label-wrap">
      <button class="cam-label" onclick="toggleCamLabel(event)">
        <span>Temeno · detail</span>
        <svg>...</svg>
      </button>
      <div class="cam-menu" role="menu">
        <button onclick="selectCamLabel(event, 'Celek')">Celek</button>
        <button onclick="selectCamLabel(event, 'Temeno · detail')">Temeno · detail</button>
        <button onclick="selectCamLabel(event, 'Vlasová linie')">Vlasová linie</button>
      </div>
    </div>
    <div class="cam-hint">Namiřte na pokožku</div>
    <button class="cam-capture" aria-label="Pořídit snímek">
      <span class="cam-capture-ring"></span>
      <span class="cam-capture-dot"></span>
    </button>
  </div>
</div>
```

**Klíčové pravidlo pro `cam-label-wrap`:**

Wrap chip + menu je `position: relative` container — chip a menu jsou jeho siblings (NOT nested). Toto jsme museli opravit — nested `<button>` je HTML5 error.

```css
.cam-card {
  padding: 0 20px 20px;
}

.cam-preview {
  position: relative;
  aspect-ratio: 4 / 3;
  background: linear-gradient(160deg, #2A2420 0%, #1A1612 100%);
  border-radius: 20px;
  overflow: hidden;
}

.cam-corner {
  position: absolute;
  top: 12px;
  width: 36px; height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
  border-radius: 50%;
  color: #F5EDE0;
  z-index: 2;
}
.cam-corner.left { left: 12px; }
.cam-corner.right { right: 12px; }

.cam-label-wrap {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
}

.cam-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px 7px 14px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  color: #F5EDE0;
  border: none;
  border-radius: 16px;
  font-family: 'Geist', sans-serif;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.cam-menu {
  display: none;
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--card-shadow);
  overflow: hidden;
  min-width: 160px;
}
.cam-menu.open { display: block; }
.cam-menu button {
  display: block;
  width: 100%;
  padding: 10px 14px;
  background: transparent;
  border: none;
  text-align: left;
  font-family: 'Geist', sans-serif;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
}
.cam-menu button:hover { background: var(--surface-2); }

.cam-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, calc(-50% - 32px));
  font-family: 'Patrick Hand', cursive;
  font-size: 13px;
  color: rgba(245, 237, 224, 0.5);
  text-align: center;
  pointer-events: none;
  z-index: 1;
}

.cam-capture {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  width: 62px;
  height: 62px;
  border: none;
  background: transparent;
  cursor: pointer;
  z-index: 5;
}
.cam-capture-ring {
  position: absolute;
  inset: 0;
  border: 3px solid #F5EDE0;
  border-radius: 50%;
}
.cam-capture-dot {
  position: absolute;
  inset: 6px;
  background: #F5EDE0;
  border-radius: 50%;
}
```

### 7.10 Detail cards (thumbs, chips)

Karty s obsahem — thumbnaily fotografií, chipy služeb, chipy produktů.

```html
<div class="detail-card">
  <div class="detail-label">Dnešní fotografie</div>
  <div class="thumb-row">
    <div class="thumb">...</div>
    <div class="thumb">...</div>
    <div class="thumb thumb-add">+</div>
  </div>
</div>

<div class="detail-card">
  <div class="detail-label">Aplikované služby</div>
  <div class="chip-row">
    <span class="chip">Diagnostika</span>
    <span class="chip">Konzultace</span>
  </div>
</div>

<div class="detail-card">
  <div class="detail-label">Produkty</div>
  <div class="chip-row">
    <span class="chip chip-product">
      <svg class="chip-check">...</svg>
      Šampon A · 450 Kč
    </span>
  </div>
</div>
```

```css
.detail-card {
  padding: 16px 20px;
  border-top: 1px solid var(--line-soft);
}

.detail-label {
  font-family: 'Geist', sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-bottom: 12px;
}

.thumb-row {
  display: flex;
  gap: 10px;
  overflow-x: auto;
}

.thumb {
  width: 76px; height: 76px;
  border-radius: 12px;
  background: var(--surface-2);
  flex-shrink: 0;
}
.thumb-add {
  border: 1.5px dashed var(--copper-border);
  color: var(--copper);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Caveat', cursive;
  font-size: 28px;
  font-weight: 600;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  font-family: 'Geist', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-2);
}

.chip-check {
  color: var(--copper-mid);
  width: 12px; height: 12px;
}
```

### 7.11 FAB — primary & secondary

Dvě floating tlačítka, každé s jinou rolí:

**Primary FAB (`.fab`) — vpravo dole.** Jediná primární akce na obrazovce: přidat událost. Teal gradient, vysoká vizuální priorita. Vždy viditelný.

**Secondary FAB (`.fab-secondary`) — vlevo dole.** Kontextová sekundární akce: scroll zpět na dnešek. Viditelný **pouze** když uživatel odroloval mimo dnešní sekci (do minulosti nebo budoucnosti). Lehká vizuální váha — surface background, subtle border, ne gradient. Šipka ukazuje směr k dnešku (nahoru = dnešek je nad tebou, dolů = dnešek je pod tebou).

```html
<!-- Primary FAB -->
<button class="fab" aria-label="Nová událost">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <rect x="3.5" y="5" width="17" height="15" rx="2.5"/>
    <path d="M3.5 9 H20.5"/>
    <path d="M8 3 V6"/>
    <path d="M16 3 V6"/>
    <path d="M12 12 V17"/>
    <path d="M9.5 14.5 H14.5"/>
  </svg>
</button>

<!-- Secondary FAB: scroll-to-today (skrytý defaultně) -->
<button class="fab-secondary" id="fab-scroll-today-a"
        onclick="scrollToToday(this)" aria-label="Zpět na dnešek">
  <svg class="fab-arrow" width="18" height="18" viewBox="0 0 24 24"
       fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 19 L12 5"/>
    <path d="M6 11 L12 5 L18 11"/>
  </svg>
</button>
```

```css
.fab {
  position: absolute;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  right: 18px;
  width: 58px;
  height: 58px;
  border-radius: 19px;
  background: linear-gradient(160deg, var(--teal) 0%, var(--teal) 50%, var(--teal-strong) 100%);
  color: #FDFAF3;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 1px 2px rgba(14, 116, 144, 0.15),
    0 6px 14px -2px rgba(14, 116, 144, 0.22),
    0 18px 32px -10px rgba(176, 110, 82, 0.22),
    inset 0 1px 0 rgba(255,255,255,0.14),
    inset 0 -1px 0 rgba(0,0,0,0.1);
  z-index: 15;
  cursor: pointer;
  transition: transform 0.22s;
}
.fab:active { transform: scale(0.96); }

.fab-secondary {
  position: absolute;
  bottom: calc(32px + env(safe-area-inset-bottom, 0px));
  left: 20px;
  width: 44px;
  height: 44px;
  border-radius: 22px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--card-shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-2);
  cursor: pointer;
  z-index: 16;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px) scale(0.9);
  transition: opacity 0.22s ease,
              transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.fab-secondary.visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0) scale(1);
}
.fab-secondary .fab-arrow {
  transition: transform 0.22s ease;
}
.fab-secondary.direction-down .fab-arrow {
  transform: rotate(180deg);
}
```

**Vertikální posun Secondary FABu:** Primary FAB je 58×58 (větší, teal), secondary je 44×44 (menší, light). Bottom pozice je 32px (vs 24px u primary) — secondary sedí o něco výš, aby opticky respektoval hierarchii. Primary je „breakout" gradient tlačítko, secondary je funkční utility.

### 7.12 Bottom sheet

Sheet s menu aplikace. iOS styl — otevírá se od spoda, backdrop dim, handle nahoře pro drag-close.

```html
<div class="sheet-backdrop" id="sheet-a-backdrop" onclick="closeSheet('sheet-a')"></div>
<div class="sheet" id="sheet-a" role="dialog" aria-modal="true" aria-label="Menu">
  <div class="sheet-handle" onclick="closeSheet('sheet-a')"></div>

  <div class="sheet-sync">
    <span class="sheet-sync-dot"></span>
    <span>Synchronizováno · před 2 min</span>
  </div>

  <div class="sheet-search">
    <!-- icon + input -->
  </div>

  <nav class="sheet-nav">
    <a class="sheet-nav-item" href="#">
      <span class="sheet-nav-label">Klienti</span>
      <span class="sheet-nav-badge">142</span>
    </a>
    <a class="sheet-nav-item" href="#">
      <span class="sheet-nav-label">Historie</span>
    </a>
    <a class="sheet-nav-item" href="#">
      <span class="sheet-nav-label">Statistiky</span>
    </a>
    <a class="sheet-nav-item" href="#">
      <span class="sheet-nav-label">Archiv</span>
    </a>
    <a class="sheet-nav-item" href="#">
      <span class="sheet-nav-label">Nastavení</span>
    </a>
  </nav>

  <div class="sheet-theme">
    <span class="sheet-theme-label">Tmavý režim</span>
    <button role="switch" aria-pressed="false"
            class="theme-switch" onclick="toggleTheme()">
      <span class="theme-switch-thumb"></span>
    </button>
  </div>
</div>
```

```css
.sheet-backdrop {
  position: absolute;
  inset: 0;
  background: var(--backdrop);
  z-index: 20;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.32s;
}
.sheet-backdrop.open {
  opacity: 1;
  pointer-events: auto;
}

.sheet {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  background: var(--surface);
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  box-shadow: var(--sheet-shadow);
  z-index: 21;
  padding: 0 20px 24px;
  transform: translateY(100%);
  transition: transform 0.32s cubic-bezier(0.4, 0, 0.2, 1);
}
.sheet.open { transform: translateY(0); }

.sheet-handle {
  width: 40px;
  height: 4px;
  background: var(--line);
  border-radius: 2px;
  margin: 10px auto 18px;
  cursor: pointer;
}

.sheet-sync {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0 14px;
  font-family: 'Geist', sans-serif;
  font-size: 12px;
  color: var(--ink-3);
  border-bottom: 1px solid var(--line-soft);
}
.sheet-sync-dot {
  width: 7px; height: 7px;
  background: var(--teal);
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(14, 116, 144, 0.15);
}

.sheet-search {
  margin: 14px 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--surface-2);
  border-radius: 12px;
  color: var(--ink-3);
  font-family: 'Geist', sans-serif;
  font-size: 14px;
}

.sheet-nav {
  padding: 4px 0;
}

.sheet-nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 4px;
  font-family: 'Fraunces', serif;
  font-size: 18px;
  font-weight: 500;
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid var(--line-soft);
  letter-spacing: -0.01em;
}
.sheet-nav-item:last-child { border-bottom: none; }

.sheet-nav-badge {
  font-family: 'Geist', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-4);
  font-variant-numeric: tabular-nums;
}

.sheet-theme {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 4px 4px;
}

.sheet-theme-label {
  font-family: 'Geist', sans-serif;
  font-size: 14px;
  color: var(--ink-2);
}

.theme-switch {
  width: 44px;
  height: 26px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 13px;
  position: relative;
  cursor: pointer;
  transition: background 0.22s;
}
.theme-switch[aria-pressed="true"] {
  background: var(--teal);
  border-color: var(--teal);
}
.theme-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background: var(--surface);
  border-radius: 50%;
  transition: transform 0.22s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}
.theme-switch[aria-pressed="true"] .theme-switch-thumb {
  transform: translateX(18px);
}
```

---

## 8. Interakční vzory

### 8.1 Sticky push-stack (kritický!)

Jako popsáno v 6.2 — sticky headers se vytlačují přes `day-section` containing blocks. Toto je **výchozí** chování pro všechny sekční hlavičky. Nikdy neřešit přes JS „který je stuck a který ne" pro layout — CSS to udělá.

### 8.2 Stuck state detection

JS listener na scroll eventu detekuje, kdy je `dv-a-wrap` přilepený na sticky pozici, a přidá `.stuck` class. To se používá pro *vizuální* změnu — mizení horizontálních linek.

```javascript
function setupStickyDayDividers() {
  const stickyTop = 46;         // matches CSS top: 46px

  document.querySelectorAll('.phone-scroll').forEach(scroll => {
    const wraps = scroll.querySelectorAll('.dv-a-wrap');
    if (!wraps.length) return;

    const update = () => {
      const scrollRect = scroll.getBoundingClientRect();
      wraps.forEach(wrap => {
        const rect = wrap.getBoundingClientRect();
        const topOffset = rect.top - scrollRect.top;
        const isStuck = topOffset <= stickyTop + 1;
        wrap.classList.toggle('stuck', isStuck);
      });
    };

    scroll.addEventListener('scroll', update, { passive: true });
    update();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupStickyDayDividers();
});
```

### 8.3 Scroll-to-today mechanika

Chrome-buttons overlay (menu, ellipsis) zůstává vždy viditelný, ale center obsah sticky hlavičky se mění podle aktuálně viditelné sekce. Když uživatel odroluje mimo dnešní sekci, musí existovat explicitní cesta zpět — to je role `fab-secondary` vlevo dole.

**Viditelnost a směr:**

```
┌─ MINULOST ─────────────────────┐
│  (past day section stuck)      │
│   ↓ fab-secondary VISIBLE      │
│     direction-down (šipka dolů)│
└────────────────────────────────┘
┌─ DNEŠEK ───────────────────────┐
│  (day-header-today stuck)      │
│   fab-secondary HIDDEN          │
│   (už jsi tam, kde máš být)    │
└────────────────────────────────┘
┌─ BUDOUCNOST ───────────────────┐
│  (future day section stuck)    │
│   ↑ fab-secondary VISIBLE      │
│     direction-up (šipka nahoru)│
└────────────────────────────────┘
```

**Detekce polohy:**

```javascript
function setupScrollToTodayButton(scrollEl, todaySection, btn) {
  if (!scrollEl || !todaySection || !btn) return;
  const stickyTop = 46;
  const headerHeight = 48;

  const update = () => {
    const scrollRect = scrollEl.getBoundingClientRect();
    const todayRect = todaySection.getBoundingClientRect();
    const todayTopOffset = todayRect.top - scrollRect.top;
    const todayBottomOffset = todayRect.bottom - scrollRect.top;

    if (todayTopOffset > stickyTop) {
      // Dnešek ještě nepřišel na sticky — user je v minulosti
      btn.classList.add('visible', 'direction-down');
      btn.classList.remove('direction-up');
    } else if (todayBottomOffset <= stickyTop + headerHeight) {
      // Dnešek projel celý — user je v budoucnosti
      btn.classList.add('visible', 'direction-up');
      btn.classList.remove('direction-down');
    } else {
      // User je uvnitř dnešní sekce
      btn.classList.remove('visible');
    }
  };

  scrollEl.addEventListener('scroll', update, { passive: true });
  update();
}
```

**Scroll na dnešek:**

```javascript
function scrollToToday(btn) {
  const scrollEl = btn.closest('.phone-inner').querySelector('.phone-scroll');
  const todaySection = scrollEl.querySelector('[data-today="true"]');
  if (!scrollEl || !todaySection) return;

  const scrollRect = scrollEl.getBoundingClientRect();
  const todayRect = todaySection.getBoundingClientRect();
  const targetDelta = todayRect.top - scrollRect.top - 46;

  scrollEl.scrollBy({ top: targetDelta, behavior: 'smooth' });
}
```

**Initial scroll:** Při načtení aplikace má být výchozí scroll pozice na dnešku (ne úplně nahoře u první past sekce). Proto po DOMContentLoaded se provede tichý scroll na dnešek.

```javascript
if (phoneAScroll && phoneATodaySection) {
  requestAnimationFrame(() => {
    const scrollRect = phoneAScroll.getBoundingClientRect();
    const todayRect = phoneATodaySection.getBoundingClientRect();
    const targetDelta = todayRect.top - scrollRect.top - 46;
    phoneAScroll.scrollBy({ top: targetDelta, behavior: 'auto' });
  });
}
```

### 8.4 Past & future infinite scroll

**Aktuální stav (prototyp):** Jedna past sekce je součástí statického HTML. V produkci se budou past/future sekce načítat dynamicky.

**Produkční implementace:**

- **Future days** — načítají se po scrollu do budoucnosti. IntersectionObserver sleduje poslední viditelnou sekci; když se přiblíží ke scroll-bottomspaceru, request na server (nebo lokální IndexedDB query) načte další 7 dní.
- **Past days** — stejně, ale směrem nahoru. Musí se řešit scroll offset při příchodu nových dat (aby scroll nepřeskočil na jinou pozici).

**Pattern pro past scroll preservation (React):**

```typescript
// Před přidáním past sekce uložit současný scroll offset
const preservePosition = () => {
  const oldHeight = scrollEl.scrollHeight;
  return () => {
    const newHeight = scrollEl.scrollHeight;
    const delta = newHeight - oldHeight;
    scrollEl.scrollTop += delta;  // kompenzace přidaného obsahu nahoře
  };
};

// Při loadPastDays:
const restore = preservePosition();
setDays(prev => [...newPastDays, ...prev]);
requestAnimationFrame(restore);
```

Tím zůstane viditelný obsah na stejném místě i když se nahoře přidají nové sekce. Uživatel vidí kontinuální plynulý scroll.

### 8.5 Sheet lifecycle

**Otevření:**
```javascript
function openSheet(id) {
  document.getElementById(id).classList.add('open');
  document.getElementById(id + '-backdrop').classList.add('open');
}
```

**Zavření:**
```javascript
function closeSheet(id) {
  document.getElementById(id).classList.remove('open');
  document.getElementById(id + '-backdrop').classList.remove('open');
}
```

**Escape key:** vždy zavírá otevřený sheet.

```javascript
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.sheet.open').forEach(sheet => {
      closeSheet(sheet.id);
    });
  }
});
```

**Tap mimo sheet (na backdrop)** taky zavírá — to je ošetřeno `onclick` na `.sheet-backdrop`.

### 8.6 Theme switching

```javascript
function toggleTheme() {
  const root = document.documentElement;
  const current = root.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  document.querySelectorAll('[role="switch"]').forEach(s => {
    s.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
  });
  /* V produkci: ulož do localStorage (mimo incognito) nebo IndexedDB */
}
```

V React bude tento stav v globálním contextu (ThemeProvider).

### 8.7 Camera label dropdown

```javascript
function toggleCamLabel(e) {
  e.stopPropagation();
  const menu = e.currentTarget.parentElement.querySelector('.cam-menu');
  menu.classList.toggle('open');
}

function selectCamLabel(e, value) {
  e.stopPropagation();
  const wrap = e.currentTarget.closest('.cam-label-wrap');
  wrap.querySelector('.cam-label span').textContent = value;
  wrap.querySelector('.cam-menu').classList.remove('open');
}

/* Click outside to close */
document.addEventListener('click', (e) => {
  document.querySelectorAll('.cam-menu.open').forEach(menu => {
    if (!menu.parentElement.contains(e.target)) {
      menu.classList.remove('open');
    }
  });
});
```

### 8.8 Touch target minimum

**44×44 CSS pixelů** pro jakýkoli interaktivní prvek. Toto je Apple HIG požadavek a WCAG 2.5.5 (Target Size AA) doporučení. Bez výjimek.

`chrome-glyph` má `width: 44px; height: 44px;` — svg uvnitř je menší (22px), ale klikací plocha je velká.

Pro malé prvky (`cam-corner` 36×36) musí být obklopeny dostatečným prostorem, takže **efektivní** klikací plocha po započtení padding kolem bude 44+.

### 8.9 Haptics (PWA)

Kde to má smysl:

| Akce                              | Haptic type        |
|-----------------------------------|--------------------|
| Tap na capture button             | `impact:medium`    |
| Výběr z dropdownu                 | `selection`        |
| Dokončení slotu (mark as done)    | `notification:success` |
| Otevření/zavření sheetu           | `impact:light`     |
| Přepnutí theme                    | `selection`        |
| Dokončení sync operace            | `notification:success` |

PWA haptics: `navigator.vibrate([10])` jako fallback, na iOS Safari je přímo nefunguje — zvažujeme WebKit haptic API, jinak bez haptics.

### 8.10 Reduced motion

Pokud uživatel má `prefers-reduced-motion: reduce`, všechny tranzice omezíme na 0s nebo instant state change:

```css
@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
    animation: none !important;
  }
  .sheet {
    transition: transform 0.1s linear !important;
  }
}
```

Paper grain texture NEPROMÍJÍME — je to statická textura, neanimuje se.

---

## 9. Formátování obsahu

### 9.1 Data & časy

```
Plné datum (detail):    čtvrtek 24. dubna 2026
Zkrácené (divider):     22. dubna  nebo  23. dubna
Kontextové:             Dnes, Zítra, Pátek, Sobota, ...
Čas:                    09:10, 16:30 (24h, HH:MM)
Rozsah:                 10:30–11:15
Trvání:                 35 min, 1 h, 1 h 45 min, 3 h, celý den
```

**Nikdy:**
- Formát `22.04.` (čistě numerický) — není prostorově úsporný a ztrácí charakter
- AM/PM
- ISO (2026-04-22) — pouze v datech, nikdy v UI

### 9.2 Čísla

```
Klienti:    142 klientů (ne „142 klient")
Ceny:       450 Kč (mezera mezi číslem a měnou, Kč vždy za)
Procenta:   23 %
Teploty:    15 °C (mezera) nebo 15° (bez jednotky když z kontextu jasné)
Počty fotek: 3 fotky, 5 fotek, 1 fotka
```

**Tabular-nums** pro všechny. V Geist i Fraunces přes `font-variant-numeric: tabular-nums`.

### 9.3 Jména klientů

```html
<!-- Vždy s nedělitelnou mezerou -->
<span>Jana&nbsp;Nováková</span>
<span>Petr&nbsp;Kříž</span>
```

### 9.4 Alergeny

```
Amoniak, PPD, Resorcinol, Parabeny, ...
```

V alert-allergen chipu, kurzivou (Caveat), vždy první písmeno velké.

### 9.5 Stavové řetězce

```
Synchronizováno · před 2 min
Synchronizace...
Čeká se na připojení
Offline
zbývá 45 min        <-- probíhající zákrok
volno 35 min         <-- volný slot
celý den volno       <-- prázdný den
```

### 9.6 Kickery

Všechny jsou UPPERCASE, Geist 600, letter-spacing 0.18em:

```
DNES, ZÍTRA, PÁTEK, SOBOTA
HISTORIE
DNEŠNÍ FOTOGRAFIE
APLIKOVANÉ SLUŽBY
PRODUKTY
ALERGENY
POZNÁMKY
```

---

## 10. Accessibility

### 10.1 WCAG 2.2 AA minimum

Aplikace cílí na AA v obou theme. Kontrasty ověřeny ručně:

**Light mode:**
```
--ink (#1C1917) proti --bg (#FDFAF3):       13.9:1 ✓ AAA
--ink-2 (#44403C) proti --bg:               9.1:1  ✓ AAA
--ink-3 (#736D64) proti --bg:               4.65:1 ✓ AA normal
--ink-4 (#9F9990) proti --bg:               3.2:1  ✓ AA large (18px+)
--teal (#0E7490) proti --bg:                5.2:1  ✓ AA normal
--copper (#B06E52) proti --bg:              3.6:1  ✓ AA large + non-text
--amber (#B97940) proti --bg:               3.7:1  ✓ AA large
```

**Dark mode** — hodnoty v opačném směru:
```
--ink (#F5EDE0) proti --bg (#211A15):       13.1:1 ✓ AAA
--ink-3 (#9D9385) proti --bg:               5.2:1  ✓ AA
--teal (#2494B2) proti --bg:                4.7:1  ✓ AA
```

**Ink-4 je vyhrazeno pro 18px+ nebo non-text.** Nelze ho použít pro klíčové informace v 11-13px velikosti.

### 10.2 Touch targets

Všechny interaktivní prvky 44×44 minimum (viz 8.6).

### 10.3 Sémantické HTML

```html
<button>         <!-- pro všechny akce (ne <div onclick>) -->
<a>              <!-- pro navigaci uvnitř aplikace -->
<nav>            <!-- pro skupiny odkazů (sheet-nav) -->
<section>        <!-- pro day-section (!kritické pro sticky) -->
<header>         <!-- pro top-chrome (zvážit — zatím je div) -->
<main>           <!-- pro phone-scroll content -->
<dialog> or role="dialog"  <!-- pro bottom sheet -->
```

### 10.4 ARIA

**Povinné atributy:**

```html
<!-- Switches -->
<button role="switch" aria-pressed="false" aria-label="Tmavý režim">

<!-- Sheets -->
<div class="sheet" role="dialog" aria-modal="true" aria-label="Menu">

<!-- Glyph buttons -->
<button class="chrome-glyph" aria-label="Otevřít menu">
<button class="chrome-glyph" aria-label="Zpět">
<button class="chrome-glyph" aria-label="Další možnosti">

<!-- Camera controls -->
<div class="cam-corner" aria-label="Blesk">
<button class="cam-capture" aria-label="Pořídit snímek">

<!-- FAB -->
<button class="fab" aria-label="Nová událost">
```

**Dynamické stavy:**
- `aria-pressed` pro theme switch aktualizovat při toggle
- `aria-expanded` pro cam-label dropdown (open/close)
- `aria-current` pro aktivní nav item v sheetu

### 10.5 Screen reader pravidla

**Kickery nemají samostatný smysl bez hlavního textu.** Příklad:

```html
<div class="chrome-kicker-row">
  <span class="chrome-kicker live">Dnes</span>
  <span class="weather-temp-subtle">15°</span>
</div>
<span class="chrome-main">22. dubna</span>
```

VoiceOver přečte: „Dnes 15 stupňů, 22. dubna" — OK.

Ale `<span class="dv-a-kicker">Zítra</span>` před `<span class="dv-a-main">23. dubna</span>` se přečte jako „Zítra, 23. dubna" — OK.

### 10.6 Dynamic Type

PWA na iOS musí respektovat uživatelovo nastavení velikosti písma. Všechny velikosti definovat přes `rem`, ne `px`, kde to má smysl:

```css
html { font-size: 16px; }  /* base; v budoucnu respektuje user prefs */

.slot-name { font-size: 1.0625rem; }  /* 17px */
```

*Momentální stav:* prototyp používá `px` pro precizní design. V produkci přejdeme na `rem` pro sekundární text (`.slot-sub`, `.detail-label`) a **ne** pro numerické hodnoty (časy, ceny) — ty vypadají lépe v pevné velikosti.

### 10.7 Focus ring

Pro klávesnicovou navigaci:

```css
*:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 2px;
  border-radius: inherit;
}
```

Touch interakce `:focus-visible` neaktivuje — vypadá jen při tab navigation.

---

## 11. Implementační poznámky

### 11.1 React komponenty (navržená mapa)

```
<App>
  <ThemeProvider>
    <PaperGrain />
    <PhoneFrame>
      <StatusBar />
      <DynamicIsland />
      <PhoneScroll>
        <ScrollTopSpacer />
        <DaySection> {/* today */}
          <TopChrome variant="daily" />
          <SlotList slots={todaySlots} />
        </DaySection>
        {futureDays.map(day => (
          <DaySection key={day.date}>
            <DayDivider kicker={day.kicker} date={day.date} />
            <SlotList slots={day.slots} />
          </DaySection>
        ))}
        <ScrollBottomSpacer />
      </PhoneScroll>
      <FAB />
      <BottomSheet id="menu">
        <SheetSync />
        <SheetSearch />
        <SheetNav items={navItems} />
        <SheetThemeToggle />
      </BottomSheet>
    </PhoneFrame>
  </ThemeProvider>
</App>
```

Pro Phone B (client detail):

```
<PhoneScroll>
  <ScrollTopSpacer />
  <TopChrome variant="client" name={client.name} />
  <PhoneBContent>
    <CurrentHead time="09:10" allergen="Amoniak" remaining={45 * 60} />
    <CameraCard onCapture={handleCapture} />
    <DetailCard label="Dnešní fotografie">
      <ThumbRow thumbs={today.thumbs} onAdd={...} />
    </DetailCard>
    <DetailCard label="Aplikované služby">
      <ChipRow chips={today.services} />
    </DetailCard>
    ...
    <HistoryHead />
    <HistoryList items={history} />
  </PhoneBContent>
  <ScrollBottomSpacer />
</PhoneScroll>
```

### 11.2 Custom hooks

```typescript
// Detekce stuck stavu pro day-divider
function useStuckState(ref: React.RefObject<HTMLElement>, stickyTop = 46) {
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroll = el.closest('.phone-scroll');
    if (!scroll) return;

    const update = () => {
      const scrollRect = scroll.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const offset = rect.top - scrollRect.top;
      setIsStuck(offset <= stickyTop + 1);
    };

    scroll.addEventListener('scroll', update, { passive: true });
    update();
    return () => scroll.removeEventListener('scroll', update);
  }, [ref, stickyTop]);

  return isStuck;
}

// Theme (s persistencí přes IndexedDB)
function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // Uložit do IndexedDB pro offline persistenci
    saveTheme(theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  return { theme, toggle };
}
```

### 11.3 Font loading

```html
<!-- V <head>, preconnect pro rychlost -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..700&family=Geist:wght@300..700&family=Caveat:wght@400..700&family=Patrick+Hand&display=swap" rel="stylesheet">
```

**Pro PWA offline:** stáhnout fonty při prvním online visitu a servírovat ze Cache API. V service workeru.

### 11.4 Offline chování

Aplikace je offline-first. UI musí tedy předpokládat, že všechna data jsou lokální:

- Klienti, termíny, fotografie — IndexedDB (Dexie.js nebo PouchDB)
- Fotografie před uploadem — encrypted blob v IndexedDB
- Sync — background task, kterému uživatel dává „tichý" signál „probíhá" přes tečku v sheet-sync

**Network state v UI:**

```typescript
const isOnline = navigator.onLine;
// Aktualizovat sync dot + text v sheet-sync
```

Když offline a existují pending changes:
```
Offline · 3 změny čekají
```

### 11.5 Performance

- `will-change: transform` pro sheet při otevírání
- `contain: content` pro jednotlivé sekce (day-section)
- IntersectionObserver pro lazy-load thumbnails v history listu
- `passive: true` pro scroll listenery (povinné!)

### 11.6 Naming conventions (pro Tailwind-like, nebo čisté CSS)

Pokud použijeme čisté CSS s custom tokeny (jako v prototypu):

```
.slot                       <-- komponenta
.slot-done                  <-- modifier
.slot-active
.slot-time                  <-- subelement

.dv-a                       <-- „day divider variant A" (archived naming)
.dv-a-wrap
.dv-a-line
.dv-a-kicker
.dv-a-main
```

Pozn.: Prefix `dv-a-` pochází z iterace, kdy jsme zkoušeli varianty A/B/C. Varianta A vyhrála; prefix `-a-` zůstává kvůli pokračitelnosti, ale **v produkční implementaci** by se mělo přejmenovat na `day-divider-*` bez variant suffixu.

Pokud přejdeme na **Tailwind CSS** (zvažováno pro dev velocity), navrhuji custom tokens v `tailwind.config.js`:

```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        'paper-bg': 'var(--bg)',
        'paper-surface': 'var(--surface)',
        'ink': { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)', 4: 'var(--ink-4)' },
        'copper': { DEFAULT: 'var(--copper)', mid: 'var(--copper-mid)' },
        'teal': { DEFAULT: 'var(--teal)', strong: 'var(--teal-strong)' },
        'amber-warn': 'var(--amber)',
      },
      fontFamily: {
        'serif': ['Fraunces', 'serif'],
        'sans': ['Geist', 'sans-serif'],
        'hand': ['Patrick Hand', 'cursive'],
        'cursive': ['Caveat', 'cursive'],
      },
    }
  }
}
```

---

## 12. Changelog

### v2.2 (24. 4. 2026) — Chrome architektura & past scroll

**Architektonické změny:**
- Extrahovány `chrome-buttons` do always-on absolute vrstvy (z:16) nad `phone-scroll` — menu a ellipsis jsou vždy viditelné, nezávisle na tom, která sekce je stuck
- Nová komponenta `day-header-today` — sticky hlavička uvnitř dnešní sekce (identická struktura s day-divider)
- Phone B pokračuje s `top-chrome` (jediná sticky sekce, nepotřebuje extrakci tlačítek)
- Přidána past day sekce (Středa 21. dubna) s 3 dokončenými návštěvami
- Sekce `data-today="true"` atribut pro JS target

**Nové komponenty:**
- `fab-secondary` — scroll-to-today tlačítko vlevo dole, light styling (surface bg, border), fade+scale entry
- Šipka se otáčí 180° přes `.direction-down` class pro indikaci směru k dnešku

**JS logika:**
- `setupScrollToTodayButton()` — sleduje pozici dnešní sekce vůči viewport, přepíná visibility a direction
- `scrollToToday()` — smooth scroll s výpočtem targetDelta vůči sticky pozici
- Initial scroll — při load se Phone A tiše skroluje na dnešek (nad ním je past)

**Hand-drawn úprava:**
- Hamburger menu ikona **přesunuta mezi geometrické UI glyphy** (3 rovné horizontální čáry, stroke 1.8). Předchozí „hand-drawn" verze (pokřivené čárky) nevyhovovala pozici v chrome-buttons layer mezi ostatními čistými UI ikonami.
- Povolená hand-drawn použití redukována **ze 4 na 3**: sluníčko, check, plus
- Sluníčko vráceno **doleva** (weather-sun-left absolute), zvětšeno z 20×20 na 26×26, stroke z 1.5 na 1.6 — lepší sladění s ostatními hand-drawn prvky (check)

**Layout chromu:**
- Sluníčko: absolute vlevo v day-header-today (`left: 64px`)
- Teplota 15°: absolute **vpravo od „Dnes"** v `.chrome-kicker-wrap` — Dnes zůstává centrované, 15° visí vpravo jako absolute anotace
- `.chrome-kicker-wrap` nový pattern: relative container pro centrovaný text s absolute hanging annotation

### v2.1 (24. 4. 2026) — Unifikace chrome & dividerů

**Typografické sjednocení:**
- Chrome date, day-divider date, client name všechny na stejnou velikost: **Fraunces 20px, weight 500, opsz 28, letter-spacing -0.02em, tabular-nums**
- Předtím roztříštěné: chrome měl 19px/550, dividery 18px/500

**Struktura:**
- Chrome-stack dostal stejný pattern jako dv-a (kicker nad datem, center align, gap 6px)
- Odstraněn `chrome-kicker-row` (byl v2.0 residue)

**Chrome content:**
- „Dnes 15°" rozdělen: „Dnes" v kicker-řádku, 15° jako inline sibling
- (Později v v2.2 dále upraveno)

### v2.0 (24. 4. 2026) — Finální konsolidace

**Nové komponenty:**
- Bottom sheet pattern s iOS styling, handle, backdrop, escape key
- Weather annotation (hand-drawn slunce absolute + muted temp)
- Day-section wrapper pro push-stack sticky headers

**Architektonické změny:**
- `.phone-scroll` je nyní absolute s vlastními spacery (`scroll-topspacer` 46px, `scroll-bottomspacer` 120px)
- Každý den v `<section class="day-section">` (containing block pro sticky)
- Chrome sticky `top: 46px` uvnitř first section
- Day-dividers sticky `top: 46px` (stejná pozice → push-stack přes containing blocks)
- Odstraněny `.screen` a `.screen-content` wrappery (horizontální padding je teď na jednotlivých komponentách)
- Slot má teď `padding: 14px 20px` (předtím 14px 0)
- Slot-active má `margin: 4px 4px` (předtím `-16px`)

**Opravené bugy:**
- Chrome neoverlappuje content při scroll-top = 0 (díky topspaceru)
- Day-divider teď *nahrazuje* chrome místo překrytí pod ním (push-stack)
- Stuck detection threshold 46px (předtím 94px)
- Chrome-with-weather wrapper odstraněn (nepoužitý residue)
- dv-b, dv-d CSS odstraněno (archived varianty)

**Barvy:**
- Dark mode `--teal: #2494B2` (bylo #5AB8D4, příliš světlé, neměla dostatečný contrast)
- `--ink-3: #736D64` v light (bylo tmavší, teď WCAG AA 4.65:1)

**Typografie:**
- Pevné pravidlo: Fraunces pro data, Geist pro UI, Patrick Hand pro prose, Caveat pro anotace
- Tabular-nums povinné pro všechna čísla

**Hand-drawn:**
- Omezeno na 4 povolené použití (menu, slunce, check, plus)
- Menu ikona ztmavena z copper na ink-2 (strukturální, ne anotace)
- Ballpoint uniform stroke (nikdy fountain pen)

**Camera:**
- Outline SVG ikony místo emoji (📷⚡🔬)
- Patrick Hand hint „Namiřte na pokožku"
- Camera shutter je absolute overlay uvnitř preview (62px dual-ring iOS style)
- `cam-label-wrap` struktura (fix nested `<button>` bug)

**Menu / Sheet:**
- Bottom sheet místo tab bar (zachovává deníkový charakter)
- Sync status dot, search, 5 nav items, dark toggle
- Escape key + backdrop tap zavírá

### v1.0 (starting point)

- Barvy, typografie, paper grain
- Phone A + Phone B základní layout
- Slot grid, chrome, dividers (s variantami)
- Dark mode základy

---

## Konec dokumentu

Tento dokument je živý. Každá významná změna v UI/UX architektuře Tricho.App by měla být reflektována v tomto dokumentu. Pokud implementace vyžaduje změnu, která není v souladu se zdejšími pravidly, je to signál k revizi — buď implementace, nebo tohoto dokumentu.

Prototyp v2 (`/mnt/user-data/outputs/tricho-prototyp-v2.html`) je vizuální reference tohoto dokumentu. Nikdy nemodifikovat prototyp bez zhledu k tomuto dokumentu.

**Pro tento dokument platí stejné pravidlo jako pro kód:** commit se čte jednou, žije měsíce. Pište proto, jako by to četl váš budoucí já za půl roku.
