# Manpower & OT: architecture review

> Decision update (2026-10-24): the API migration proposed below is deferred. Keep the existing copies and authentication boundaries; use `npm run check:workforce-drift` to detect calculation drift. See [workforce-drift.md](workforce-drift.md). Reconsider one API if drift recurs. The review below is retained as an unimplemented alternative.

Reviewed: 2026-10-24. This document proposes a design; the migration is not implemented.

## Senior Review

Frozen proposal under review: “Both apps read the same Sheets but duplicate logic. Share one computation module, keep independent sheet reads, enforce the same version in build. No cross-app API call.”

**Altitude diagnosis: fog.** The proposal does not specify how two production deployments keep the same version, how input freshness is maintained, or how failures are presented.

### Verified facts

- The checked local environment files point to the same Sheet, using different service accounts. This does not verify the deployed environment variables.
- Calendar computation is duplicated: `api/sheet-tools.js:2374` in Ops and `api/_lib/workforce.js:179` in Floor.
- Ops also uses the calendar computation for HR coverage checks. Moving display logic must preserve these callers (`api/sheet-tools.js:2250`).
- Ops caches Sheet rows for 300 seconds (`api/_lib/sheets.js:11`), workforce responses for 20 seconds (`api/sheet-tools.js:2468`), and sets an additional CDN cache policy (`api/sheet-tools.js:2496`). Invalidating an in-memory cache does not invalidate another process or application.
- The two apps are configured as separate Vercel projects in separate teams.
- After the holiday fix, running both implementations against the same live input tables produced 2,965 equal roster rows across 474 dates. This is a same-input comparison, not a comparison of both production endpoints.
- The focused leave, weekly-off, swap, override and holiday suites pass 21 tests. There are no before/after production latency measurements.

### Blockers

- **B1: Sharing code does not ensure shared runtime inputs.** Independent caches can hold different roster and leave data. Fix: define a freshness policy and include the represented input/result revision and generation time in responses.
- **B2: Matching package versions at build time does not coordinate production activation.** Vercel monorepo projects deploy independently. Fix: either manage coordinated releases explicitly or use a single producer for workforce results.
- **B3: A failed load can resemble an empty workforce.** The current GET catches calendar-source errors and continues with an empty array (`api/sheet-tools.js:2477–2495`). Fix: return a visible load failure; never cache that result as a successful empty roster.

### Major findings

- Rejecting a central API on speed grounds was premature. A browser calling one canonical backend directly still makes one backend request. Its actual latency depends on deployment location, cold starts, payload and Sheet reads; it requires measurement.
- A monorepo is useful source organization, but it does not itself provide cross-project cache invalidation or simultaneous production rollout.
- A central API alone is also insufficient if its instances keep stale private caches. It needs an explicit fresh-read path, bounded cache age and revision metadata.

### What the earlier proposal got right

The scheduling rules should be implemented once. Pure calculation separated from Sheet access makes characterization tests and rollback easier. Authentication remains explicit for each consumer.

## Options considered

| Option | Main benefit | Limitation | Assessment |
| --- | --- | --- | --- |
| Keep copies and add parity tests | Smallest immediate change | Copies, deployments and caches can still diverge | Temporary safeguard |
| Shared package in separate repos | One maintained calculation implementation; no extra runtime hop | Package updates, deployed versions and input caches still need coordination | Useful if independent backends are required |
| Monorepo with a shared package and two projects | Easier code review and shared changes | Two deployed producers remain; moving repositories is broader work | Good maintenance improvement, incomplete consistency solution |
| Narrow canonical workforce API, called directly | One runtime owner for rules and data-loading policy | Requires cross-origin authentication integration and availability planning | Recommended for this requirement |
| Canonical API behind a Floor server proxy | Keeps browser authentication integration local | Adds a server hop; proxy must not add stale caching | Fallback if direct authentication integration is disproportionately costly |
| One workforce screen hosted once, linked from both menus | One maintained UI and backend | Navigation/login experience changes and needs product agreement | Good only if a shared destination is acceptable |
| Materialized computed roster in Sheets | Both consumers can read a published result revision | Requires a reliable publisher after leave/schedule changes; failed publication creates stale results | Too much lifecycle work for the present scope |
| Merge both apps into one deployment | One release boundary | Broad migration unrelated to fixing this screen | Excessive scope |

## Promoted Plan (v2)

### Goal and non-goals

Both screens obtain Manpower & OT calendar data from one maintained producer, preserve each app’s existing authorized workflow, and make data freshness and failures visible. This does not merge the whole apps, replace Sheets, introduce a paid cache service, or promise simultaneous updates to browsers that remain open without refreshing.

### Decision

Use a narrow workforce API hosted in the existing Ops backend. Ops owns the HR approval workflow that changes calendar attendance, so it is the appropriate owner of the derived roster. Reuse `api/sheet-tools.js` routing rather than adding a serverless function.

Both frontends call this backend directly. Floor does not independently compute or assemble calendar attendance. Keeping the computation as a pure internal module remains useful, but publishing a shared package is not required to achieve one runtime owner.

The strongest alternative is the monorepo/shared-package approach: it retains independent operation and avoids cross-origin integration. Choose it only when that independence is a requirement and temporary differences in versions/freshness are acceptable. The current user concern favors one result producer.

### Interface and ownership

The proposed response is:

