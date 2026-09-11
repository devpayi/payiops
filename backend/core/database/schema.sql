-- Complete step 1 SQL. Generated from bootstrap.sql and migrations/0001_initial.sql. Run once on a new dedicated database.
-- Run once as a database administrator against a NEW, DEDICATED database.
-- No application login or password is created here. Provision credentials in
-- your secret manager and grant cmo_runtime to the application's login role.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cmo_owner') THEN
    CREATE ROLE cmo_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cmo_runtime') THEN
    CREATE ROLE cmo_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('cmo_owner','cmo_runtime')
             AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolcanlogin)) THEN
    RAISE EXCEPTION 'Unsafe pre-existing cmo database role configuration';
  END IF;
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Bangkok');
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO cmo_runtime, cmo_owner', current_database());
END $$;
ALTER ROLE cmo_runtime SET timezone TO 'Asia/Bangkok';
ALTER ROLE cmo_owner SET timezone TO 'Asia/Bangkok';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
CREATE SCHEMA app AUTHORIZATION cmo_owner;
GRANT USAGE ON SCHEMA app TO cmo_runtime;
COMMIT;

-- PostgreSQL 17+. Apply once after bootstrap.sql as an administrator able to
-- SET ROLE cmo_owner. All tenant data, including jobs and integration state,
-- lives in app. Amounts are THB; foreign-currency events must be rejected.
BEGIN;
SET LOCAL ROLE cmo_owner;
SET LOCAL timezone = 'Asia/Bangkok';
SET LOCAL search_path = app, pg_catalog, public;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION app.current_company_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;

CREATE TABLE app.companies (
  company_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  legal_name text NOT NULL CHECK (btrim(legal_name) <> ''),
  tax_id text,
  timezone text NOT NULL DEFAULT 'Asia/Bangkok' CHECK (timezone = 'Asia/Bangkok'),
  base_currency text NOT NULL DEFAULT 'THB' CHECK (base_currency = 'THB'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Tenant-local identity: the same verified IdP identity can belong to multiple
-- companies. Authenticate externally, then check membership before SET LOCAL.
CREATE TABLE app.users (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  auth_issuer text NOT NULL CHECK (btrim(auth_issuer) <> ''),
  auth_subject text NOT NULL CHECK (btrim(auth_subject) <> ''),
  email text NOT NULL CHECK (email = lower(email) AND email LIKE '%@%'),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED','ACTIVE','DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id),
  UNIQUE (company_id,auth_issuer,auth_subject),
  UNIQUE (company_id,email)
);
CREATE TABLE app.roles (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,code)
);
CREATE TABLE app.permissions (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_.]*$'),
  description text NOT NULL,
  PRIMARY KEY (company_id,id), UNIQUE (company_id,code)
);
CREATE TABLE app.role_permissions (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL,
  PRIMARY KEY (company_id,role_id,permission_id),
  FOREIGN KEY (company_id,role_id) REFERENCES app.roles(company_id,id),
  FOREIGN KEY (company_id,permission_id) REFERENCES app.permissions(company_id,id)
);
CREATE TABLE app.user_roles (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,user_id,role_id),
  FOREIGN KEY (company_id,user_id) REFERENCES app.users(company_id,id),
  FOREIGN KEY (company_id,role_id) REFERENCES app.roles(company_id,id),
  FOREIGN KEY (company_id,granted_by) REFERENCES app.users(company_id,id)
);

CREATE TABLE app.products (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sku text NOT NULL,
  slug text NOT NULL CHECK (btrim(slug) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text NOT NULL DEFAULT '',
  seo_title text,
  seo_description text,
  unit text NOT NULL DEFAULT 'ชิ้น',
  price_ex_vat numeric(20,2) NOT NULL CHECK (price_ex_vat >= 0 AND price_ex_vat <> 'NaN'),
  is_published boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,sku), UNIQUE (company_id,slug)
);
CREATE TABLE app.product_costs (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  valid_during tstzrange GENERATED ALWAYS AS (tstzrange(valid_from,valid_to,'[)')) STORED,
  unit_cost numeric(20,6) NOT NULL CHECK (unit_cost >= 0 AND unit_cost <> 'NaN'),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id),
  UNIQUE (company_id,id,product_id),
  FOREIGN KEY (company_id,product_id) REFERENCES app.products(company_id,id),
  FOREIGN KEY (company_id,created_by) REFERENCES app.users(company_id,id),
  CHECK (isfinite(valid_from) AND (valid_to IS NULL OR (isfinite(valid_to) AND valid_to > valid_from))),
  EXCLUDE USING gist (company_id WITH =, product_id WITH =, valid_during WITH &&)
);

