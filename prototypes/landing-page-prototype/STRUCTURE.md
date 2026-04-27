# Struktura stránky a komponenty

## Pořadí sekcí na stránce

```
<Header />              ← sticky, vždy viditelný
<main>
  <Hero />              ← hero
  <TwoScreens />        ← 01 — Dvě obrazovky
  <Story />             ← 02 — Ludmila + video + manifesto
  <Privacy />           ← 03 — Šifrování + 3 pilíře
  <Pricing />           ← 04 — Free + Pro/Max
  <Voices />            ← 05 — Testimonialy
  <Faq />               ← 06 — FAQ
  <FinalCta />          ← Final CTA
</main>
<Footer />
```

Žádné jiné sekce. Žádný „logo bar", žádný „as seen in", žádný newsletter signup, žádný blog teaser.

## Doporučená komponentová struktura

```
src/
├── components/
│   ├── landing/
│   │   ├── Header.astro
│   │   ├── Hero.astro
│   │   ├── TwoScreens.astro
│   │   ├── Story.astro
│   │   ├── Privacy.astro
│   │   ├── Pricing.astro
│   │   ├── Voices.astro
│   │   ├── Faq.astro
│   │   ├── FinalCta.astro
│   │   └── Footer.astro
│   │
│   ├── phone/
│   │   ├── PhoneFrame.astro          ← sdílený rámeček (full + mini varianta)
│   │   ├── PhoneStatusBar.astro      ← 9:41 + signal/battery
│   │   ├── PhoneSlot.astro           ← jedna položka diáře
│   │   ├── PhoneDayHeader.astro      ← "Dnes 22. dubna"
│   │   ├── PhoneDivider.astro        ← "Zítra"
│   │   ├── ContentDiar.astro         ← obsah diáře (skládá Slots)
│   │   └── ContentKartaKlientky.astro ← obsah karty klientky
│   │
│   └── ui/
│       ├── Button.astro              ← .btn-primary, .btn-secondary
│       ├── ThemeToggle.astro
│       ├── Pillar.astro              ← jeden ze tří pilířů v Privacy
│       ├── PlanCell.astro            ← Pro / Max plan card
│       ├── Testimonial.astro         ← jeden testimonial card
│       └── FaqItem.astro             ← jedna FAQ položka
│
├── content/
│   └── landing.ts                    ← (volitelné) struktura dat z COPY.md
│
├── layouts/
│   └── Layout.astro                  ← html + head + body wrapper
│
├── pages/
│   └── index.astro                   ← skládá landing/* komponenty
│
└── styles/
    ├── tokens.css                    ← CSS variables z DESIGN_TOKENS.md
    ├── global.css                    ← reset, body, paper grain
    └── fonts.css                     ← Google Fonts (nebo přes <head> v Layout)
```

## Komponenty — popis

### Header.astro
- Sticky top, `z-index: 50`
- Levá: brand (`Tricho.app` + version chip)
- Střed: nav links (Blog, Nápověda, Plány) — schované pod 720px
- Pravá: ThemeToggle + Button "Začít zdarma"
- Border-bottom 1px line

### Hero.astro
- Grid 1.1fr 1fr (zhroutí na 1 sloupec pod 880px)
- Levá: eyebrow → H1 → lede → CTA → meta
- Pravá: full-size phone mockup (PhoneFrame s ContentDiar)

### PhoneFrame.astro
**Props:**
- `variant?: 'full' | 'mini'` — default `'full'`. Mini má menší velikost (max-width 300px, height 540px).
- Slot pro `<ContentDiar />` nebo `<ContentKartaKlientky />`

Obsahuje:
- Vnější rámeček (var --phone-frame)
- Vnitřní screen s rounded corners
- Dynamic island (top center)
- Status bar (9:41 + ikony)
- Paper grain overlay
- Phone shadow

### PhoneSlot.astro
**Props:**
- `time: string` (např. "10:30")
- `name?: string`
- `subtitle?: string` (typ návštěvy)
- `status?: 'done' | 'active' | 'free' | 'default'`
- `freeText?: string` — když `status='free'`, zobrazuje text v Patrick Hand místo jména

### TwoScreens.astro
- Section header (01 + H2 + sub)
- Intro paragraph (Fraunces 300)
- Grid 2 sloupce (zhroutí pod 800px)
- Levý sloupec: PhoneFrame variant=mini s ContentDiar + popis pod tím
- Pravý sloupec: PhoneFrame variant=mini s ContentKartaKlientky + popis pod tím

