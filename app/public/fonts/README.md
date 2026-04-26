# Self-hosted fonts

Tricho's UI uses four font families. They are self-hosted (not loaded from
`fonts.googleapis.com`) so the PWA can paint typography correctly while the
device is offline and so the service worker can cache them indefinitely.

| Family       | Role                                  | Variable axes |
|--------------|----------------------------------------|---------------|
| Fraunces     | Narrative — names, dates, slot times  | opsz, wght    |
| Geist        | Functional UI — chips, kickers, sub   | wght          |
| Caveat       | Annotation — allergen badge           | wght          |
| Patrick Hand | Prose — free-slot label, notes        | regular only  |

## Layout

```
public/fonts/
├── fraunces/
│   ├── fraunces-roman-latin.woff2
│   └── fraunces-roman-latin-ext.woff2
├── geist/
│   ├── geist-latin.woff2
│   └── geist-latin-ext.woff2
├── caveat/
│   ├── caveat-latin.woff2
│   └── caveat-latin-ext.woff2
└── patrick-hand/
    ├── patrick-hand-latin.woff2
    └── patrick-hand-latin-ext.woff2
```

The `latin` subset covers ASCII; `latin-ext` adds the Czech diacritics
(`ě š č ř ž ý á í é ů ú ť ď ň`). The `@font-face` declarations in
`src/styles/base.css` use `unicode-range` to load only the subset a glyph
actually needs.

## Refreshing

Run `bash scripts/fetch-fonts.sh` from the repo root. The script downloads
woff2 binaries directly from Google's CDN — that's a build-time operation,
not a runtime one. The runtime never touches Google.