CREATE TABLE app.customers (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  email text,
  tax_id text,
  billing_address jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(billing_address) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id)
);
CREATE TABLE app.orders (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_number text NOT NULL,
  customer_id uuid,
  source text NOT NULL,
  external_order_id text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED','RECOGNIZED','CANCELLED')),
  ordered_at timestamptz NOT NULL DEFAULT now(),
  recognized_at timestamptz,
  recognition_date date GENERATED ALWAYS AS ((recognized_at AT TIME ZONE 'Asia/Bangkok')::date) STORED,
  currency text NOT NULL DEFAULT 'THB' CHECK (currency = 'THB'),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,order_number),
  UNIQUE (company_id,source,external_order_id),
  FOREIGN KEY (company_id,customer_id) REFERENCES app.customers(company_id,id),
  FOREIGN KEY (company_id,created_by) REFERENCES app.users(company_id,id),
  CHECK ((status = 'RECOGNIZED') = (recognized_at IS NOT NULL))
);
CREATE TABLE app.order_items (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  product_id uuid NOT NULL,
  description text NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0 AND quantity <> 'NaN'),
  unit_price_ex_vat numeric(20,6) NOT NULL CHECK (unit_price_ex_vat >= 0 AND unit_price_ex_vat <> 'NaN'),
  discount_ex_vat numeric(20,2) NOT NULL DEFAULT 0 CHECK (discount_ex_vat >= 0 AND discount_ex_vat <> 'NaN'),
  net_amount numeric(20,2) GENERATED ALWAYS AS (round(quantity * unit_price_ex_vat,2) - discount_ex_vat) STORED,
  vat_amount numeric(20,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0 AND vat_amount <> 'NaN'),
  cost_version_id uuid,
  unit_cost_snapshot numeric(20,6) CHECK (unit_cost_snapshot >= 0 AND unit_cost_snapshot <> 'NaN'),
  cogs_amount numeric(20,2) GENERATED ALWAYS AS (round(quantity * unit_cost_snapshot,2)) STORED,
  PRIMARY KEY (company_id,id), UNIQUE (company_id,order_id,line_number),
  FOREIGN KEY (company_id,order_id) REFERENCES app.orders(company_id,id),
  FOREIGN KEY (company_id,product_id) REFERENCES app.products(company_id,id),
  FOREIGN KEY (company_id,cost_version_id,product_id) REFERENCES app.product_costs(company_id,id,product_id),
  CHECK (discount_ex_vat <= round(quantity * unit_price_ex_vat,2)),
  CHECK ((cost_version_id IS NULL) = (unit_cost_snapshot IS NULL))
);

CREATE TABLE app.marketing_campaigns (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('META','TIKTOK','OTHER')),
  external_account_id text NOT NULL,
  external_campaign_id text NOT NULL,
  name text NOT NULL,
  starts_on date,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id),
  UNIQUE (company_id,platform,external_account_id,external_campaign_id),
  CHECK (ends_on IS NULL OR (starts_on IS NOT NULL AND ends_on >= starts_on))
);
CREATE TABLE app.fixed_costs (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  amount_ex_vat numeric(20,2) NOT NULL CHECK (amount_ex_vat >= 0 AND amount_ex_vat <> 'NaN'),
  frequency text NOT NULL CHECK (frequency IN ('DAILY','MONTHLY','YEARLY')),
  starts_on date NOT NULL,
  ends_on date,
  allocation_method text NOT NULL DEFAULT 'ACTUAL_DAYS' CHECK (allocation_method = 'ACTUAL_DAYS'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id),
  FOREIGN KEY (company_id,created_by) REFERENCES app.users(company_id,id),
  CHECK (ends_on IS NULL OR ends_on > starts_on)
);

