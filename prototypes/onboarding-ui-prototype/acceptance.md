# Tricho.App welcome screen — Acceptance checklist

Spuštění před PR. Každý bod musí být ✅ nebo má důvod, proč ne, v PR popisu.

---

## Funkční chování

### Launch mode detekce

- [ ] Otevření URL v běžném prohlížeči (ne PWA): wizard začíná na Step 1
- [ ] Otevření z installed PWA na iOS Safari: wizard začíná na Step 2 (Step 1 je už done)
- [ ] Otevření z installed PWA na Android Chrome: wizard začíná na Step 2
- [ ] Po odinstalování PWA a otevření URL v prohlížeči: wizard zase od Step 1
- [ ] `localStorage` neukládá launch mode — detekce se dělá při každém loadu

### Step 1 (Instalace) — browser mode

- [ ] iOS Safari: zobrazí se iOS instrukce se share ikonou inline
- [ ] Android Chrome: zobrazí se Android instrukce s ⋮ glyphem
- [ ] Jiný prohlížeč (např. Firefox, Edge): zobrazí se generic fallback
- [ ] Klik na „Mám nainstalováno": tělo karty se přepne na post-install zprávu, **wizard NEpostoupí na Step 2**
- [ ] Step 2 a 3 zůstanou locked
- [ ] Klik na „Ještě jsem ji neinstaloval/a": vrátí se k instalačním instrukcím
- [ ] Caveat amber warning „v prohlížeči by tvoje data nebyla v bezpečí" je vidět a čitelné

### Step 1 — PWA mode

- [ ] Step 1 je rovnou v done state, opacity 0.5, copper check marker
- [ ] Step 2 je active a expandovaný
- [ ] Žádná post-install zpráva se nikdy nezobrazí v PWA módu

### Step 2 (Přihlášení)

- [ ] Apple OAuth tlačítko je espresso černé (`#2A231B`), v dark mode invertované
- [ ] Google OAuth tlačítko má autentické barvy loga (4 segmenty)
- [ ] Klik na Apple → spustí `AppleID.auth.signIn()` flow
- [ ] Klik na Google → spustí Google Identity Services flow
- [ ] Po úspěšném přihlášení Step 2 → done, Step 3 → active
- [ ] Po neúspěšném přihlášení (cancel, error) Step 2 zůstane active s viditelnou error hláškou (mimo aktuální spec, ale počítej s tím)
- [ ] Footer disclaimer „nedostane heslo ani přístup k e-mailu" je viditelný

### Step 3 (Šifrování) — nový účet

- [ ] Caveat amber warning „Tvůj klíč. Bez něj data neobnovíš." nad QR
- [ ] QR kód je generovaný z reálného master klíče (256-bit), ne mockup
- [ ] Otisk klíče zobrazuje formát `Otisk · XXXX · XXXX · XXXX` s last4 v copperu
- [ ] „Stáhnout obrázek QR kódu" skutečně stáhne PNG (na iOS Safari fallback s long-press hintem)
- [ ] „Mám uložený klíč" → substep `verify`, „Zpět ke klíči" se objeví v hlavičce
- [ ] V substep `verify`: kamera (capture=environment), galerie (file picker), nebo last4 input
- [ ] Last4 input akceptuje jen Base32 znaky (A-Z, 2-7), case-insensitive, max 4
- [ ] Po úspěšném ověření → substep `webauthn`, „Zpět k ověření" v hlavičce
- [ ] „Aktivovat biometrii" zavolá `startRegistration()` z `@simplewebauthn/browser`
- [ ] Po úspěšné WebAuthn registraci master klíč zašifrovaný → uložený do IndexedDB

### Step 3 — existující účet

- [ ] Žádný QR display (uživatel klíč nezískává, jen načítá)
- [ ] Vyfotit / Vybrat z galerie / vepsat ručně — tři rovnocenné cesty
- [ ] Manuální input akceptuje plný Base32 řetězec, validuje formát na submit
- [ ] Po načtení klíče → rovnou substep `webauthn` (žádný separátní verify)
- [ ] **Žádný back link v hlavičce stepu** v existujícím účtu
- [ ] Po WebAuthn registraci master klíč → odšifruje server payload → wizard done

### Final state

- [ ] Po dokončení Step 3 se zobrazí Caveat „Vítej v zápisníku."
- [ ] „Otevřít aplikaci" CTA je teal primary
- [ ] Klik → navigate do hlavní aplikace

---

## Vizuální shoda s prototypem

Otevři `prototype.html` vedle implementace, projdi side-by-side:

