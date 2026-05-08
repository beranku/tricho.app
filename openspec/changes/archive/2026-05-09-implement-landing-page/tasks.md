## 1. Foundation — tokens, fonts, content module

- [x] 1.1 Extend `web/src/styles/tokens.css` with the new variables under `:root` and `:root[data-theme="dark"]` (`--cream`, `--cream-2`, `--ink-2..4`, `--teal-200/600/700/900`, `--copper-deep/soft/50`, `--radius-card`, `--radius-ctrl`, `--paper-blend`, `--paper-opacity`). Do not change any existing key's hex value.
- [x] 1.2 Add Google Fonts `<link rel="preconnect">` + stylesheet for Geist Mono and Caveat to `web/src/layouts/Base.astro` (Fraunces / Geist / Patrick Hand are already loaded as self-hosted woff2 in `site.css`).
- [x] 1.3 Create `web/src/content/landing.ts` with typed exports for: `siteMeta`, `header`, `hero`, `phoneDiar` (mockup data), `phoneKartaKlientky` (mockup data), `twoScreens`, `story`, `privacy`, `pricing` (free + plans + fineprint), `voices` (testimonials + fineprint), `faq` (8 items), `finalCta`, `footer`. Copy lifted verbatim from `prototypes/landing-page-prototype/COPY.md`.

## 2. Layout — `<head>` enhancements

- [x] 2.1 Add a FOUC-safe inline `<script is:inline>` to `Base.astro`'s `<head>` BEFORE the existing scripts and CSS imports. Reads `localStorage['tricho-theme']`; if `'dark'` → set `data-theme="dark"`. If unset → check `prefers-color-scheme: dark` and set `data-theme="dark"` if true.
- [x] 2.2 Verify nothing else in `Base.astro` writes `data-theme`. Service-worker, install-banner, launch-app scripts remain untouched.
- [x] 2.3 Add a small landing-only stylesheet at `web/src/styles/landing.css` (paper-grain `body::before`, `.page` max-width container, `.section-head`, `.section-num`, `.section-title`, `.section-sub`). Imported once from `pages/index.astro`.

## 3. Phone mockups (HTML/CSS only)

- [x] 3.1 `web/src/components/phone/PhoneFrame.astro` — props `variant: 'full' | 'mini'`. Renders frame, dynamic island, status bar slot, paper-grain overlay, default slot for content.
- [x] 3.2 `web/src/components/phone/PhoneStatusBar.astro` — `9:41` + signal/battery glyphs.
- [x] 3.3 `web/src/components/phone/PhoneDayHeader.astro`, `PhoneDivider.astro`, `PhoneSlot.astro` (props per STRUCTURE.md), all consuming tokens only.
- [x] 3.4 `web/src/components/phone/ContentDiar.astro` — composes day header + slots from `landing.ts:phoneDiar`.
- [x] 3.5 `web/src/components/phone/ContentKartaKlientky.astro` — header (Klára Dvořáková), allergen tags (Caveat font), Diagnostika block, Historie list, two photo placeholders.

## 4. UI primitives

- [x] 4.1 `web/src/components/ui/Button.astro` — `variant`, optional `href` (renders `<a>` if set, else `<button>`).
- [x] 4.2 `web/src/components/ui/ThemeToggle.astro` — 32 px circle button, sun/moon icon swap via CSS, click handler that flips `data-theme` and writes to localStorage.
- [x] 4.3 `web/src/components/ui/SectionHead.astro` — `num`, `title` (rendered with `set:html` to allow `<em>`), optional `sub`.
- [x] 4.4 `web/src/components/ui/Pillar.astro` — `label`, `text` (HTML, may contain `<code>`).
- [x] 4.5 `web/src/components/ui/PlanCell.astro` — `name`, `amount`, `period`, `tag`, `features[]`, `microcopy`.
- [x] 4.6 `web/src/components/ui/Testimonial.astro` — `quote` (HTML), `initials`, `name`, `role`, optional `photoSrc`.
- [x] 4.7 `web/src/components/ui/FaqItem.astro` — renders `<details class="faq-item"><summary>…</summary>…answer (HTML)…</details>`.

