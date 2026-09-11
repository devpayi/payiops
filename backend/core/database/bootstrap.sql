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
