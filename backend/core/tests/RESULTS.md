# Backend core verification — steps 2–4

Date: 2026-09-11 (Asia/Bangkok)

- TypeScript strict typecheck: PASS
- Production TypeScript build: PASS
- Integration tests: **35 passed, 0 failed, 0 skipped**
- Database engine: PostgreSQL 18.4, isolated local cluster
- Production dependency audit: 0 reported vulnerabilities at verification time

Verified behavior:

1. Legacy response-cache migration works with FORCE RLS.
2. Missing scope, tenant switching and company mismatch are denied.
3. Fifty concurrent tenant scopes remain isolated without explicit WHERE filters.
4. Cross-tenant writes fail and pooled connections remain usable after rollback.
5. Nested errors prevent the outer transaction from committing.
6. SQL values are bound parameters; session-control statements are rejected.
7. An aborted scope cannot commit.
8. JWT signature, expiry, issuer, audience, tenant header and membership are checked.
9. Accrual profit reconciles to posted ledger with recognition-time COGS.
10. Satang allocation conserves monthly ads/daily fixed costs, including leap years.
11. Invalid gateway signatures/accounts/headers cannot reserve a key.
12. A simultaneous duplicate receives 409; the original commits and replays exact response bytes.
13. Separate event IDs cannot duplicate the same payment capture.
14. Reusing an event identity with changed verified data produces 409.
15. Failure after actual payment/ledger writes rolls them back; retry commits once.
16. A deferred COMMIT failure rolls back actual payment/ledger writes and never caches success.
17. Concurrent distinct payments cannot over-collect an order.
18. Abandoned claims recover; completed payment keys do not expire.
19. 2C2P HS256, merchant matching, long JWTs and reissued-token deduplication work.
20. Omise authenticated retrieval overrides untrusted delivery data and records advances correctly.
21. Credit notes change revenue/COGS; refunds change collection independently.
22. Unrecognized/missing orders and users without finance permission are denied.
23. A source sale without its posted journal cannot produce a profit report.

Gateway tests use signed test fixtures and a mocked Omise API, not live accounts.
The two `http_error` log lines during the run are intentional failure injections.
The temporary PostgreSQL server is stopped after the run. No production database was changed.

Commands: `npm run typecheck`, `npm test`, `npm run build`, `npm audit --omit=dev --json`.

## Additional verification (2026-09-11)

- Procurement classification, retry safety, receipt accounting, proof-gated payout and tenant-private images: passed.
- HTTP sales, cost snapshots, private/public catalog, Bangkok date-only serialization: passed.
- LINE signature, intended recipient, replay protection, daily queue deduplication and free-quota ceiling: passed with test integrations.
- Next.js production build and strict TypeScript: passed.
- Browser QA uses an isolated fixture company; real store data is untouched.
- Dedicated LINE channel credentials and public HTTPS delivery remain unconfigured; no live message or bank transfer was performed.
