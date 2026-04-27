## Why

Tricho.app is currently in invite-only mode — there is no public sign-up flow. The previous landing-page contract (every CTA links to `/app/` to start a free account) misleads visitors because `/app/` is closed during private alpha. We need to collect prospective users' e-mail addresses for the invite waitlist and send them directly to Brevo without changing the rest of the landing.

## What Changes

- Replace the four `Začít zdarma → /app/` CTAs on the landing page with an invite-request flow:
  - **Hero** and **Final CTA**: render an inline `<InviteForm>` (e-mail input + submit). The form **POSTs directly to Brevo's hosted form endpoint** via `fetch` with `mode: 'no-cors'`. No iframe, no Brevo embed script, no third-party SDK.
  - **Header CTA** and **Pricing → Free block CTA**: become anchor buttons labelled "Požádat o pozvánku" that scroll to `#pozvanka` (the new id of the Final CTA section, replacing `#stahnout`).
- Update the hero meta line "Bez platební karty" → "Aplikace na pozvánky" so the invite-only state is explicit on first paint.
- Submission UX: the form shows an inline success state (no navigation away from the landing) on completion, and an inline error state if `fetch` itself fails (network drop). Native `<form action method=POST>` is preserved so the form still works without JavaScript — non-JS submitters get redirected to Brevo's hosted thank-you page.

Out of scope:
- Brevo list segmentation, double-opt-in, automation triggers — configured in the Brevo dashboard, not in code.
- Returning the user to the landing after a no-JS submit — the Brevo hosted thank-you page is acceptable for that fallback.
- Any change to the PWA shell at `/app/`. The `/app/` route stays closed; we do not add a "thank you" page on the marketing site.

## Capabilities

### New Capabilities
*(none — all work lands inside the existing `marketing-site` capability)*

### Modified Capabilities
- `marketing-site`: the existing requirement "Landing-page CTA placements all link to the PWA shell" is replaced by a new requirement "Landing-page CTAs collect invite requests via Brevo while the app is invite-only".

## Impact

- **Code touched:** new `web/src/components/landing/InviteForm.astro`; edits to `Hero.astro`, `FinalCta.astro`, `Header.astro` (via `landing.ts`), `Pricing.astro` (via `landing.ts`), and `web/src/content/landing.ts`.
- **Dependencies:** none added. No Brevo SDK, no embed script, no third-party JS bundle.
- **Network surface:** one outbound `POST` per form submission, only after the user clicks submit, only to the Brevo `/serve/<id>` endpoint. No background pings, no analytics.
- **Privacy:** the e-mail address is sent to Brevo (third-party processor — privacy policy update needed in `/legal/privacy` when that page is fleshed out, tracked separately in `prototypes/landing-page-prototype/TODO.md`).
- **Rollback:** revert this change — the prior `Začít zdarma → /app/` CTAs are restored automatically. No migration needed in the Brevo dashboard.
