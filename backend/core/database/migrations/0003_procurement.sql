BEGIN;
SET LOCAL ROLE cmo_owner;
SET LOCAL timezone='Asia/Bangkok';
CREATE TABLE app.file_contents (
 company_id uuid NOT NULL, file_id uuid NOT NULL, content bytea NOT NULL,
 PRIMARY KEY(company_id,file_id), FOREIGN KEY(company_id,file_id) REFERENCES app.files(company_id,id),
 CHECK(octet_length(content) BETWEEN 1 AND 5242880)
);
CREATE TABLE app.procurement_accounts (
 company_id uuid PRIMARY KEY REFERENCES app.companies(company_id),
 expense_account_id uuid NOT NULL, payable_account_id uuid NOT NULL, cash_account_id uuid NOT NULL,
 FOREIGN KEY(company_id,expense_account_id) REFERENCES app.accounts(company_id,id),
 FOREIGN KEY(company_id,payable_account_id) REFERENCES app.accounts(company_id,id),
 FOREIGN KEY(company_id,cash_account_id) REFERENCES app.accounts(company_id,id)
);
CREATE TABLE app.local_credentials (
 company_id uuid NOT NULL, user_id uuid NOT NULL, password_hash text NOT NULL, salt text NOT NULL,
 failed_attempts integer NOT NULL DEFAULT 0, locked_until timestamptz, changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,user_id), FOREIGN KEY(company_id,user_id) REFERENCES app.users(company_id,id)
);
CREATE TABLE app.line_event_receipts (
 company_id uuid NOT NULL, connection_id uuid NOT NULL, event_id text NOT NULL, outcome text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,connection_id,event_id),
 FOREIGN KEY(company_id,connection_id) REFERENCES app.integration_connections(company_id,id)
);
ALTER TABLE app.purchase_requests ADD COLUMN client_request_id uuid;
ALTER TABLE app.purchase_requests ADD COLUMN input_sha256 text;
CREATE UNIQUE INDEX procurement_client_request ON app.purchase_requests(company_id,requested_by,client_request_id);
ALTER TABLE app.procurement_payouts ADD COLUMN prepared_proof_file_id uuid;
ALTER TABLE app.procurement_payouts ADD CONSTRAINT prepared_proof_fk FOREIGN KEY(company_id,prepared_proof_file_id) REFERENCES app.files(company_id,id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['file_contents','procurement_accounts','local_credentials','line_event_receipts'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I TO cmo_runtime,cmo_owner USING(company_id=app.current_company_id()) WITH CHECK(company_id=app.current_company_id())',t);
  EXECUTE format('CREATE TRIGGER immutable_company BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_tenant_change()',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO cmo_runtime',t);
 END LOOP;
END $$;
COMMIT;
