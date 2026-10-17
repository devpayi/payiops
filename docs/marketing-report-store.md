# Private monthly ad report storage

The report journal is independent of `marketing_inputs`. Saving a report never
changes Dashboard/CFO values or pricing calculations. Dev/Boss authentication is
required for the save API; the server rebuilds totals from submitted source files.

## Provisioning

1. Create a private spreadsheet with a `report_revisions` tab and the exact
   `REPORT_HEADERS` from `api/_lib/marketingReportRevisions.js` in A1:I1.
2. Obtain explicit approval before granting the application service account
   Writer access. Do not share publicly or grant access to other operational sheets.
3. Set `MARKETING_REPORTS_SHEET_ID` to that spreadsheet ID and
   `MARKETING_REPORTS_STORE_APPROVED=true` in the server environment. Keep credentials
   server-only. Existing operational, archive, HR and pricing sheet IDs are rejected.
4. Run source imports without `--publish` first; then publish only reviewed files.
   Read the stored reports back and compare month, shop, spend and source fingerprints
   before enabling/deploying the report UI.

```powershell
node scripts/publish-monthly-ads.mjs --platform Shopee --business Payi --file '<overview.csv>' --file '<group-detail.csv>'
node scripts/publish-monthly-ads.mjs --platform 'TikTok Shop' --business Payi --file '<dashboard-capture.json>'
```

Add `--publish` only after store approval and dry-run verification. TikTok JSON
is a recorded dashboard capture, not a platform-exported product report. Lazada
import is intentionally unavailable until its real export format is verified.

## Revisions and failures

Each import appends source text, hashes, normalized results and a commit marker in
one atomic Sheets batch. Literal string cells prevent formula execution. Revisions
remain in the journal; the reader selects the latest revision per platform,
business, shop and calendar month. A → B → A does not double-count totals.

If a request times out, refresh before trying again: the batch may have committed.
Malformed headers, incomplete revisions and modified hashes fail closed. Access
failures show an error; production never silently falls back to local private files.
Do not manually edit journal rows. Use a new verified import to correct a report.

Disabling the approved-store flag hides report availability and retains the legacy
manual ad-cost form. Source files and report JSON belong in ignored `reports/`
or private storage, never Git, `public/`, or a client bundle.
