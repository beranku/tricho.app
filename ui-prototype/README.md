# Tricho.App — Implementační balíček v1

Toto je první kostra UI implementace pro Tricho.App. Obsahuje design systém,
Astro komponenty, React Islands a PWA konfiguraci, připravené k slití se
stávajícím projekt-skeletonem.

Celé je postavené na **Astro + React Islands** s cílem minimální JavaScript
payload. Statické UI komponenty jsou v `.astro` souborech (renderují se
serverside a do browseru neposílají žádný JS). Interaktivní prvky jsou
React komponenty hydratované přes `client:*` direktivy.

---

## Technologický stack

- **Astro 4.x** — static site generator s zero-JS defaultem
- **React 18** — pouze pro interactive Islands (scroll detection, sheet, camera, theme)
- **TypeScript** — strict mode
- **Nano Stores** — shared state napříč Islands (theme, sheet open/close)
- **Vite PWA** (`@vite-pwa/astro`) — service worker + manifest generace
- **Dexie.js** — IndexedDB wrapper (offline-first DB, doplnit v dalším kole)
- **Cloudflare Pages** — hosting (`output: "static"`, žádný adapter potřeba)

---

## Strategie Astro vs React Islands

**Astro komponenty** (`.astro`, žádný JavaScript v browseru):
- Veškerá prezentační struktura (phone frame, layout, karty, sloty)
- SVG ikony (hand-drawn i geometrické)
- Day dividery, day-header-today, chrome-buttons
- Detail cards, chipy, thumbnails

**React Islands** (`.tsx`, hydratované v browseru):
- `<PhoneScroll>` — scroll detection, stuck state, fab-secondary visibility, initial scroll
- `<BottomSheet>` — open/close state, backdrop, ESC handler, focus trap
- `<CameraCard>` — dropdown state, capture handler
- `<ThemeToggle>` — persistent dark mode přes localStorage
- `<FabSecondary>` — visibility via scroll state (subscribes k `phoneScroll` store)

**Proč ne celé v Reactu:** Statické UI má být hostováno na Cloudflare Pages
jako prerendered HTML. Každý byte JavaScriptu počítá, protože PWA chceme
rychlé při prvním načtení na mobilu. Astro nám to hlídá automaticky — pokud
komponenta neobsahuje `client:*` directive, její JS se do browseru ani neposílá.

---

## Struktura projektu

