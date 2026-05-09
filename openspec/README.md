# OpenSpec — tricho.app

Behavioural requirements (SHALL/MUST + Given/When/Then) live in
[`specs/<capability>/spec.md`](specs/). In-flight proposals live in
[`changes/`](changes/); completed work is moved to
[`changes/archive/`](changes/archive/) and its delta specs are merged
into the main capability specs.

## Workflow

Use the OpenSpec skills:

- `/opsx:propose` — describe what you want; produces
  `changes/<name>/{proposal,design,tasks,specs/}`.
- `/opsx:apply` — implement tasks; mark them `[x]` as you go.
- `/opsx:explore` — think-partner mode; no code.
- `/opsx:archive` — move a finished change into `archive/` and merge
  delta specs into main.

Project rules — proposal/spec/design/task conventions, hard invariants,
spec-format requirements (failure scenarios for security-sensitive
paths, source paths instead of line numbers) — live in
[`config.yaml`](config.yaml).

## Capabilities by domain

### Identity & auth
- [oauth-identity](specs/oauth-identity/) — Google/Apple OIDC; identity binding to vault.
- [jwt-session](specs/jwt-session/) — RS256 JWT issuance, refresh-token rotation.
- [jwt-key-bootstrap](specs/jwt-key-bootstrap/) — public-key handover from `tricho-auth` to CouchDB.
- [passkey-prf-unlock](specs/passkey-prf-unlock/) — WebAuthn + PRF day-to-day unlock.
- [local-pin-fallback](specs/local-pin-fallback/) — PIN unlock with rate-limit + lockout.

### Encryption & vault
- [envelope-crypto](specs/envelope-crypto/) — AES-256-GCM symmetric primitives.
- [payload-encryption](specs/payload-encryption/) — document `payload` shape + AAD binding.
- [vault-keystore](specs/vault-keystore/) — `tricho_keystore` IndexedDB layout, dual-wrap DEK.
- [vault-state-sync](specs/vault-state-sync/) — `vault-state` doc replication and merging.
- [recovery-secret](specs/recovery-secret/) — RS generation, confirmation, rotation, show.
- [encrypted-backup](specs/encrypted-backup/) — encrypted ZIP backup format.
- [secrets-management](specs/secrets-management/) — SOPS + age operator workflow.

### Sync & device
- [live-sync](specs/live-sync/) — PouchDB ↔ CouchDB replication + conflict resolution.
- [device-management](specs/device-management/) — device registry, limits, naming.
- [local-database](specs/local-database/) — PouchDB conventions + `_local/` rules.
- [restore-from-local-zip](specs/restore-from-local-zip/) — pre/post-unlock ZIP restore.
- [static-build-merge](specs/static-build-merge/) — `merge-dist.mjs` + `validate-build.mjs` contract.

### Billing & plans
- [billing-plans](specs/billing-plans/) — Free / Pro / Max definitions and gating.
- [stripe-recurring-billing](specs/stripe-recurring-billing/) — Stripe subscription lifecycle.
- [bank-transfer-billing](specs/bank-transfer-billing/) — manual bank transfer reconciliation.
- [plan-management-ui](specs/plan-management-ui/) — Plan screen UX.
- [plan-renewal-walkthrough](specs/plan-renewal-walkthrough/) — Renew banner + gated sheet.

### UI shell & navigation
- [pwa-shell-routing](specs/pwa-shell-routing/) — `/app/` routing + hash router.
- [bottom-sheet-navigation](specs/bottom-sheet-navigation/) — bottom-sheet menu.
- [locked-screen](specs/locked-screen/) — daily-unlock screen.
- [idle-lock](specs/idle-lock/) — auto-lock on idle.
- [theme-preference](specs/theme-preference/) — light/dark theme.
- [locale-preference](specs/locale-preference/) — `cs`/`en` toggle.
- [ui-design-system](specs/ui-design-system/) — fonts, colors, paper grain, glyphs.

### Data domains
- [appointment-data](specs/appointment-data/) — appointment doc + queries.
- [client-detail](specs/client-detail/) — client-card view.
- [daily-schedule](specs/daily-schedule/) — Phone A schedule view.
- [photo-attachments](specs/photo-attachments/) — encrypted photo pipeline.

### Onboarding & lifecycle
- [welcome-onboarding-wizard](specs/welcome-onboarding-wizard/) — first-run wizard.
- [account-lifecycle](specs/account-lifecycle/) — deletion, fresh-JWT, local wipe.

### Formatting & i18n
- [i18n-foundation](specs/i18n-foundation/) — Paraglide + message-key conventions.
- [czech-formatting](specs/czech-formatting/) — Czech date/time/duration/pluralisation.
- [english-formatting](specs/english-formatting/) — English equivalents.

### Marketing & release
- [marketing-site](specs/marketing-site/) — `web/` pages, content collections, SEO.
- [app-release-versioning](specs/app-release-versioning/) — `app-v*` tags, Vite `define`s.
- [release-promotion](specs/release-promotion/) — `Promote dev → main` workflow.

### Deployment & infra
- [cloudflare-pages-deploy](specs/cloudflare-pages-deploy/) — Pages routing, headers, redirects.
- [stack-orchestration](specs/stack-orchestration/) — root `compose.yml` + `Makefile` profiles.
- [traefik-edge](specs/traefik-edge/) — Traefik TLS + routing for dev/ci.

### Testing
- [test-strategy](specs/test-strategy/) — six-tier pyramid + speed budgets.
- [e2e-testing](specs/e2e-testing/) — Playwright contract.
- [backend-tests](specs/backend-tests/) — testcontainers + tricho-auth tests.
- [component-tests](specs/component-tests/) — RTL + jsdom + fake-indexeddb.
- [third-party-mocks](specs/third-party-mocks/) — Stripe + mock-OIDC.
