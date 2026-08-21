-- O'QUV MARKAZ — production database hardening.
--
-- Run once, as a superuser (or the database owner), AFTER `prisma migrate
-- deploy` has created the schema. Re-running is safe: every statement is
-- idempotent.
--
-- What this is for: the application connects with one role, and that role
-- should be able to do exactly what the application does and nothing else. If
-- an injection or a compromised process ever gets to run SQL of its own
-- choosing, the difference between a role that can only SELECT/INSERT/UPDATE/
-- DELETE and one that owns the schema is the difference between an incident and
-- a catastrophe.
--
-- Pass both variables on the command line:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v app_role=oquv_markaz_app \
--     -v app_password="$(openssl rand -base64 32)" \
--     -f scripts/db-harden.sql
--
-- `\set` is deliberately NOT used to provide defaults: it runs when the file is
-- read and would silently override anything passed with -v, which is how a
-- first attempt at this script created a role nobody asked for.

\if :{?app_role}
\else
  \echo 'ERROR: -v app_role=... is required'
  \quit
\endif

\if :{?app_password}
\else
  \echo 'ERROR: -v app_password=... is required (openssl rand -base64 32)'
  \quit
\endif

-- ---------------------------------------------------------------------------
-- 1. The application role
-- ---------------------------------------------------------------------------
-- psql does not interpolate its variables inside a dollar-quoted block, so the
-- CREATE is generated as text and executed with \gexec.
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_role', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role')
\gexec

-- No inherited superpowers, and no ability to create more roles or databases.
ALTER ROLE :"app_role" NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- ---------------------------------------------------------------------------
-- 2. Privileges: data, not schema
-- ---------------------------------------------------------------------------
-- :DBNAME is psql's own variable for the database you are connected to.
GRANT CONNECT ON DATABASE :"DBNAME" TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";

-- Explicitly NOT granted: CREATE on the schema, TRUNCATE, REFERENCES, TRIGGER.
-- The application never issues DDL — Prisma migrations run as the owner — so a
-- role that cannot DROP or TRUNCATE loses nothing and prevents a great deal.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";

-- Tables created by future migrations inherit the same grants, so a deploy does
-- not silently leave a new table unreadable — or worse, over-granted.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

-- The public schema is world-writable by default in older Postgres versions.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Limits that stop one bad query taking the site down
-- ---------------------------------------------------------------------------
-- A query that has run for thirty seconds is not going to finish usefully; it
-- is going to hold a connection while the rest of the pool starves.
ALTER ROLE :"app_role" SET statement_timeout = '30s';

-- A transaction left open by a crashed process holds locks indefinitely.
ALTER ROLE :"app_role" SET idle_in_transaction_session_timeout = '60s';

-- Leaves headroom for a superuser to get in when the pool is exhausted.
ALTER ROLE :"app_role" CONNECTION LIMIT 40;

-- ---------------------------------------------------------------------------
-- 4. Verify
-- ---------------------------------------------------------------------------
-- Expect: rolsuper=f, rolcreatedb=f, rolcreaterole=f, rolbypassrls=f
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolconnlimit
FROM pg_roles WHERE rolname = :'app_role';

-- Expect every row to show exactly: SELECT, INSERT, UPDATE, DELETE
SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS granted
FROM information_schema.table_privileges
WHERE grantee = :'app_role' AND table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;
