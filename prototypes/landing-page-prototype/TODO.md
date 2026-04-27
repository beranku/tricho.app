# TODO — pro autora po implementaci

Tento soubor obsahuje věci, které **coding agent nemůže vyřešit sám** během implementace landing page. Po dokončení implementace zkontroluj a vyřeš.

## Assety

### 🎬 Video Ludmily (75 vteřin)
- **Stav:** Placeholder v `<Story>` komponentě.
- **Co dodat:** MP4 video (H.264, max 10 MB), poster JPG (1080×1350, aspect ratio 4:5).
- **Kam:** `public/videos/ludmila-ukazka.mp4` + `public/videos/ludmila-poster.jpg`.
- **Komponenta** by měla po dodání akceptovat `videoSrc` a `posterSrc` jako props.
- **Doporučení:** Self-host přes `<video controls preload="none" poster="...">`. Žádný YouTube embed (privacy positioning).

### 📸 Fotografie testimonialek
- **Stav:** Placeholdery (kruhové gradienty s iniciálami).
- **Co dodat:** 3× kruhové fotografie (256×256 JPG/WebP, profilové):
  - Marie Nováková (MN)
  - Jana Kratochvílová (JK)
  - Petra Svobodová (PS)
- **Kam:** `public/images/testimonials/marie.webp` (atd.).
- **Komponenta** `Testimonial` by měla akceptovat optional `photoSrc`. Když je nastavena, zobraz foto, jinak fallback iniciály.

### 🖼️ Open Graph image
- **Stav:** Placeholder (chybí).
- **Co dodat:** OG image 1200×630 PNG.
- **Doporučení:** Použij hero design — H1 nadpis ve Fraunces přes paper-grain pozadí, nebo screenshot karty klientky z mockupu.
- **Kam:** `public/og.png`.

### 🎨 Favicon
- **Stav:** Placeholder.
- **Co dodat:**
  - `public/favicon.svg` (preferovaný moderní formát)
  - `public/favicon.ico` (fallback)
  - `public/apple-touch-icon.png` (180×180)
- **Doporučení:** Jednoduchý monogram „T" ve Fraunces nebo mini ikona kalendáře v copper/teal.

## Routing

### `/blog`
- **Stav:** Odkaz v navigaci a footeru, ale stránka neexistuje.
- **Co udělat:** Buď (a) vytvořit blog content collection s plánovanými články, nebo (b) vyrobit jednoduchou „Coming soon" stránku, nebo (c) odstranit odkaz, dokud blog nebude.

### `/help` (Nápověda)
- **Stav:** Odkaz v navigaci a footeru, stránka neexistuje.
- **Doporučení:** Implementovat přes Astro Starlight nebo jednoduchou content collection (FAQ → kategoriální dokumentace).

### `/o-nas`
- **Stav:** Odkaz ve footeru, stránka neexistuje.
- **Doporučení:** Implementovat až později — neblokuje launch landing page.

### Právní stránky (`/gdpr`, `/podminky`, `/cookies`)
- **Stav:** Odkazy ve footeru, stránky neexistují.
- **POZOR:** Před launch musí existovat alespoň `/gdpr` (Privacy Policy / Information for data subjects) — vyžadováno GDPR. `/podminky` a `/cookies` tolerantnější (cookies neukládáme, podmínky nutné při registraci).
- **Doporučení:** Připravit Markdown obsah a vystavit jako statické Astro stránky. Šablonu DPA (zmíněna v FAQ 4) buď přidat jako PDF download v `/gdpr`, nebo později.

### `mailto:ahoj@tricho.app`
- **Stav:** Odkaz funguje. Ujisti se, že **e-mailová schránka existuje a je čtená.**

## Funkce

### PWA install prompt
- **Stav:** Tlačítko „Začít zdarma" momentálně skroluje na sekci `#stahnout` (final CTA).
- **Co bude potřeba:**
  - Implementace skutečného `beforeinstallprompt` flow (Android Chrome)
  - iOS edukativní overlay s instrukcemi „Safari → Sdílet → Přidat na plochu" (iOS nemá API)
  - Detekce, jestli už je nainstalováno (matchMedia('(display-mode: standalone)'))
- **Out of scope této PR.** Když přijde čas, implementuj jako samostatný feature s vlastním modal flow.

### Theme toggle persistence
- **Stav:** Implementováno přes `localStorage`.
- **Krásnější UX:** Respektovat `prefers-color-scheme` jako default při první návštěvě:
  ```js
  if (!stored) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) root.setAttribute('data-theme', 'dark');
  }
  ```
  Přidej tuto logiku, agente.

### FOUC (flash of unstyled content)
- **Stav:** Možné riziko při načítání theme z `localStorage`.
- **Řešení:** Přidej blokující inline `<script>` v `<head>` před načtením CSS:
  ```html
  <script>
    try {
      const t = localStorage.getItem('tricho-theme');
      if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    } catch(e) {}
  </script>
  ```

## Performance

### Font loading
- **Stav:** Google Fonts přes `<link>` (default `font-display: swap` kvůli URL parametru).
- **Optimalizace:** Zvážit self-hosting přes `@fontsource/fraunces`, `@fontsource/geist-sans`, `@fontsource-variable/...` pro:
  - Eliminaci third-party request
  - Přesnou kontrolu nad font-display
  - Lepší LCP

### Critical CSS
- **Astro to obvykle řeší automaticky.** Po buildu zkontroluj, že hero styling je inlined.

### Image lazy loading
- **Stav:** Žádné images v hero (mockupy jsou HTML+CSS).
- Když dodáš video poster a OG image, použij `loading="lazy"` pod foldem.

## Lighthouse audit

Po implementaci spusť:
- **Performance** ≥ 95 (mobile)
- **Accessibility** = 100
- **Best Practices** ≥ 95
- **SEO** = 100

Pokud něco klesne pod, **nahlas důvod** v PR description.

## Označení po dokončení

Coding agent: až vyřešíš nějakou položku, doplň zde stav:

- [x] Všechny komponenty implementovány
- [x] Stránka projde build
- [ ] Lighthouse audit nahlášen *(manuální krok mimo CI — nahlas po deploy preview)*
- [x] Theme toggle funguje (s prefers-color-scheme fallback)
- [x] FAQ accordion funguje (single-open)
- [x] Mobile breakpointy funkční
- [x] Dark mode vizuálně OK
- [x] Linter/TS bez warningů
- [ ] PR description napsán

## Pro autora — co řešit po merge

- [ ] Nahrát video Ludmily
- [ ] Pořídit profilové fotky 3 testimonialek
- [ ] Vyrobit OG image
- [ ] Vyrobit favicon
- [ ] Připravit obsah `/gdpr` (povinné!)
- [ ] Rozhodnout o `/podminky`, `/cookies`
- [ ] Rozhodnout o blogu (zveřejnit / skrýt link)
- [ ] Nastavit `ahoj@tricho.app` schránku
- [ ] Doménový + DNS setup
- [ ] (Volitelně) Plausible / self-hosted analytics
- [ ] (Volitelně) self-host fonty místo Google Fonts