-- Double-entry ledger: reporting reads POSTED entries, not a sum of overlapping
-- orders/expenses/ad_spends sources. Settlements have their own journal entries.
CREATE TABLE app.accounts (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  reporting_group text NOT NULL CHECK (reporting_group IN
    ('CASH','RECEIVABLE','INVENTORY','INPUT_VAT','OTHER_ASSET','PAYABLE','OUTPUT_VAT',
     'OTHER_LIABILITY','EQUITY','SALES','SALES_RETURNS','COGS','AD_SPEND','GATEWAY_FEES','FIXED_COST','OTHER_EXPENSE')),
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (company_id,id), UNIQUE (company_id,code),
  CHECK ((account_type = 'ASSET' AND reporting_group IN ('CASH','RECEIVABLE','INVENTORY','INPUT_VAT','OTHER_ASSET'))
    OR (account_type = 'LIABILITY' AND reporting_group IN ('PAYABLE','OUTPUT_VAT','OTHER_LIABILITY'))
    OR (account_type = 'EQUITY' AND reporting_group = 'EQUITY')
    OR (account_type = 'REVENUE' AND reporting_group IN ('SALES','SALES_RETURNS'))
    OR (account_type = 'EXPENSE' AND reporting_group IN ('COGS','AD_SPEND','GATEWAY_FEES','FIXED_COST','OTHER_EXPENSE')))
);
CREATE TABLE app.journal_entries (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entry_number text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN
    ('ORDER','CREDIT_NOTE','EXPENSE','AD_SPEND','PAYMENT','REFUND','GATEWAY_FEE','PROCUREMENT_PAYOUT','MANUAL','REVERSAL')),
  source_id uuid NOT NULL,
  source_event_key text NOT NULL,
  accounting_date date NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
  posted_at timestamptz,
  posted_by uuid,
  reverses_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,entry_number),
  UNIQUE (company_id,source_kind,source_id,source_event_key),
  UNIQUE (company_id,reverses_entry_id),
  FOREIGN KEY (company_id,posted_by) REFERENCES app.users(company_id,id),
  FOREIGN KEY (company_id,reverses_entry_id) REFERENCES app.journal_entries(company_id,id),
  CHECK ((status = 'POSTED') = (posted_at IS NOT NULL)),
  CHECK (reverses_entry_id IS NULL OR reverses_entry_id <> id),
  CHECK ((source_kind = 'REVERSAL') = (reverses_entry_id IS NOT NULL))
);
CREATE TABLE app.journal_lines (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  account_id uuid NOT NULL,
  description text NOT NULL,
  debit numeric(20,2) NOT NULL DEFAULT 0 CHECK (debit >= 0 AND debit <> 'NaN'),
  credit numeric(20,2) NOT NULL DEFAULT 0 CHECK (credit >= 0 AND credit <> 'NaN'),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,journal_entry_id,line_number),
  FOREIGN KEY (company_id,journal_entry_id) REFERENCES app.journal_entries(company_id,id),
  FOREIGN KEY (company_id,account_id) REFERENCES app.accounts(company_id,id),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE TABLE app.ad_spends (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  spend_date date NOT NULL,
  source_timezone text NOT NULL,
  amount_ex_vat numeric(20,2) NOT NULL CHECK (amount_ex_vat >= 0 AND amount_ex_vat <> 'NaN'),
  vat_amount numeric(20,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0 AND vat_amount <> 'NaN'),
  impressions bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,campaign_id,spend_date,revision),
  FOREIGN KEY (company_id,campaign_id) REFERENCES app.marketing_campaigns(company_id,id)
);

CREATE TABLE app.payees (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('EMPLOYEE','SUPPLIER','COURIER')),
  name text NOT NULL,
  user_id uuid,
  payout_destination_ref text,
  -- Opaque reference to encrypted bank details in a vault, never plaintext.
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id),
  FOREIGN KEY (company_id,user_id) REFERENCES app.users(company_id,id),
  CHECK (kind <> 'EMPLOYEE' OR user_id IS NOT NULL)
);
CREATE TABLE app.purchase_requests (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_number text NOT NULL,
  requested_by uuid NOT NULL,
  title text NOT NULL CHECK (btrim(title) <> ''),
  raw_text text,
  shop_url text CHECK (shop_url IS NULL OR shop_url ~ '^https://'),
  suggested_location text CHECK (suggested_location IN ('MARKETPLACE','MAKRO','LOCAL_SHOP','MAIN_HOUSE')),
  confirmed_location text CHECK (confirmed_location IN ('MARKETPLACE','MAKRO','LOCAL_SHOP','MAIN_HOUSE')),
  payment_method text NOT NULL CHECK (payment_method IN ('PREPAID','COD','REIMBURSEMENT','INTERNAL_STOCK')),
  payee_id uuid,
  estimated_amount numeric(20,2) NOT NULL CHECK (estimated_amount >= 0 AND estimated_amount <> 'NaN'),
  actual_amount numeric(20,2) CHECK (actual_amount >= 0 AND actual_amount <> 'NaN'),
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN
    ('SUBMITTED','NEEDS_REVIEW','APPROVED','PURCHASED','PAID','FULFILLED','REJECTED','CANCELLED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  business_date date GENERATED ALWAYS AS ((requested_at AT TIME ZONE 'Asia/Bangkok')::date) STORED,
  needed_on date,
  purchased_at timestamptz,
  paid_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,request_number),
  FOREIGN KEY (company_id,requested_by) REFERENCES app.users(company_id,id),
  FOREIGN KEY (company_id,payee_id) REFERENCES app.payees(company_id,id),
  FOREIGN KEY (company_id,approved_by) REFERENCES app.users(company_id,id),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK (status NOT IN ('APPROVED','PURCHASED','PAID','FULFILLED') OR approved_at IS NOT NULL),
  CHECK ((status = 'PAID') = (paid_at IS NOT NULL)),
  CHECK (status <> 'PAID' OR (actual_amount IS NOT NULL AND payee_id IS NOT NULL AND payment_method <> 'INTERNAL_STOCK')),
  CHECK (status <> 'FULFILLED' OR payment_method = 'INTERNAL_STOCK')
);
CREATE TABLE app.files (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  object_key text NOT NULL CHECK (object_key LIKE company_id::text || '/%'),
  original_name text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  scan_status text NOT NULL DEFAULT 'PENDING' CHECK (scan_status IN ('PENDING','CLEAN','REJECTED')),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,object_key),
  FOREIGN KEY (company_id,uploaded_by) REFERENCES app.users(company_id,id)
);
CREATE TABLE app.purchase_request_files (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  request_id uuid NOT NULL,
  file_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('REFERENCE','CASH_RECEIPT','TRANSFER_PROOF')),
  PRIMARY KEY (company_id,request_id,file_id),
  FOREIGN KEY (company_id,request_id) REFERENCES app.purchase_requests(company_id,id),
  FOREIGN KEY (company_id,file_id) REFERENCES app.files(company_id,id)
);
CREATE TABLE app.product_files (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  product_id uuid NOT NULL,
  file_id uuid NOT NULL,
  alt_text text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  PRIMARY KEY (company_id,product_id,file_id),
  FOREIGN KEY (company_id,product_id) REFERENCES app.products(company_id,id),
  FOREIGN KEY (company_id,file_id) REFERENCES app.files(company_id,id)
);
CREATE TABLE app.procurement_classifications (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  request_version integer NOT NULL CHECK (request_version > 0),
  engine text NOT NULL CHECK (engine IN ('RULES','AI','HUMAN')),
  model text,
  prompt_version text,
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  location text NOT NULL CHECK (location IN ('MARKETPLACE','MAKRO','LOCAL_SHOP','MAIN_HOUSE')),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  explanation text NOT NULL,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id),
  FOREIGN KEY (company_id,request_id) REFERENCES app.purchase_requests(company_id,id),
  FOREIGN KEY (company_id,reviewed_by) REFERENCES app.users(company_id,id),
  CHECK (engine <> 'AI' OR (model IS NOT NULL AND prompt_version IS NOT NULL)),
  CHECK (engine <> 'HUMAN' OR reviewed_by IS NOT NULL)
);

