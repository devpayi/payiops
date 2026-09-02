# CLAUDE.md — PAYI Ops

Context for AI assistants working on this project. Read this first.

## What this is

**PAYI Ops** — workflow/analytics/ops hub for a Thai e-commerce business selling on
Shopee / TikTok Shop / Lazada. Owner speaks **Thai** (reply in Thai). Hard constraint:
**everything must be free-tier** (Vercel Hobby + GitHub + Google Sheets as the database —
no paid services, ever).

Rebuilt from scratch after the owner's old PC was wiped (2026-07-03); has since grown
well beyond the original sales-dashboard scope into HR/leave, workforce scheduling,
demand planning, marketing tracking, and a LINE bot.

## Stack & architecture

- **Frontend**: Vite + React 19 + Recharts + lucide-react. Plain CSS via `src/theme.css`
  (PAYI theme, CSS variables like `--payi-mint`, `--payi-surface`, `--payi-text-strong`).
- **`src/App.jsx`** is a **tab-based shell** (no router). Active tab in `localStorage`
  key `payi-active-tab`. Sidebar menu = `menuGroups` array; render is a big ternary on
  `activeTab`. To add a page: add a menu item + a ternary branch + the component.
- **Backend**: Vercel **serverless functions** in `api/*.js`, reading Google Sheets via a
  service account (`api/_lib/sheets.js`). Frontend calls **flat** `/api/<name>` endpoints
  (query params for sub-routing, e.g. `/api/claims?view=monthly`). No nested paths.
- **⚠️ Vercel Hobby caps 12 serverless functions — we are at 9/12 (3 free)** after
  Claims was removed entirely (commit `8d2bf9e`, freed 3 slots: `claims.js`,
  `claims-import.js`, `manager-claims.js`). Still: any new feature MUST piggyback an
  existing file via a new query param + a new `api/_lib/*.js` impl before reaching for a
  new `api/*.js` file — `sheet-tools.js` (`op=`) and `marketing.js` (`kind=`) are the
  established multiplexing pattern to copy.
- **File uploads parse xlsx CLIENT-SIDE** (via the `xlsx` dep) and POST JSON — never
  multipart. Deliberate so imports work on serverless.
- **Dev**: `npm run dev` runs Vite AND serves `/api/*` locally (middleware in
  `vite.config.js`). Requires root `.env`. `npm run build` to check compile.
- **Role-based access** (`shared/roles.js`): 6 roles — `dev`/`boss`/`staff` plus 3
  narrow single-purpose roles added since: `stock` (ฟ้า — sees only Inventory/Stock
  Movement), `marketing` (ตูน — sees Dashboard/Products + Marketing Radar + Demographic),
  `finance` (พี่หยก/พี่แต้ว — sees only CFO Dashboard). `admin` is a legacy alias,
  normalized to `dev`. `canAccessTab(role, tab)`: `dev` sees everything; `boss` sees
  everything except `Import Orders`/`Dev Hub`/`Settings`; `stock`/`marketing`/`finance`
  are restricted to their own `*_TABS` whitelist only; default (`staff`) uses
  `STAFF_TAB_SET` (`Executive`, `Monthly`, `Products`, `ProductTrends`, `Inventory`,
  `Stock Movement`). Server-side guards mirror this: `requireAuth` (any logged-in
  user), `requireDev` (dev only — used by `import-orders.js`), `requireManager`
  (dev+boss), `canManageOperations` (dev/boss — Inventory/HR/Import Tracking ops),
  `canManageMarketing` (dev/boss/marketing — Marketing Radar writes, basket analysis),
  `canManageFinance` (dev/boss/finance — legacy, no longer gates anything after the
  2026-09-01 lockdown). **⚠️ `op=cfo` / `op=demographic` / `op=import-tracking` are
  DEV-ONLY as of 2026-09-01** (owner request — `normalizeRole(req.user?.role) !== 'dev'`
  → 403). Other roles still see the sidebar entry but `App.jsx` renders `DevOnlyLock`
  (a fake "module being prepared" placeholder, deliberately indistinguishable from an
  unbuilt tab). The narrow-role
  guards must be paired with `authEnabled() &&` (local dev has no `AUTH_SECRET`, so
  `req.user` is `undefined` and would otherwise get normalized down to `staff` and
  rejected — bit the team once building the stock-in-request matcher).

## Data (Google Sheets: "mona-ops-db", SHEET_ID in .env)

**Sales/product tabs**: `raw_orders_2026_MM` (~190k+ order rows),
`product_aliases`, `import_log`, `users`. Businesses: **Payi**, **Payi Outlet**,
**กรอบรูป**. Platforms: **Shopee**, **TikTok Shop**, **Lazada**. **`claims` sheet tab
itself likely still exists with historical data but no app code reads/writes it anymore**
— Claims was removed entirely (commit `8d2bf9e`), see TODO #3.

