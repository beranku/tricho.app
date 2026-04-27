# Prompt pro AI coding agenta

> Tento soubor je copy-paste vstup pro Claude Code, Cursor Composer, Aider nebo jiného autonomního agenta. Začni tady.

---

Jsi senior frontend engineer s expertízou v Astro a moderní webové typografii. Tvým úkolem je implementovat landing page pro Tricho.app v existujícím Astro repu. Pracuješ se balíčkem souborů, které máš k dispozici (`README.md`, `landing-page.html`, `DESIGN_TOKENS.md`, `COPY.md`, `STRUCTURE.md`, `TODO.md`).

## Kontext produktu

Tricho.app je PWA pro evidenci klientek u samostatných tricholožek a kadeřnic v ČR a SR. Cílovka: ženy 28–38 let s vlastní praxí. Klíčové vlastnosti: end-to-end šifrování, offline-first, dvě obrazovky (diář + karta klientky). Plány: Free napořád, Pro 299 Kč/rok, Max 499 Kč/rok.

Stránka je v češtině, tichá, deníková, bez marketingového hype. Pozice je inspirovaná Bear, Day One, Standard Notes, Linear.

## Tvůj úkol

Implementuj landing page jako sadu Astro komponent v existujícím repu. Cílem je produkční kód, který:

- vypadá pixel-faithful jako `landing-page.html`,
- používá copy přesně podle `COPY.md` (žádný nový český text negeneruj),
- respektuje konvence existujícího repa (struktura, styling approach, naming),
- má Lighthouse Performance ≥ 95 na mobile, LCP < 2.5s,
- je dostupný (semantic HTML, aria, keyboard navigation),
- je responsive (mobile-first, breakpointy v `DESIGN_TOKENS.md`).

## Jak postupovat — krok za krokem

### 1. Analýza repa (před jakoukoli změnou)

Než cokoli napíšeš, prozkoumej repo:

- Jaká je verze Astro? (`package.json`)
- Jak je organizovaná struktura? (`src/components/`, `src/layouts/`, `src/pages/`)
- Existuje již nějaký globální styling? (Tailwind / CSS modules / vanilla / SCSS)
- Existuje design system / tokeny?
- Jaká je konvence pojmenování komponent? (PascalCase vs. kebab-case)
- Používá repo TypeScript? Strict?
- Jsou už integrované Google Fonts / fontsource?
- Existují už content collections (pro blog/help)?

Vytvoř stručnou analýzu (max 15 řádků) a nahlas ji v komentáři před prvním commitem nebo v souhrnu prvního chatu.

### 2. Rozhodnutí o stylingu

Pokud repo má zaběhnutou konvenci, drž se jí.

Pokud repo **nemá** styling konvenci, použij toto:

- **CSS Modules** (`Component.module.css`)
- **Globální tokeny** v `src/styles/tokens.css` jako CSS variables (kompletní seznam v `DESIGN_TOKENS.md`)
- **Globální reset + paper-grain background** v `src/styles/global.css`
- Žádný PostCSS plugin navíc, žádný SCSS, žádné Tailwind, **pokud nejsou v repu už použité**.

### 3. Komponenty k vytvoření

Detailní mapa v `STRUCTURE.md`. High-level:

```
src/components/landing/
  Header.astro              — sticky nav s theme toggle a CTA
  Hero.astro                — H1, lede, CTA, telefonní mockup
  PhoneMockup.astro         — sdílený frame pro mockupy
  PhoneDiar.astro           — content pro diář mockup
  PhoneKartaKlientky.astro  — content pro kartu klientky mockup
  TwoScreens.astro          — sekce 01: dvě obrazovky vedle sebe
  Story.astro               — sekce 02: Ludmila + video + manifesto
  Privacy.astro             — sekce 03: šifrování + 3 pilíře
  Pricing.astro             — sekce 04: Free + Pro/Max
  Voices.astro              — sekce 05: testimonialy
  Faq.astro                 — sekce 06: 8 otázek (accordion)
  FinalCta.astro            — final CTA
  Footer.astro              — patička

src/components/ui/
  Button.astro              — .btn-primary, .btn-secondary
  ThemeToggle.astro         — sun/moon toggle s localStorage
  Testimonial.astro         — jeden testimonial (used in Voices)
  Pillar.astro              — pilíř (used in Privacy)
  PlanCell.astro            — Pro/Max plan cell (used in Pricing)

src/pages/
  index.astro               — kompozice sekcí

src/styles/
  tokens.css                — CSS variables
  global.css                — reset, body, paper grain
  fonts.css                 — Google Fonts import (preconnect v <head>)
```

### 4. Copy

**KRITICKÉ:** Veškerý český copy je v `COPY.md`. Nikdy ho neměň, neredukuj, ani „neopravuj". Pokud chybí (např. SEO description), pohraň ze `COPY.md` nebo z `landing-page.html`. Pokud opravdu nikde není, **nahlas to v TODO.md jako otevřenou položku**, nevymýšlej.

### 5. Interakce (jediné dvě)