CREATE TABLE app.procurement_batches (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_date date NOT NULL,
  round_number integer NOT NULL DEFAULT 1 CHECK (round_number > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','PROCESSING','PARTIALLY_PAID','PAID','CANCELLED')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,business_date,round_number),
  FOREIGN KEY (company_id,approved_by) REFERENCES app.users(company_id,id),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK (status NOT IN ('APPROVED','PROCESSING','PARTIALLY_PAID','PAID') OR approved_at IS NOT NULL)
);
CREATE TABLE app.procurement_payouts (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  payee_id uuid NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('COD','REIMBURSEMENT','PREPAID')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','PAID','FAILED','CANCELLED')),
  amount numeric(20,2) NOT NULL CHECK (amount > 0 AND amount <> 'NaN'),
  destination_ref_snapshot text NOT NULL,
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_provider text,
  external_transfer_id text,
  transfer_proof_file_id uuid,
  paid_at timestamptz,
  confirmed_by uuid,
  settlement_journal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,idempotency_key),
  UNIQUE (company_id,batch_id,payee_id,payment_method),
  UNIQUE (company_id,payment_provider,external_transfer_id),
  UNIQUE (company_id,settlement_journal_id),
  FOREIGN KEY (company_id,batch_id) REFERENCES app.procurement_batches(company_id,id),
  FOREIGN KEY (company_id,payee_id) REFERENCES app.payees(company_id,id),
  FOREIGN KEY (company_id,transfer_proof_file_id) REFERENCES app.files(company_id,id),
  FOREIGN KEY (company_id,confirmed_by) REFERENCES app.users(company_id,id),
  FOREIGN KEY (company_id,settlement_journal_id) REFERENCES app.journal_entries(company_id,id),
  CHECK ((status = 'PAID') = (paid_at IS NOT NULL)),
  CHECK (status <> 'PAID' OR (settlement_journal_id IS NOT NULL AND
    ((payment_provider IS NOT NULL AND external_transfer_id IS NOT NULL) OR
      (confirmed_by IS NOT NULL AND transfer_proof_file_id IS NOT NULL))))
);
CREATE TABLE app.procurement_batch_items (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL,
  request_id uuid NOT NULL,
  amount numeric(20,2) NOT NULL CHECK (amount > 0 AND amount <> 'NaN'),
  released_at timestamptz,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id),
  FOREIGN KEY (company_id,payout_id) REFERENCES app.procurement_payouts(company_id,id),
  FOREIGN KEY (company_id,request_id) REFERENCES app.purchase_requests(company_id,id),
  CHECK ((released_at IS NULL) = (release_reason IS NULL))
);
CREATE UNIQUE INDEX procurement_request_one_active_payout
  ON app.procurement_batch_items(company_id,request_id) WHERE released_at IS NULL;