```
tricho-impl/
├── README.md                  # Tento soubor
├── package.json               # Dependencies
├── astro.config.mjs           # Astro + PWA config
├── tsconfig.json              # TypeScript (strict)
├── public/
│   ├── manifest.webmanifest   # PWA manifest
│   └── fonts/                 # Self-hosted fonts (viz fonts/README.md)
├── src/
│   ├── layouts/
│   │   └── AppLayout.astro    # Root layout s paper grain, fonts, theme
│   ├── pages/
│   │   ├── index.astro        # Phone A — daily schedule
│   │   ├── clients/
│   │   │   └── [id].astro     # Phone B — client detail
│   │   └── offline.astro      # PWA offline fallback
│   ├── components/
│   │   ├── astro/             # Pure Astro (no client JS)
│   │   │   ├── PhoneFrame.astro
│   │   │   ├── StatusBar.astro
│   │   │   ├── Island.astro   # Dynamic Island na iOS
│   │   │   ├── PaperGrain.astro
│   │   │   ├── ChromeGlyph.astro
│   │   │   ├── ChromeButtons.astro
│   │   │   ├── DayHeaderToday.astro
│   │   │   ├── DayDivider.astro
│   │   │   ├── DaySection.astro
│   │   │   ├── Slot.astro
│   │   │   ├── SlotDone.astro
│   │   │   ├── SlotActive.astro
│   │   │   ├── SlotFree.astro
│   │   │   ├── CurrentHead.astro
│   │   │   ├── DetailCard.astro
│   │   │   ├── Chip.astro
│   │   │   └── icons/
│   │   │       ├── Hamburger.astro
│   │   │       ├── Ellipsis.astro
│   │   │       ├── BackArrow.astro
│   │   │       ├── Caret.astro
│   │   │       ├── SunHandDrawn.astro
│   │   │       ├── CheckHandDrawn.astro
│   │   │       ├── CalendarPlus.astro
│   │   │       ├── ArrowUp.astro
│   │   │       ├── Camera.astro
│   │   │       ├── Flash.astro
│   │   │       └── UV.astro
│   │   └── islands/           # React (client:*)
│   │       ├── PhoneScroll.tsx
│   │       ├── BottomSheet.tsx
│   │       ├── CameraCard.tsx
│   │       ├── ThemeToggle.tsx
│   │       ├── FabSecondary.tsx
│   │       └── hooks/
│   │           ├── useStuckState.ts
│   │           ├── useScrollToToday.ts
│   │           ├── useTheme.ts
│   │           ├── useBottomSheet.ts
│   │           └── useEscapeKey.ts
│   ├── lib/
│   │   ├── types/             # Domain types
│   │   │   ├── client.ts
│   │   │   ├── appointment.ts
│   │   │   ├── allergen.ts
│   │   │   ├── photo.ts
│   │   │   └── index.ts
│   │   ├── format/            # Formatting helpers (Czech)
│   │   │   ├── date.ts        # "22. dubna", "Dnes", "Zítra"
│   │   │   ├── time.ts        # "09:10", "zbývá 45 min"
│   │   │   ├── duration.ts    # "volno 35 min", "1 h 45 min"
│   │   │   └── pluralize.ts   # "142 klientů" vs "1 klient" vs "3 klienti"
│   │   ├── store/             # Nano Stores
│   │   │   ├── theme.ts       # dark mode state
│   │   │   ├── sheet.ts       # bottom sheet open/close
│   │   │   └── phoneScroll.ts # stuck day, today position
│   │   └── db/                # Dexie.js (placeholder pro další kolo)
│   │       └── README.md
│   └── styles/
│       ├── tokens.css         # CSS custom properties (light + dark)
│       ├── typography.css     # Font-family / size / weight utilities
│       ├── base.css           # Reset, fonts @font-face, paper grain
│       └── global.css         # Imports všech výše
└── fonts/
    └── README.md              # Instrukce pro self-hosting fontů
```

---

## Pro coding agenta: Kroky integrace

1. **Zkopírovat adresářovou strukturu** do stávajícího skeletonu. Pokud
   některé cesty existují, slučovat obsah, neprepisovat bez kontroly.

2. **Nainstalovat dependencies:**
   ```bash
   npm install
   ```
   (Viz `package.json` níže — přidává: `@astrojs/react`, `@vite-pwa/astro`,
   `nanostores`, `@nanostores/react`, `dexie`, `react`, `react-dom`,
   `@types/react`, `@types/react-dom`)

3. **Self-host fonts** (povinné pro offline PWA):
   - Stáhnout Fraunces, Geist, Caveat, Patrick Hand z Google Fonts
   - Dát do `public/fonts/` (viz `fonts/README.md`)
   - Provázáno přes `@font-face` v `src/styles/base.css`

4. **Ověřit `astro.config.mjs`** — má zapnutou React integraci a PWA plugin.

5. **`src/styles/global.css`** musí být importován v `src/layouts/AppLayout.astro`.
   Každá stránka (`src/pages/*.astro`) používá `AppLayout`.

6. **Dexie schema** implementovat v `src/lib/db/` v dalším kole. Zatím jsou
   types připraveny.

7. **Service worker & manifest** jsou generované automaticky přes Vite PWA.
   Konfigurace v `astro.config.mjs`.

8. **Testovací spuštění:**
   ```bash
   npm run dev         # Lokálně
   npm run build       # Build pro Cloudflare Pages
   npm run preview     # Preview buildu
   ```

---

## Mapování prototyp → implementace

Každý element z prototypu (`tricho-prototyp-v2.html`) má odpovídající Astro
komponentu nebo React Island:

| Prototyp element            | Implementace                                    |
|-----------------------------|-------------------------------------------------|
| `.phone-inner`              | `<PhoneFrame>` (Astro)                          |
| `.status-bar`               | `<StatusBar>` (Astro)                           |
| `.island`                   | `<Island>` (Astro)                              |
| `.paper-grain`              | `<PaperGrain>` (Astro)                          |
| `.chrome-buttons`           | `<ChromeButtons>` (Astro) — buttons inside      |
| `.chrome-glyph`             | `<ChromeGlyph>` (Astro) — wrapper s `<slot>`    |
| `.day-header-today`         | `<DayHeaderToday>` (Astro)                      |
| `.dv-a-wrap`                | `<DayDivider>` (Astro)                          |
| `.day-section`              | `<DaySection>` (Astro)                          |
| `.slot`                     | `<Slot>` / `<SlotDone>` / `<SlotActive>` / `<SlotFree>` |
| `.current-head`             | `<CurrentHead>` (Astro, Phone B only)           |
| `.detail-card`              | `<DetailCard>` (Astro)                          |
| `.chip`                     | `<Chip>` (Astro)                                |
| `.top-chrome` (Phone B)     | Součást Phone B page                            |
| `.phone-scroll` + JS        | `<PhoneScroll>` (React Island)                  |
| `.fab-secondary` + JS       | `<FabSecondary>` (React Island)                 |
| `.sheet` + JS               | `<BottomSheet>` (React Island)                  |
| `.cam-card` + JS            | `<CameraCard>` (React Island)                   |
| `theme-switch` + `toggleTheme()` | `<ThemeToggle>` (React Island)             |
| `setupStickyDayDividers()`  | `useStuckState` hook v `<PhoneScroll>`          |
| `setupScrollToTodayButton()`| `useScrollToToday` hook v `<PhoneScroll>`       |

---

## Co je a není v tomto balíčku

**✅ Obsaženo:**
- Kompletní design systém (tokens, typography, hand-drawn ikony)
- Všechny UI komponenty z prototypu v2.2
- Scroll chování (stuck state, scroll-to-today, initial scroll na dnešek)
- Dark mode s persistencí
- Bottom sheet s ESC + backdrop close
- Camera card (bez skutečného capture — placeholder)
- PWA manifest + SW config
- TypeScript types pro Client, Appointment, Photo, Allergen
- Czech formátování (data, časy, pluralizace)

**⏳ Co dodělat v dalším kole:**
- Dexie.js DB schema + repositories
- Skutečné capture photos (getUserMedia + encrypted storage)
- Client list page (sheet nav → /clients)
- Editační flow pro slots, chipy
- Empty states
- Login / onboarding
- Statistics, Archiv, Nastavení pages
- Background sync pro offline edity
- E2E encryption layer (Noble + Web Crypto)

---

## Konvence

**TypeScript:** Strict mode. `interface` pro domain types, `type` pro utility.
Exporty vždy named (no default, kromě Astro pages).

**Astro komponenty:** Props definované v TypeScript interface nahoře v frontmatteru.
Scoped `<style>` blok, žádné globální styly (ty jdou do `src/styles/`).

**React Islands:** Vždy function components s explicit return type.
Props interface suffixed `Props` (např. `PhoneScrollProps`).
Nikdy `any`. Hooks importované z `./hooks/`.

**CSS:** BEM-ish naming (`.slot-name`, `.slot-sub`) konzistentní s prototypem.
Žádný Tailwind pro teď — kept close to prototype CSS.

**Czech:** UI text a komentáře v produktivních komentářích (které uvidí tým) v češtině.
JSDoc komentáře v angličtině (standardní praxe).

---

Coding agente, pokud narážíš na nejasnost, respektuj prototyp
(`tricho-prototyp-v2.html`) jako source of truth pro vizuální chování.
North Star (`tricho-north-star.md`) jako source of truth pro designová pravidla.

Začni s `package.json`, `astro.config.mjs`, `src/styles/`, pak typy,
pak Astro komponenty, pak React Islands, pak pages.
