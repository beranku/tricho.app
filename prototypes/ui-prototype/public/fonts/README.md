# Self-hosted Fonts

Pro offline PWA musí fonty být součástí assetů aplikace, ne načítané
z Google Fonts runtime. V development módu fonty ze sítě projdou (při
prvním načtení), ale produkční build by Service Worker nemohl spolehlivě
cachovat.

## Požadované fonty

Stáhnout a uložit do `public/fonts/`:

| Font | Varianta | Očekávaný soubor |
|------|----------|-------------------|
| Fraunces | VF (SOFT, WONK, opsz, wght) | `Fraunces-VariableFont_SOFT,WONK,opsz,wght.woff2` |
| Geist | VF (wght) | `Geist-VariableFont_wght.woff2` |
| Caveat | VF (wght) | `Caveat-VariableFont_wght.woff2` |
| Patrick Hand | Regular | `PatrickHand-Regular.woff2` |

## Kde stáhnout

Všechny jsou OFL-licensed, dostupné v [Google Fonts](https://fonts.google.com/):
- https://fonts.google.com/specimen/Fraunces
- https://fonts.google.com/specimen/Geist
- https://fonts.google.com/specimen/Caveat
- https://fonts.google.com/specimen/Patrick+Hand

Doporučený postup:
1. Stáhnout ZIP z Google Fonts (`Download family`).
2. Vytáhnout `*.ttf` / `*.woff2` variable font soubory.
3. Konvertovat `.ttf` → `.woff2` pokud je potřeba (např. přes `wawoff2`
   nebo online tool). Google Fonts servíruje `.woff2` přímo — stačí
   ji vytáhnout z `<head>` network tabu v DevTools a uložit.

## Konverze z .ttf na .woff2

Pokud máš pouze `.ttf` verzi:

```bash
npm i -g ttf2woff2
ttf2woff2 Fraunces-VariableFont_SOFT,WONK,opsz,wght.ttf
```

## Struktura po dokončení

```
public/
└── fonts/
    ├── Fraunces-VariableFont_SOFT,WONK,opsz,wght.woff2
    ├── Geist-VariableFont_wght.woff2
    ├── Caveat-VariableFont_wght.woff2
    └── PatrickHand-Regular.woff2
```

Fonty jsou referencované v `src/styles/base.css` přes `@font-face` rules.
Pokud názvy souborů změníš, aktualizuj i tam.

## Ověření

V DevTools → Network → filtr `woff2` po načtení stránky. Měly by být 4
requesty, všechny status 200 a z `/fonts/` cesty (ne `fonts.googleapis.com`).

## Licence

Všechny 4 fonty jsou pod [SIL Open Font License 1.1](https://openfontlicense.org/).
OFL dovoluje self-hosting v komerčních projektech bez royalties —
podmínka je, že soubory fontů nebudou prodávané samostatně.
Přilož licence text do `public/fonts/LICENSE-OFL.txt` pro každý font.