CREATE TABLE app.expenses (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  expense_number text NOT NULL,
  payee_id uuid,
  request_id uuid,
  fixed_cost_id uuid,
  recognition_date date NOT NULL,
  service_period_start date,
  service_period_end date,
  description text NOT NULL,
  amount_ex_vat numeric(20,2) NOT NULL CHECK (amount_ex_vat >= 0 AND amount_ex_vat <> 'NaN'),
  vat_amount numeric(20,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0 AND vat_amount <> 'NaN'),
  gross_amount numeric(20,2) GENERATED ALWAYS AS (amount_ex_vat + vat_amount) STORED,
  recognition_journal_id uuid NOT NULL,
  receipt_file_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,expense_number),
  UNIQUE (company_id,request_id), UNIQUE (company_id,fixed_cost_id,recognition_date),
  UNIQUE (company_id,recognition_journal_id),
  FOREIGN KEY (company_id,payee_id) REFERENCES app.payees(company_id,id),
  FOREIGN KEY (company_id,request_id) REFERENCES app.purchase_requests(company_id,id),
  FOREIGN KEY (company_id,fixed_cost_id) REFERENCES app.fixed_costs(company_id,id),
  FOREIGN KEY (company_id,recognition_journal_id) REFERENCES app.journal_entries(company_id,id),
  FOREIGN KEY (company_id,receipt_file_id) REFERENCES app.files(company_id,id),
  FOREIGN KEY (company_id,created_by) REFERENCES app.users(company_id,id),
  CHECK (num_nonnulls(request_id,fixed_cost_id) <= 1),
  CHECK ((service_period_start IS NULL AND service_period_end IS NULL) OR
    (service_period_start IS NOT NULL AND service_period_end IS NOT NULL AND service_period_end > service_period_start))
);

