## Why

A first-time end user opening tricho.app today gets stuck. After onboarding, the diár has zero clients and zero appointments, but every visible action (the FAB, every "volno X min" slot) opens the same bottom sheet whose only options are unhelpful: a non-Czech-voice promo body and a Close button. There is no signal that visit creation is *deferred-by-design*; it just looks broken. We have 22+ Playwright specs for auth/sync/encryption/billing — none of them walk the diár empty state, the FAB sheet, settings navigation, or the plan picker as a first-time user, so the regression got in unguarded.

## What Changes

- **Fix the FabAddSheet regression** (`app/src/components/islands/MenuSheet.tsx:138-200`). Restore spec-aligned copy: title `Plánování v příští verzi`, body `Přidávání a úpravy zákroků dorazí v další verzi. Zatím můžete prohlížet plán a otevírat detaily klientů.` Stop reusing `m.menu_promo_body()` here.
- **Add Paraglide messages** `schedule_deferred_title` and `schedule_deferred_body` (cs canonical, en placeholder).
- **Extend the existing component test** (`MenuSheet.component.test.tsx`) to assert deferred-feature copy verbatim — locks the regression out at the unit tier.
- **Add Playwright walkthrough e2e specs** that exercise every shipped feature as a first-time user:
  - `first-run-onboarding.spec.ts` — Step 1 install → Step 2 mock OIDC → Step 3 RS + WebAuthn → unlocked diár
  - `diar-empty-state.spec.ts` — empty diár; FAB tap; free-slot tap. Asserts `Plánování v příští verzi` copy.
  - `diar-navigation.spec.ts` — 7-day window arrows, day swipe, today-glyph, copper kickeries
  - `karta-klientky-walk.spec.ts` — open seeded client, anamnéza, photo gallery, history, back-nav
  - `settings-walk.spec.ts` — sync, encryption (PIN, RS rotate entry), backup, devices, plan, account, about
  - `plan-picker-walk.spec.ts` — Free/Pro/Max tiers, Stripe (mock) checkout, bank-transfer instructions
  - `first-run-composite.spec.ts` — thin top-to-bottom journey for the GIF capture and smoke
- **Add `make e2e-walkthrough`** target that runs only the new specs against the `dev-mock` profile (HTTP, mock OIDC, `http://tricho.localhost/app/`) for fast Chrome MCP debugging.
- **Add a SHALL to `e2e-testing`** that the suite includes a first-run walkthrough covering each shipped feature with explicit regression guards for placeholder/empty-state copy.
- **Refresh `docs/testing.md`** with the dev-mock loop, the Chrome MCP debugging recipe, and the after-each-run "doc refresh" rule (the test ↔ docs feedback loop).

## Capabilities

### New Capabilities

(none — no new capability is introduced)

### Modified Capabilities

- `e2e-testing`: add a SHALL requiring the Playwright suite to include a first-run walkthrough that covers every shipped feature with regression guards for placeholder and empty-state copy. Adds dev-mock profile support for the same specs against `http://tricho.localhost/app/`.

## Impact

- **Affected code:** `app/src/components/islands/MenuSheet.tsx` (copy + message ids); Paraglide message catalogs (cs + en); `app/src/components/islands/MenuSheet.component.test.tsx`; new files under `app/tests/e2e/`; `Makefile` (`e2e-walkthrough` target).
- **Affected docs:** `docs/testing.md`; `app/tests/e2e/README.md` (creating if absent).
- **Zero-knowledge invariants:** No impact. No payload shape, AAD, DEK, RS, or server interaction is changed. The walkthrough specs reuse the existing `openVaultAsTestUser` fixture and never assert on plaintext server-side.
- **Dependencies:** No new packages. Reuses Playwright, Vitest, Paraglide, mock-oidc, Traefik, the dev-mock compose service, and the claude-in-chrome MCP (developer-side only, not part of CI).
- **CI:** New specs join the existing `npm run test:e2e` job under the ci profile. Wall-clock for the e2e tier should stay within the 5-minute total CI budget; the new walkthrough specs are short (each well under 30s).
- **Rollback:** Pure additive code + copy fix. To roll back, revert this change's commits — there is no schema migration, no payload-format change, no server-side state.
