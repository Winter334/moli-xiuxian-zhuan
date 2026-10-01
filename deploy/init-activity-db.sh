#!/bin/sh
set -eu

psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
    --set=ON_ERROR_STOP=1 --set=app_password="$ACTIVITY_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE moli_activity_vps LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER DATABASE moli_activity_vps OWNER TO moli_activity_vps;
REVOKE ALL ON DATABASE moli_activity_vps FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE moli_activity_vps TO moli_activity_vps;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
