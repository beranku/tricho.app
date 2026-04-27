# Tricho.App — úvodní obrazovka & onboarding wizard

**Pro AI coding agenta:** Tento dokument popisuje implementaci úvodní obrazovky a onboarding wizardu. Doprovodný soubor `prototype.html` je referenční prototyp se všemi stavy. `tokens.css` obsahuje designové tokeny. Používej **prototype.html jako single source of truth pro vizuální podobu** — markup struktura, třídy, animace a chování jsou tam doladěné a otestované.

---

## 1. Kontext aplikace

Tricho.App je offline-first PWA pro trichologa, postavená na React/TypeScript. Klíčová architektonická omezení:

- **End-to-end šifrované** — všechna data klienta včetně fotek jsou šifrovaná před odesláním na server. Server je zero-knowledge.
- **PWA-only** — produkční použití musí běžet v installed mode, ne v běžné browser tabě. Storage origin se liší a uživatel by ztratil data při odinstalování.
- **WebAuthn pro denní přihlašování** — biometrie (Face ID, Touch ID, Android fingerprint) jako primární auth metoda. Master šifrovací klíč je vázaný na WebAuthn credential.
- **Cílové platformy** — iOS Safari (s jeho známými PWA omezeními) a Android Chrome. Jiné prohlížeče fallback s degraded experience.

---

## 2. Co tato obrazovka řeší

Toto je **první obrazovka, kterou uživatel vidí**, když navštíví Tricho.App URL. Pokrývá celý onboarding od „dorazil jsem na URL v prohlížeči" po „mám nainstalovanou PWA, jsem přihlášený, mám aktivní šifrování a biometrii". Tři fáze:

1. **Instalace** — návod, jak přidat PWA na plochu (browser-specific). Po instalaci požadavek na otevření z plochy.
2. **Přihlášení** — OAuth přes Apple nebo Google (žádné jiné varianty).
3. **Šifrování** — buď generování nového klíče s ověřením a aktivací biometrie, nebo načtení existujícího klíče (uživatel se přihlašuje na novém zařízení) s aktivací biometrie.

Po dokončení všech tří fází se uživatel dostane do aplikace samotné (mimo scope tohoto dokumentu).

---

## 3. Wizard state machine

### Top-level state: launch mode

Detekuje se při startu, určuje, kde wizard začíná:

```typescript
function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}
```

| Mode | Detekce | Wizard začíná na |
|---|---|---|
| `browser` | `isStandalone() === false` | Step 1 (Instalace) |
| `pwa` | `isStandalone() === true` | Step 2 (Přihlášení) — Step 1 už je hotový |

**Důležité:** V browser modu wizard NIKDY nepostoupí dál než Step 1. Po kliknutí na „Mám nainstalováno" se zobrazí post-install zpráva s výzvou otevřít PWA z plochy. Žádné step 2/3 v browseru — krádež dat by skončila ve špatné storage origin.

### Step state machine

Každý step je v jednom ze čtyř stavů:

- `locked` — zatím nedosažený, viditelně dimmed (opacity 0.62), s lock ikonkou
- `active` — aktuální, plně viditelný, copper border, expandovaný obsah
- `done` — dokončený, **více tlumený než locked** (opacity 0.5), s copper check markerem
- (post-final) — všechny kroky hotové, zobrazí se welcome message a CTA do aplikace

**Uživatel nemůže přepínat fáze ručně.** Jen aktivní step je expandovaný. Postup je jednosměrný: dokončení aktivního stepu automaticky aktivuje další.

### Step 1 substate

```
data-installed="false"  → ukazuje install instructions + CTA "Mám nainstalováno"
data-installed="true"   → ukazuje post-install zprávu (otevři z plochy + amber warning)
                         + back link "Ještě jsem ji neinstaloval/a"
```

V PWA modu Step 1 nikdy neukazuje post-install zprávu — automaticky přeskočí jako `done`.

### Step 3 substate machine

Step 3 má dvě paralelní větve (`data-flow="new"` vs `data-flow="existing"`), každá se třemi substepy (`data-substep`):

**Nový účet (`flow="new"`):**