CREATE TABLE app.integration_connections (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('STRIPE','OMISE','2C2P','LINE','META','TIKTOK')),
  external_account_id text NOT NULL,
  webhook_route_id uuid NOT NULL DEFAULT gen_random_uuid(),
  credentials_secret_ref text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,provider,external_account_id),
  UNIQUE (company_id,webhook_route_id)
);
CREATE TABLE app.webhook_events (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  signature_verified_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','PROCESSING','PROCESSED','FAILED','IGNORED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_until timestamptz,
  lock_token uuid,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  PRIMARY KEY (company_id,id), UNIQUE (company_id,connection_id,provider_event_id),
  FOREIGN KEY (company_id,connection_id) REFERENCES app.integration_connections(company_id,id),
  CHECK (status <> 'PROCESSED' OR processed_at IS NOT NULL)
);
CREATE TABLE app.idempotency_keys (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  scope text NOT NULL,
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 255),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','COMPLETED')),
  response_status integer CHECK (response_status BETWEEN 100 AND 599),
  response_body jsonb,
  lock_token uuid NOT NULL DEFAULT gen_random_uuid(),
  locked_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (company_id,scope,key),
  CHECK (expires_at > created_at),
  CHECK (status <> 'COMPLETED' OR response_status IS NOT NULL)
);
CREATE TABLE app.payments (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  external_payment_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED','CANCELLED')),
  amount numeric(20,2) NOT NULL CHECK (amount > 0 AND amount <> 'NaN'),
  currency text NOT NULL DEFAULT 'THB' CHECK (currency = 'THB'),
  paid_at timestamptz,
  settlement_journal_id uuid,
  last_webhook_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,connection_id,external_payment_id),
  UNIQUE (company_id,settlement_journal_id),
  FOREIGN KEY (company_id,order_id) REFERENCES app.orders(company_id,id),
  FOREIGN KEY (company_id,connection_id) REFERENCES app.integration_connections(company_id,id),
  FOREIGN KEY (company_id,settlement_journal_id) REFERENCES app.journal_entries(company_id,id),
  FOREIGN KEY (company_id,last_webhook_event_id) REFERENCES app.webhook_events(company_id,id),
  CHECK ((status = 'SUCCEEDED') = (paid_at IS NOT NULL)),
  CHECK (status <> 'SUCCEEDED' OR settlement_journal_id IS NOT NULL)
);
CREATE TABLE app.gateway_fees (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  external_fee_id text NOT NULL,
  recognition_date date NOT NULL,
  amount_ex_vat numeric(20,2) NOT NULL CHECK (amount_ex_vat >= 0 AND amount_ex_vat <> 'NaN'),
  vat_amount numeric(20,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0 AND vat_amount <> 'NaN'),
  journal_entry_id uuid NOT NULL,
  PRIMARY KEY (company_id,id), UNIQUE (company_id,payment_id,external_fee_id),
  UNIQUE (company_id,journal_entry_id),
  FOREIGN KEY (company_id,payment_id) REFERENCES app.payments(company_id,id),
  FOREIGN KEY (company_id,journal_entry_id) REFERENCES app.journal_entries(company_id,id)
);
CREATE TABLE app.credit_notes (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  credit_note_number text NOT NULL,
  recognized_on date NOT NULL,
  reason text NOT NULL,
  journal_entry_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,credit_note_number),
  UNIQUE (company_id,journal_entry_id),
  FOREIGN KEY (company_id,order_id) REFERENCES app.orders(company_id,id),
  FOREIGN KEY (company_id,journal_entry_id) REFERENCES app.journal_entries(company_id,id)
);
CREATE TABLE app.credit_note_items (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  credit_note_id uuid NOT NULL,
  order_item_id uuid NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0 AND quantity <> 'NaN'),
  net_amount numeric(20,2) NOT NULL CHECK (net_amount >= 0 AND net_amount <> 'NaN'),
  vat_amount numeric(20,2) NOT NULL CHECK (vat_amount >= 0 AND vat_amount <> 'NaN'),
  restored_cogs numeric(20,2) NOT NULL DEFAULT 0 CHECK (restored_cogs >= 0 AND restored_cogs <> 'NaN'),
  restock boolean NOT NULL DEFAULT false,
  PRIMARY KEY (company_id,id), UNIQUE (company_id,credit_note_id,order_item_id),
  FOREIGN KEY (company_id,credit_note_id) REFERENCES app.credit_notes(company_id,id),
  FOREIGN KEY (company_id,order_item_id) REFERENCES app.order_items(company_id,id),
  CHECK (restock OR restored_cogs = 0)
);
CREATE TABLE app.refunds (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  credit_note_id uuid NOT NULL,
  external_refund_id text NOT NULL,
  amount numeric(20,2) NOT NULL CHECK (amount > 0 AND amount <> 'NaN'),
  refunded_at timestamptz NOT NULL,
  settlement_journal_id uuid NOT NULL,
  PRIMARY KEY (company_id,id), UNIQUE (company_id,payment_id,external_refund_id),
  UNIQUE (company_id,settlement_journal_id),
  FOREIGN KEY (company_id,payment_id) REFERENCES app.payments(company_id,id),
  FOREIGN KEY (company_id,credit_note_id) REFERENCES app.credit_notes(company_id,id),
  FOREIGN KEY (company_id,settlement_journal_id) REFERENCES app.journal_entries(company_id,id)
);

CREATE TABLE app.line_recipients (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  line_user_id text NOT NULL,
  user_id uuid NOT NULL,
  daily_summary_enabled boolean NOT NULL DEFAULT true,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,connection_id,line_user_id),
  FOREIGN KEY (company_id,connection_id) REFERENCES app.integration_connections(company_id,id),
  FOREIGN KEY (company_id,user_id) REFERENCES app.users(company_id,id)
);
CREATE TABLE app.line_action_tokens (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  recipient_id uuid NOT NULL,
  request_id uuid,
  batch_id uuid,
  action text NOT NULL CHECK (action IN ('MARK_PURCHASED','APPROVE_BATCH','CONFIRM_TRANSFER')),
  expected_version integer CHECK (expected_version > 0),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,token_sha256),
  FOREIGN KEY (company_id,recipient_id) REFERENCES app.line_recipients(company_id,id),
  FOREIGN KEY (company_id,request_id) REFERENCES app.purchase_requests(company_id,id),
  FOREIGN KEY (company_id,batch_id) REFERENCES app.procurement_batches(company_id,id),
  CHECK (num_nonnulls(request_id,batch_id) = 1),
  CHECK ((action = 'MARK_PURCHASED' AND request_id IS NOT NULL AND expected_version IS NOT NULL)
    OR (action IN ('APPROVE_BATCH','CONFIRM_TRANSFER') AND batch_id IS NOT NULL)),
  CHECK (expires_at > created_at)
);
CREATE TABLE app.job_runs (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  run_after timestamptz NOT NULL,
  lock_token uuid,
  locked_until timestamptz,
  completed_at timestamptz,
  last_error text,
  PRIMARY KEY (company_id,id), UNIQUE (company_id,job_name,business_date)
);
CREATE TABLE app.outbox_events (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  deduplication_key text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','DELIVERED','DEAD')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lock_token uuid,
  locked_until timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id), UNIQUE (company_id,topic,deduplication_key)
);
CREATE TABLE app.audit_logs (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  request_id uuid,
  changes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(changes) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,id),
  FOREIGN KEY (company_id,actor_user_id) REFERENCES app.users(company_id,id)
);

