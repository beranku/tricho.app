## Context

The TrichoApp codebase today has a single-tier testing model:

- `npm test` runs every `.test.ts` under `src/` via Vitest + jsdom + fake-indexeddb. 286 tests, ~2.5 s on warm cache.
- Crypto + keystore coverage is excellent. `src/auth/recovery.test.ts` has 115 tests; `src/crypto/envelope.test.ts` has 51.
- Everything outside that flat unit tier is untested: React components (~2,300 lines), the `tricho-auth` Node service (~1,080 lines), the `mock-oidc` mock (~180 lines), and most of the vault lifecycle flows that Playwright doesn't yet cover.
- Tests aren't tagged by tier or cost. There's no way to say "run only the fast ones" or "skip anything that needs Docker".
- `@vitest/coverage-v8` isn't installed; numbers like "90 % coverage on crypto" are anecdotal.
- Some suites are bloated. `recovery.test.ts` at 1,366 lines re-constructs the same fixture in many places. The marginal value of test #114 vs. #40 is unclear.

The `unified-stack-orchestration` change (just landed) added the mock-oidc container and a Playwright smoke, which is what exposed that the supporting unit + backend tiers don't exist — every OAuth regression today is caught (or missed) only at the end-to-end layer, which is the slowest and most fragile place to catch it.

The security story of this app is demanding:
- End-to-end encryption (AAD-bound ciphertext per doc)
- Dual-wrapped DEK (passkey PRF + Recovery Secret)
- JWT → CouchDB `couch_peruser` with per-user isolation
- Device-limit enforcement via subscription records
- Idle lock that clears in-memory secrets

Any of these can silently break in ways Playwright won't notice (e.g. a subtle typo in AAD construction that still decrypts your own data fine). We need a disciplined pyramid to catch these at the cheapest-to-run tier possible.

**Stakeholders:** the sole developer (Jan) on DX and correctness; future self-hosters on confidence that `make test-all` covers what matters; audit reviewers who want to see "the zero-knowledge properties are actually tested".

## Goals / Non-Goals

**Goals:**

- A six-tier pyramid with clear membership rules and per-tier speed/coverage budgets.
- `npm test` (no args) stays fast (< 15 s) and Docker-free so the inner-loop experience is snappy.
- Every React screen has component-level coverage of happy path, error state, and a11y basics.
- Every backend module has unit tests; `couch_peruser` + JWT + device-limit flows have integration tests against real CouchDB via `testcontainers`.
- Coverage is measured, gated, and visible in CI.
- A new contributor can tell from `docs/TESTING.md` + file layout exactly where their next test belongs.
- Shared fixtures eliminate the copy-paste setup that made `recovery.test.ts` swell to 1,366 lines.

**Non-Goals:**

- Visual regression testing (Percy, Chromatic, etc.). Defer until the UI design is more stable.
- Performance / load testing. Unit tests assert correctness, not throughput.
- Contract tests against the real Google or Apple OIDC providers. Those providers are external; we verify our client against mock-oidc, not against them.
- Mutation testing (Stryker). High-value for crypto code in principle, but infrastructure cost outpaces payoff at this stage.
- A custom test runner. Vitest + Playwright cover everything; adding Jest, Mocha, or Cypress would fragment tooling.

## Decisions

### D1 — Vitest everywhere (no Jest)

Vitest runs unit (jsdom) and component (jsdom) and backend unit (Node) and backend integration (Node + testcontainers) with a single CLI, a single config system, and a single assertion API. Playwright stays for E2E because it's the only sensible browser driver.

**Alternative considered:** Jest for components (more tutorials exist). Rejected — switching runners costs more than it saves, and Vitest's ESM-first model matches our Astro/React ESM codebase.

### D2 — Tier detection by filename suffix

Each test file's tier is determined by a glob pattern:

| Tier | Glob |
|---|---|
| Pure unit | `src/**/*.test.ts` (excluding `*.component.test.tsx`) |
| Component | `src/components/**/*.component.test.tsx` |
| Backend unit | `infrastructure/**/test/**/*.test.mjs` (excluding `*.integration.test.mjs`) |
| Backend integration | `infrastructure/**/test/**/*.integration.test.mjs` |
| E2E | `tests/e2e/**/*.spec.ts` |
| Smoke | `scripts/smoke/*.sh` |

Four Vitest configs (`vitest.config.unit.ts`, `.component.ts`, `.backend.ts`, `.integration.ts`) share a common base via `mergeConfig`. Each config sets its own `include`/`exclude` and, for integration, `testTimeout: 60_000`.

**Alternative considered:** single Vitest config with `--project` separation. Rejected because Vitest's project support still requires per-project environments, and config inheritance stays simpler with four explicit files.

### D3 — React Testing Library + userEvent; no Enzyme

RTL is the React-testing standard. It enforces testing through the accessibility tree, which aligns with our a11y-invariant requirements. `userEvent` (v14) dispatches realistic browser events; `fireEvent` is deprecated for user-driven scenarios.

**Alternative considered:** Enzyme (mount / shallow). Rejected — deprecated for React 18+, encourages testing internal state.

