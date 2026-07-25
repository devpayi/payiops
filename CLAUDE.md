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
- **⚠️ Vercel Hobby caps 12 serverless functions — we are AT the cap (12/12 files in
  `api/`).** Any new feature (e.g. inventory/stock) MUST piggyback an existing file via
  a new query param + a new `api/_lib/*.js` impl — do NOT add a new `api/*.js` file
  without first retiring one. `sheet-tools.js` (`op=`) and `marketing.js` (`kind=`) are
  the established multiplexing pattern to copy.
- **File uploads parse xlsx CLIENT-SIDE** (via the `xlsx` dep) and POST JSON — never
  multipart. Deliberate so imports work on serverless.
- **Dev**: `npm run dev` runs Vite AND serves `/api/*` locally (middleware in
  `vite.config.js`). Requires root `.env`. `npm run build` to check compile.
- **Role-based access** (`shared/roles.js`): roles are `dev` / `boss` / `staff`
  (`admin` is a legacy alias, normalized to `dev`). `STAFF_TABS` whitelist gates what a
  `staff` login can see in the sidebar; `boss` sees everything except `Import Orders`,
  `Dev Hub`, `Settings`. Server-side guards mirror this: `requireAuth` (any logged-in
  user), `requireDev` (dev only — used by `import-orders.js`), `requireManager`
  (dev+boss — used by `manager-claims.js`, marketing endpoints).

## Data (Google Sheets: "mona-ops-db", SHEET_ID in .env)

**Sales/product tabs**: `raw_orders_2026_MM` (~190k order rows), `claims`,
`product_aliases`, `import_log`, `users`. Businesses: **Payi**, **Payi Outlet**,
**กรอบรูป**. Platforms: **Shopee**, **TikTok Shop**, **Lazada**.

`raw_orders` columns (A–R): order_key, order_id, order_item_id, date, platform, business,
sku_platform, product_name, variation_name, master_sku, display_name, qty, revenue,
order_status, imported_at, source_file, import_id, alias_key.
`claims` columns: date, business, product_name, free_item, claim_value, is_damaged,
is_incomplete, is_wrong_item, note, master_sku, display_name, imported_at, import_id,
**id, source_file** (appended later — never insert mid-schema, older rows are
column-position dependent; `id` backfilled lazily on first load for pre-existing rows).
`product_aliases`: master_sku, display_name, business, platform, alias_product_name,
alias_variation, alias_key, created_at (+ optional `product_group` override column).
`users`: scrypt-hashed passwords, `role` column (dev/boss/staff/admin-legacy).

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
derivable from `raw_orders`).

Conventions: **exclude cancelled orders** (`order_status` contains "ยกเลิก"/"cancel");
aggregate server-side and set `Cache-Control` s-maxage / in-memory cache
(`cacheable()`, since per-user auth forces `no-store` on the HTTP layer) so we don't hit
Sheets rate limits.

## Files

### Frontend — `src/pages/` (wired to real Sheets backend unless noted)
- `MonthlyDashboard.jsx` (sales by store, MoM, platform donut, trend — tab `Dashboard สรุปยอดขาย`)
- `ProductDashboard.jsx` + `ProductTrends.jsx` (product-family dashboard + MoM trends — tab `Dashboard สินค้า`)
- `Upload.jsx` → used inside `Import Orders` tab (import orders, dev-only)
- `ClaimView.jsx` (claims, desktop) / `ManagerClaimsPrototype.jsx` (claims, mobile manager view — real data since 2026-07-04, see roadmap below)
- `MarketingRadar.jsx` (marketing action log + event tracking)
- `AdsChannels.jsx` (manual Ads spend / TikTok channel entry + monthly sales overlay)
- `PlannerControl.jsx` + `FeedProducts.jsx` (demand planning: ABC, FG tracking, recommended feed)
- `WorkforceOT.jsx` (manpower & OT scheduling)
- `HR.jsx` / `HRMobile.jsx` (leave requests/approvals, LINE-bot-integrated)
- `LinksHub.jsx`, `DevHub.jsx` (static link/doc hubs — real content, no backend)
- `Login.jsx`, `Settings.jsx` (auth screens, user management)
- **`ContentOSPrototype.jsx`** ("Content OS Prototype") — **UI-only prototype, no API
  calls, no backend.** Not usable yet.
- **`PackingView.jsx`** — dead/unused; Packing was removed from the sidebar permanently
  (commit `fee17e7`). Do not wire it up without checking with the owner first.

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