### Story.astro
- Section header (02 + H2 + sub)
- Grid 1.1fr 1fr (zhroutí pod 800px)
- Levá: dva citátové paragrafy + author (Ludmila Beránková)
- Pravá: video placeholder (aspect-ratio 4/5, max-width 380px)
- Pod gridem: manifesto (jediný odstavec, max-width 64ch)

**Video placeholder design:**
- Background gradient (cream → copper-soft)
- Paper grain overlay
- Top-left mono label `[ Video Ludmily — placeholder ]`
- Centered play button (72px circle, ink bg)
- Bottom-left meta: `Ukázka` + `75 vteřin`

**Pro produkční video:** Komponenta by měla akceptovat `videoSrc` prop. Pokud je nastavený, místo placeholderu renderuj `<video>` element s poster image a play overlay. Implementace play-on-click (žádné autoplay).

### Privacy.astro
- Section header (03 + H2, **bez** section-sub — záměrně)
- Background: `var(--cream-2)` (jemně zbarvená sekce, oddělená border-top + border-bottom)
- Privacy prose: 3 paragrafy ve Fraunces 300
- Druhý paragraf má class `.lift` — copper border-left, ink color
- Třetí paragraf obsahuje `<span class="hand-soft">i v tom zdarma</span>`
- Pillars grid (3 sloupce, zhroutí pod 720px)

### Pillar.astro
**Props:**
- `label: string`
- `text: string` (může obsahovat `<code>` inline)

### Pricing.astro
- Section header (04 + H2 + sub)
- **Free block** (velký panel s grid 1fr 1.2fr):
  - Levá: label, H3, popis, CTA
  - Pravá: features list (2 sloupce, border-left)
- **Plans intro** (mezisekce s eyebrow + H3 + popis)
- **Plans grid** (2 sloupce):
  - PlanCell "Pro"
  - PlanCell "Max"
- Fineprint pod gridem (1 řádek, centered, malý mutovaný text)

### PlanCell.astro
**Props:**
- `name: string` (Pro / Max)
- `amount: string` (`299` / `499`)
- `period: string` (`/rok`)
- `tag: string` (krátký popis)
- `features: string[]`
- `microcopy: string` (Patrick Hand pod features)

### Voices.astro
- Section header (05 + H2 + sub)
- Background: `var(--cream-2)` (jako Privacy)
- Voices grid (3 sloupce, zhroutí pod 880px)
- Pod gridem: fineprint (Patrick Hand, centered)

### Testimonial.astro
**Props:**
- `quote: string` (může obsahovat `<em>` pro emfaze)
- `initials: string` (2 písmena)
- `name: string`
- `role: string`
- `photoSrc?: string` — optional, fallback na initials

### Faq.astro
- Section header (06 + H2 + sub)
- FAQ list (max-width 760px) — sada `<FaqItem>`

### FaqItem.astro
**Props:**
- `question: string`
- `answer: string` (může obsahovat HTML — `<strong>`, `<code>`)

Renderuje jako `<details><summary>...</summary>...</details>`. Single-open behavior přes `<script>` na Faq.astro úrovni.

### FinalCta.astro
- Centered layout, padding-bottom velký
- Border-top 1px line
- H2 (max 22ch, Fraunces 300, large)
- Lede (centered, max 50ch)
- CTA button
- Risk reversal (Patrick Hand, max 50ch)
- Micro (mono, malý)

### Footer.astro
- 4 sloupce (zhroutí na 2 pod 720px, na 1 pod 480px)
- Sloupec 1: brand block (logo + version + tagline)
- Sloupec 2: Produkt links
- Sloupec 3: Právní links
- Sloupec 4: Kontakt
- Footer bottom: copyright + version

### Button.astro
**Props:**
- `variant: 'primary' | 'secondary' | 'text'`
- `href?: string` — když je nastaven, renderuj jako `<a>`, jinak `<button>`
- Slot pro label

### ThemeToggle.astro
- 32px circle
- Sun ikona (light mode) / Moon ikona (dark mode)
- `<script>` v komponentě:
  - Načte `localStorage.getItem('tricho-theme')` při startu
  - Click handler toggle dark/light a uloží

## Section-num komponent

