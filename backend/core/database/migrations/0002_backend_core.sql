BEGIN;
SET LOCAL ROLE cmo_owner;
SET LOCAL timezone='Asia/Bangkok';
-- Persist exact JSON response bytes. Payment deduplication records are retained
-- indefinitely by the service (expires_at='infinity'), not purged on a TTL.
ALTER TABLE app.idempotency_keys ADD COLUMN response_text text;
ALTER TABLE app.idempotency_keys ADD CONSTRAINT completed_response_present
  CHECK (status <> 'COMPLETED' OR (response_status BETWEEN 200 AND 299 AND response_text IS NOT NULL)) NOT VALID;
-- Do not fake a response for an already completed record lacking its old bytes.
-- Existing installations must backfill from their retained response_body first.
-- The administrative migrator enumerates tenants; every data update is scoped.
-- cmo_owner itself remains subject to FORCE RLS, so it cannot do a global backfill.
SET LOCAL ROLE NONE;
DO $$
DECLARE tenant record;
BEGIN
  FOR tenant IN SELECT company_id FROM app.companies LOOP
    PERFORM set_config('app.company_id',tenant.company_id::text,true);
    UPDATE app.idempotency_keys SET response_text=response_body::text
      WHERE company_id=tenant.company_id AND status='COMPLETED' AND response_text IS NULL AND response_body IS NOT NULL;
  END LOOP;
END $$;
SET LOCAL ROLE cmo_owner;
ALTER TABLE app.idempotency_keys VALIDATE CONSTRAINT completed_response_present;

CREATE TABLE app.gateway_account_mappings (
  company_id uuid NOT NULL REFERENCES app.companies(company_id),
  connection_id uuid NOT NULL,
  clearing_account_id uuid NOT NULL,
  receivable_account_id uuid NOT NULL,
  advance_account_id uuid NOT NULL,
  PRIMARY KEY (company_id,connection_id),
  FOREIGN KEY (company_id,connection_id) REFERENCES app.integration_connections(company_id,id),
  FOREIGN KEY (company_id,clearing_account_id) REFERENCES app.accounts(company_id,id),
  FOREIGN KEY (company_id,receivable_account_id) REFERENCES app.accounts(company_id,id),
  FOREIGN KEY (company_id,advance_account_id) REFERENCES app.accounts(company_id,id),
  CHECK (clearing_account_id<>receivable_account_id AND clearing_account_id<>advance_account_id AND receivable_account_id<>advance_account_id)
);
ALTER TABLE app.gateway_account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.gateway_account_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.gateway_account_mappings TO cmo_runtime,cmo_owner
  USING (company_id=app.current_company_id()) WITH CHECK (company_id=app.current_company_id());
CREATE TRIGGER immutable_company BEFORE UPDATE ON app.gateway_account_mappings
  FOR EACH ROW EXECUTE FUNCTION app.reject_tenant_change();
GRANT SELECT,INSERT,UPDATE,DELETE ON app.gateway_account_mappings TO cmo_runtime;
COMMIT;
