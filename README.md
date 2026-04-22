# Tricho.app - PWA Kamera

Progresivní webová aplikace (PWA) pro pořizování a ukládání fotografií přímo v prohlížeči. Všechna data zůstávají lokálně na zařízení uživatele.

## Funkce

- **Kamera** - přístup k fotoaparátu zařízení, přepínání mezi kamerami
- **Lokální úložiště** - fotografie se ukládají do IndexedDB prohlížeče
- **Galerie** - prohlížení fotek organizovaných do sezení (sessions)
- **Nastavení** - kvalita JPEG, rozlišení, limity úložiště
- **PWA** - instalace na domovskou obrazovku, offline podpora
- **Automatická správa** - mazání starých fotek při překročení limitů

## Tech Stack

- **[Astro](https://astro.build/)** v5 - statický site builder
- **TypeScript** - typově bezpečný JavaScript
- **IndexedDB** - klientská databáze pro ukládání blobů
- **Service Worker** - offline cache a PWA funkcionalita
- **GitHub Pages** - hosting

## Struktura projektu

```
tricho.app/
├── src/
│   ├── components/          # Astro komponenty (UI)
│   ├── layouts/             # Základní HTML layout
│   ├── pages/               # Stránky (routes)
│   ├── scripts/             # TypeScript moduly (logika)
│   └── styles/              # Globální CSS
├── public/                  # Statické soubory (kopírují se 1:1)
├── dist/                    # Build output (generováno)
├── astro.config.mjs         # Astro konfigurace
├── tsconfig.json            # TypeScript konfigurace
└── package.json
```

## Komponenty (`src/components/`)

| Soubor | Popis |
|--------|-------|
| `Header.astro` | Hlavička aplikace s názvem a StatusBar |
| `StatusBar.astro` | Online/offline indikátor, režim aplikace, tlačítko nastavení |
| `CameraPanel.astro` | Hlavní panel s video elementem a ovládacími prvky |
| `CameraOverlay.astro` | UI vrstva nad videem (tlačítka, status chip) |
| `SidePanel.astro` | Pravý panel - instalace, výběr kamery, galerie |
| `Gallery.astro` | Galerie fotek se seznamem sezení a mřížkou fotek |
| `SettingsModal.astro` | Modální dialog pro nastavení aplikace |
| `Footer.astro` | Patička s informacemi |

## TypeScript moduly (`src/scripts/`)

### `settings.ts` - Správa nastavení

Definuje typy a funkce pro práci s nastavením aplikace.

```typescript
interface AppSettings {
  sessionGapMinutes: number;    // Pauza pro oddělení sezení (min)
  jpegQuality: number;          // Kvalita JPEG (50-100)
  maxResolution: number;        // Max rozlišení (px)
  maxPhotos: number;            // Max počet fotek
  maxStorageMB: number;         // Max velikost úložiště (MB)
  defaultCamera: 'environment' | 'user';  // Výchozí kamera
  autoRestartCamera: boolean;   // Restart kamery po návratu
  confirmDelete: boolean;       // Potvrzení mazání
}
```

**Funkce:**
- `loadSettings()` - načte nastavení z localStorage
- `saveSettings(settings)` - uloží nastavení
- `getSettings()` - vrátí aktuální nastavení
- `resetSettings()` - obnoví výchozí hodnoty
- `getSessionGapMs()`, `getJpegQuality()`, `getMaxWidth()`, `getMaxHeight()`, `getMaxPhotos()`, `getMaxBytes()` - computed getters

**localStorage klíč:** `appSettings`

---

### `storage.ts` - IndexedDB operace

Ukládání a načítání fotografií z IndexedDB.

```typescript
interface PhotoRecord {
  id?: number;          // Auto-increment ID
  createdAt: number;    // Timestamp vytvoření
  blob: Blob;           // JPEG data
  size: number;         // Velikost v bytes
}
```

**Funkce:**
- `openDb()` - otevře/vytvoří databázi
- `savePhotoBlob(blob)` - uloží novou fotku
- `loadPhotos()` - načte všechny fotky
- `deletePhoto(id)` - smaže fotku podle ID
- `computeTotals(photos)` - spočítá statistiky (count, bytes)
- `formatBytes(bytes)` - formátuje velikost ("1,5 MB")

**IndexedDB:**
- Databáze: `pwa-camera-db`
- Object store: `photos`
- Verze: 1

---

### `camera.ts` - Správa kamery

Inicializace kamery, pořizování snímků, správa oprávnění.

**Funkce:**
- `initCameraElements(elements)` - nastaví reference na DOM elementy
- `initCamera(deviceId?)` - spustí kameru
- `stopCamera()` - zastaví stream
- `switchCamera()` - přepne na další kameru
- `selectCamera(deviceId)` - vybere konkrétní kameru
- `capturePhoto()` - pořídí snímek a uloží do DB
- `checkCameraPermission()` - zkontroluje stav oprávnění
- `markPermissionGranted()` / `clearPermissionStatus()` - správa stavu oprávnění
- `listVideoDevices(selectedId?)` - naplní select s kamerami

**localStorage klíče:**
- `preferredCameraDeviceId` - ID preferované kamery
- `cameraPermissionGranted` - cache stavu oprávnění

---

### `gallery.ts` - Galerie a sezení

Organizace fotek do sezení, vykreslování galerie.

```typescript
interface Session {
  start: number;           // Timestamp začátku sezení
  photos: PhotoRecord[];   // Fotky v sezení
}
```

**Funkce:**
- `initGalleryElements(elements)` - nastaví DOM reference
- `buildSessions(photos)` - rozdělí fotky do sezení podle časové mezery
- `renderGallery()` - vykreslí celou galerii
- `renderSessionList()` - vykreslí seznam sezení
- `renderSessionPhotos()` - vykreslí fotky aktivního sezení
- `cleanupOlderThanMonths()` - smaže staré fotky
- `enforceLimits()` - automaticky smaže fotky při překročení limitů
- `showGallery()` / `hideGallery()` - zobrazí/skryje galerii

**Logika sezení:** Fotky pořízené s mezerou větší než `sessionGapMinutes` spadají do nového sezení.

---

### `pwa.ts` - PWA funkcionalita

Instalace aplikace, service worker, online/offline stav.

**Funkce:**
- `initPwaElements(elements)` - nastaví DOM reference
- `setupInstallHandlers(basePath)` - nastaví SW a install prompt
- `isStandalonePwa()` - detekuje standalone režim
- `detectPlatformInstallHint()` - vrátí text nápovědy pro instalaci
- `updateOnlineStatus(dot, status)` - aktualizuje online indikátor
- `updateModeStatus(label)` - aktualizuje label režimu

---

### `main.ts` - Hlavní inicializace

Vstupní bod aplikace, propojuje všechny moduly.

**Funkce:**
- `initApp(basePath)` - hlavní inicializace:
  1. Načte nastavení
  2. Získá DOM reference
  3. Inicializuje moduly
  4. Nastaví event listenery
  5. Spustí kameru
  6. Registruje service worker

## Styly (`src/styles/global.css`)

Obsahuje:
- **CSS proměnné** - barvy, stíny, border-radius, blur
- **Základní reset** - box-sizing, body styly
- **Layout** - header, main, footer, grid layout
- **Komponenty** - panely, tlačítka, formuláře, modály
- **Responzivita** - breakpointy pro mobile/desktop

### CSS proměnné

```css
:root {
  --bg: #f2f2f7;                    /* Pozadí */
  --bg-elevated: rgba(255,255,255,0.9);
  --border: rgba(0,0,0,0.06);
  --accent: #007aff;                /* Modrá akcent */
  --text: #111827;
  --text-soft: #6b7280;
  --danger: #ff3b30;                /* Červená */
  --radius-xl: 26px;
  --radius-lg: 20px;
  --radius-md: 14px;
  --radius-pill: 999px;
  --blur-backdrop: 24px;
}
```

## PWA (`public/`)

### `manifest.webmanifest`

```json
{
  "name": "PWA Kamera",
  "short_name": "Kamera",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#f2f2f7",
  "theme_color": "#f2f2f7"
}
```

### `sw.js` - Service Worker

- **Cache name:** `pwa-camera-cache-v2`
- **Strategie:** Cache-first s network fallback
- **Offline:** Vrací cached `index.html` pro navigační requesty

## Konfigurace

### `astro.config.mjs`

```javascript
export default defineConfig({
  site: 'https://tricho.app',
});
```

- `site` - produkční URL (custom doména)

### TypeScript

Používá `astro/tsconfigs/strict` pro přísnou typovou kontrolu.

## Vývoj

```bash
# Instalace závislostí
npm install

# Dev server (http://localhost:4321)
npm run dev

# Build pro produkci
npm run build

# Preview buildu
npm run preview
```

## Deployment

Automatický deployment na GitHub Pages s custom doménou přes GitHub Actions:

1. Push do `main` větve
2. Workflow `.github/workflows/deploy.yml`:
   - Checkout → Setup Node → Install → Build → Deploy
3. Dostupné na `https://tricho.app/`

### Custom doména

- Soubor `public/CNAME` obsahuje `tricho.app`
- DNS musí mít CNAME záznam směřující na `beranku.github.io`

### Manuální deployment

```bash
npm run build
# Upload obsahu dist/ na hosting
```

## Datový tok

```
[Kamera] → getUserMedia → <video> → canvas.drawImage → toBlob → IndexedDB
                                                                    ↓
[Galerie] ← URL.createObjectURL ← loadPhotos ← ─────────────────────┘
```

## Důležité poznámky

### Base Path
Aplikace běží na root path `/` (custom doména `tricho.app`):
- V Astro: `import.meta.env.BASE_URL` vrací `/`
- V JS: předáno jako parametr `initApp(basePath)`
- V manifestu/SW: všechny cesty jsou absolutní od root (`/`)

### Oprávnění kamery
- Vyžaduje HTTPS nebo localhost
- Stav oprávnění se cachuje v localStorage
- Při zamítnutí se zobrazí chybová hláška

### Limity úložiště
- IndexedDB má limit závislý na prohlížeči (obvykle 50% volného místa)
- Aplikace má vlastní limity (maxPhotos, maxStorageMB)
- Při překročení se automaticky mažou nejstarší fotky

### Sezení (Sessions)
- Fotky se automaticky seskupují do sezení
- Mezera větší než `sessionGapMinutes` = nové sezení
- V galerii se zobrazuje seznam sezení + fotky aktivního sezení

## Budoucí vylepšení

- [ ] Export/import dat
- [ ] Sdílení fotek
- [ ] Filtry a úpravy fotek
- [ ] Lepší ikony pro PWA manifest
- [ ] Push notifikace
- [ ] Sync napříč zařízeními
