BEGIN;
SET LOCAL ROLE cmo_owner;
SET LOCAL timezone='Asia/Bangkok';
CREATE TABLE app.line_shop_groups (
 company_id uuid NOT NULL, connection_id uuid NOT NULL, group_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,connection_id), UNIQUE(company_id,group_id),
 FOREIGN KEY(company_id,connection_id) REFERENCES app.integration_connections(company_id,id)
);
CREATE TABLE app.line_notes (
 company_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), connection_id uuid NOT NULL,
 group_id text NOT NULL, message_id text NOT NULL, requester_line_id text NOT NULL,
 original_text text NOT NULL, quote_token text, amendments jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','ORDERED','PICKUP','DONE','CANCELLED')),
 track_arrival boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 event_timestamp bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,id), UNIQUE(company_id,connection_id,message_id),
 FOREIGN KEY(company_id,connection_id) REFERENCES app.line_shop_groups(company_id,connection_id),
 CHECK(jsonb_typeof(amendments)='array'), CHECK(length(original_text) BETWEEN 1 AND 10000)
);
CREATE TABLE app.line_note_actions (
 company_id uuid NOT NULL, token_sha256 text NOT NULL, note_id uuid NOT NULL,
 recipient_id uuid NOT NULL, note_version integer NOT NULL, action text NOT NULL CHECK(action IN('ORDERED','PICKUP','DONE','TRACK')),
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 PRIMARY KEY(company_id,token_sha256),
 FOREIGN KEY(company_id,note_id) REFERENCES app.line_notes(company_id,id),
 FOREIGN KEY(company_id,recipient_id) REFERENCES app.line_recipients(company_id,id)
);
CREATE INDEX line_notes_pending ON app.line_notes(company_id,connection_id,created_at) WHERE status IN('OPEN','PICKUP','ORDERED');
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['line_shop_groups','line_notes','line_note_actions'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON app.%I TO cmo_runtime,cmo_owner USING(company_id=app.current_company_id()) WITH CHECK(company_id=app.current_company_id())',t);
  EXECUTE format('CREATE TRIGGER immutable_company BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_tenant_change()',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO cmo_runtime',t);
 END LOOP;
END $$;
COMMIT;