```js
{
  schemaVersion: 1,
  logicVersion: '...',
  revision: '...',
  generatedAt: '...',
  range: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' },
  days: [
    {
      date: 'YYYY-MM-DD',
      people: [{ code: '...', name: '...', group: '...', fraction: 1, labels: [] }],
      holiday: null,
      ot: [],
      events: []
    }
  ]
}
```

`revision` identifies the actual input bundle and calculation version represented, not merely the deployment or request timestamp. The API owns group assignment, attendance fractions, holiday/leave/swap effects and OT labels. The frontends render the result and keep application-specific styling.

Move workforce reads and the existing workforce mutations used by this screen to the same owner. HR leave mutations remain under existing Ops authorization; Floor gets no HR write access. Otherwise Floor could keep writing data while the canonical reader’s caches remain unaware.

### Authentication

Do not expose workforce data publicly. Keep Ops tokens and roles unchanged. Add a workforce-scoped verifier for the existing Floor identity, with server-only verifier configuration and an explicit Floor-origin allowlist for browser access. Authorization must restrict that identity to the workforce actions already available in Floor; it must not grant access to arbitrary Ops or HR routes. Never place service-account credentials in either frontend.

Verify production origins, identity configuration and deployed Sheet IDs before switching traffic. These have not been verified by the local audit.

### Freshness and performance

- Load the related input ranges as one request-scoped bundle using Sheets `values.batchGet`; avoid reconstructing a response from separately aged Sheet caches. This groups reads but is not a transactional guarantee across separate requests.
- Reuse a small bounded cache for ordinary reads. Initial proposal: no more than 15 seconds for this endpoint, measured end to end; do not retain a hidden five-minute lower-layer cache or stack stale CDN responses underneath that promise. Validate this target against the actual request rate and Google quota before release.
- On a successful mutation, update the writer’s displayed result and use a fresh read that bypasses all applicable cache layers. Revalidate on screen focus so returning users see recent changes.
- A fresh read must account for other backend instances; merely clearing the current instance’s map is insufficient. In-flight responses that began before a write must not overwrite the writer’s newer response.
- Return only the requested date range and required calendar fields. Fetch summary/history details when those tabs need them.
- On load failure, show an explicit error. Previously loaded data may remain visible with its timestamp and a stale label; do not silently fall back to an independent old calculation or return empty success.
- There is no promise that requests at different times have the same revision. Exact comparisons require the same represented revision. A shared backend removes duplicated rules; freshness remains a defined, observable policy.
- Measure current and proposed warm/cold load latency, request count, payload size and post-write freshness. Do not claim a speed improvement before measuring. Consolidating service-account traffic can increase pressure on one account’s quota.

### Sequencing and verification

1. Extract the pure computation and retain characterization tests. Verify the existing 2,965-row same-input baseline plus holiday, weekly-off, half-day leave, swap and override cases. Preserve HR coverage callers.
2. Implement the narrow response, authorization and read-bundle/failure behavior behind an explicit migration switch. Verify a calculation failure cannot become an empty successful roster.
3. Route Ops through the contract first. Measure against the existing path and test writes followed by fresh reads from a separate instance.
4. Connect Floor with its workforce-scoped identity. Compare both screens by response revision, including edits made from either screen and HR leave approval in Ops.
5. Validate production configuration and both previews, then switch consumers. Delete independent Floor calculation and redundant display derivation after verification. Retain application-specific UI and permission controls.
6. Add integration checks that both consumers use the canonical route, cross-origin requests have only the intended permissions, and failure/refresh states remain visible.

### Risks and rollback

The canonical backend becomes a shared availability dependency. Preserve a timestamped last successful display and a clear retry state during an outage. A duplicate fallback engine would reintroduce the original correctness problem.

Authentication migration is the main integration risk. Test the intended Floor-only capability and rejection of HR/general Ops access before production. Read payloads must exclude unrelated HR fields.

Roll back both consumers together to the known pre-migration release if needed. Retain the existing Sheets schema during migration so rollback does not require data conversion. Avoid leaving one consumer permanently on the old calculation path.

### Open product decision

The acceptable freshness delay has not been specified. Fifteen seconds is an initial engineering proposal, not a user-approved guarantee. If every open screen must update immediately after edits, that requires an additional notification/polling mechanism and quota evaluation. It is outside the initial migration.

## Delta summary

- Changed from shared source only to a single producer for workforce results.
- Included the existing five-minute input cache and independent-instance behavior in the design.
- Replaced unmeasured speed claims with a benchmark and freshness acceptance step.
- Preserved existing HR ownership and made Floor authorization explicitly workforce-scoped.
- Separated identical calculation, bounded freshness and live screen synchronization into distinct guarantees.

## Sources checked 2026-10-24

- [Vercel monorepos](https://vercel.com/docs/monorepos): shared packages are supported; connected projects create separate deployments.
- [npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/): lockfiles reproduce resolved dependency versions, not multi-project activation.
- [Google Sheets batchGet](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchGet): multiple ranges can be read in one request.
- [Google Sheets quotas](https://developers.google.com/workspace/sheets/api/limits): read quotas include 300 requests/minute/project and 60/minute/user/project. Quotas matter when consolidating readers.

These sources support platform behavior. The architecture choice and proposed freshness target are engineering judgments for this codebase, not vendor prescriptions.
