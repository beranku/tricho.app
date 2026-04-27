## 1. Build the invite-request form

- [x] 1.1 Add `inviteForm` block to `web/src/content/landing.ts` (label, placeholder, submitLabel, helper, successMessage, errorMessage).
- [x] 1.2 Create `web/src/components/landing/InviteForm.astro` — e-mail input + submit + hidden Brevo honeypot/locale/html_type, scoped styles using landing tokens, inline success/error status, inline `<script>` posting to Brevo with `fetch({ mode: 'no-cors' })` and falling back to the native form POST when JS is off.

## 2. Wire the new CTA model

- [x] 2.1 Hero renders `<InviteForm align="left" />` instead of the old `<a class="btn-primary" href="/app/">`.
- [x] 2.2 Final-CTA renders `<InviteForm align="center" />` and carries `id="pozvanka"`. The previous `id="stahnout"` is removed.
- [x] 2.3 Header CTA in `landing.ts:header` becomes `{ ctaLabel: 'Požádat o pozvánku', ctaHref: '#pozvanka' }`.
- [x] 2.4 Pricing Free block CTA in `landing.ts:pricing.free` becomes `{ ctaLabel: 'Požádat o pozvánku', ctaHref: '#pozvanka' }`.
- [x] 2.5 Hero meta line "Bez platební karty" → "Aplikace na pozvánky" so the invite-only state is explicit on first paint.
- [x] 2.6 No remaining occurrences of `Začít zdarma` or `href="/app/"` on the rendered landing page (verified via `grep` against `dist/index.html`).

## 3. Validate

- [x] 3.1 `cd web && npm run build` clean.
- [x] 3.2 `cd web && npm run lint` (= `astro check`) — 0 errors / 0 warnings.
- [x] 3.3 `node scripts/merge-dist.mjs` + `node scripts/validate-build.mjs` — all assertions pass.
- [ ] 3.4 Manual smoke check on dev preview URL: submit a real e-mail, verify it arrives in the Brevo dashboard contact list, verify inline success message shows, verify the URL did not change after submission.
