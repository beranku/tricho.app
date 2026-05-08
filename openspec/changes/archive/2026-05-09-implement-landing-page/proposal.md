## Why

The marketing site at the apex (`web/`) currently ships a placeholder landing page (a generic feature grid with copy that does not match the brand voice). A finished, designer-led prototype lives in `prototypes/landing-page-prototype/landing-page.html` together with locked Czech copy (`COPY.md`), design tokens (`DESIGN_TOKENS.md`) and a component map (`STRUCTURE.md`). Until that prototype is moved into production-grade Astro components, the apex cannot be launched: the existing page does not surface the value proposition, plan structure, testimonials, story, or FAQ that the brand strategy depends on, and it does not match the visual identity of the PWA shell.

This change replaces the placeholder landing with the production landing-page implementation, faithfully reproduced from the prototype, while preserving the existing marketing-site contract (static output, layout-driven SEO, install banner, launch-app affordance).

## What Changes

- Add full landing-page implementation to `web/`:
  - `web/src/pages/index.astro` is **rewritten** to compose the new sections (Hero, TwoScreens, Story, Privacy, Pricing, Voices, FAQ, FinalCta).
  - New section components under `web/src/components/landing/` (Header, Hero, TwoScreens, Story, Privacy, Pricing, Voices, Faq, FinalCta, Footer).
  - New phone-mockup components under `web/src/components/phone/` (PhoneFrame, PhoneStatusBar, ContentDiar, ContentKartaKlientky, etc.) — pure HTML/CSS, no rasters.
  - New UI primitives under `web/src/components/ui/` (Button, ThemeToggle, Pillar, PlanCell, Testimonial, FaqItem, SectionHead).
  - Centralised copy module at `web/src/content/landing.ts` (lifted verbatim from `COPY.md`).
- Extend design tokens:
  - Add `--cream`, `--cream-2`, `--ink-2..4`, `--teal-200/600/700/900`, `--copper-deep/soft/50`, `--radius-card`, `--radius-ctrl` to `web/src/styles/tokens.css`.
  - Add full `:root[data-theme="dark"]` overrides matching the prototype.
- Add new typefaces (Geist Mono, Caveat) via Google Fonts in `Base.astro` (preconnect already present); reuse self-hosted Fraunces / Geist / Patrick Hand from `site.css`.
- Add a **landing-page stylesheet** (CSS modules per component or a single dedicated stylesheet — see design.md) for section, mockup, and primitive styles.
- Add **two interaction scripts**:
  - Theme toggle (FOUC-safe inline init in `<head>`, click handler in `ThemeToggle`), respecting `prefers-color-scheme` as default and persisting to `localStorage['tricho-theme']`.
  - FAQ single-open accordion using native `<details>`/`<summary>` plus a 5-line `toggle` listener.
- Preserve existing apex contract:
  - `InstallBanner` and `LaunchAppLink` continue to render and remain dismissable / hidden by default.
  - `Base.astro` continues to own all `<head>` SEO, OG/Twitter, JSON-LD, manifest, service-worker registration, install-banner reveal, launch-app reveal.
  - `<title>` and `<meta name="description">` come from `COPY.md` (overrides the existing placeholder text).

Out of scope for this change:
- Real video, real testimonial photos, OG/favicon assets (placeholders only — tracked in `prototypes/landing-page-prototype/TODO.md`).
- New routes (`/o-nas`, `/podminky`, `/cookies`, etc.) — existing routes are untouched.
- PWA install prompt redesign — the "Začít zdarma" CTA continues to point at `/app/`.

## Capabilities

### New Capabilities
*(none — all work lands inside the existing `marketing-site` capability)*

### Modified Capabilities
- `marketing-site`: adds requirements for the production landing-page surface — section composition, theme toggle, FAQ accordion, phone mockups, copy provenance, dark-mode parity. Existing static-output / SEO / OG / install-banner / launch-app / Core-Web-Vitals requirements are unchanged.

## Impact

- **Code touched:** `web/src/pages/index.astro` (rewrite), `web/src/styles/tokens.css` (extend), `web/src/styles/site.css` (lightly extend or leave; new styles live with components), `web/src/layouts/Base.astro` (add Google Fonts link + FOUC-safe theme init script), plus ~20 new `.astro` component files and one `.ts` content file.
- **Dependencies:** none added. Google Fonts referenced via `<link>` (no npm package). Existing `@astrojs/mdx`, `@astrojs/sitemap`, `astro` versions are sufficient.
- **APIs / runtime:** no server-side changes. PWA shell at `/app/` untouched. Service-worker pass-through unaffected.
- **Performance budget:** must remain inside the 100 KB compressed critical-resources budget and ≤ 50 KB compressed total client JS. Two inline `<script>` blocks total ~30 lines.
- **Accessibility:** semantic HTML, `aria-label` on icon buttons, focus-visible outlines, keyboard-navigable FAQ via native `<details>`.
- **Rollback:** revert the change — all edits land inside `web/`; nothing else depends on the new components.