Každá hlavní sekce má unifikovanou hlavičku s číslem `01`–`06`. Doporučuji extrahovat:

```astro
---
// SectionHead.astro
const { num, title, sub } = Astro.props;
---
<div class="section-head">
  <div class="section-num">{num}</div>
  <h2 class="section-title" set:html={title} />
  {sub && <div class="section-sub">{sub}</div>}
</div>
```

`title` jako `set:html` proto, že obsahuje `<em>...</em>` pro italic emphasis.

**Pozor:** Sekce 03 (Privacy) **nemá** section-sub. Je to záměr — drží to emocionální váhu nadpisu *„Co ti řekne klientka, zůstane mezi vámi."*. Nepřidávej tam fallback.

## Layout.astro

```astro
---
const { title, description } = Astro.props;
---
<!DOCTYPE html>
<html lang="cs" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content={description} />
  <!-- OG, Twitter, favicon, fonts preconnect -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=..." rel="stylesheet" />
</head>
<body>
  <slot />
</body>
</html>
```

## Index.astro

```astro
---
import Layout from '../layouts/Layout.astro';
import Header from '../components/landing/Header.astro';
import Hero from '../components/landing/Hero.astro';
import TwoScreens from '../components/landing/TwoScreens.astro';
import Story from '../components/landing/Story.astro';
import Privacy from '../components/landing/Privacy.astro';
import Pricing from '../components/landing/Pricing.astro';
import Voices from '../components/landing/Voices.astro';
import Faq from '../components/landing/Faq.astro';
import FinalCta from '../components/landing/FinalCta.astro';
import Footer from '../components/landing/Footer.astro';
---
<Layout
  title="Tricho.app — Karta klientky, která si pamatuje za tebe"
  description="Aplikace pro samostatné tricholožky a kadeřnice. Anamnéza, alergeny, fotky pokožky, historie návštěv — všechno na jednom místě, v telefonu. Šifrované, offline, zdarma."
>
  <Header />
  <main id="main">
    <Hero />
    <TwoScreens />
    <Story />
    <Privacy />
    <Pricing />
    <Voices />
    <Faq />
    <FinalCta />
  </main>
  <Footer />
</Layout>
```

## Content data (volitelné)

Pokud chceš vyhnout duplikaci copy v komponentách, vytvoř `src/content/landing.ts`:

```ts
export const hero = {
  eyebrow: 'Pro samostatné tricholožky a kadeřnice',
  h1: 'Karta klientky,<br>která si <em>pamatuje za tebe</em>.',
  lede: 'Anamnéza, alergeny, fotky pokožky, co jste minule zkoušely, kdy přijde příště. Všechno o jedné klientce na jednom místě, v telefonu.',
  cta: 'Začít zdarma',
  meta: ['iPhone i Android', 'Bez platební karty'],
};

export const testimonials = [
  {
    quote: 'Klientka přijde po půl roce a chce „přesně to samé jako minule". <em>Dřív jsem chvíli vzpomínala, teď to mám rozkliknuté za dvě vteřiny.</em>',
    initials: 'MN',
    name: 'Marie Nováková',
    role: 'Kadeřnice a trichologyně, Brno',
  },
  // ...
];

// atd. pro každou sekci
```

A pak v komponentě: `import { hero } from '../../content/landing';`

To je mělce použitelné a usnadňuje pozdější editaci copy.

## Responzivní vlastnosti

| Breakpoint | Co se mění |
|---|---|
| ≤880px | Hero grid → 1 sloupec, voices grid → 1 sloupec, plans grid → 1 sloupec |
| ≤800px | Story grid → 1 sloupec, free block → 1 sloupec, status block → 1 sloupec |
| ≤720px | Pillars → 1 sloupec, footer-grid → 2 sloupce, nav-links skryté |
| ≤600px | Page padding 24px (z 40px), section-sub na nový řádek |
| ≤480px | Footer-grid → 1 sloupec |

## Co NEDĚLAT v komponentách

- Nedávej framer-motion / GSAP — žádné animace navíc.
- Nedávej tooltips, popovery, modaly. Žádné z toho na stránce není.
- Nedávej skeletons / loading states — stránka je statická.
- Nedávej intersection observers pro lazy reveals — stránka je tichá.
- Nedávej cookie banner — privacy positioning, žádné cookies.
- Nedávej i18n. Stránka je čistě česká.