```
qr        → ukáže vygenerovaný klíč jako QR kód s otiskem (last 4 highlight)
            akce: "Stáhnout obrázek QR kódu" (download), "Mám uložený klíč" → verify
verify    → ověření, že uživatel klíč skutečně má
            akce: scan kamerou / upload z galerie / zadat last 4 znaky → webauthn
            zpět: "Zpět ke klíči" (v hlavičce karty) → qr
webauthn  → success note + "Aktivovat biometrii"
            zpět: "Zpět k ověření" (v hlavičce karty) → verify
            dokončení → step done, wizard finished
```

**Existující účet (`flow="existing"`):**

```
qr        → načtení klíče, který už uživatel má
            akce: vyfotit kamerou / vybrat z galerie / vepsat ručně
            (po jakékoliv z těchto akcí přímo na webauthn)
webauthn  → success note + "Aktivovat biometrii"
            (žádný back link — jakmile je klíč rozpoznán, jsme u cíle)
            dokončení → step done, wizard finished
```

Pozn. ke zpětné navigaci: back link sídlí v **header rowu** active stepu, ve slotu po pravé straně titulu (kde u locked stepů je lock ikonka). Logika viditelnosti je čistě CSS:

```css
.step-card[data-state="active"][data-flow="new"][data-substep="verify"] .step-back-btn[data-target="qr"],
.step-card[data-state="active"][data-flow="new"][data-substep="webauthn"] .step-back-btn[data-target="verify"] {
  display: inline-flex;
}
```

---

## 4. Browser detekce pro Step 1

Step 1 ukazuje různý návod podle prohlížeče. Detekce na základě UA:

```typescript
function detectBrowser(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}
```

**Návod pro každou variantu** (přesné texty v `prototype.html`):

- **iOS Safari** — Klepni na share ikonu v dolní liště → Vyber „Přidat na plochu" → Potvrď „Přidat" vpravo nahoře
- **Android Chrome** — Klepni na ⋮ vpravo nahoře → Vyber „Nainstalovat aplikaci" → Potvrď instalaci
- **Other (fallback)** — Otevři menu prohlížeče → Najdi „Nainstalovat" nebo „Přidat na plochu" → Otevři aplikaci z plochy

UI toto zobrazuje jako vertikální časovou osu (tečka na čáře, ne číslované kroky — vědomě, kvůli unikátnímu číslu kruhu fáze).