-- Schema invariants; business middleware/services are intentionally step 2+.
CREATE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;

CREATE FUNCTION app.reject_tenant_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'company_id is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION app.guard_journal_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted journal entries are immutable; create a reversal' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Create a draft journal, add lines, then post' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_journal_entry BEFORE INSERT OR UPDATE OR DELETE ON app.journal_entries
FOR EACH ROW EXECUTE FUNCTION app.guard_journal_entry();

CREATE FUNCTION app.guard_journal_line() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE entry_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.journal_entry_id,NEW.company_id) IS DISTINCT FROM (OLD.journal_entry_id,OLD.company_id) THEN
    RAISE EXCEPTION 'Cannot move journal lines' USING ERRCODE = '23514';
  END IF;
  SELECT status INTO entry_status FROM app.journal_entries
    WHERE company_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END
      AND id = CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END FOR UPDATE;
  IF NOT FOUND OR entry_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Lines require a visible draft journal entry' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_journal_line BEFORE INSERT OR UPDATE OR DELETE ON app.journal_lines
FOR EACH ROW EXECUTE FUNCTION app.guard_journal_line();

CREATE FUNCTION app.check_journal_balance() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE current_status text; line_count bigint; imbalance numeric;
BEGIN
  SELECT status INTO current_status FROM app.journal_entries WHERE company_id = NEW.company_id AND id = NEW.id;
  IF current_status = 'POSTED' THEN
    SELECT count(*), coalesce(sum(debit-credit),0) INTO line_count,imbalance
      FROM app.journal_lines WHERE company_id = NEW.company_id AND journal_entry_id = NEW.id;
    IF line_count < 2 OR imbalance <> 0 THEN
      RAISE EXCEPTION 'Journal must have at least two lines and equal debits/credits' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balance AFTER INSERT OR UPDATE ON app.journal_entries
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_journal_balance();

CREATE FUNCTION app.guard_order_item() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE order_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.order_id,NEW.company_id) IS DISTINCT FROM (OLD.order_id,OLD.company_id) THEN
    RAISE EXCEPTION 'Cannot move order items' USING ERRCODE = '23514';
  END IF;
  SELECT status INTO order_status FROM app.orders
    WHERE company_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END
      AND id = CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END FOR UPDATE;
  IF NOT FOUND OR order_status IN ('RECOGNIZED','CANCELLED') THEN
    RAISE EXCEPTION 'Items require a visible editable order' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_order_item BEFORE INSERT OR UPDATE OR DELETE ON app.order_items
FOR EACH ROW EXECUTE FUNCTION app.guard_order_item();

CREATE FUNCTION app.guard_order() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.status IN ('RECOGNIZED','CANCELLED') THEN
    RAISE EXCEPTION 'Finalized order is immutable; use a credit note' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.status = 'RECOGNIZED' THEN
    IF NOT EXISTS (SELECT FROM app.order_items WHERE company_id = NEW.company_id AND order_id = NEW.id) THEN
      RAISE EXCEPTION 'Cannot recognize an empty order' USING ERRCODE = '23514';
    END IF;
    -- Lock selected cost rows so concurrent cost-history corrections cannot race
    -- this validation. Snapshot all costs before changing the order status.
    PERFORM c.id FROM app.product_costs c JOIN app.order_items i
      ON (i.company_id,i.cost_version_id) = (c.company_id,c.id)
      WHERE i.company_id = NEW.company_id AND i.order_id = NEW.id FOR SHARE OF c;
    IF EXISTS (
      SELECT FROM app.order_items i LEFT JOIN app.product_costs c
        ON (i.company_id,i.cost_version_id,i.product_id) = (c.company_id,c.id,c.product_id)
      WHERE i.company_id = NEW.company_id AND i.order_id = NEW.id
        AND (c.id IS NULL OR i.unit_cost_snapshot IS DISTINCT FROM c.unit_cost OR NOT (c.valid_during @> NEW.recognized_at))
    ) THEN
      RAISE EXCEPTION 'Missing or invalid cost snapshot for recognition time' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_order BEFORE INSERT OR UPDATE OR DELETE ON app.orders
FOR EACH ROW EXECUTE FUNCTION app.guard_order();

CREATE FUNCTION app.guard_cost_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cost history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF (NEW.id,NEW.product_id,NEW.valid_from,NEW.unit_cost,NEW.created_by,NEW.reason,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.product_id,OLD.valid_from,OLD.unit_cost,OLD.created_by,OLD.reason,OLD.created_at) THEN
    RAISE EXCEPTION 'Cost history values are immutable; add a new interval' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT FROM app.order_items i JOIN app.orders o ON (o.company_id,o.id) = (i.company_id,i.order_id)
    WHERE i.company_id = OLD.company_id AND i.cost_version_id = OLD.id AND o.status = 'RECOGNIZED'
      AND NOT (tstzrange(NEW.valid_from,NEW.valid_to,'[)') @> o.recognized_at)) THEN
    RAISE EXCEPTION 'Cost interval must still contain its recognized sales' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_cost_history BEFORE UPDATE OR DELETE ON app.product_costs
