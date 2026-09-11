# Schema verification

Executed: 2026-09-10T04:54:01.836Z

Engine: PostgreSQL 18.4 on x86_64-windows, compiled by msvc-19.44.35226, 64-bit

37 checks passed.

- PASS: Bootstrap and migration execute on real PostgreSQL
- PASS: Database timezone is Asia/Bangkok
- PASS: All 40 tables ENABLE and FORCE RLS
- PASS: Every table has mandatory company_id
- PASS: Every foreign key includes company_id on both sides
- PASS: Missing tenant context reads zero rows
- PASS: Missing context blocks writes
- PASS: Query without WHERE cannot see another tenant
- PASS: Cross-tenant update affects zero rows
- PASS: Cross-tenant insert denied
- PASS: Cross-tenant foreign key rejected
- PASS: TRUNCATE is denied
- PASS: Runtime cannot create tables
- PASS: Runtime cannot change companies
- PASS: Overlapping cost ranges rejected
- PASS: Adjacent half-open cost ranges select exactly the new cost
- PASS: Recognition without cost snapshot rejected
- PASS: Recognition uses Bangkok business date across UTC midnight
- PASS: Recognized item cannot change
- PASS: Historical cost amount cannot change
- PASS: Cost interval cannot exclude recognized sale
- PASS: Deferred constraint rejects unbalanced posting
- PASS: Balanced journal posts successfully
- PASS: Posted journal cannot change
- PASS: Posted lines cannot change
- PASS: Used account cannot change reporting classification
- PASS: Journal source cannot post twice
- PASS: Webhook event identity is unique
- PASS: Request cannot enter two active payout items
- PASS: Paid payout requires journal and payment evidence
- PASS: Unknown procurement location is rejected
- PASS: File object key must use tenant prefix
- PASS: Company row cannot change timezone
- PASS: Audit history cannot be deleted
- PASS: FORCE RLS also constrains table owner
- PASS: Reused connection switches tenant without stale visibility
- PASS: SET LOCAL tenant context expires after transaction

Scope: real PostgreSQL schema and integrity tests; no application, gateway, AI or LINE integration tests in step 1.