### Backend — `api/` (12/12 files, at the Vercel Hobby cap)
- `dashboard.js` — Executive daily view (`requireAuth`)
- `monthly.js` — monthly sales by store (`requireAuth`)
- `products.js` / `product-trends.js` — product-family aggregation + MoM trends (`requireAuth`)
- `claims.js` (`?view=summary|monthly|sku|by-product|imports-list|import[DELETE]`) (`requireAuth`)
- `claims-import.js` — POST parsed xlsx into `claims` (`requireAuth`)
- `import-orders.js` (`?view=log` + POST map→alias-match→dedup→route to `raw_orders_YYYY_MM` + log; DELETE by import batch) (`requireDev` — dev-only, this is the destructive one)
- `manager-claims.js` — mobile manager claim-rate view (`requireManager`)
- `planner-sales.js` — ABC classification + sales average over a `?days=N` window (default 90; Inventory/Stock Movement/Planner Control all call `?days=30` as of 2026-07-25), 6h in-memory cache per `days` value (`requireAuth`). Decomposes Set/bundle SKU sales into real component demand via `set_recipes` sheet — see Files section
- `marketing.js` (`?kind=events|inputs` — multiplexes `_lib/marketingEvents.js` / `_lib/marketingInputs.js`, each with its own `requireManager`)
- `sheet-tools.js` (`?op=summary|sheet|append|overwrite|workforce|planner|hr|inventory|import-tracking|line-webhook`) — the biggest file; HR, workforce/OT, planner CRUD, generic sheet tools, and the LINE webhook all live here to stay under the function cap. `line-webhook` op is unauthenticated (verified via LINE signature instead, see `_lib/line.js`). `op=inventory` (added 2026-07-21) delegates to `_lib/inventory.js` — not in the staff op-whitelist (`summary`/`workforce`/`planner`), so Inventory/Stock Movement are dev+boss only for now, same as it's currently absent from `STAFF_TABS`. `op=import-tracking` (added 2026-07-24) delegates to `_lib/importTracking.js` — same dev+boss-only gating, see Files section
- `auth.js` — login/setup/create-user/list-users/delete-user (deliberately NOT behind `requireAuth` — it IS the auth entrypoint)
- `_lib/`: `sheets.js` (Sheets client), `auth.js` (HMAC token issuing + guards), `productGroup.js` (see below), `inventory.js` (stock items + movements, see Files section above), `claimMapping.js` + `claimImport.js` + `claimsSchema.js` (claims import support), `marketingEvents.js` + `marketingInputs.js` (marketing impls), `dates.js` (date normalization), `line.js` (LINE Messaging API), `leaveCoverage.js` + `scheduleOverrides.js` (HR/workforce logic)
- `shared/roles.js` — role constants + tab access rules, imported by both frontend (`App.jsx`) and backend (`sheet-tools.js`)

`api/_lib/productGroup.js` — **the ONE reusable product-family grouping util.**
`deriveGroup(displayName, masterSku, overrideMap)` → `{ key, label }`: strips size **and
color** tokens that stand alone (space-separated) from display_name — sizes (M/L/XL,
ไซส์/เบอร์/ขนาด X, trailing `(...)`) and colors (ดำ/ขาว/ฟ้า/… + English). Honors a manual
`product_group` override column in `product_aliases` if present. Used by `products.js`,
`product-trends.js`, `claims.js?view=by-product`, `dashboard.js`, and
`manager-claims.js`. Verified on real data: PY006 "2in1 M" + PY007 "2in1 L" → "ถุงเท้าเจล
2in1"; PY015–018 "แผ่นรองเท้า M/L ดำ/ฟ้า" → one "แผ่นรองเท้า" (4 SKUs), while "แผ่นรองเท้า
Heavy" stays separate. **Limitation:** colors glued to a word without a space (e.g.
"สลิปเปอร์ฟ้า" vs "สลิปเปอร์ขาว") are NOT auto-stripped — use a `product_group` override.

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
3. ✅ **DONE — Claims mobile manager view** (`ManagerClaimsPrototype.jsx` +
   `api/manager-claims.js`, real data, claim rate = claims ÷ units via shared
   `deriveGroup`, RuRu mascot mood auto from alert count, small-sample guard
   `MIN_UNITS = 100`). ✅ Thresholds (`RED = 1.0`, `AMBER = 0.2`) **confirmed correct by
   owner (2026-07-22)**.
   Open: period selector (currently all-time), drill-down to actual claim records.
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
     the redirected chair units (1923→1995). **`SKU_REDIRECTS` is a hardcoded map for now
     (one entry)** — fine at this scale, but if renames become frequent, move it to a
     Sheets tab like `set_recipes` instead of requiring a code deploy per rename.
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

## Gotchas

- The preview screenshot tool often times out on chart-heavy (Recharts) pages — that's a
  tooling limitation, not an app bug. Verify via DOM/`preview_eval` + `preview_logs`.
- First `/api/dashboard` / `/api/monthly` / `/api/products` call reads all raw_orders
  (~5–12s); `vercel.json` sets `maxDuration: 60`.
- `vite.config.js` honors `process.env.PORT` (strictPort) so the preview harness can bind the
  dev server to its assigned port. Without a PORT env, dev picks 5173 as before.
- `api/` is at the 12-function Hobby cap — check this section's "12/12" note before ever
  proposing a new `api/*.js` file.