Veškerá interaktivita je v 30 řádcích JS. V Astro to umístíš jako `<script>` v rámci komponent.

#### Theme toggle (`ThemeToggle.astro`)
```js
const root = document.documentElement;
const stored = localStorage.getItem('tricho-theme');
if (stored === 'dark') root.setAttribute('data-theme', 'dark');

document.querySelector('.theme-toggle')?.addEventListener('click', () => {
  const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('tricho-theme', next); } catch(e) {}
});
```

#### FAQ accordion (`Faq.astro`)
Použij nativní `<details><summary>` (žádný JS pro toggle). Přidej JS pro single-open behavior:
```js
document.querySelectorAll('.faq-item').forEach(item => {
  item.addEventListener('toggle', () => {
    if (item.open) {
      document.querySelectorAll('.faq-item').forEach(other => {
        if (other !== item) other.removeAttribute('open');
      });
    }
  });
});
```

### 6. SEO a meta

V `index.astro` Layout / `<head>` doplň:

- `<title>Tricho.app — Karta klientky, která si pamatuje za tebe</title>`
- `<meta name="description" content="Aplikace pro samostatné tricholožky a kadeřnice. Anamnéza, alergeny, fotky pokožky, historie návštěv — všechno na jednom místě, v telefonu. Šifrované, offline, zdarma.">`
- `<meta name="viewport" content="width=device-width, initial-scale=1">`
- `<html lang="cs">`
- Open Graph: titulek, popis, og:image (pokud chybí, použij placeholder URL `/og.png` a označ v TODO)
- Twitter Card: `summary_large_image`
- Favicon (placeholder `/favicon.svg` — řešení v TODO)

### 7. Performance checklist

- ✅ `<link rel="preconnect" href="https://fonts.googleapis.com">` a gstatic
- ✅ Font loading přes `font-display: swap`
- ✅ Žádný blocking CSS (inline critical pokud potřeba)
- ✅ Žádné velké obrázky v hero (mockup je čistý SVG/HTML, ne raster)
- ✅ Žádný klientský JS framework, jen 2× malé `<script>` na konec
- ✅ Lazy loading pro video a obrázky pod foldem
- ✅ Cache headers (řeší Astro buildovacím procesem)

### 8. Accessibility checklist

- ✅ Semantic HTML (`<header>`, `<main>`, `<section>`, `<footer>`)
- ✅ `<h1>` jednou, hierarchie nadpisů konzistentní
- ✅ `aria-label` na ikonových tlačítkách (theme toggle, video play)
- ✅ Theme toggle respektuje `prefers-color-scheme` jako default
- ✅ Focus visible (žádné `outline: none` bez náhrady)
- ✅ Kontrastní poměry: minimum WCAG AA (large text 3:1, normal 4.5:1) — design už splňuje, jen ověř po implementaci
- ✅ FAQ accordion ovladatelné klávesnicí (nativní `<details>` to řeší)

### 9. Lokalizace

Stránka je primárně **česká**. SR varianta není v scope této PR, ale:

- Použij `<html lang="cs">`
- Nedělej i18n strukturu (žádné `cs.json` / `sk.json`) — kdyby v budoucnu přibyl jiný jazyk, refactor proběhne tehdy.
- Ovšem **nehard-coduj texty deeper than necessary** — drž je v komponentách jako prop nebo importuj z `COPY.md`-ekvivalentu (např. `src/content/landing.cs.ts`).

### 10. Po dokončení

1. Spusť `npm run build` — musí projít bez warningů.
2. Spusť Lighthouse na vybuildovaný `index.html` — nahlas skóre.
3. Vyplň `TODO.md` — co bylo vyřešeno, co zbývá pro autora (assety, video, fotky).
4. V commit zprávě / PR description shrni: co jsi udělal, jaké soubory přibyly, co je v TODO.

## Co dělat, když narazíš na nejasnost

- **Konvence repa konfliktuje s prototypem** → konvence repa vítězí, ale nahlas to v komentáři PR
- **Chybí copy / asset** → použij placeholder, přidej do `TODO.md`
- **Designové detaily v prototypu jsou nekonzistentní** → drž se prototypu, ne svého úsudku. Pokud opravdu rozhodnutí potřebuješ, ptej se autora.
- **Nemůžeš dosáhnout Lighthouse 95** → nahlas, NEDĚLEJ kompromis na vizuální věrnosti bez konzultace.

## Co rozhodně neudělat

- ❌ Negeneruj český copy.
- ❌ Nepřidávej analytics ani trackery.
- ❌ Nepřepisuj design system (barvy, font-weights, spacing).
- ❌ Neimportuj UI knihovny (shadcn, Radix, Mantine, atd.).
- ❌ Nepřidávej scroll animations / fade-iny / parallax.
- ❌ Nedělej aria-live na nic — stránka je statická.
- ❌ Nezapomeň na `lang="cs"` na `<html>`.

---

**Začni analýzou repa. Až budeš mít přehled, pošli stručný plán a teprve pak začni implementovat.**
