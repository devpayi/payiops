BEGIN;
SET LOCAL ROLE cmo_owner;
SET LOCAL timezone='Asia/Bangkok';
ALTER TABLE app.line_notes ADD COLUMN snoozed_until timestamptz;
ALTER TABLE app.line_note_actions ADD COLUMN targets jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(targets)='array');
ALTER TABLE app.line_note_actions DROP CONSTRAINT line_note_actions_action_check;
ALTER TABLE app.line_note_actions ADD CONSTRAINT line_note_actions_action_check CHECK(action IN('ORDERED','PICKUP','DONE','TRACK','CANCELLED','SNOOZE','ALL'));
ALTER TABLE app.line_event_receipts ADD COLUMN reply_messages jsonb CHECK(reply_messages IS NULL OR jsonb_typeof(reply_messages)='array');
CREATE TABLE app.line_summary_runs (
 company_id uuid NOT NULL REFERENCES app.companies(company_id),run_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(company_id,run_key)
);
ALTER TABLE app.line_summary_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.line_summary_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.line_summary_runs TO cmo_runtime,cmo_owner USING(company_id=app.current_company_id()) WITH CHECK(company_id=app.current_company_id());
CREATE TRIGGER immutable_company BEFORE UPDATE ON app.line_summary_runs FOR EACH ROW EXECUTE FUNCTION app.reject_tenant_change();
GRANT SELECT,INSERT,UPDATE,DELETE ON app.line_summary_runs TO cmo_runtime;
COMMIT;
