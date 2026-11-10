#!/bin/sh
# Postgres's roles (§13, Q4 on #18, #67). Runs once, when the data volume is first created.
#   lzp_owner: owns the database and the public schema, and runs the migrations (config/env.ts's DATABASE_OWNER_URL)
#   lzp_app:   the app's login (DATABASE_URL); no BYPASSRLS, so row-level security always applies to it
#   lzp_auth:  no login; the auth tables' rights (#176). lzp_app takes it only by SET ROLE, which the auth handle does on
#              its own connections, and never inherits it, so workspace code running as lzp_app can't reach them (#183)
# None is a superuser or can create roles or databases. Table grants come with the migrations (#71, #176), so each one
# is reviewed and checked by squawk. Servers get the same script in M6. The script runs only when the data volume is
# first created: an existing volume gets a new role by `docker compose -f docker/compose.yml down -v`, then `up`.
set -eu

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set db="$POSTGRES_DB" \
  --set owner_password="$LZP_PG_OWNER_PASSWORD" --set app_password="$LZP_PG_APP_PASSWORD" <<'SQL'
CREATE ROLE lzp_owner LOGIN PASSWORD :'owner_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE lzp_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER DATABASE :"db" OWNER TO lzp_owner;
ALTER SCHEMA public OWNER TO lzp_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO lzp_app;
CREATE ROLE lzp_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO lzp_auth;
GRANT lzp_auth TO lzp_app WITH INHERIT FALSE, SET TRUE;
SQL
