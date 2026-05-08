## Design — Landing-page implementation

### Approach in one paragraph

Take the standalone prototype HTML (`prototypes/landing-page-prototype/landing-page.html`) and decompose it into Astro components that compose to a single `index.astro`. Every visible string lives in `web/src/content/landing.ts` (a typed mirror of `COPY.md`); every visual token lives in `web/src/styles/tokens.css`; every component owns its own scoped styles via Astro's `<style>` block (which compiles to component-scoped CSS without CSS Modules tooling). The result is a static HTML page with two tiny inline scripts (theme toggle, FAQ accordion).

### File layout

```
web/src/
├── content/
│   └── landing.ts              ← typed content lifted from COPY.md
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
│   ├── phone/
│   │   ├── PhoneFrame.astro       (props: variant 'full'|'mini', slot)
│   │   ├── PhoneStatusBar.astro
│   │   ├── PhoneSlot.astro        (props: time, name?, subtitle?, status?, freeText?)
│   │   ├── PhoneDayHeader.astro
│   │   ├── PhoneDivider.astro
│   │   ├── ContentDiar.astro
│   │   └── ContentKartaKlientky.astro
│   └── ui/
│       ├── Button.astro            (props: variant 'primary'|'secondary'|'text', href?)
│       ├── ThemeToggle.astro
│       ├── SectionHead.astro       (props: num, title (HTML), sub?)
│       ├── Pillar.astro            (props: label, text (HTML))
│       ├── PlanCell.astro          (props: name, amount, period, tag, features[], microcopy)
│       ├── Testimonial.astro       (props: quote (HTML), initials, name, role, photoSrc?)
│       └── FaqItem.astro           (props: question, answer (HTML))
├── layouts/Base.astro              (extended: Google Fonts link, FOUC theme init)
├── pages/index.astro               (rewritten composition)
└── styles/
    ├── tokens.css                  (extended palette + dark theme)
    └── site.css                    (existing — kept for /about, /pricing, etc.)
```

### Decision: Astro `<style>` blocks vs. global CSS file vs. CSS Modules

**Choice: Astro component `<style>` blocks (scoped) for component styles + extend `tokens.css` for shared tokens.**

- The repo doesn't use CSS Modules; existing `web/src/components/*.astro` rely on `site.css` plus inline styles. Introducing a third pattern would fragment the codebase.
- Astro `<style>` blocks are scoped by default (component-class hashing), give us colocation, and produce no extra runtime — the build inlines critical CSS automatically.
- Tokens stay global because they cross component boundaries and the dark-mode override on `:root[data-theme="dark"]` cascades naturally.
- Section-level utilities used by multiple components (e.g. `.page` max-width, `.section-head`) live in a small new `web/src/styles/landing.css` imported once from `index.astro`. Keep it under 6 KB minified.

### Decision: Phone mockups in HTML/CSS, not raster

The prototype renders the diary and the client card as pure HTML+CSS+SVG. Keep that — it preserves crispness on retina, theme-flips with the dark mode automatically, and avoids the LCP cost of large hero images. The mockup ships at ~2 KB of HTML + ~3 KB of CSS — far cheaper than a 60 KB hero PNG.

### Decision: Copy module is **typed** but **plain TypeScript**, not an Astro Content Collection

Content collections are designed for many records of the same shape (blog posts, help articles). The landing page is a single document with heterogeneous sections. A `landing.ts` module exporting named consts is simpler, type-safe, and grep-friendly. It also keeps the locked Czech copy in one file so editors can sweep it without reading component code.

### Decision: Theme toggle architecture

Three pieces:

1. **Inline FOUC-safe init in `Base.astro` `<head>`** (runs before CSS):
   ```html
   <script is:inline>
     (function () {
       try {
         var t = localStorage.getItem('tricho-theme');
         if (t === 'dark') { document.documentElement.setAttribute('data-theme', 'dark'); return; }
         if (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
           document.documentElement.setAttribute('data-theme', 'dark');
         }
       } catch (_) {}
     })();
   </script>
   ```
2. **Click handler in `ThemeToggle.astro`** flips `data-theme` and writes to localStorage.
3. **CSS** keys all colour tokens off `:root` and `:root[data-theme="dark"]` — components never branch on theme.

Total budget: ~20 lines of JS, all inline, blocking is intentional (prevents flash). Inline length is ~400 bytes — well under the 100 KB critical budget.

### Decision: FAQ accordion

Native `<details>`/`<summary>` for keyboard + screen-reader behaviour. A 5-line script on `Faq.astro` listens for `toggle` and closes siblings. No dependency on JS for content visibility — non-JS users can still expand items.

### Decision: One CTA, repeated

The prototype ships **only `Začít zdarma`** (4 placements). Each links to `/app/` to hand off to the PWA — same href as today's placeholder. The "Otevřít aplikaci" link is the standalone-only `LaunchAppLink` already in the layout; we keep using it.

### Threat-model delta

This change touches only the marketing surface. **Zero-knowledge invariants are not affected**:
- No plaintext leaves the client; the page renders no user data.
- No analytics or third-party scripts are added.
- Google Fonts is already loaded by the existing implementation; we add two more font families on the same `fonts.googleapis.com` connection.
- The two new inline scripts read/write only `localStorage['tricho-theme']` and DOM state; they have no network surface.

### Performance budget

| Resource              | Budget (compressed) | How we stay under |
|-----------------------|---------------------|-------------------|
| HTML                  | ~25 KB              | Single page, no inline SVG larger than the hero mockup |
| CSS (head-blocking)   | ~25 KB              | Astro auto-inlines critical; component-scoped CSS pruned |
| Inline JS (head)      | ~1 KB               | Theme FOUC-init + (existing) install-banner + launch-app reveals |
| Body JS               | ~2 KB               | Theme-toggle click handler + FAQ accordion |
| Fonts (subset)        | already preconnected| `font-display: swap`, no blocking |
| **Total critical**    | **<100 KB**         | Hard requirement from `marketing-site` spec |

### Accessibility

- Skip-link `Přejít k obsahu` → `#main`, present at top of `<body>`.
- `<h1>` exactly once (Hero); `<h2>` per section.
- All icon-only buttons (`ThemeToggle`, video play) carry `aria-label`.
- `data-theme` doesn't break `prefers-color-scheme`: stored choice wins, but users with no choice respect their OS setting.
- Native `<details>` keyboard-handles FAQ.
- Focus-visible outlines on all interactive elements via component-scoped CSS.

### Rollout

Single PR. Diff the rendered HTML against the prototype to confirm pixel parity. Run `npm run build` + `astro check` from `web/`. Manual Lighthouse pass on `dist/index.html` (mobile profile) — requirement is Performance ≥ 95, LCP < 2.5 s.

### Open questions / TODO carried forward

These are out-of-scope of this change and are tracked in `prototypes/landing-page-prototype/TODO.md`:

- Real video of Ludmila + poster image
- Three testimonial photos
- OG image and favicon
- New routes: `/gdpr` (legally required pre-launch), `/podminky`, `/cookies`, `/o-nas`
- Self-hosting Geist Mono + Caveat (current implementation uses Google Fonts)

The components accept the relevant `videoSrc` / `photoSrc` / `ogImage` props so swapping in real assets is a one-line edit per component.
