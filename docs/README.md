# docs/ — developer reference

Behavioural requirements live in [`../openspec/specs/`](../openspec/).
The files here are procedural and contextual: how to set up, build,
deploy, test, and write copy. They link to specs rather than restate
them.

| File                                       | Covers                                                  |
|--------------------------------------------|---------------------------------------------------------|
| [architecture.md](architecture.md)         | Current-state overview: surfaces, modules, flows, ZK    |
| [developer-guide.md](developer-guide.md)   | Local setup, day-to-day flow, IDE, code conventions     |
| [build-and-deploy.md](build-and-deploy.md) | Build pipeline, promote workflow, rollback, versioning  |
| [testing.md](testing.md)                   | Six-tier pyramid, per-tier commands, speed budgets      |
| [secrets.md](secrets.md)                   | Dev pointer to the SOPS + age workflow                  |
| [voice-czech.md](voice-czech.md)           | Czech voice, grammar, vocabulary, forbidden framing     |

Other entry points:

- **End-user help:** [`web/src/content/help/`](../web/src/content/help/)
  — rendered at `tricho.app/help`.
- **Operator runbooks:**
  [`secrets/README.md`](../secrets/README.md) (SOPS lifecycle),
  [`infrastructure/couchdb/tricho-auth/BILLING.md`](../infrastructure/couchdb/tricho-auth/BILLING.md)
  (paid-plans deploy + reconciliation).
- **Canonical product copy:**
  [`prototypes/landing-page-prototype/COPY.md`](../prototypes/landing-page-prototype/COPY.md).
- **Canonical UI spec:**
  [`prototypes/ui-prototype/tricho-north-star.md`](../prototypes/ui-prototype/tricho-north-star.md).
- **Capability index:** [`../openspec/README.md`](../openspec/).