### D4 — `testcontainers` for CouchDB integration

`testcontainers` is the npm-native wrapper around Docker testcontainers. It gives per-file container lifecycle management with automatic cleanup on failure. The alternative — hand-rolled `docker run`/`docker stop` in bash — doesn't handle crash cleanup.

**Integration test template:**

```ts
import { GenericContainer, Wait } from 'testcontainers';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

let couchUrl: string;
let stop: () => Promise<void>;

beforeAll(async () => {
  const c = await new GenericContainer('couchdb:3')
    .withEnvironment({ COUCHDB_USER: 'admin', COUCHDB_PASSWORD: 'test' })
    .withExposedPorts(5984)
    .withWaitStrategy(Wait.forHttp('/_up', 5984))
    .start();
  couchUrl = `http://${c.getHost()}:${c.getMappedPort(5984)}`;
  stop = () => c.stop();
}, 60_000);

afterAll(async () => stop());

describe('meta.ensureDatabase', () => {
  // ...
});
```

Each integration suite gets a fresh CouchDB. Parallel runs don't collide because `testcontainers` gives them different host ports.

**Trade-off accepted:** each integration file costs ~3-5 s in container startup. Keep the integration tier small — only flows that fundamentally need real CouchDB live there.

### D5 — Backend tests run under Vitest's Node environment

`infrastructure/couchdb/tricho-auth/test/**` uses `environment: 'node'` (no jsdom). Vitest picks this up from the tier-specific config. No polyfills needed — the service runs on real Node in production, tests run on the same runtime.

### D6 — `@vitest/coverage-v8` with committed baseline

Coverage runs only in CI (not on every local `npm test`). CI writes `coverage-summary.json` per tier; the committed `coverage-baseline.json` captures the current numbers. CI compares summary vs. baseline and fails if any percentage drops by more than 0.5 pp without a reviewer-acknowledged exception.

**Why a committed baseline** instead of a static threshold:
- Static thresholds (e.g. "90 %") create friction when a refactor genuinely drops coverage to 89.8 % for good reasons. Baseline comparison lets reviewers accept the drop explicitly.
- Static thresholds also hide *increases* — we want visibility when a new test bumps crypto coverage from 92 % to 95 %, and the baseline makes that a committed diff.

**Alternative considered:** Codecov / Coveralls. Defer — external service + token management for a one-dev project. Local baseline is simpler.

### D7 — Shared fixtures + factories in `src/test/fixtures/`

Three directories, one per frontend/backend/e2e domain:

```
src/test/fixtures/
  vault.ts           # makeVaultFixture() -> { vaultId, dek, keystore }
  oauth.ts           # fakeOAuthResult(), fakeSubscription()
  pouch.ts           # inMemoryPouch(vault), seedCustomer()

infrastructure/couchdb/tricho-auth/test/fixtures/
  meta.mjs           # fakeMeta() - in-memory Meta that records writes
  jwt.mjs            # testSigner() - deterministic keypair + signer
  routes.mjs         # mountRouter(env?) - returns { req(path, opts) }

tests/e2e/fixtures/
  vault.ts           # openVaultAsTestUser(page, { subject })
  mock-oidc.ts       # setMockIdentity(page, identity)
```

Rule: if two tests would need the same five lines of setup, extract.

**Refactor debt**: the existing `recovery.test.ts` (1,366 lines) and `payload.test.ts` (903 lines) predate this rule. The change includes a task to extract their common setup into fixtures and trim the suites.

### D8 — What DOESN'T get a test

Explicit exclusions so "low coverage" doesn't become a moral failure:

- Type-only modules (`src/db/types.ts`) — no runtime code to test.
- Astro pages that are pure wrappers around a single React component (`src/pages/index.astro`) — covered via E2E.
- Generated code (`dist/`, `.astro/`) — ignored by coverage config.
- Third-party library surfaces already covered by their own test suites — don't test PouchDB itself.

These go into `vitest.config.*.ts` exclude lists and into a `docs/TESTING.md` "why this isn't covered" footer.

### D9 — E2E fixture: `openVaultAsTestUser`

Playwright tests currently duplicate 20+ lines of OAuth-callback driving. Extract:

```ts
// tests/e2e/fixtures/vault.ts
export const test = base.extend<{ vaultUser: VaultUser }>({
  vaultUser: async ({ page }, use) => {
    const sub = `g-e2e-${Date.now()}-${Math.random()}`;
    await setMockIdentity(page, { sub, email: `${sub}@tricho.test` });
    const body = await driveGoogleOAuthFlow(page);
    await use({ sub, tokens: extractTokens(body) });
  },
});
```

Tests then `test('something', async ({ vaultUser, page }) => { ... })` and arrive with a signed-in page in one line.

### D10 — CI matrix

Single workflow `.github/workflows/tests.yml` with jobs:

```
jobs:
  unit:            # ~30 s — always runs
  component:       # ~60 s — always runs
  backend-unit:    # ~20 s — always runs
  backend-integ:   # ~3 min — runs on PRs touching infrastructure/
  e2e:             # ~4 min — runs on PRs + main
  smoke:           # ~10 s — always runs
  coverage-gate:   # depends on unit + component + backend-unit, compares to baseline
```

Path-filtering (`dorny/paths-filter`) skips jobs whose inputs didn't change — a pure README-edit PR only runs `smoke`. The `e2e.yml` from the unified-stack change is folded into this workflow as the `e2e` job.

### D11 — Mock hygiene

`vi.mock` calls live at the top of each test file (hoisted). We do NOT use `vi.mock` with a factory that reads from the unmocked module — that encourages coupling. Mocks reset between tests via `beforeEach(() => { vi.clearAllMocks() })` in the shared setup.

## Risks / Trade-offs

- **[Component test brittleness]** RTL tests coupled to DOM structure break on refactor. → Mitigated by D3 (query via accessibility tree, not CSS selectors). Reviewers reject any `querySelector` usage.
- **[testcontainers flakiness on laptops]** Docker daemon hiccups can fail integration tests randomly. → Mitigated by running integration only in `test:backend:integration` and CI, NOT `npm test`. Local dev opts in.
- **[Coverage numbers become a goalpost]** Chasing 100 % incentivises testing trivial getters. → Baseline comparison, not static targets. `docs/TESTING.md` explicitly lists what doesn't need to be covered.
- **[Fixture overreach]** Shared fixtures can hide test intent. → Rule: fixtures hold *setup*, not assertions. Every test still asserts its own invariants explicitly.
- **[CI wall-clock budget]** Six parallel jobs means six runners per PR. → GitHub Actions free tier supports this; the fan-out matches what Anthropic's own repos do. If we outgrow the free tier we self-host.
- **[testcontainers adds SOPS / Colima friction]** Integration tests require Docker locally. → Acceptable — `npm test` stays Docker-free; `npm run test:backend:integration` is explicit opt-in. `make doctor` already checks Docker presence.
- **[Shared fixtures for the crypto suite hide subtle parametrisation]** Refactoring `recovery.test.ts` might drop case coverage. → Task list explicitly requires diff of test counts before/after, plus spot-check that every Base32 edge case still appears in the trimmed file.

## Migration Plan

Phase 1 — Foundation (~1 day of work):
1. Install dev deps (`@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `testcontainers`, `@vitest/coverage-v8`).
2. Author the four Vitest configs and the shared base.
3. Split `package.json` scripts (`test:unit`, `test:component`, `test:backend`, `test:backend:integration`, `test:e2e`, `test:smoke`, `test:all`).
4. Ship `docs/TESTING.md` + the shared fixtures skeleton (empty files with the expected exports).

Phase 2 — Unit-tier gap fill (~½ day):
5. Add tests for `src/auth/oauth.ts`, `src/auth/webauthn.ts`, `src/sync/couch.ts`, `src/sync/idle-lock.ts`.
6. Refactor `recovery.test.ts` and `payload.test.ts` to use fixtures; assert same-count or explicit case-by-case justification for anything dropped.

Phase 3 — Component tier (~1 day):
7. Install the jsdom polyfills in `src/test/component-setup.ts`.
8. Ship component tests for the ten top-level screens, one PR per screen if they get large.

Phase 4 — Backend tier (~1½ days):
9. Author `tricho-auth/test/` unit suite for jwt / meta / routes / providers / server.
10. Author `mock-oidc/test/server.test.mjs`.
11. Author the two integration suites (meta+design-doc, JWT-vs-real-CouchDB).

Phase 5 — E2E extensions (~1 day):
12. Extract `openVaultAsTestUser` fixture.
13. Ship `vault-unlock.spec.ts`, `rs-recovery.spec.ts`, `device-limit.spec.ts`, `offline-sync.spec.ts`, `a11y.spec.ts`.

Phase 6 — CI + coverage gating (~½ day):
14. Replace `e2e.yml` with the matrix `tests.yml`.
15. Wire coverage baseline + comparison script.
16. Gate merges.

**Rollback:** each phase is a `git revert` candidate in isolation. Phase 1 is the only "no going back" — the config split is committed infrastructure once merged.

## Open Questions

- *Do we run component tests in parallel workers?* Vitest parallelises by default, but RTL's global cleanup is fine with parallelism. Lean yes, revisit if flakes appear.
- *How to handle WebAuthn / credential APIs in component tests?* jsdom has no real WebAuthn. We'll stub `navigator.credentials.create`/`.get` in `component-setup.ts`; full PRF unlock stays E2E's territory via a passkey-stub browser context. The E2E passkey-stub is a follow-up change — without it, `vault-unlock.spec.ts` only covers the PIN path.
- *Mutation testing for crypto?* Proposed non-goal. Reopen if we find a subtle crypto bug that escaped line-coverage. Stryker + Vitest integration is workable when needed.
- *Keep or delete `dist/` + `.auto-claude/` from coverage config?* Already excluded in `.dockerignore` / `.gitignore`; mirror in `vitest.config.*.ts`'s `coverage.exclude`.
- *Should the baseline live in a separate branch?* Committing on `main` creates a diff on every coverage-changing PR. Acceptable — the diff is small, reviewable, and review-visible. A separate branch is overkill for a one-dev repo.