- [ ] Brand wordmark: `Tricho` Fraunces 28px (mobile 32px) + `.APP` Geist 10px copper kicker, top-aligned, vpravo nahoře u titulu
- [ ] Subtitle Patrick Hand 15px (mobile 16px) ink-3
- [ ] Step kickers: `TVÉ ZAŘÍZENÍ` / `TVÁ IDENTITA` / `TVÁ DATA` v Geist 10px copper, letter-spacing 0.18em
- [ ] Step titles Fraunces 19px (mobile 20px) ink, letter-spacing -0.015em
- [ ] Step markers: kruh 30×30 s číslem v Geist 13px tabular nums
- [ ] Done marker: copper hand-drawn check SVG (ne ikona z lib)
- [ ] Locked marker: lock icon, ink-4
- [ ] Done state opacity 0.5, surface-2 background, no shadow
- [ ] Locked state opacity 0.62, surface-2 background
- [ ] Active state surface background, copper-border
- [ ] Install rows jako vertikální timeline: copper outlined dots spojené tenkou line opacity 0.32
- [ ] Inline glyphs (share, ⋮) ve frází akce, vertical-align -3px
- [ ] Auth buttony 52-56px tall, 12px radius, gap 12px mezi ikonou a labelem
- [ ] QR card: surface, copper-border, 14px padding, QR canvas 152×152
- [ ] Otisk klíče Geist Mono 11px, ink-3, last4 copper-mid bold
- [ ] CTA primary teal s gradient (linear 160deg) a 3-vrstvý shadow
- [ ] CTA secondary copper outline na copper-tint pozadí
- [ ] Paper grain overlay aktivní v obou theme módech, blend mode správný

---

## Accessibility

- [ ] Touch targets min 44×44px na všech interactive prvcích
- [ ] Focus visible: 2px copper outline, 1px offset, na všech buttons/inputs/links
- [ ] Keyboard navigation: tab order odpovídá vizuálnímu order, žádné focus traps
- [ ] Screen reader: aria-live region oznámí substep transitions („přepnuto na ověření klíče")
- [ ] Aria-checked na všech radio-style options
- [ ] Aria-haspopup, aria-expanded na dropdown trigger
- [ ] Color contrast: všechny text/bg kombinace ≥ 4.5:1 (běžný text) / 3:1 (large text)
- [ ] `prefers-reduced-motion` respektován — animace zkráceny na 0.01ms
- [ ] Inputy mají programmaticky associated labels (htmlFor / aria-labelledby)
- [ ] Hand-drawn check a glyphs mají `aria-hidden="true"` (decorative)

---

## Responzivita

- [ ] Test iPhone SE (375×667): vše čitelné, žádný horizontální scroll
- [ ] Test iPhone 15 Pro (393×852): wizard má dostatek breathing room
- [ ] Test Galaxy S23 (412×915): Android Chrome variant je vidět správně
- [ ] Test desktop (≥901px): phone frame se zobrazí (preview mode), nebo plný viewport pokud je deployed
- [ ] Safe area insets respektovány na iPhone X+ (env(safe-area-inset-top/bottom))
- [ ] Status bar v PWA mode není simulovaný — používá real systémový s safe area

---

## Theme

- [ ] Light theme: výchozí, paper cream pozadí, paper grain s `multiply` blend
- [ ] Dark theme: espresso `#211A15`, paper grain s `screen` blend
- [ ] Theme toggle: per-session jen pro debug/preview; produkčně řízený `prefers-color-scheme` nebo user setting
- [ ] Apple OAuth button: invertován v dark mode (světlý fill)
- [ ] Google OAuth button: konzistentní logo barvy v obou módech
- [ ] Všechny copper akcenty mají dark variant `#C48867` místo `#B06E52`
- [ ] Teal akcenty mají dark variant `#2494B2` místo `#0E7490`

---

## Bezpečnost a data

- [ ] Master klíč nikdy nepřejde plain text přes `localStorage`, `sessionStorage`, nebo do server logu
- [ ] WebAuthn credential ID se ukládá do IndexedDB, ne localStorage
- [ ] OAuth ID token se zpracovává server-side, klient ho jen předává
- [ ] PWA storage origin: ujisti se, že `localStorage`/`IndexedDB` v `display-mode: standalone` se NEsdílí s běžnou browser tabou
- [ ] Po odinstalování PWA a reinstallu uživatel projde Step 3 jako „existující účet" — backend pozná, že už má credentials, ale lokální klíč je pryč

---

## Performance

- [ ] First Contentful Paint < 1.5s na 3G simulaci
- [ ] Lighthouse PWA score ≥ 95
- [ ] Lighthouse Accessibility score = 100
- [ ] Žádné console errory ani warningy v produkčním buildu
- [ ] Bundle size: tato obrazovka < 50 KB gzipped (bez crypto knihoven)

---

## Edge cases

- [ ] Uživatel přidá PWA na plochu, ale neotevře ji a vrátí se do prohlížeče → vidí post-install zprávu znovu (state se ztratí, OK)
- [ ] Uživatel zavře OAuth okno bez dokončení → Step 2 zůstane active, žádná error modal nepotřeba (uživatel může zkusit znovu)
- [ ] Uživatel zadá špatný last4 → input border amber, focus zpět do inputu, žádný error toast
- [ ] Uživatel uploaduje obrázek bez QR kódu → toast „QR kód nebyl rozpoznán, zkus znovu"
- [ ] Uživatel je offline během OAuth → degraded UX, ale graceful (tlačítka stále vypadají interaktivně, error po pokusu)
- [ ] WebAuthn není podporovaný na zařízení → „Tvé zařízení biometrii nepodporuje" + alternativní flow (mimo aktuální spec)
- [ ] User long-presses na share/menu glyph v iOS instrukci → context menu se neotevře (glyph není interactive element)
