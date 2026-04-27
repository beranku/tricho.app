# Tricho.app Landing Page — Implementační balíček pro Astro

## Co to je

Tento balíček obsahuje **finální prototyp landing page** pro Tricho.app spolu se vším, co potřebuješ pro implementaci v existujícím Astro repu. Cílem je co nejvěrněji přenést prototyp do produkční podoby Astro stránky, přizpůsobit ho konvencím repa a být připravený na další iterace.

## Obsah balíčku

| Soubor | Účel |
|---|---|
| `README.md` | Tento soubor — overview a pravidla |
| `PROMPT.md` | Hlavní prompt pro AI coding agenta (Claude Code, Cursor, Aider). Začni tímto. |
| `landing-page.html` | **Reference HTML** — finální prototyp se vším copy, designem a interakcí |
| `DESIGN_TOKENS.md` | Design tokeny (barvy, typografie, spacing) v framework-agnostickém formátu |
| `COPY.md` | Veškerý český copy v Markdown formě — pro snadnou editaci bez sahání do komponent |
| `STRUCTURE.md` | Mapa sekcí stránky, doporučené komponenty a jejich rozhraní |
| `TODO.md` | Věci, které coding agent NEMŮŽE udělat sám (assety, finální texty, závislosti) |

## Klíčové principy implementace

1. **Pixel-faithful k prototypu.** Vizuální podoba landing-page.html je referenční — barvy, typografie, mezery, animace. Coding agent může adaptovat na konvence repa (např. utility-first vs. CSS modules), ale výsledek musí vypadat shodně.

2. **Český copy je posvátný.** Veškeré texty jsou výsledkem několika iterací s rodilým mluvčím. **Neměň žádný copy** během implementace, ani když ti přijde "nepřesný". Pokud máš pochybnost, nahlas ji autorovi, ale neopravuj.

3. **Žádné nové marketingové fráze.** Pokud chybí copy někde, kde jej Astro komponenta očekává (např. SEO meta description), použij text z landing-page.html nebo vytáhni z `COPY.md`. Negeneruj nový.

4. **Konvence repa první.** Pokud má repo zaběhnuté patterny (komponenty, content collections, styly, testy, typing), drž se jich. Tento balíček je obsah — ne architektura.

5. **Optimalizace pro výkon.** Tricho.app cílí na mobilní cílovku. Lighthouse Performance ≥ 95 na mobile, LCP < 2.5s. Žádné JS pro stránku samotnou (jen pro theme toggle a FAQ accordion). Žádné externí trackery.

6. **Nedávej sem žádný analytics, hotjar, GA, Cloudflare Insights.** Privacy positioning je core value prop — stránka nesmí mít trackery (kromě případného Plausible / self-hosted, který si autor přidá ručně).

## Stack a předpoklady

- **Astro** (verze podle existujícího repa)
- **Styling:** zvol podle konvencí repa. Pokud není zaběhnutá konvence, **doporučuji CSS Modules + CSS variables** podle prototypu (již extrahovány v `DESIGN_TOKENS.md`).
- **Typography:** Google Fonts (Fraunces, Geist, Geist Mono, Patrick Hand, Caveat) — preconnect už v prototypu
- **Bez UI knihoven** (žádné shadcn, Radix, Mantine — vše je custom v prototypu).
- **Bez Tailwindu** (pokud už není v repu). Tokeny jsou navržené pro CSS variables.
- **Bez TypeScriptu pro logiku** — jediný JS je theme toggle + FAQ accordion (cca 30 řádků), píš v plain JS / TS dle repa.

## Jak postupovat (high-level workflow)

1. Otevři `PROMPT.md` a dej ho coding agentovi jako úvodní prompt.
2. Agent si pak přečte ostatní soubory dle potřeby.
3. Implementační kroky (agent je provede sám):
   1. Analýza existujícího Astro repa (struktura, konvence, styling, content)
   2. Návrh komponent dle `STRUCTURE.md`
   3. Implementace tokenů jako CSS variables (nebo Tailwind theme dle konvence)
   4. Implementace komponent jeden po druhém s referencí na `landing-page.html`
   5. Vložení textů z `COPY.md` (NE z landing-page.html — copy je už v Markdown)
   6. Implementace dvou JS interakcí (theme toggle, FAQ accordion)
   7. SEO meta tagy, Open Graph, favicon
   8. Lighthouse audit a optimalizace
4. Nakonec projdi `TODO.md` a označ, co bylo vyřešeno a co zbývá pro autora.

## Co prototyp NEOBSAHUJE (a coding agent to musí adresovat)

- **Reálné video Ludmily** — v prototypu je placeholder. Komponenta `<StoryVideo>` musí akceptovat prop `videoSrc` a zobrazit poster + play overlay.
- **Reálné fotografie** testimonialů — v prototypu jsou kruhové avatary s iniciálami. Komponenta `<Testimonial>` musí akceptovat optional `photoSrc`, fallback na iniciály.
- **OG image / favicon** — neexistují, agent vygeneruje placeholdery a označí v TODO.
- **Routing pro `/blog`, `/help`, `/o-nas`, `/gdpr`, `/podminky`, `/cookies`** — odkazy v navigaci a patičce vedou na placeholder URL. Agent vytvoří 404 placeholder pro ty, co ještě neexistují, NEBO přesměruje na `#` a označí v TODO.
- **PWA install prompt** — landing page tlačítko "Začít zdarma" momentálně jen scrolluje na sekci. Agent zachová toto chování — vlastní install flow je out-of-scope.

## Čeho se v repu vyvarovat

- **Nepřidávej tracking.** Privacy je core USP.
- **Negeneruj nový český copy.** Žádné AI-generated micro-texts ani SEO descriptions. Použij existující.
- **Neoptimalizuj přes vizuální věrnost.** Když se bude bít performance s designem, nech mi to vědět — neudělej kompromis sám.
- **Nepřidávej animace navíc.** Prototyp je záměrně tichý. Žádné scroll animations, žádné fade-iny při načtení.
- **Nepouštěj se do A/B testingu nebo "vylepšování CTA".** Stránka je výsledkem briefu a iterací.

---

**Začni `PROMPT.md`.**