`raw_orders` columns (A–V): order_key, order_id, order_item_id, date, platform, business,
sku_platform, product_name, variation_name, master_sku, display_name, qty, revenue,
order_status, imported_at, source_file, import_id, alias_key, **province** (S, appended
2026-08-25, see TODO #12), **shipping_option** (T), **fulfillment_type** (U),
**buyer_hash** (V) — the last three appended 2026-09-01 (see TODO #14). All four are
populated only for orders imported after their respective dates — no backfill; older
rows are blank there. `Upload.jsx`'s `RELEVANT_HEADER_HINTS` had to be widened each
time so the client-side column filter stops stripping them before upload. **DELETE
`?importId=` reads `A:Z`** (was `A:R` — that silently wiped province+ on any
import-batch delete; fixed 2026-09-01).
`product_aliases`: master_sku, display_name, business, platform, alias_product_name,
alias_variation, alias_key, created_at (+ optional `product_group` override column).
`users`: scrypt-hashed passwords, `role` column (dev/boss/staff/stock/marketing/finance,
admin = legacy alias for dev).
`sku_redirects` (`api/_lib/skuMapping.js`): old_sku, new_sku, note, created_at —
Sheets-backed replacement for the old hardcoded `SKU_REDIRECTS` map in
`planner-sales.js` (see TODO #7 sub-note).
`set_recipes` (`api/_lib/skuMapping.js`): set_sku, variation_name, component_sku,
qty_per_unit, keep_set_sales — decomposes Set/bundle SKU sales into real component
demand, see TODO #7 sub-note.
`cfo_capital` / `cfo_fixcost` (`api/_lib/cfo.js`): capital injections log + recurring
fixed-cost line items, backing the CFO Dashboard — see Files section.

**HR/workforce tabs** (auto-created via `ensureSheet`, all managed through
`api/sheet-tools.js?op=hr|workforce`): `hr_leave`, `hr_leave_backups`, `hr_leave_quota`,
`hr_leave_edits`, `hr_office_people`, `hr_line_links`, `hr_line_sessions`,
`workforce_people`, `workforce_ot`, `workforce_ot_approvals`, `workforce_ot_limits`,
`workforce_ot_approval_history`, `workforce_schedule_snapshot`,
`workforce_schedule_overrides`, `workforce_events`.

**Planner tabs** (`api/sheet-tools.js?op=planner`): `planner_config` (per-SKU feed
settings), `planner_daily` (daily FG/feed history).

**Marketing tabs** (`api/marketing.js`): `marketing_events` (action log + sales
snapshot), `marketing_inputs` (manual monthly Ads spend / TikTok channel split — not
derivable from `raw_orders`). `marketing.js` also has a `?kind=basket` op
(`_lib/marketingBasket.js`) — "bought together" basket analysis computed live from
`raw_orders`, no separate sheet.

Conventions: **exclude cancelled orders** (`order_status` contains "ยกเลิก"/"cancel");
aggregate server-side and set `Cache-Control` s-maxage / in-memory cache
(`cacheable()`, since per-user auth forces `no-store` on the HTTP layer) so we don't hit
Sheets rate limits.

## Files

### Frontend — `src/pages/` (wired to real Sheets backend unless noted)
- `MonthlyDashboard.jsx` (sales by store, MoM, platform donut, trend — tab `Dashboard สรุปยอดขาย`)
- `ProductDashboard.jsx` + `ProductTrends.jsx` (product-family dashboard + MoM trends — tab `Dashboard สินค้า`)
- `Upload.jsx` → used inside `Import Orders` tab (import orders, dev-only)
- `MarketingRadar.jsx` (marketing action log + event tracking)
- **`DemographicDashboard.jsx`** — "เดโมกราฟฟิกลูกค้า", province-level sales breakdown,
  `sheet-tools.js?op=demographic` (`_lib/demographic.js`, see TODO #12). **DEV-ONLY**
  since 2026-09-01. Also computes, from `raw_orders` T/U/V: Shopee delivery-option
  breakdown (`_lib/shippingClass.js` — parses the label from the raw Shopee string,
  folds carrier-only values to "ไม่ระบุประเภท"), the same split per `deriveGroup`
  product family (% fast vs standard), and per-platform repeat-customer rate (counted
  per distinct `order_id`, buyers matched on `buyer_hash`). Province names normalized
  at read time via `_lib/provinceNormalize.js` (merges "จังหวัดนนทบุรี"/"นนทบุรี"/
  "Nonthaburi" etc. — fixes existing data, no re-import).
- `AdsChannels.jsx` (manual Ads spend / TikTok channel entry + monthly sales overlay)
- **`CfoDashboard.jsx`** — "CFO Dashboard", cash runway/burn-rate view,
  `sheet-tools.js?op=cfo` (`_lib/cfo.js`, `cfo_capital`/`cfo_fixcost` sheets). **DEV-ONLY**
  since 2026-09-01 (was `canManageFinance`) — see TODO #13.
- `PlannerControl.jsx` + `FeedProducts.jsx` (demand planning: ABC, FG tracking, recommended feed)
- `HR.jsx` / `HRMobile.jsx` (leave requests/approvals, LINE-bot-integrated)
- `LinksHub.jsx`, `DevHub.jsx` (static link/doc hubs — real content, no backend)
- `Login.jsx`, `Settings.jsx` (auth screens, user management)
- **`ContentOSPrototype.jsx`** ("Content OS Prototype") — **UI-only prototype, no API
  calls, no backend.** Not usable yet.

**Removed (undated, found stale 2026-08-26):** `WorkforceOT.jsx` component file still
exists on disk but is **not imported/lazy-loaded in `App.jsx` at all** — Manpower & OT
was removed from the sidebar (commit `a6685a9`); treat it as dead code, same as
`PackingView.jsx` which has since been deleted outright (was previously noted here as
"dead/unused, do not wire up" — now actually gone from `src/pages/`).

**Removed (2026-07-21, owner decision):**
- **`SalesView.jsx`** ("Off-Platform Sales") — was localStorage-first, never migrated to
  Sheets. Deleted along with its sidebar entry, lazy import, and the `activeTab ===
  'Sales'` render branch/data-fetch trigger.
- **`AI Assistant` / "PAYI Brain" tab** — was NOT real AI (`buildReply()` was a hardcoded
  if/else returning canned Thai text, no LLM call). Deleted whole (`AIAssistantView`
  function, menu item, icon mapping, ternary branch) rather than keep a fake-AI page.
  If a real AI assistant is wanted later, per-user/per-role personalization IS feasible —
  scope the system prompt + visible data by the caller's role (`dev`/`boss`/`staff` from
  `shared/roles.js`), same pattern already used to gate sidebar tabs. Not built.

- **`ImportTracking.jsx`** (2026-07-24) — "ติดตามนำเข้า", Sheets-backed via
  `sheet-tools.js?op=import-tracking` (`_lib/importTracking.js`, `import_tracking` sheet,
  `ensureSheet`-created). **No money/cost tracking at all** — this is the second version
  of an import-goods page; the first version (`ImportCost.jsx`, same day) computed
  ต้นทุนต่อชิ้น with CNY price/FX rate/shipping/duty/2-stage payment, but the owner scrapped
  the whole cost-calculation angle ("ลบที่เกี่ยวกับเงินทั้งหมด ไม่ต้องแทรค") and asked to
  rebuild keeping only identifiers + document/handover tracking. Fields: date/item/sku/qty,
  `bill_no`/`customs_no`/`tracking_no` (เลขบิล/เลขที่ใบขน/เลขพัสดุ — `customs_no` is
  explicitly optional in the UI: the owner's own historical sheet data showed that column
  was never actually populated with real customs numbers, likely because their shipping
  agent consolidates customs clearance and doesn't issue per-shipment numbers), a 6-item
  document checklist (ใบดราฟ, ใบขนดราฟ + ใบขนใช้จริง as two separate checks, ใบกำกับภาษี,
  หัก ณ ที่จ่าย, ใบทักบัญชี → `docStatus` ครบ/ค้าง/ยังไม่เริ่ม), and a 3-item handover
  checklist (ส่งบัญชีแล้ว/ส่งคุณจอยแล้ว/พิมพ์แล้ว=PRNT, toggleable inline from the table).
  **Dev + boss only** (not in `STAFF_TABS`, same `canManageOperations` gating as
  Inventory/HR). No new `api/*.js` file — piggybacked onto `sheet-tools.js` per the 12/12
  function-cap rule. Deleting a row is a real delete (discrete purchase-order records, not
  a catalog, same as the cost version had). The old `import_cost_orders` Sheet tab from the
  scrapped cost version may still exist (empty, harmless) — nothing reads/writes it.
  **Bigger idea discussed but not built:** a LINE-based arrival **status confirmation**
  flow — photograph the goods-receiving bill in the same LINE bot already used for leave
  requests, boss taps ตรง/ไม่ตรง in-chat (no web page needed for the confirm step, mirrors
  the HR leave-approval LINE flow). A visual mockup of this was built and shared with the
  owner 2026-07-24 to explain the flow before deciding whether to build it for real. If
  revisited: Google Drive photo storage via the service account was ruled out (owner's
  Google account is a free personal Gmail — service accounts have zero Drive storage quota
  on non-Workspace accounts, uploads would fail) — a GitHub repo (public, random
  unguessable filenames, same risk posture as the already-link-public Sheet) was proposed
  as the free-tier-safe alternative for photo storage instead, not yet confirmed/built.
- **`Inventory.jsx`** + **`StockMovement.jsx`** (2026-07-21) — real stock tracking, Sheets-
  backed via `sheet-tools.js?op=inventory` (`_lib/inventory.js`). **Tracks at real SKU
  level (`sku`), NOT `deriveGroup` product-family** — M/L/color variants are physically
  separate stock, unlike the sales-analytics grouping used by Products/Claims/Dashboard.
  Modeled on the owner's existing manual Excel workflow (`Safety UP177` sheet = current
  balance + safety-stock/reorder status; monthly `เบิกของ<เดือน>`/`ของเข้า<เดือน>` sheets =
  day-by-day in/out log) but collapsed into one live system: `inventory_items` holds
  `opening_balance` per SKU, `stock_movements` is an append-only event log (type
  in/out/adjust, signed qty), and current balance = `opening_balance + Σmovements`,
  computed fresh on every request — never stored, so it can't drift the way the Excel's
  cross-sheet formula chain could. No auto-deduction from `raw_orders` yet (owner
  decision, 2026-07-21) — every movement is entered manually, matching current behavior.
  Packaging/consumables (the Excel's `Something` sheet — stickers, boxes) intentionally
  out of scope, phase 2. **Still open:** seed `inventory_items.opening_balance` from the
  owner's 96-row `Safety UP177` sheet — those rows only have product *names*, need
  matching to `master_sku` via `product_aliases` (same alias-matching pattern as claims
  import) before the real starting balances can be loaded; not done yet.

**`SOPs` menu item still has NO implementation** — falls through to the generic
"กำลังจัดเตรียมโครงสร้างคลังข้อมูล" placeholder in `App.jsx`. Real sidebar entry, zero
backing code. Lower priority (see TODO #9).

### Backend — `api/` (9/12 files, 3 free — see architecture note above)
- `dashboard.js` — Executive daily view (`requireAuth`)
- `monthly.js` — monthly sales by store (`requireAuth`)
- `products.js` / `product-trends.js` — product-family aggregation + MoM trends (`requireAuth`)
- `import-orders.js` (`?view=log|mapping-options|map-product|validate-dates` + POST map→alias-match→dedup→route to `raw_orders_YYYY_MM` + log; DELETE by import batch) (`requireDev` — dev-only, this is the destructive one). Now also resolves `province` on import — direct column or postal-code fallback via `ZIP_TO_PROVINCE`, see TODO #12.
- `planner-sales.js` — ABC classification + sales average over a `?days=N` window (default 90; Inventory/Stock Movement/Planner Control all call `?days=30` as of 2026-07-25), 6h in-memory cache per `days` value (`requireAuth`). Decomposes Set/bundle SKU sales into real component demand via `set_recipes` sheet, and resolves renamed SKUs via `sku_redirects` — both now Sheets-backed through `_lib/skuMapping.js`, see TODO #7 sub-note and Files section
- `marketing.js` (`?kind=events|inputs|basket` — multiplexes `_lib/marketingEvents.js` / `_lib/marketingInputs.js` / `_lib/marketingBasket.js`, each with its own `requireManager`/`canManageMarketing`)
- `sheet-tools.js` (`?op=summary|sheet|append|overwrite|workforce|planner|hr|inventory|import-tracking|cfo|demographic|line-webhook`) — the biggest file; HR, workforce/OT, planner CRUD, generic sheet tools, CFO, Demographic, and the LINE webhook all live here to stay under the function cap. `line-webhook` op is unauthenticated (verified via LINE signature instead, see `_lib/line.js`); it and a `&cron=low-stock`/`holiday-reminder` mode (Vercel Cron) both bypass `requireAuth` by design. `op=inventory` (added 2026-07-21) delegates to `_lib/inventory.js` — `stock` role has full access, `staff` also now sees Inventory/Stock Movement (in `STAFF_TABS`). `op=import-tracking` (added 2026-07-24) delegates to `_lib/importTracking.js` — **DEV-ONLY since 2026-09-01** (was dev+boss). `op=cfo` → `_lib/cfo.js`, `op=demographic` → `_lib/demographic.js`, `op=fulfillment` → `_lib/fulfillment.js` (added 2026-09-02) — all three **DEV-ONLY** (see the role note near the top of this doc + TODO #14/#15)
- `auth.js` — login/setup/create-user/list-users/delete-user (deliberately NOT behind `requireAuth` — it IS the auth entrypoint)
- `_lib/`: `sheets.js` (Sheets client), `auth.js` (HMAC token issuing + guards), `productGroup.js` (see below), `inventory.js` (stock items + movements, see Files section above), `marketingEvents.js` + `marketingInputs.js` + `marketingBasket.js` (marketing impls), `cfo.js` (CFO Dashboard backing, see Files section), `demographic.js` (province-level sales summary), `skuMapping.js` (`sku_redirects` + `set_recipes` lookups, see Data section), `zipToProvince.js` (955-entry Thai postal-code→province table, sourced from `kongvut/thai-province-data`, used only as a fallback for Lazada rows whose export masks buyer address but leaves postal code readable), `provinceNormalize.js` (merges the 3 platforms' province spellings — prefix/suffix strip, bilingual cells, EN→TH aliases — used at read time by `demographic.js`), `shippingClass.js` (parses the Shopee `ตัวเลือกการจัดส่ง` label; `isFastShopeeOption` for the per-product view), `packagingOrderRules.js` (box-packaging rule engine used by Inventory's packaging/BOM logic), `dates.js` (date normalization), `line.js` (LINE Messaging API), `leaveCoverage.js` + `scheduleOverrides.js` (HR/workforce logic), `importTracking.js` (Import Tracking backing)
- `shared/roles.js` — role constants + tab access rules, imported by both frontend (`App.jsx`) and backend (`sheet-tools.js`)

`api/_lib/productGroup.js` — **the ONE reusable product-family grouping util.**
`deriveGroup(displayName, masterSku, overrideMap)` → `{ key, label }`: strips size **and
color** tokens that stand alone (space-separated) from display_name — sizes (M/L/XL,
ไซส์/เบอร์/ขนาด X, trailing `(...)`) and colors (ดำ/ขาว/ฟ้า/… + English). Honors a manual
`product_group` override column in `product_aliases` if present. Used by `products.js`,
`product-trends.js`, and `dashboard.js`. Verified on real data: PY006 "2in1 M" + PY007
"2in1 L" → "ถุงเท้าเจล 2in1"; PY015–018 "แผ่นรองเท้า M/L ดำ/ฟ้า" → one "แผ่นรองเท้า" (4
SKUs), while "แผ่นรองเท้า Heavy" stays separate. **Limitation:** colors glued to a word
without a space (e.g. "สลิปเปอร์ฟ้า" vs "สลิปเปอร์ขาว") are NOT auto-stripped — use a
`product_group` override.

## Status & how to deploy

Local git initialized and committed (user `monalll13`). Deploy status (push to GitHub /
Vercel, env vars) — verify current state with the owner, this drifts. See `README.md`.
Real service-account key backup: `MONA\hide\sales-dashboard-497407-*.json`.

## Security

`.env` / `backend/.env` are gitignored and contain a real Google **private key** — never
commit secrets, always verify before `git add`. The Sheet is currently link-public
readable (owner should turn that off — the service account already has access).

**API auth — per-user login:** every `api/*.js` handler starts with
`if (!requireAuth(req, res)) return` (or `requireDev`/`requireManager` for
role-restricted ones) — `api/_lib/auth.js`. Auth = HMAC-signed tokens (no session
store); users live in the `users` sheet tab (scrypt-hashed passwords), issued by
`api/auth.js` (`?action=status` / POST `login` / `setup` [first-run creates admin] /
`create-user` [admin/dev only]). `api/auth.js` is deliberately NOT behind `requireAuth`.
**No `AUTH_SECRET` env set = auth disabled** (local-dev default; local `.env`
deliberately has none). On Vercel the owner MUST set `AUTH_SECRET`, otherwise
write/delete endpoints let anyone touch the Sheet. Frontend: `src/main.jsx` wraps
`window.fetch` (attaches localStorage `payi-api-token`, clears+reloads on 401) and gates
the app behind `src/pages/Login.jsx` when `status.enabled`. Logout = user chip
top-right. New endpoints must keep an auth guard as the first handler line, and must
piggyback an existing `api/*.js` file (see function-cap note above) rather than adding
a new one.

## TODO / roadmap (agreed with owner)

1. Push to GitHub + deploy to Vercel (needs owner auth) — verify current status.
2. ✅ **DONE — Product-family grouping** (`api/_lib/productGroup.js`), reused across
   products/trends/claims/dashboard/manager-claims. Open item: owner can add
   `product_group` overrides in `product_aliases` for cases auto-strip can't catch
   (colors glued to the word, or totally different names for the same product).
3. ✅ **DONE, then REMOVED — Claims mobile manager view.** Was `ManagerClaimsPrototype.jsx`
   + `api/manager-claims.js` (real data, claim rate = claims ÷ units via shared
   `deriveGroup`, RuRu mascot mood auto from alert count, small-sample guard
   `MIN_UNITS = 100`, thresholds `RED = 1.0`/`AMBER = 0.2` confirmed correct by owner
   2026-07-22). **Claims was removed entirely from mona-ops** (commit `8d2bf9e`) —
   `claims.js`, `claims-import.js`, `manager-claims.js`, `ClaimView.jsx`,
   `ManagerClaimsPrototype.jsx`, and their `_lib` support (`claimMapping.js`/
   `claimImport.js`/`claimsSchema.js`) are all gone; fully moved to **payi-floor**
   (see the `app-portfolio-plan` note — payi-floor is แตง's live app). No trace left in
   `src/`/`api/` except historical comments citing the old `claims` sheet as a schema
   precedent, and a stale `test/claims.test.js` that should eventually be deleted too.
4. ✅ **DONE — Dashboard IA split** — `Dashboard สรุปยอดขาย` (Executive/Monthly) and
   `Dashboard สินค้า` (Products/ProductTrends) are both live, separate top-level menu
   items.
5. **Ads + TikTok channel data** — ✅ has a home now (`AdsChannels.jsx` +
   `marketing_inputs` sheet, manual entry). Verify with owner whether manual entry is
   still acceptable long-term or should pull from a platform export.
6. ✅ **REMOVED (2026-07-21)** — Off-Platform Sales (`SalesView.jsx`) was
   localStorage-only and never migrated to Sheets. Owner decided to delete the page
   entirely rather than migrate it (page, menu item, fetch-trigger condition all
   removed). If off-platform sales tracking is wanted again later, build it fresh
   Sheets-backed from the start rather than reviving the old localStorage version.
7. ✅ **DONE (2026-07-21) — Inventory / Stock Movement**, first version.
   `Inventory.jsx` + `StockMovement.jsx` + `sheet-tools.js?op=inventory` (`_lib/inventory.js`,
   `inventory_items` + `stock_movements` sheets) — see Files section for full detail.
   **Correction from the original plan:** stock is keyed by real **SKU** (`sku` field),
   NOT `api/_lib/productGroup.js`'s `deriveGroup` family grouping — M/L/color variants
   are physically separate stock counts, unlike the sales-analytics rollup Products/Claims
   use. `deriveGroup` was the wrong tool here; don't reuse it for inventory quantities.
   Modeled on the owner's real Excel workflow (`Safety UP177` + monthly `เบิกของ`/`ของเข้า`
   sheets) — see Files section for the mapping. No auto-deduction from sales (owner
   decision). ✅ **Seeded with real opening balances (2026-07-21)** — 70 `inventory_items`
   rows, matched from the owner's `Safety UP177` list to `master_sku` via `product_aliases`
   (owner confirmed the ambiguous ones by hand — including one correction: เฝือกโป้ง is
   **PY050** ผ้ารัดหัวแม่เท้าเอียง, not PY033; PY033 is พยุงเท้า/Night Splint only). Notes
   for future edits:
   - ✅ **DONE (2026-07-22) — split the color/size-combined SKUs into real separate rows.**
     Owner's actual stock sheet tracks color/size as separate line items even when they'd
     nominally share one `master_sku`, so `deriveGroup`-style combining was wrong for
     inventory counting. Split using the owner's original per-variant quantities (no data
     loss, zero real `stock_movements` existed against any combined row): **PY066**
     (ถุงเท้าดับกลิ่น ดำ) → added **PY066-B** (ขาว), **PY066-C** (ฟ้าเบบี้บลู); **PY073**
     (กันรองเท้ากัด/หลวม ดำ) → added **PY073-B** (เนื้อ); **PY051** (Sky/Ocean line) → split
     into 10 rows **PY051, PY051-B .. PY051-J** (5 Sky sizes + 5 Ocean sizes) — owner said
     reusing the same base SKU with suffixes is fine, don't need distinct new codes. `-B`/
     `-C`/etc suffix convention was already established by `PY047`/`PY047-B`.
   - ✅ **DONE (2026-07-22) — ZZ004-ZZ009 created + added to `product_aliases`.** Owner
     confirmed: it's fine that these duplicate display names already used by
     `PY055`/`PY056`/`ZZ003` under different codes — **ZZ prefix means discontinued/
     no-longer-sold**, a deliberately separate catalog identity from the historically-sold
     SKU even when the product name is the same. `ZZ004` ไม้ดัดเท้า, `ZZ005` สมุนไพรแช่เท้า,
     `ZZ006` ถุงมือรองรีดผ้า, `ZZ007/008/009` Mirott สูตรเย็น/สูตรร้อน/ออริจินอล (opening
     balance 0 for all three — no quantity data ever existed for Mirott, blank in the
     original pasted stock list). All 9 + `PY076` now show up on Products/Claims/
     Dashboard via `product_aliases` (business=Payi, platform=Shopee placeholder alias).
   - **Gotcha:** `appendRows` to `product_aliases` intermittently landed with the last 4
     columns blank on the very next read (once for a single-row append; a later 6-row
     append was fine) — cause not fully root-caused, suspect a transient Sheets API/cache
     timing issue rather than a real code bug. **Always verify with a fresh GET right after
     any append to `product_aliases`** (or any large shared sheet) and repair via
     read-modify-write if it happened, same as done here — don't assume the API response
     saying `ok:true` means the data landed correctly.
   - ✅ **DONE (2026-07-22) — sales/ABC fallback for the self-split color/size SKUs.**
     `PY066-B/-C`, `PY073-B`, `PY051-B..J` have no direct sales match — `raw_orders` was
     never split by color/size for these, only the base `master_sku` (e.g. `PY066`) was
     ever recorded, so `planner-sales.js` has nothing to look up under the suffixed code.
     `Inventory.jsx` now falls back: when a SKU has no direct match but its base (sku with
     the trailing `-X` stripped) does, it splits the base's `dailyAverage`/`units90`
     across every sibling in that base group proportionally by current `balance` share
     (equal split if all balances are 0). This is a real product with real sales, but a
     **statistical estimate, not a true per-color breakdown** — the ABC badge shows a `≈`
     prefix (with a tooltip) on every row using an estimated number, so it's visibly
     different from a direct match. `ZZ004-ZZ009` and `PY076` still correctly show no
     data (genuinely no sales — discontinued or never sold under that code), which is
     expected and not a bug.
   - ✅ **DONE (2026-07-22) — Set-product sales decomposition (`set_recipes` sheet).**
     `product_aliases` has real Set/bundle SKUs (`PY067` [Set สุดคุ้ม], `PY069`
     [Set ลดปวดเท้า], `PY071` [Set นิ้วโป้งเท้า 24 ชม.]) that sell in real volume (PY067 was
     ABC-**A**, 1,548 units/90d) but aren't physical stock items themselves — before this,
     their sales were completely invisible to the real component SKUs' ABC/dailyAverage,
     understating true demand badly (e.g. `PY036` มาตรฐาน went from ABC-A/no-recommendation
     to correctly showing "ใกล้หมด" + a real +5,138 recommended order once counted).
     `planner-sales.js` now reads a new `set_recipes` sheet (`set_sku`, `variation_name`,
     `component_sku`, `qty_per_unit`) and widened its `raw_orders` read from `J:N` to
     `I:N` to also pull `variation_name` (needed because **the component breakdown
     depends on which variation was ordered**, not just the set SKU — e.g. PY067's
     `variation_name` encodes both shape ("วงรี"/"มาตรฐาน"/...) and pack size ("Set 10/20/30
     ชิ้น"), plus a mixed "Set จัดให้" variation that's an actual multi-component recipe
     scaled ×1/×2/×3 by size). When an order row's `(set_sku, variation_name)` matches a
     `set_recipes` entry, that row is replaced with its decomposed component rows (qty ×
     `qty_per_unit`) before aggregation — the Set SKU itself then correctly drops out of
     `items` (it's not a real stocked thing). Unmatched variations silently keep counting
     under the raw Set SKU (safe fallback — no data loss, just not decomposed yet).
     **Only `PY067` has recipes seeded so far** (30 rows, verified against real
     `variation_name` values pulled live from `raw_orders_2026_07` before seeding — do
     that verification step again for any new set, exact-string matching is unforgiving).
     ✅ **DONE (2026-07-22) — `PY069`/`PY071` recipes added too** (8 rows, same
     verify-against-real-`variation_name`-first approach): `PY069` [Set ลดปวดเท้า] →
     ครีมนวดเท้า/PY027, ลูกกลิ้งนวดเท้า/PY028, or both combined; `PY071` [Set นิ้วโป้งเท้า
     24 ชม.] → ซิลิโคนคั่นนิ้วโป้ง/PY043, ผ้ารัดหัวแม่เท้า/PY050, or both combined. All 3
     known Set SKUs now fully decomposed (38 `set_recipes` rows total).
   - ✅ **DONE (2026-07-22) — Set SKUs now keep their own sales too, not just decompose.**
     Owner clarified: a real Set (PY067/069/071) needs its **own** ABC/sales tracked (to
     know if the Set itself sells well) *in addition to* feeding component demand for
     production/ordering ("บ้านล่าง" feed planning) — the original design silently dropped
     the Set's own entry once decomposed, which was wrong. `set_recipes` gained a 5th
     column `keep_set_sales` (blank/`1` = also keep the Set's own row, default — matches
     PY067/069/071; `0` = fully redirect, no self-tracking) so this is configurable per
     recipe row without a code change.
   - ✅ **DONE (2026-07-22) — SKU_REDIRECTS + fixed a real catalog mixup found via SKU
     audit.** Two issues surfaced while spot-checking: (1) `PY065` (ถุงเท้าสปาสีชมพู,
     588 real units/90d) had **zero** rows in `product_aliases` despite selling — turned
     out **`PY041` was already the correct, long-established code** for this exact
     product (6 real alias rows across Shopee/TikTok/Lazada/Outlet/Claims) — `PY065` was
     a stray duplicate code from some import. Renamed the `inventory_items` row to
     `PY041` (zero real `stock_movements` existed, safe) and added a small
     `SKU_REDIRECTS = { PY065: 'PY041' }` map in `planner-sales.js` so historical *and*
     future `raw_orders` rows still tagged `PY065` by Shopee/TikTok keep counting under
     `PY041` — renaming in our system doesn't change what the platforms send us, so this
     redirect is required for the rename to actually work, not just cosmetic. (2) `PY075`
     (บอลเทาปุ่ม) had a **second, unrelated product mixed into the same `master_sku`** in
     `product_aliases`: `[Set คลายเส้น]` — actually เก้าอี้มหัศจรรย์ (`PY026`) sold in
     Standard/Set Pro/Premium quantity tiers (1/2/3 chairs, Set Pro & Premium also bundle
     in `PY028` ลูกกลิ้งนวดเท้า and `PY027` ครีมนวดเท้า) — contaminating both PY075's and
     PY026's real sales numbers. Fixed via the same `set_recipes` mechanism (6 rows,
     `keep_set_sales=0` since this isn't a real Set line, just a mislabeled listing) —
     verified live: PY075 dropped 124→52 units/90d (real ball-only sales), PY026 gained
     the redirected chair units (1923→1995). ✅ **DONE (undated) — `SKU_REDIRECTS` moved
     off the hardcoded map into a real `sku_redirects` Sheets tab** (`old_sku, new_sku,
     note, created_at`), read via the new shared `api/_lib/skuMapping.js`
     (`getSkuRedirectMap()` / `resolveRedirect()` / `resolveSalesSku()`, also shared with
     `set_recipes` lookup) — renames no longer require a code deploy.
   - ✅ **DONE (2026-07-22) — `product_aliases` catalog cleanup**, safe/cosmetic only:
     fixed a stray typo duplicate (`PY047` had one row spelled "ผ้านุุ่่ม" with doubled
     combining vowel marks — merged to the correct "ผ้านุ่ม" spelling); relabeled the 3
     `PY075` "[Set คลายเส้น]" rows' `display_name` to make clear they're the mislabeled
     เก้าอี้มหัศจรรย์ listing, not real บอลเทาปุ่ม variants. **Deliberately did NOT touch
     `master_sku` or `alias_key` on either fix** — `import-orders.js` resolves master_sku
     for new imports by matching `alias_key` exactly (see `aliasByKey` in that file);
     changing or deleting those fields would silently orphan future orders of that exact
     listing (master_sku would come back blank on import). Only `display_name` is safe to
     edit freely.
   - Decor/gift items from the pasted stock list (ถุงทอง, นกยูงเรซิ่น, เรือสำเภาทองเรซิ่น,
     ปลามังกรเรซิ่น, ม้าทองเรซิ่น, ต้นไทร, เรซิ่นกระทิง) were **deliberately excluded** —
     owner confirmed they belong to the กรอบรูป shop, out of scope here.
   - `safety_stock` is `0` for all 69 seeded items (no reorder-point data was provided) —
     owner should set real thresholds per item via the Inventory page's edit action.
   - ✅ **DONE (2026-07-21) — reorder tracking + auto safety-stock formula**, matching the
     owner's real Excel workflow (`Safety UP177` columns G–N). `inventory_items` gained
     (appended at the end, per the header-order lesson below): `reorder_date`,
     `expected_arrival` (manual — "did we already order this, when's it landing", shown
     as a small note under the status badge), `lead_time_production`, `lead_time_transport`,
     `ship_freight` (boolean). When lead time is filled in on the edit modal, `safety_stock`
     auto-fills via `dailyAvg × (leadTimeTotal + leadTimeTotal/2 if ship_freight)` — the
     owner's sea-freight rows get an extra 50% buffer since boat lead times are long/variable
     (ROP is folded into this single SS number, no separate ROP field). Still fully editable
     after auto-fill, doesn't lock. `dailyAvg` comes from `/api/planner-sales`, joined
     client-side in `Inventory.jsx` (same pattern as the ABC join in `StockMovement.jsx`).
     Also added a **"แนะนำสั่งซื้อ"** column (Inventory table), shown only for non-"ปกติ"
     rows: `recommended_order = max(0, safety_stock − (balance − dailyAvg × leadTimeTotal))`.
     **Gotcha hit while building this:** first attempt inserted the 3 new lead-time columns
     into the MIDDLE of `ITEMS_HEADERS` — corrupted all 70 existing rows (data stayed at old
     column positions, header row didn't) until repaired from the known-good seed data.
     Same rule as `claims.js`: **always append new columns at the end, never insert mid-sheet.**
   - ✅ **DONE (2026-07-21) — Inventory table now applies the formula live**, not just
     inside the edit modal. `Inventory.jsx` builds one `enriched` array (items ×
     `/api/planner-sales`) so the table, sort, filter, and edit modal all read the same
     numbers — no separate calculation paths to drift apart. Specifically: the "ขั้นต่ำ"
     cell shows `effectiveSafety` (computed value when lead time is set, else the stored
     manual one) marked "(สูตร)" when it differs from what's saved, and is itself a button
     that opens the edit modal (server-side `safety_stock` only updates on actual save —
     the table never silently overwrites the sheet). Row order is ABC asc, then `units90`
     desc (ties broken by name) — same ABC source as `StockMovement.jsx`. Added a "เฉพาะที่
     แนะนำสั่ง" checkbox that filters to rows with `recommendedOrder > 0`.
   - ✅ **DONE (2026-07-21) — status/recommended-order use the live formula, not just the
     saved number.** Found right after shipping the above: the status badge and
     "แนะนำสั่งซื้อ" trigger were still reading the server's `status` field, which is
     computed server-side from the *stored* `safety_stock` only — so an item could show
     an auto-computed "ขั้นต่ำ" of e.g. 1,985 while still displaying "ปกติ" and no
     recommendation, because the sheet's saved `safety_stock` was still 0. `Inventory.jsx`
     now computes its own `effectiveStatus` (mirrors the server's `statusOf`, but fed
     `effectiveSafety`) client-side, and both the badge and the KPI "Low Stock" count use
     that instead. Dropped the "(สูตร)" label text (redundant once the number itself is
     just always the live one).
   - ✅ **DONE (2026-07-21) — hide/show items.** Some seeded rows aren't real
     stock-tracked SKUs (owner spotted them by eye). `active` was already a soft-delete
     flag in the schema (`truthyActive`/`upsertItem` already supported it) but had no UI.
     `op=inventory&view=items&includeHidden=1` now always returns everything including
     inactive rows (with an `active` boolean per item); `Inventory.jsx` filters that down
     to active-only by default and adds a "แสดงสินค้าที่ซ่อนไว้" checkbox to reveal +
     restore hidden ones. Hiding is just `upsert-item {sku, active:false}` — fully
     reversible, never a real delete.
   - ✅ **DONE (2026-07-21) — reorder popup + polish.** `reorder_date` moved out of the
     main edit modal into its own small `ReorderModal` (opened from the "วันเติมสินค้า/
     รอเช็ค" cell) — added `reorder_qty` and `reorder_note` alongside it (appended at the
     end of `ITEMS_HEADERS`, same append-only rule) since the owner needs to log how much
     was ordered and any note, not just the date. Empty cell shows nothing (no placeholder
     text). ABC letter renders green when `ship_freight` is true. Swapped column order so
     "แนะนำสั่งซื้อ" comes before "วันเติมสินค้า/รอเช็ค", and gave it its own color
     (`#c2410c`) distinct from the ขั้นต่ำ column's mint auto-calc highlight.
   - ✅ **DONE (2026-07-21) — lead time + ship_freight backfilled for real** on all 70
     seeded items, read straight from the owner's `Safety UP177` file (columns J/K for
     lead_time_production/transport) via openpyxl. The `ship_freight` flag came from
     reading cell **fill color** on column A ("เขียว=leadtime เรือ" — theme color 9 =
     sea-freight rows) rather than any cell value, since that's how the owner's original
     sheet actually encodes it. Without this the "แนะนำสั่งซื้อ" column was empty for
     every real item (no lead time = formula has nothing to compute from) — this is why
     it looked broken. **Also found and wiped a data-integrity bug while fixing this:**
     `reorder_date`/`expected_arrival` had the exact same bogus timestamp duplicated
     across 69/70 rows (an artifact from earlier test-and-reset cycles this session, not
     real owner data — never chase the root cause further than confirming stock
     quantities were untouched; just clear it and move on).
   - ✅ **DONE (2026-07-22) — balance correction (stock-take reconciliation).** New
     "ปรับยอดคงเหลือ" icon button (`ClipboardCheck`) on each Inventory row opens
     `BalanceCorrectionModal` — owner enters the actual counted quantity, the modal shows
     the delta live, and on save it posts the existing `add-movement` action with
     `type: 'adjust'` (no schema/backend change needed). This means every correction is
     already a separate, visible entry in Stock Movement history (satisfies "บันทึกแยก
     ประวัติการแก้ไข") rather than silently overwriting `opening_balance`. Auto-generated
     note (`ปรับยอดจากนับสต็อกจริง (เดิม X → Y)`) if the owner leaves the note blank.
   - ✅ **DONE (2026-07-22) — fixed two UI bugs the owner flagged with screenshots:**
     (1) "แสดงสินค้าที่ซ่อนไว้" checkbox was showing ALL items (hidden + active) when
     checked instead of hidden-only — filter logic was `showHidden || it.active`, fixed to
     `showHidden ? !it.active : it.active`. (2) ขั้นต่ำ (safety stock) button color used to
     change after editing (auto-computed vs stored-value styling) — owner wanted it to stay
     visually consistent; dropped the conditional color, now always
     `var(--payi-text-muted)`.
   - ✅ **DONE (2026-07-22) — consolidated balance correction + reorder tracking into the
     single edit popup, per owner feedback that the row's icon toolbar had gotten too
     crowded** (`+`/`−`/ปรับยอดคงเหลือ/แก้ไข/ซ่อน — 5 icons). Removed the standalone
     `ปรับยอดคงเหลือ` icon and `BalanceCorrectionModal`, and the standalone
     `ReorderModal` (opened from the "วันเติมสินค้า/รอเช็ค" table cell) — both are now
     sections inside `ItemModal` (the same popup opened by the pencil "แก้ไข" icon and by
     clicking that table cell). Row toolbar is back to 4 icons. `ItemModal`'s `submit()`
     now bundles an optional `balanceCorrection` object into its payload;
     `saveItem()` in `Inventory.jsx` does the `upsert-item` call first, then a second
     `add-movement` (`type: 'adjust'`) call if a correction was entered — still two
     separate API calls under the hood, just one form for the owner. Also **changed
     `reorder_date` from a date picker to a free-text field** (owner: orders often ship
     in multiple partial lots, a single date can't represent that) — renamed the label to
     match the table column ("วันเติมสินค้า/รอเช็ค") and dropped the separate
     `expected_arrival` date field it used to show (was a second, mostly-empty date
     concept the owner never asked to keep). **Backend change to match:**
     `api/_lib/inventory.js` `upsertItem()` used to run `reorder_date` through `isoDate()`
     — a free-text string like "สั่งแล้ว 2 ล็อต รออีก 300" isn't parseable as a date, so
     `isoDate()` silently returned `''` and the whole field appeared to "not save" (it
     saved a blank string). Fixed to store `reorder_date` as a trimmed raw string, no date
     parsing. Confirmed via direct API test post-fix. `expected_arrival`/`reorder_qty`/
     `reorder_note` columns still exist in the sheet (harmless, just unused by the UI now)
     — didn't remove them since `ITEMS_HEADERS` is append-only positional, not worth a
     migration for 3 dead columns.
   - **Found while testing the above (2026-07-22): 10 inventory items were already
     hidden (`active:'0'`) in the live sheet without the owner asking for it** — `ZZ002,
     PY025, PY026, ZZ004–ZZ009, PY034`, all sharing `updated_at` timestamps clustered in a
     ~2-minute window (`08:53:45`–`08:55:39` UTC same day), almost certainly an accidental
     bulk action from earlier in this session rather than 10 deliberate individual hides.
     Notably **PY026 (เก้าอี้มหัศจรรย์) has a live recommended-order alert** — being hidden
     meant the owner wouldn't have seen it. Restored all 10 to `active:true` and verified.
     Root cause of the "restore script looked like it failed" confusion while fixing this:
     **not a bug** — rapid-fire sequential `upsert-item` POSTs (each does a full
     read-modify-write of the whole sheet) can return `success:true` before the Sheets API
     write is queryable back, so an immediate verification GET can read stale data. Adding
     a ~400ms delay between writes and waiting ~1.5s before verifying fixed it. Same
     underlying pattern as the earlier `appendRows`-to-`product_aliases` blank-columns
     gotcha — treat immediate-read-after-write on Sheets as eventually consistent, not
     synchronous, for any bulk operation.
   - ✅ **DONE (2026-07-28) — of-goods-arrival "แจ้งของเข้า → Match" queue**, owner's real
     workflow: พี่หยกลงวันที่/รายการ/จำนวน on paper → goods arrive, photo posted to a LINE
     group (that part stays outside the app, owner explicitly said "ไม่ต้องผ่านไลน์" — no
     LINE bot integration) → ฟ้า (the `stock` role) logs the arrival in the web app (sku,
     arrival date, count date, qty) → it shows as pending until พี่หยก/พี่แต้ว (`boss` role)
     match-confirms it, which is what actually creates the real `stock_movements` (type
     `in`) row and moves the balance. New `stock_in_requests` sheet
     (`api/_lib/inventory.js`: `id, sku, arrival_date, count_date, qty, note, status,
     created_by, created_at, matched_by, matched_at, movement_id`, `ensureSheet`-created,
     same append-only-headers rule as the rest of this file) holds pending/matched/rejected
     rows — a pending row has **zero effect on balance** until matched, so a wrong or
     duplicate arrival report never silently corrupts stock. `op=inventory` gained
     `view=stock-in-requests` (GET) and 3 actions: `create-stock-in-request` (any logged-in
     role — this is the point, ฟ้า/staff can report without needing boss/dev access),
     `match-stock-in-request` (creates the real movement, boss/dev only via
     `canManageOperations`, qty editable at match time in case the physical count differs
     from what was first reported), `reject-stock-in-request` (boss/dev only). **Gotcha hit
     while building this:** the manager-only check inside `inventory.js` used
     `canManageOperations(role)` unconditionally, but local dev has no `AUTH_SECRET` (auth
     disabled) so `req.user` is `undefined` and `role` came through as `undefined` →
     `normalizeRole` defaults that to `staff` → match got rejected for the owner's own dev
     session. Fixed to only enforce when `authEnabled()` is true, same short-circuit
     pattern every other role guard in this codebase already uses (e.g.
     `requireAdmin`/`requireScheduleEditor` in `sheet-tools.js`) — don't gate on
     `canManageOperations(role)` alone in a new endpoint, always pair it with
     `authEnabled() &&`. UI: `StockMovement.jsx` gained a "แจ้งของเข้า" button (anyone) and
     a "ของเข้ารอ Match" panel showing pending requests, with Match/ปฏิเสธ buttons visible
     only to `isBoss` (same `!authEnabled || canManageOperations(currentUser?.role)` pattern
     `WorkforceOT.jsx` already uses for its own boss-gated actions). Verified live end-to-end
     against the real Sheet (create → match → real movement appeared with correct balance
     delta); the test row's effect was reverted with a compensating `adjust` movement
     afterward, same manual-cleanup pattern as the "revert test correction" row already
     visible in `stock_movements` history from an earlier session.
   - ✅ **DONE (2026-07-28) — blind-count order tracking.** Owner clarified the intent
     behind the queue: once ฟ้า reports an arrival, **boss must match it himself, and ฟ้า
     must not see how much was ordered in advance** — otherwise she'd just confirm the
     expected number instead of doing a genuine physical count. First cut put the qty
     field on the Inventory edit modal, but owner asked to split it into its own button
     instead (**"แยกปุ่ม สั่งของ กับ แจ้งของเข้า เป็นสองฝั่ง"**) — `StockMovement.jsx` now has
     a dedicated boss/dev-only **"สั่งของ"** button (`OrderRequestModal`, sku+qty+note only)
     next to the existing "แจ้งของเข้า" one; the Inventory-edit-modal qty field was removed.
     Submitting it calls `createOrderRequest` in `api/_lib/inventory.js`, which
     creates/updates a `stock_in_requests` row with `arrival_date`/`count_date` left blank
     (matches an existing sku+order-only row instead of duplicating if ordered again before
     the first lot arrives). `loadStockInRequests` computes
     `order_only: !arrival_date` per row and **filters those out entirely for non-manager
     roles** (`authEnabled() && !canManageOperations(role)`) — enforced server-side, not
     just hidden in the UI, since the whole point is staff/stock literally cannot see the
     number even via direct API call. Boss/dev see these in a separate "สั่งไว้ รอของเข้า"
     panel in `StockMovement.jsx` (edit/cancel only, no Match button — there's nothing to
     match yet). `matchStockInRequest` now also hard-rejects matching any row with no
     `arrival_date` ("ยังไม่มีคนแจ้งรับของจริง") so a boss can't accidentally match his own
     order-placeholder row instead of a real arrival report. ฟ้า's own "แจ้งของเข้า" flow is
     unchanged — she still creates her own independent row with her own blind-counted qty;
     the two rows are never auto-linked (deliberately — auto-filling one from the other
     would leak the ordered number back to her through the edit form). `editStockInRequest`
     was widened to also allow editing `status: 'pending'` rows (previously rejected-only),
     but gated: editing an order-only row (no `arrival_date`) requires
     `canManageOperations`, same as match/reject — editing a real arrival report (has
     `arrival_date`, whether pending or rejected) stays open to whoever filed it. Order-only
     rows also get a **"เสร็จสิ้น"** button (`finishOrderRequest`, boss/dev only) to close
     them out once the lot has actually arrived and been matched through the normal
     ฟ้า-reports → boss-matches flow — sets `status: 'done'` without creating a second
     `stock_movements` row (the real qty already landed through that separate flow; this
     is purely closing the order-tracking placeholder so it drops off the queue).
   - ✅ **DONE (2026-07-28) — multi-lot ordering + FIFO match pairing.** Owner flagged two
     gaps in the above: (1) `createOrderRequest` used to find-and-overwrite any existing
     pending order-only row for the same SKU instead of creating a new one — ordering a
     second lot before the first arrived silently destroyed the first lot's qty/note.
     Fixed to always `appendRows` a new row, same as `addStockInRequest` already did —
     multiple open "สั่งของ" lots per SKU now coexist correctly. (2) boss had no way to
     see which order-lot an arrival report corresponds to without manually cross-checking
     — `loadStockInRequests` now computes, for every pending arrival row, an
     `available_orders` array: all pending order-only rows for that SKU sorted oldest-first
     (FIFO — "สั่งก่อนจับคู่กับที่แจ้งก่อน"), gated the same as `order_only` itself (only
     attached when `!authEnabled() || canManageOperations(role)` — never leaks the ordered
     qty to non-manager roles). `MatchRequestModal` (`StockMovement.jsx`) shows this as a
     dropdown (FIFO-oldest pre-selected as a suggestion, not a lock — boss can pick a
     different lot, or "ไม่ผูกลอต" if lots got swapped or there's no matching order at all)
     with a live mismatch warning when the selected lot's qty differs from what's being
     counted in. Confirmed explicitly by owner: ฟ้า can file an arrival report even when
     no order-request exists yet for that SKU — matching a lot is optional, never required.
     One Match click now does both: creates the real `stock_movements` row AND (if a lot
     was selected) closes that order-request as matched — no more separate "เสร็จสิ้น" step.
     `STOCK_IN_REQUESTS_HEADERS` gained `linked_order_id` (append-only, records which lot
     an arrival was matched against, for history). `matchStockInRequest` takes an optional
     `order_request_id`, validates it's a pending order-only row for the same SKU, and
     updates both rows in the same sheet write. **Verified live end-to-end** (order 2 lots
     same SKU → confirmed both persist separately → filed arrival → Match modal showed
     both lots FIFO-ordered with lot 1 pre-selected → cleaned up all test rows after).
     **Hit the same eventually-consistent-Sheets gotcha again while cleaning up test
     data**: two `delete-stock-in-request` calls fired concurrently (parallel `Promise.all`)
     both read-modified-wrote the same sheet snapshot, so one delete silently got lost
     (classic lost-update race, not a code bug in the endpoint itself) — resolved by
     retrying the single missing delete sequentially. Any future bulk cleanup script
     against `stock_in_requests` (or other shared sheets) should serialize writes, not
     fire them in parallel.
   - ✅ **DONE (2026-07-28) — order date on "สั่งของ".** `OrderRequestModal` gained a date
     input (defaults to today, editable) — before this the only timestamp was
     `created_at`, not owner-settable, so backdating an order already placed (or noting
     a date different from when the boss got around to entering it) wasn't possible.
     New `order_date` column (append-only, end of `STOCK_IN_REQUESTS_HEADERS`) stored via
     `createOrderRequest`/`editStockInRequest`, shown in the "สั่งไว้ รอของเข้า" list and in
     the FIFO lot picker inside `MatchRequestModal`. Old rows created before this column
     existed show `-` (blank order_date), expected — not backfilled.
   - ✅ **DONE (undocumented until now, found 2026-08-21) — full LINE bot flow for
     "สั่งของ" and "แจ้งของเข้า" already exists**, built later than the notes above and
     never written up here — this whole doc previously said the LINE-based arrival idea
     was "discussed but not built"; that's stale. Real behavior in `api/sheet-tools.js`
     (`opLineWebhook`, same bot/webhook as HR leave approval, ~line 299 onward):
     **"สั่งของ"** — boss/dev only (`findManagerLink` + `notify_stock` checkbox gate) —
     type "สั่งของ" or tap "สั่ง" on a low-stock alert card, search/pick items (supports
     multi-line batch like "sky 35-36 = 10"), quantities, pick a date, confirms as a
     `stock_in_requests` order-only row (mirrors the web `OrderRequestModal`/
     `createOrderRequest`, same `stock_order_sessions` cart pattern). **"แจ้งของเข้า"** —
     open to **any** LINE-linked staff (`resolveArrivalReporter`, not gated to boss/dev),
     mirrors the same cart/search/qty/date flow into `stock_in_sessions`, lands as a
     pending `stock_in_requests` row via `addStockInRequest` (identical end state to the
     web "แจ้งของเข้า" button — still requires boss to Match from the web, still
     blind-count safe: the reporter never sees the ordered qty). A generic
     "ของเข้ารอตรวจ/รายการที่สั่งไว้/เช็คของ/แก้ไขของเข้า" menu and an approve-from-LINE
     flow (with FIFO lot matching) exist too. **Practical implication:** ฟ้า does not
     need any web form to report goods arrival — she already does it via LINE chat today.
     If Inventory/Stock Movement ever move to a different app (e.g. payi-floor), only the
     boss-side web "Match" UI needs to exist there — the arrival-reporting step is already
     covered by LINE and doesn't need porting.
8. ✅ **REMOVED (2026-07-21)** — "PAYI Brain" AI Assistant tab was fake (canned
   if/else replies, no LLM call). Owner decided to delete rather than keep a
   fake-AI page (`AIAssistantView` function, menu item, icon mapping, ternary branch
   all removed from `App.jsx`). **If revisited:** per-user/per-role AI IS feasible —
   scope the system prompt and visible data by the caller's role (`dev`/`boss`/`staff`,
   `shared/roles.js`), mirroring how sidebar tab visibility is already gated. Would need
   a real LLM API call (mind Vercel Hobby timeout + cost) — not built, no page exists
   to extend.
9. `SOPs` menu tab still has no implementation (same generic placeholder Inventory/Stock
   Movement used to hit) — lower priority, but flag if the owner asks about it.
10. ✅ **DONE (2026-07-22) — mobile-responsive pass across the whole app**, owner request
    ("ทั้งแอพ"). Nav shell first: sidebar is locked permanently expanded on desktop (owner
    asked to stop the old hover-to-expand behavior — see `sidebarExpanded` in `App.jsx`,
    now a constant `true` not state).
    - **v1 (superseded same day)**: mobile got an off-canvas drawer (sidebar slid in from a
      hamburger button). Its open/close was driven by inline `transform` tied to
      `isMobileViewport`/`mobileNavOpen` state rather than a CSS class + transition — a
      plain CSS transition on that property got stuck mid-animation in this testing
      environment (computed style never reached its target despite correct class/
      specificity). Then a **second bug** in the same v1: the backdrop's `z-index` was
      *higher* than the drawer's on mobile because a CSS `!important` media-query rule
      wasn't reliably overriding the sidebar's inline `zIndex:20` — the backdrop sat on
      top and every menu tap was silently swallowed. Owner caught this live ("กด side bar
      แล้ว มีอะไรมาบัง กดไม่ได้").
    - ✅ **v2 (current, 2026-07-22) — replaced the drawer entirely with a bottom tab bar**,
      owner request: "เอา side bar มาทำเป็นเมนู แท็ปข้างล่างทำเหมือนแอพธนาคาร" (reference:
      soft rounded glassmorphic banking-app UI). Given the two v1 bugs both traced back to
      **trusting CSS `!important` to override inline styles / trigger transitions
      reliably in this environment**, v2 avoids that pattern entirely: which nav renders
      (desktop `.payi-sidebar-nav` vs mobile `.payi-bottom-tabbar`) is decided by a plain
      JS conditional (`{!isMobileViewport && <sidebar/>}` / `{isMobileViewport &&
      <tabbar/>}`) driven by the existing `window.innerWidth` resize-listener state — CSS
      in `theme.css` is pure styling only now, no show/hide `!important` fights possible.
      **New mobile-only chrome:**
      - `.payi-bottom-tabbar` — floating frosted-glass pill (`backdrop-filter: blur`,
        translucent white, rounded, soft shadow) fixed to the bottom, 4 curated most-used
        tabs (`MOBILE_TAB_CANDIDATES` in `App.jsx`: หน้าหลัก/สต็อก/เคลม/แพลน, filtered by
        `canAccessTab` per role same as the sidebar) + a 5th "เมนู" button. Active tab gets
        a mint→green gradient pill behind its icon (`.payi-bottom-tab-icon.active`).
      - "เมนู" opens `.payi-more-sheet` — a bottom sheet (slide-up animation) listing the
        *full* `visibleMenuGroups` (same data/grouping as the desktop sidebar, so nothing
        is unreachable on mobile), backdrop-tap or item-tap to close.
      - `.payi-main-content` gets `padding-bottom: 108px` on mobile so page content clears
        the floating tab bar.
      - Page header (`pageMeta` eyebrow/title/subtitle) gets a soft rounded gradient card
        on mobile only (`isMobileViewport` ternary inline, not CSS) — mint→green gradient,
        white text, matching the banking-app reference look. Desktop header unchanged.
        Search/notification/user-chip row deliberately left in its normal white style
        below the gradient card (not restyled) to avoid a large risky diff re-theming
        every child element for contrast.
      Owner explicitly scoped this as "เท่าที่ปรับได้ไม่พัง" (as much polish as fits
      without breaking things) — did **not** attempt a full glassmorphic re-theme of every
      page's internal cards/tables, just the nav chrome + header, which was the concrete
      ask.
    New shared CSS classes in `theme.css` for the common two-column/KPI-grid layout pattern
    used across pages — collapse at `860px`/`560px`:
    - `app-kpi-grid` — any fixed `repeat(N, ...)` grid (KPI cards, form fields, etc.)
    - `app-two-col-fixed` — `content + fixed-px-sidebar` layouts (charts, Links Hub)
    - `app-side-drawer` — right-side slide-in panels, caps to `100vw` at `<=560px`
    Applied page-by-page, verified at 375px viewport (no page-level horizontal overflow,
    all real data renders) for every real page in the app:
    - Dashboard (`Executive`/`Monthly`), Products (`Dashboard สินค้า`/`% เปลี่ยนแปลง`)
    - Inventory + Stock Movement (mostly already safe — `table-layout:fixed` + colgroup +
      `overflowX:auto` + modals capped at 92vw already; just added table minWidths)
    - **Claims — found and fixed a real bug**, not just a squeeze: the SKU detail panel's
      claim-records table had `overflowX: 'visible'` (not `'auto'`) with
      `tableLayout:'fixed'` and no `minWidth` — on narrow screens this genuinely mangled
      the columns illegibly instead of scrolling. Also two hardcoded fixed-column KPI/
      reason grids collapsed via `app-kpi-grid`.
    - Marketing Radar (hero + aside 340px-fixed layout, Event History fixed-5-col rows —
      Kanban board itself deliberately left horizontally scrollable, same UX as a mobile
      Trello board) + Ads & Channels
    - Planner Control + Feed Products — already fine (`.planner-kpis`/`.planner-form-grid`
      classes from an earlier session were already wired up and working)
    - Workforce OT (`.workforce-kpis`/`.workforce-form-grid` already wired from an earlier
      session) + HR — already fine, no changes needed
    - Upload, Settings, Dev Hub — already fine (auto-fit grids / scrollable tables)
    - **Links Hub — found real overflow bugs**: add-link form, 6-col "Core Modules" grid,
      main-content+336px-aside split, and the 3-col link grid all used `minmax(150–230px,
      1fr)` with no upper collapse, forcing horizontal scroll on phones. Fixed with the
      shared classes above.
    - `ContentOSPrototype.jsx` (explicitly a non-functional UI prototype, see its own note
      above) has dense fixed grids too but no *hard* overflow bug at 375px since its
      tracks mostly use `minmax(0, ...)` (shrinks instead of forcing scroll) — deliberately
      left as-is given its prototype status, not worth a deep pass on unused UI.
      `ManagerClaimsPrototype.jsx` and `HRMobile.jsx` are separate mobile-only routes
      (reached via URL query param, not the sidebar) — already mobile-first by design,
      out of scope for this pass.
11. **NOT STARTED — LINE claim intake for เกด.** Idea only, agreed 2026-08-21, not built.
    Real current process: customer sends a claim message (name/address/phone/reason,
    screenshot from a marketplace chat), staff screenshots it and forwards into an
    internal LINE group as a record — never enters `claims` sheet automatically. Owner
    considered a LINE-bot parse flow (like the "สั่งของ"/"แจ้งของเข้า" bot flows already
    live, see Inventory section) but decided against it — wants a **separate lightweight
    web page for เกด instead** (own "1 person 1 web" site, not part of payi-floor/แตง's
    app): a form (product/reason/qty, maybe customer info) that POSTs straight to the
    existing `create-claim` action and lands in Claims history immediately. Owner
    explicitly asked to keep this **as light as possible — a single static HTML file, no
    React/Vite/build step, no new scaffolded project** — just fetch() to mona-ops's
    existing claim-create endpoint (needs CORS opened for whatever origin hosts it).
    Deferred — owner said "โน๊ตไว้ก่อน" (note it, don't build yet).

12. ✅ **DONE (2026-08-25/26) — Demographic dashboard (เดโมกราฟฟิกลูกค้า) + province
    backfill fix.** New `DemographicDashboard.jsx` (`sheet-tools.js?op=demographic`,
    `_lib/demographic.js`) shows province-level sales, gated `canManageMarketing`.
    **Root cause fixed while building it:** `province` had been empty on all 240k+
    historical `raw_orders` rows — `Upload.jsx`'s client-side xlsx column filter
    (`RELEVANT_HEADER_HINTS`) was silently stripping province/postal-code columns before
    they ever reached `import-orders.js`. Fixed by adding `province`,
    `shippingpostcode`, `postal code`, `ไปรษณีย์`, `zip`, `zipcode` to the hint list.
    `import-orders.js` now also falls back to guessing province from postal code via a
    new 955-entry `ZIP_TO_PROVINCE` table (`api/_lib/zipToProvince.js`, sourced from
    `kongvut/thai-province-data`) when no direct province column exists — needed
    specifically for **Lazada**, whose export masks buyer city/name (`ค*a`) but leaves
    the postal code readable. `province` appended as a new column at the end of
    `raw_orders` (append-only rule, per the claims/inventory precedent). Only covers
    orders imported *after* this fix, plus any historical Lazada rows re-derivable from
    postal code — older Shopee/TikTok rows with no province column and no postal code
    stay blank, not backfilled.
13. ✅ **DONE (undated, found 2026-08-26) — CFO Dashboard.** `CfoDashboard.jsx` +
    `sheet-tools.js?op=cfo` (`_lib/cfo.js`), gated `canManageFinance` (dev/boss/finance —
    the `finance` role is scoped to พี่หยก/พี่แต้ว, `FINANCE_TABS = ['CFO']` only). Tracks
    `cfo_capital` (capital injections: id/date/amount/note) and `cfo_fixcost` (recurring
    fixed costs: id/item/amount/active) sheets. `summary` view computes
    `latestCapital`, `fixCostMonthly`, `avgRevenue`, `avgAdsSpend` (from
    `marketing_inputs`, last 3 closed months), `burnRate = fixCostMonthly + avgAdsSpend −
    avgRevenue`, `runwayMonths`, `cashTrend`, `capitalHistory`. New top-level sidebar
    group "การเงิน" (finance) holds just this one tab.
14. ✅ **DONE (2026-09-01) — shipping-type + repeat-customer analytics + DEV-only lockdown.**
    - `raw_orders` gained 3 trailing columns: **`shipping_option`** (T — Shopee
      "ตัวเลือกการจัดส่ง" / Lazada `deliveryType` / TikTok "Delivery Option", raw),
      **`fulfillment_type`** (U — TikTok "Fulfillment Type", the rest blank),
      **`buyer_hash`** (V — sha256 of the buyer username + a code pepper, first 16 hex;
      **never the raw name** — the Sheet has been link-public). No backfill; owner
      decided to only re-import August onward ("ต้องอัพอยู่แล้ว") + future months.
    - `import-orders.js` DELETE path `A:R`→`A:Z` (was silently dropping province on any
      import-batch delete).
    - `DemographicDashboard.jsx` (still `op=demographic`) gained 3 cards: Shopee
      delivery-option breakdown, "สินค้าไหนลูกค้ารีบ" (% fast per `deriveGroup` family),
      and per-platform repeat-customer rate. `_lib/shippingClass.js` +
      `_lib/provinceNormalize.js` are new. Province names now normalized at read time
      (merges "จังหวัดนนทบุรี"/"นนทบุรี"/"Nonthaburi").
    - **CFO / Demographic / Import Tracking are now DEV-ONLY** (owner request). Non-dev
      roles still see the sidebar entry but get `DevOnlyLock` in `App.jsx` — a fake
      "โมดูล ... กำลังจัดเตรียมโครงสร้างคลังข้อมูล" placeholder, deliberately identical to
      an unbuilt tab. Endpoints 403 for non-dev too. `canManageFinance` /
      `canManageMarketing` no longer gate any op (kept in `shared/roles.js` for the tab
      whitelists + tests).
    - Still open: `SPX Express`-style carrier-only values are folded to "ไม่ระบุประเภท"
      via a hardcoded `CARRIER_ONLY` set in `shippingClass.js` — extend it if new couriers
      show up. Coverage of the shipping/buyer columns climbs only as new months import.
15. ✅ **DONE (2026-09-02) — Fulfillment analysis tab** (`Fulfillment.jsx` +
    `sheet-tools.js?op=fulfillment` → `_lib/fulfillment.js`, `fulfillment_config` sheet,
    DEV-ONLY, new sidebar item in the "การเงิน" group). Answers "เมื่อไหร่ถึงจังหวะย้ายงาน
    แพ็คเข้า Fulfillment (FBS)". Key framing (from owner): packing labour (4 staff × ฿400,
    OT ฿50/hr) is a **fixed cost** — moving to FBS saves nothing until volume outgrows the
    team; and high express/instant % is a reason to **keep** a product self-packed (FBS
    can't do same-day), not move it; FBS stockout is safe (orders fall back to self-pack);
    FBS restock is monthly. **`?range=all|N|YYYY-MM`** (default `3` = last 3 complete
    months) scopes capacity/fbsUsage/byProduct/otAudit/fbsRetention; prepWindow + weekday
    + campaign always pool all months. A **summary row** of 3–4 status tiles (green/orange/
    red dot + label + one-line conclusion) sits under the range selector, above a
    "รายละเอียด" divider — each tile just surfaces the verdict a detail card below already
    computed (FBS move / finish-time ceiling / FBS-cost / next campaign day). Cards:
    (a) verdict hold/watch/act — plain capacity read, the campaign warning stays in its
    own card (owner asked); (b) **month-over-month
    capacity** — a bar per month of the team's projected finish time; `orders_per_person_hour`
    is calibrated = last complete month's avg orders/day ÷ headcount ÷ normal work hours,
    ceiling line at `max_finish`, growth = least-squares slope on complete months,
    months-to-ceiling from that slope. Deliberately NOT a rolling-14-day window — that was
    fragile to import timing and unverifiable by the owner. (b2) campaign-day model — the
    order multiplier on each N.N date (day===month: 9.9/11.11/12.12) vs the surrounding
    normal days, predicts the next one's volume (median of the last 4 real campaign days —
    excludes the 1.1 New-Year dip) and finish time; on real data 9.9 lands the team ~22:00.
    (c) weekday load (peak weekday = the real constraint); (d) FBS restock-day recommender (lightest 4-day window of the
    month) + per-candidate send units (~1 month of standard-delivery demand); (e)
    FBS-vs-retention observation (repeat rate of buyers who ever got FBS vs self-only,
    Shopee/`buyer_hash` — carries an explicit "frequent buyers land in the FBS group
    mechanically" bias warning); (f) current FBS usage % + monthly trend (Shopee only —
    TikTok `fulfillment_type` came back empty in the exports); (g) per-`deriveGroup` FBS
    candidate/keep-self scoring (fast <20% + standard/FBS ≥55% = candidate; fast ≥25% =
    keep self); (h) monthly OT hours/฿ — **not** tied to order volume: owner says OT is
    mostly FG feeding / repackaging (pack orders → 1h break → feed goods till end of shift),
    so it scales with FG prep not parcels; overlays `planner_daily.planned_feed` per month
    when present; (i) **marginal-cost break-even** — ฿/order for "OT ต่อไป"
    (`ot_rate_per_hour` ÷ calibrated oph), a 5th hire, and FBS (`fbs_fee_per_piece` × avg
    pieces/order for Shopee standard orders), live "try a fee" input, folded into the
    verdict. The 5th-hire figure credits the OT it removes (owner's point — a new hire
    does the FG feeding in normal hours so OT drops): `(daily_wage × workdays_per_month −
    last month's OT cost × hire_ot_offset_pct) ÷ added monthly packing capacity`. On real
    data the 5th hire lands ~฿0.9/order (cheaper than OT), and FBS at any realistic fee
    loses to both — the card says so and points to the operational reasons for FBS. FBS
    fee fields are 0 for now (owner: FBS free until ~Oct 2026, rate unknown). No new
    `api/*.js` file (piggybacks `sheet-tools.js`, still 9/12). **Open to dev + boss +
    finance** as of 2026-09-02 (was DEV-only) — `FINANCE_TABS` gained `Fulfillment`, the
    `op=fulfillment` guard and `App.jsx` render allow those three roles. Every card (and
    the verdict) has a click-to-open ⓘ tooltip spelling out how its numbers are derived.

## Gotchas

- The preview screenshot tool often times out on chart-heavy (Recharts) pages — that's a
  tooling limitation, not an app bug. Verify via DOM/`preview_eval` + `preview_logs`.
- First `/api/dashboard` / `/api/monthly` / `/api/products` call reads all raw_orders
  (~5–12s); `vercel.json` sets `maxDuration: 60`.
- `vite.config.js` honors `process.env.PORT` (strictPort) so the preview harness can bind the
  dev server to its assigned port. Without a PORT env, dev picks 5173 as before.
- `api/` is at 9/12 of the Hobby cap (3 free after Claims removal) — still piggyback
  existing files via query params rather than adding a new `api/*.js` file casually; see
  the architecture note at the top of this doc.