## 5. Landing sections

- [x] 5.1 `web/src/components/landing/Header.astro` — sticky, brand wordmark + version chip, nav links (Blog · Nápověda · Plány), `<ThemeToggle>`, `<Button variant="primary" href="/app/">Začít zdarma</Button>`. Hide nav links under 720 px.
- [x] 5.2 `web/src/components/landing/Hero.astro` — eyebrow, `<h1>` (Fraunces 300, italic emphasis on *pamatuje za tebe* in teal-700), lede, primary CTA, meta row, plus full `<PhoneFrame variant="full"><ContentDiar /></PhoneFrame>` on the right.
- [x] 5.3 `web/src/components/landing/TwoScreens.astro` — `<SectionHead num="01">`, intro paragraph, two-column grid: `PhoneFrame variant="mini"` + Diář description, `PhoneFrame variant="mini"` + Karta klientky description.
- [x] 5.4 `web/src/components/landing/Story.astro` — `<SectionHead num="02">`, two quoted paragraphs, author block, video placeholder (gradient + play button + `aria-label="Přehrát video"`), manifesto paragraph below.
- [x] 5.5 `web/src/components/landing/Privacy.astro` — `<SectionHead num="03">` (no sub), background `var(--cream-2)` with top/bottom borders, three Fraunces-300 paragraphs (middle one with `.lift` copper border-left), three `<Pillar>` cards.
- [x] 5.6 `web/src/components/landing/Pricing.astro` — `<SectionHead num="04">`, free block (label + h3 with italic emphasis + text + CTA + 5-feature list), plans intro, two `<PlanCell>`s, fineprint.
- [x] 5.7 `web/src/components/landing/Voices.astro` — `<SectionHead num="05">`, background `var(--cream-2)`, three `<Testimonial>` cards, Patrick-Hand fineprint.
- [x] 5.8 `web/src/components/landing/Faq.astro` — `<SectionHead num="06">`, 8 `<FaqItem>`s; appended `<script>` for single-open behavior (max 10 lines).
- [x] 5.9 `web/src/components/landing/FinalCta.astro` — centered, border-top, h2 with italic emphasis, lede, primary CTA, Patrick-Hand risk-reversal, mono micro line.
- [x] 5.10 `web/src/components/landing/Footer.astro` — 4 columns (brand + tagline · Produkt · Právní · Kontakt), bottom row (copyright · version). Collapse to 2 columns under 720 px and 1 under 480 px.

## 6. Page composition

- [x] 6.1 Rewrite `web/src/pages/index.astro` to import the new sections and compose them in the locked order: `Header` → `main#main` (Hero, TwoScreens, Story, Privacy, Pricing, Voices, Faq, FinalCta) → `Footer`. Keep `<InstallBanner />` (top of `<main>`) and `<LaunchAppLink />` (inside Header).
- [x] 6.2 Pass new title + description from `landing.ts:siteMeta` into `<Base>`.
- [x] 6.3 Keep the existing `softwareJsonLd` block in `index.astro` (reuse it) and re-attach `<Base jsonLd>`.
- [x] 6.4 Add a skip-link `Přejít k obsahu` → `#main` at top of `<body>` content.

## 7. Validation

- [x] 7.1 `cd web && npm run build` — must succeed without warnings.
- [x] 7.2 `cd web && npm run lint` (= `astro check`) — must report 0 errors / 0 warnings.
- [x] 7.3 Manual smoke check on `dist/index.html`: title, description, all four `Začít zdarma` links target `/app/`, page contains all 6 numbered sections plus hero + final CTA + footer.
- [x] 7.4 Theme toggle smoke: open `dist/index.html` in a browser, click the toggle, reload — dark mode persists.
- [x] 7.5 FAQ smoke: open two FAQ items in sequence — only the second stays open.
- [x] 7.6 Update `prototypes/landing-page-prototype/TODO.md` checkboxes for items resolved by this change (build passes, theme toggle, FAQ, breakpoints, dark mode).
