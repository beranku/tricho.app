# Tricho.App — Welcome screen handoff

Tento balík obsahuje vše potřebné pro implementaci úvodní obrazovky a onboarding wizardu Tricho.App PWA. Cílová stack: React + TypeScript, mobile-first, PWA-only produkce.

## Soubory

| Soubor | Účel | Kdy ho otevřít |
|---|---|---|
| **`SPEC.md`** | Hlavní specifikace — kontext, state machine, komponenty, funkční vrstva | **Nejdřív.** Začni tady. |
| **`prototype.html`** | Pixel-perfect prototyp se všemi stavy. **Single source of truth pro vizuál.** | Před každým commitem porovnávej side-by-side. |
| **`tokens.css`** | Designové tokeny (light + dark), font stack | Importuj jako první do globálního stylesheetu. |
| **`copy.md`** | Všechny UI texty s tone of voice pravidly | Když měníš nebo lokalizuješ texty. |
| **`acceptance.md`** | Kontrolní checklist pro QA před PR | Před otevřením PR projdi všechny ☐ → ✅. |

## Quick start pro agenta

1. Otevři `prototype.html` v Chrome / Safari, zkus mobile preview (DevTools → device 393×852 nebo iPhone 15 Pro).
2. V pravém horním rohu klikni `≡ SCÉNÁŘ` → projdi všechny kombinace:
   - **Režim spuštění** × **Prohlížeč** × **Typ účtu** × theme toggle
   - Tlačítko „Restartovat průvodce" tě vrátí na začátek
3. Přečti `SPEC.md` od začátku do konce. Zvlášť sekce 6 (kryptografie) a 8 (snadno udělat špatně).
4. Otevři `acceptance.md`, podívej se, co se po tobě čeká.
5. Až pak začínej implementovat.

## Co tento balík NEobsahuje

- Backend implementace (OAuth callback, WebAuthn server, key storage) — to je mimo scope
- Routing a navigace mimo welcome screen
- Strings pro lokalizaci do jiných jazyků (zatím jen čeština)
- Storybook / vizuální testy — agent může přidat podle vlastního uvážení

## Otázky / nejasnosti

Nejasné požadavky řeš v tomto pořadí preference:
1. Podívej se do `prototype.html` — pravděpodobně to tam je
2. Podívej se do `SPEC.md` sekce 8 (edge cases) a 10 (non-goals)
3. Pokud ani tam, zeptej se před implementací — nedělej domněnky o crypto, auth nebo PWA chování