Inline glyphs v textu („Klepni na **[share icon]** v dolní liště") jsou SVG inline ve frází; v iOS Safari je to share square, v Chrome ⋮ menu glyph.

---

## 5. Komponentní struktura (doporučená)

Rozdělení do React komponent (volné, agent může adaptovat podle stávající codebase):

```
<WelcomeScreen>           // route /welcome nebo /
  <BrandWordmark />        // "Tricho" + ".APP" suffix
  <Subtitle>tvůj zápisník trichologa</Subtitle>
  <OnboardingWizard>
    <StepCard step={1} state="active|locked|done">
      <StepHeader />
      <StepBody>
        {!installed ? <Step1Pre /> : <Step1Post />}
      </StepBody>
    </StepCard>
    <StepCard step={2} state="...">
      <StepHeader />
      <StepBody><Step2 /></StepBody>
    </StepCard>
    <StepCard step={3} state="..." flow="new|existing" substep="qr|verify|webauthn">
      <StepHeader>
        <SubstepBackButton />  // conditional, in header right slot
      </StepHeader>
      <StepBody>
        {flow === 'new' ? <Step3New /> : <Step3Existing />}
      </StepBody>
    </StepCard>
    <FinalCard />  // shows when all done
  </OnboardingWizard>
</WelcomeScreen>
```

### Stav (doporučení: jeden reducer)

```typescript
type WizardState = {
  launchMode: 'browser' | 'pwa';
  step1: { installed: boolean };
  step2: { authenticated: boolean; provider?: 'apple' | 'google' };
  step3: {
    flow: 'new' | 'existing';
    substep: 'qr' | 'verify' | 'webauthn';
    completed: boolean;
  };
  currentStep: 1 | 2 | 3 | 'final';
};

type WizardAction =
  | { type: 'CONFIRM_INSTALLATION' }
  | { type: 'CANCEL_INSTALLATION' }
  | { type: 'AUTHENTICATE'; provider: 'apple' | 'google' }
  | { type: 'SET_FLOW'; flow: 'new' | 'existing' }
  | { type: 'ADVANCE_SUBSTEP'; substep: 'qr' | 'verify' | 'webauthn' }
  | { type: 'COMPLETE_STEP_3' };
```

Při browser modu `CONFIRM_INSTALLATION` jen překlopí `step1.installed = true` — neaktivuje step 2. Přechod na step 2 je řízený launch mode detekcí při příštím loadu po otevření z plochy.

---

## 6. Skutečná funkčnost (což prototyp jen simuluje)

Prototyp je vizuální. Pro produkci je potřeba implementovat:

### Step 2 — OAuth

- Apple Sign In přes [`AppleID.auth.signIn()`](https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_js) nebo přes `@simplewebauthn/server`-kompatibilní backend flow
- Google Sign In přes [Google Identity Services](https://developers.google.com/identity/gsi/web/guides/overview) (`accounts.google.com/gsi/client`)
- Server přijme ID token, vytvoří/načte uživatele, vrátí session

### Step 3 — Šifrování (kryptografická vrstva)

**Generování master klíče (nový účet):**

- `crypto.getRandomValues()` pro 256-bit klíč
- Encode jako Base32 nebo bech32-style format pro lidský fingerprint (24 znaků)
- Posledních 4 znaků jsou „last4" pro ověření
- QR obsahuje plný klíč v Base32

**Skenování klíče (existující účet):**

- `<input type="file" accept="image/*" capture="environment">` pro foto z kamery
- `<input type="file" accept="image/*">` pro výběr z galerie
- Decoding QR z obrázku přes `jsQR` nebo podobnou knihovnu
- Manuální zadání: input field s validací formátu

**Knihovny doporučené:**

- **QR generování:** `qrcode-generator` (drobný, dependency-free)
- **QR čtení:** `jsQR`
- **Crypto primitivy:** `@noble/ciphers` (XChaCha20-Poly1305 pro symmetric), `@noble/hashes` (Argon2id pro derivaci z biometrického secretu)
- **WebAuthn klient:** `@simplewebauthn/browser`

### Step 3 — WebAuthn registrace

```typescript
import { startRegistration } from '@simplewebauthn/browser';

async function activateBiometrics(masterKey: Uint8Array) {
  // 1. Backend připraví challenge
  const opts = await fetch('/api/webauthn/register-options').then(r => r.json());
  // 2. Browser vyvolá biometrii
  const att = await startRegistration(opts);
  // 3. Backend uloží credential
  await fetch('/api/webauthn/register-verify', {
    method: 'POST',
    body: JSON.stringify(att),
  });
  // 4. Master klíč zašifrovat lokálně klíčem odvozeným z PRF extension
  //    (WebAuthn PRF) nebo z lokálně držené wrapping key
  await storeWrappedKey(masterKey, att);
}
```

PRF extension (`prf` v `extensions`) je preferovaná cesta — biometrie pak rovnou vrací deterministický secret, kterým se odšifruje master klíč při dalších přihlášeních. Fallback: master klíč zašifrovaný náhodně vygenerovaným wrapping klíčem uloženým v IndexedDB pod tímto WebAuthn credential ID (méně bezpečné, ale fungující).

### Stažení QR jako obrázku

```typescript
function downloadQRAsImage(canvasOrSvg: HTMLElement, filename: string) {
  // Pokud SVG → render do canvas přes <img src="data:image/svg+xml,...">,
  // pak canvas.toBlob() → File → URL.createObjectURL → <a download>
}
```

Na iOS Safari je `download` atribut nespolehlivý — alternativa: otevřít v novém tabu a poradit „long-press → save image".

---

## 7. Designové tokeny

Všechny tokeny v `tokens.css` jako CSS custom properties. Soubor obsahuje light + dark variantu.

Klíčová pravidla použití:

- **Copper** (`--copper`) — anotace, kickers, vedlejší akce, decorative accents. Nikdy ne pro destructive nebo critical state.
- **Teal** (`--teal`) — výhradně pro **active/live state** a primary CTAs vedoucí k završení akce. Pravidlo z North Star: teal = „something is happening right now". Žádný teal pro statický UI.
- **Amber** (`--amber`) — varování typu „bez tohoto klíče přijdeš o data", v Caveat fontu, ne korporátní tone.
- **Ink scale** (`--ink`, `--ink-2`, `--ink-3`, `--ink-4`) — primární text → drobné labely. Ink-4 jen pro glyphs a divider hints, ne pro tělo textu.

### Typografie — tři hlasy

- **Fraunces** (serif, opsz 9-144) — narrative, nadpisy, action verbs. Display použití opsz 28-36, body opsz 18-22.
- **Geist** (sans, weights 300-700) — UI labely, kickers, buttons, mono fingerprints. Default body 13-15px.
- **Patrick Hand** (handwritten) — vysvětlující drobný text, hints, „diary annotations". 14-16px.
- **Caveat** (handwritten cursive) — varování, vítací zprávy, krátké emocionální anotace. 16-22px / weight 600.

Žádný jiný font. Nepoužívej Fraunces na UI labelech ani Geist na narrativ — narušuje to charakter aplikace.

### Wordmark „Tricho.APP"

```html
<div class="brand-wordmark">
  <span class="brand-name">Tricho</span>
  <span class="brand-suffix">.APP</span>
</div>
```

```css
.brand-wordmark { position: relative; padding-right: 38px; }
.brand-name {
  font-family: 'Fraunces', serif;
  font-variation-settings: 'opsz' 36;
  font-weight: 500;
  font-size: 28px;     /* mobile: 32px */
  letter-spacing: -0.02em;
}
.brand-suffix {
  position: absolute;
  left: calc(100% - 38px + 4px);
  top: 5px;
  font-family: 'Geist', sans-serif;
  font-size: 10px;     /* mobile: 11px */
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--copper);
}
```

`.APP` suffix je copperový (NIKDY teal — copper je pro statickou identitu, teal pro live state).

### Paper grain overlay

```css
.app-root::after {
  content: '';
  position: absolute; inset: 0;
  background-image: var(--paper-grain);  /* SVG noise filter, viz tokens.css */
  background-size: 200px 200px;
  mix-blend-mode: var(--paper-blend);    /* multiply v light, screen v dark */
  opacity: var(--paper-opacity);
  pointer-events: none;
  z-index: 25;
}
```

Důležité: zachovat `mix-blend-mode` rozdílný pro light/dark, jinak grain v dark modu zhasne pozadí místo aby ho zjasnil.

---

## 8. Detaily, které se snadno udělají špatně

1. **Po `confirmInstallation()` v browser modu nepokračovat.** Žádný `setStepState(2, 'active')`. Step 1 zůstává active, jen `data-installed` přepne tělo.
2. **PWA detekce při each load.** Ne uložené v localStorage. Když uživatel odinstaluje PWA, musí na browseru znovu vidět Step 1.
3. **`display-mode: standalone` neexistuje na iOS Safari před iOS 11.3.** Fallback `navigator.standalone` je správně, neignorovat.
4. **Last4 input** přijímá pouze A-Z a 0-9 (Base32 alphabet bez 0/O/1/I), case-insensitive, max 4 znaky. Validace na submit, ne live.
5. **QR card není scrollable.** Pokud se nevejde na malé telefony (iPhone SE 1st gen ~568px tall), QR canvas zmenšit, ne přidat scroll uvnitř karty.
6. **`scroll-margin-top`** na step cards aby smooth scroll po `completeStep` neslídla obsah pod sticky brand wordmarkem.
7. **Done state musí být tlumenější než locked.** Done = 0.5 opacity, locked = 0.62. Vědomě, vytváří past/present/future temporal hierarchii.
8. **Back button v Step 3 header je v slotu po pravé straně**, mutually exclusive s lock iconou. Lock je viditelná jen v locked state, back jen v active state — překryv neexistuje, ale CSS guard `.step-card[data-state="active"] .step-status { display: none; }` to zajistí explicitně.
9. **Apple OAuth button** je espresso černý (`#2A231B`) v light modu, v dark modu naopak světlý. Google button je vždy surface (white v light, dark surface v dark) s autentickými barvami loga (4 barevné segmenty z Google brand guidelines).
10. **Hand-drawn copper check** v done markeru je SVG path, ne ikona z lib. Cesta: `M2.8 7.2 C 3.8 8.6, 4.8 9.6, 5.7 10.2 C 6.5 8.3, 8.7 5.4, 11.4 2.8` — vědomě nedokonalá křivka v duchu rukopisu.
11. **Status bar a dynamic island** v prototypu jsou simulace pro browser preview. V produkční PWA `display-mode: standalone` je status bar real systémový — musí to fungovat s `env(safe-area-inset-top)` pro správné padding.
12. **Žádné emojis v UI textech.** North Star design language používá jen vlastní SVG glyphs a hand-drawn elementy.

---

## 9. Accessibility požadavky

- Všechny touch targety **min 44 × 44 px** (Apple HIG, WCAG 2.5.5).
- **Focus visible** na všech interactive prvcích — `outline: 2px solid var(--copper)` jako default focus styl.
- **Aria-live="polite"** region pro substep transitions ve Step 3, aby screen readery oznámily přechod.
- **Aria-checked** na radio dropdown options, **aria-expanded** na dropdown trigger, **aria-haspopup="menu"**.
- **Reduced motion** — všechny `transition` musí respektovat `prefers-reduced-motion`. V prototypu zatím není, agent musí přidat.
- **Color contrast** — všechny text/background kombinace splňují WCAG AA (4.5:1 pro běžný text, 3:1 pro large text). Ověřeno pro light i dark mode.
- **Inputy** musí mít programaticky associated labels (visible label + `htmlFor`).

---

## 10. Non-goals (co NEdělat)

- ❌ Přidávat „skip" nebo „later" volby — wizard je závazný entry point, alternativa neexistuje.
- ❌ Nahrazovat OAuth providery něčím jiným nebo přidávat třetí (žádný Facebook, GitHub, email/password). Spec je „Apple a Google, nic jiného".
- ❌ Ukládat stav wizardu do localStorage napříč session. Po reloadu se vždy detekuje launch mode a začíná podle něj.
- ❌ Pamatovat si „last used flow" (new vs existing). Defaultní vždy `new`, uživatel přepne ručně přes nějaké UI mimo tuto obrazovku (mimo scope).
- ❌ Implementovat manuální přepínání mezi stepy 1/2/3 — jednosměrný progres je záměr.
- ❌ Skrývat post-install zprávu po nějakém timeoutu — uživatel ji musí vědomě dismissnout přes back link.
- ❌ Měnit copy v error/empty states bez konzultace — texty mají specifický tone of voice (diary, ne corporate).
- ❌ Optimalizovat na desktop. Toto je mobile-first PWA. Desktop layout je nice-to-have, ale phone frame v prototypu je ground truth.

---

## 11. Soubory v handoff balíku

```
SPEC.md            — tento dokument
prototype.html     — kompletní pixel-perfect prototyp se všemi stavy (single source of truth)
tokens.css         — designové tokeny (CSS custom properties, light + dark)
copy.md            — všechny texty na jednom místě (i pro budoucí lokalizaci)
acceptance.md      — kontrolní checklist „hotovo / nehotovo" pro QA
```

---

## 12. Pracovní postup pro agenta

1. **Otevři `prototype.html` v prohlížeči.** Projdi všechny stavy přes dropdown „Scénář" v pravém horním rohu — všechny kombinace browser × flow × launch mode × theme. Tohle je tvoje jediná vizuální reference.
2. **Najdi v existující codebase**, kde je current onboarding nebo welcome screen. Pravděpodobně něco v `src/screens/` nebo `src/routes/`.
3. **Importuj `tokens.css`** do globálního stylesheetu. Nemap je na existující tokeny — nech je vedle sebe a postupně migruj.
4. **Implementuj `<WelcomeScreen>`** podle struktury v sekci 5. Začni samotnou strukturou a stavovým automatem, vizuál až pak.
5. **Postupně dolaďuj vizuál proti prototype.html.** Compare side-by-side, ne podle paměti.
6. **Implementuj funkční vrstvu** podle sekce 6 — OAuth, crypto, WebAuthn. Mock backendy jsou OK pro první iteraci, ale crypto musí být funkční (no plaintext keys ever).
7. **Projdi acceptance checklist** v `acceptance.md` před PR.

---

**Konec specifikace.**