FOR EACH ROW EXECUTE FUNCTION app.guard_cost_history();

CREATE FUNCTION app.guard_account_classification() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF (NEW.account_type,NEW.reporting_group) IS DISTINCT FROM (OLD.account_type,OLD.reporting_group)
    AND EXISTS (SELECT FROM app.journal_lines WHERE company_id = OLD.company_id AND account_id = OLD.id) THEN
    RAISE EXCEPTION 'An account with journal lines cannot be reclassified' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_account_classification BEFORE UPDATE ON app.accounts
FOR EACH ROW EXECUTE FUNCTION app.guard_account_classification();

CREATE FUNCTION app.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON app.audit_logs
FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER classifications_append_only BEFORE UPDATE OR DELETE ON app.procurement_classifications
FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER ad_spends_append_only BEFORE UPDATE OR DELETE ON app.ad_spends
FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- Read paths begin with company_id; PostgreSQL does not auto-index FK columns.
CREATE INDEX orders_recognition_idx ON app.orders(company_id,recognition_date) WHERE status = 'RECOGNIZED';
CREATE INDEX orders_customer_idx ON app.orders(company_id,customer_id);
CREATE INDEX items_cost_idx ON app.order_items(company_id,cost_version_id,product_id);
CREATE INDEX journal_date_idx ON app.journal_entries(company_id,accounting_date,id) WHERE status = 'POSTED';
CREATE INDEX journal_account_idx ON app.journal_lines(company_id,account_id,journal_entry_id);
CREATE INDEX expenses_date_idx ON app.expenses(company_id,recognition_date);
CREATE INDEX expenses_payee_idx ON app.expenses(company_id,payee_id);
CREATE INDEX requests_pending_idx ON app.purchase_requests(company_id,business_date,confirmed_location,suggested_location)
  WHERE status IN ('SUBMITTED','NEEDS_REVIEW','APPROVED','PURCHASED');
CREATE INDEX requests_user_idx ON app.purchase_requests(company_id,requested_by,requested_at DESC);
CREATE INDEX classifications_request_idx ON app.procurement_classifications(company_id,request_id,created_at DESC);
CREATE INDEX batch_items_payout_idx ON app.procurement_batch_items(company_id,payout_id) WHERE released_at IS NULL;
CREATE INDEX payments_order_idx ON app.payments(company_id,order_id);
CREATE INDEX credit_notes_order_idx ON app.credit_notes(company_id,order_id);
CREATE INDEX refund_credit_note_idx ON app.refunds(company_id,credit_note_id);
CREATE INDEX webhook_retry_idx ON app.webhook_events(company_id,status,next_attempt_at);
CREATE INDEX idempotency_expiry_idx ON app.idempotency_keys(company_id,expires_at);
CREATE INDEX jobs_due_idx ON app.job_runs(company_id,status,run_after);
CREATE INDEX outbox_due_idx ON app.outbox_events(company_id,status,available_at);
CREATE INDEX audit_entity_idx ON app.audit_logs(company_id,entity_type,entity_id,occurred_at DESC);
CREATE INDEX user_roles_role_idx ON app.user_roles(company_id,role_id);
CREATE INDEX role_permissions_permission_idx ON app.role_permissions(company_id,permission_id);

-- Fail closed for ALL tables, including company records. Every FK between
-- tenant entities includes company_id. No table is granted TRUNCATE or DDL.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app' LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('CREATE POLICY tenant_scope ON app.%I FOR ALL TO cmo_runtime, cmo_owner USING (company_id = app.current_company_id()) WITH CHECK (company_id = app.current_company_id())', t.tablename);
    EXECUTE format('CREATE TRIGGER immutable_company BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_tenant_change()', t.tablename);
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'app' AND table_name = t.tablename AND column_name = 'updated_at') THEN
      EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t.tablename);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO cmo_runtime;
REVOKE INSERT, UPDATE, DELETE ON app.companies FROM cmo_runtime;
REVOKE UPDATE, DELETE ON app.audit_logs, app.procurement_classifications, app.ad_spends FROM cmo_runtime;
GRANT EXECUTE ON FUNCTION app.current_company_id() TO cmo_runtime;
-- New tables receive no automatic runtime grants; each future migration must
-- explicitly add RLS and privileges. No SECURITY DEFINER escape hatch exists.
COMMIT;
