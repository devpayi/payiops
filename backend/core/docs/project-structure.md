# Project structure

The database and documentation were implemented in step 1. Step 2 implements
apps/api, packages/db, packages/money and tests/integration in TypeScript.
Other application directories below remain architectural boundaries for later
work; no empty application source files or fake implementations were created.

```text
cmo-cfo-procurement/
├── apps/
│   ├── web/                         Next.js / React / TypeScript
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (auth)/
│   │       │   ├── (dashboard)/[companySlug]/
│   │       │   │   ├── cfo/
│   │       │   │   ├── cmo/
│   │       │   │   ├── procurement/
│   │       │   │   └── settings/
│   │       │   └── (catalog)/[companySlug]/products/[productSlug]/
│   │       ├── components/
│   │       └── lib/                 Server-only API client, money, Bangkok dates
│   ├── api/                         Express / TypeScript
│   │   └── src/
│   │       ├── config/
│   │       ├── middleware/          Auth, verified tenant, RBAC, idempotency
│   │       ├── modules/
│   │       │   ├── identity/
│   │       │   ├── companies/
│   │       │   ├── catalog/
│   │       │   ├── orders/
│   │       │   ├── accounting/
│   │       │   ├── expenses/
│   │       │   ├── marketing/
│   │       │   ├── procurement/
│   │       │   ├── files/
│   │       │   └── integrations/
│   │       │       ├── stripe/
│   │       │       ├── omise/
│   │       │       ├── twoc2p/
│   │       │       └── line/
│   │       └── http/                Routes, raw webhook bodies, error mapping
│   └── worker/
│       └── src/
│           ├── jobs/                Daily procurement, fixed cost accrual, ads
│           ├── outbox/              LINE delivery and retry
│           └── scheduler/           Tenant dispatch, Bangkok schedules, leases
├── packages/
│   ├── db/                          Pool and mandatory scoped transactions
│   ├── contracts/                   Validated API DTOs; money as decimal strings
│   ├── money/                       Decimal arithmetic and explicit rounding
│   ├── time/                        Asia/Bangkok business dates
│   └── observability/               Structured logs, tracing, redaction
├── database/                        Implemented in step 1
│   ├── bootstrap.sql
│   ├── schema.sql                   Complete combined SQL
│   ├── migrations/
│   │   ├── 0001_initial.sql
│   │   └── 0002_backend_core.sql
│   └── tests/
│       ├── package.json
│       ├── package-lock.json
│       ├── verify.mjs
│       └── RESULTS.md
├── docs/                            Implemented in step 1
│   ├── database-blueprint.th.md
│   ├── backend-core.th.md
│   └── project-structure.md
├── infra/                           Deployment, secret refs, backup policies
├── tests/
│   ├── integration/                 Tenant, accounting, replay, concurrency
│   └── e2e/                         Employee request to boss reconciliation
└── .gitignore
```

Each API module owns its routes, validation, service, and repository. Routes do
not execute SQL directly. Services own transaction boundaries and authorization;
repositories receive a tenant-scoped transaction instead of a global pool.
Shared packages must not expose database access to browser bundles.

This is a modular monolith with separately deployable web, API, and worker
processes. It keeps money movements within one PostgreSQL transaction while
allowing independent process scaling. No microservice split is needed initially.
