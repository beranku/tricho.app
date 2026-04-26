# Tricho.App — Texty UI

Všechny texty z welcome screen / onboarding wizardu na jednom místě. Pokud potřebuješ změnit copy, dělej to tady. Tone of voice: **deníkový, lidský, ne korporátní**. Žádné „Vážený uživateli", žádné „Klikněte prosím".

---

## Brand wordmark

- **Brand name:** `Tricho`
- **Suffix:** `.APP`
- **Subtitle:** `tvůj zápisník trichologa`

---

## Krok 1 — Instalace

- **Kicker:** `TVÉ ZAŘÍZENÍ`
- **Title:** `Instalace`

### iOS Safari instrukce

1. `Klepni na [share icon] v dolní liště`
   - hint: `v Safari, mezi adresou a záložkami`
2. `Vyber „Přidat na plochu"`
   - hint: `posuň seznam dolů, pokud volbu nevidíš`
3. `Potvrď „Přidat" vpravo nahoře`
   - hint: `aplikace se objeví na ploše`

### Android Chrome instrukce

1. `Klepni na [⋮ glyph] vpravo nahoře`
   - hint: `menu prohlížeče Chrome`
2. `Vyber „Nainstalovat aplikaci"`
   - hint: `nebo „Přidat na plochu"`
3. `Potvrď instalaci`
   - hint: `ikona se objeví v zásuvce aplikací`

### Other browser fallback

1. `Otevři menu prohlížeče`
   - hint: `obvykle ikona ⋮ nebo ⋯`
2. `Najdi „Nainstalovat" nebo „Přidat na plochu"`
   - hint: `pro nejlepší zážitek doporučujeme Safari nebo Chrome`
3. `Otevři aplikaci z plochy`
   - hint: `průvodce automaticky pokračuje`

### CTA

- Pre-install: `Mám nainstalováno`

### Post-install message

- **Title:** `Otevři Tricho.App z plochy`
- **Body:** `Aplikace už máš na obrazovce s aplikacemi nebo na ploše. Klepni na její ikonu a průvodce tě tam přivítá zpátky.`
- **Warning (amber, Caveat font):** `Tady už pokračovat nemůžeš — v prohlížeči by tvoje data nebyla v bezpečí.`
- **Back link:** `Ještě jsem ji neinstaloval/a`

---

## Krok 2 — Přihlášení

- **Kicker:** `TVÁ IDENTITA`
- **Title:** `Přihlášení`

### OAuth buttons

- Apple: `Pokračovat s Apple`
- Google: `Pokračovat s Google`

### Footer disclaimer

- `Tricho.App nedostane heslo ani přístup k tvému e-mailu — jen ověří, že jsi to ty.`

---

## Krok 3 — Šifrování

- **Kicker:** `TVÁ DATA`
- **Title:** `Šifrování`

### Substep: QR (nový účet)

- **Caveat warning above QR:** `Tvůj klíč. Bez něj data neobnovíš.`
- **Fingerprint label:** `Otisk · 7K9F · A2X4 · B7TC`
  *(prvních 12 znaků v ink-3, last4 v copper-mid + bold)*
- **Download CTA:** `Stáhnout obrázek QR kódu`
- **Continue CTA:** `Mám uložený klíč`

### Substep: Verify (nový účet)

- **Header back link:** `‹ Zpět ke klíči` *(slot v hlavičce karty)*
- **Section title:** `Ověř, že máš klíč u sebe`

#### Akce

1. **Title:** `Vyfotit fotoaparátem`
   - sub: `otevře se kamera, namiř ji na uložený QR`
2. **Title:** `Nahrát z galerie`
   - sub: `vyber obrázek, který jsi právě stáhl/a`

- **Divider:** `nebo`
- **Section title:** `Napiš poslední 4 znaky klíče`
- **Input placeholder:** `• • • •` *(Geist Mono, letter-spacing 0.18em)*
- **Submit button:** `Ověřit`

### Substep: WebAuthn (nový účet)

- **Header back link:** `‹ Zpět k ověření`
- **Success note:** `Klíč ověřen. Teď ho propojíme s biometrií zařízení — příště se přihlásíš otiskem nebo obličejem.`
- **CTA:** `Aktivovat biometrii`

### Substep: QR (existující účet)

*(žádný caveat warning ani QR display — uživatel klíč už má, jen ho načítá)*

- **Section title:** `Naskenuj nebo nahraj svůj klíč`

#### Akce

1. **Title:** `Vyfotit QR kód` *(primary highlighted)*
   - sub: `namiř fotoaparát na uložený obrázek nebo výtisk`
2. **Title:** `Vybrat z galerie`
   - sub: `obrázek QR kódu, který sis dříve stáhl/a`

- **Divider:** `nebo`
- **Section title:** `Vepiš celý klíč ručně`
- **Input placeholder:** `XXXX · XXXX · XXXX · XXXX`
- **Submit button:** `Ověřit`

### Substep: WebAuthn (existující účet)

*(žádný back link — viz SPEC sekce 3, UX rozhodnutí)*

- **Success note:** `Klíč rozpoznán. Tvá data se právě dešifrují. Propojíme ho s biometrií zařízení.`
- **CTA:** `Aktivovat biometrii`

---

## Final state (všechny kroky hotové)

- **Caveat (cursive, copper):** `Vítej v zápisníku.`
- **Patrick Hand (sub):** `Otevři první den a zapiš první návštěvu.`
- **CTA:** `Otevřít aplikaci`

---

## Stavové texty (markery v krocích)

- **Done step marker:** copper hand-drawn check (SVG, ne text)
- **Locked step marker:** lock icon (SVG, ne text)
- **Active step marker:** číslo kroku (1/2/3) v copper-mid

---

## Tone of voice — pravidla

1. **Tykání**, ne vykání. Vždy.
2. **Diary tone** — texty čteme jako poznámku v zápisníku, ne jako systémovou hlášku. „tvůj zápisník trichologa", ne „Vaše profesionální CRM řešení".
3. **Krátké, konkrétní.** Žádné „prosím", žádné „v případě, že", žádné „pro zajištění optimální funkčnosti".
4. **Pojmenovávej věci jejich pravým jménem.** „Klíč", ne „šifrovací řetězec". „Plocha", ne „domovská obrazovka aplikací".
5. **Varování v Caveat fontu** mají emocionální tón, ne sterilní. „Bez něj data neobnovíš." je správně. „CHYBA: Klíč musí být zálohován." je špatně.
6. **Žádné emojis.** Vůbec.
