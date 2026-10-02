#!/bin/bash
set -euo pipefail
umask 077
export TZ=Asia/Shanghai

root=/backups
mkdir -p "$root"
exec 9>"$root/.lock"
work=
next=
cleanup() {
  if [[ -n "$work" && "$work" == "$root"/.pending.* ]]; then
    rm -f "$work/database.dump" "$work/contents.txt" "$work/metadata.json" "$work/SHA256SUMS" "$work/target-revision"
    rmdir "$work" 2>/dev/null || true
  fi
  if [[ "$next" == "$root"/.*.next ]]; then rm -f "$next"; fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

backup() {
  local slot=$1 revision=${2:-scheduled}
  case "$slot" in update|quick|daily) ;; *) return 2 ;; esac
  [[ "$revision" =~ ^[a-zA-Z0-9._-]{1,80}$ ]] || return 2
  flock -w 120 9
  if [[ -f "$root/PAUSED" ]]; then
    echo "Backups are paused; existing archives preserved." >&2
    flock -u 9
    return 1
  fi
  if [[ "$slot" == update && -f "$root/.update-pending" ]]; then
    if [[ ! -s "$root/update.tar" ]]; then
      echo "Backup refused: the protected pre-update archive is missing. Inspect the pending deployment." >&2
      flock -u 9
      return 1
    fi
    local expected_hash actual_hash
    expected_hash=$(sed -n '2p' "$root/.update-pending")
    if ! actual_hash=$(sha256sum "$root/update.tar") ||
       [[ -z "$expected_hash" || "${actual_hash%% *}" != "$expected_hash" ]]; then
      echo "Backup refused: pending update marker and archive differ. Inspect both before retrying." >&2
      flock -u 9
      return 1
    fi
    echo "Keeping the original pre-update backup for the pending deployment."
    flock -u 9
    return 0
  fi
  local database user source_revision archive_hash success=0
  if ! database=$(psql -X -At -v ON_ERROR_STOP=1 -c 'SELECT current_database()') ||
     ! user=$(psql -X -At -v ON_ERROR_STOP=1 -c 'SELECT current_user'); then
    flock -u 9
    return 1
  fi
  if [[ "$database" != moli_activity_vps || "$user" != moli_activity_vps ]]; then
    echo "Backup refused: unexpected database or role." >&2
    flock -u 9
    return 1
  fi
  if ! work=$(mktemp -d "$root/.pending.XXXXXX"); then flock -u 9; return 1; fi
  next="$root/.${slot}.next"
  source_revision=$(head -n 1 "$root/.deployed-revision" 2>/dev/null || printf 'unknown')
  if pg_dump --format=custom --no-owner --no-acl --file="$work/database.dump" &&
     pg_restore --list "$work/database.dump" >"$work/contents.txt"; then
    if psql -X -At -v ON_ERROR_STOP=1 -v slot="$slot" -v revision="$revision" -v source_revision="$source_revision" >"$work/metadata.json" <<'SQL'
SELECT (to_regclass('moli_client.schema_migrations') IS NOT NULL) AS has_migrations \gset
\if :has_migrations
SELECT json_build_object('database', current_database(), 'slot', :'slot',
  'targetRevision', :'revision', 'sourceRevision', :'source_revision', 'capturedAt', clock_timestamp(),
  'migrations', (SELECT json_agg(json_build_object('name', name, 'checksum', checksum) ORDER BY name)
    FROM moli_client.schema_migrations));
\else
SELECT json_build_object('database', current_database(), 'slot', :'slot',
  'targetRevision', :'revision', 'sourceRevision', :'source_revision', 'capturedAt', clock_timestamp(), 'migrations', json_build_array());
\endif
SQL
    then
      # The archive contains one transaction-consistent dump plus restore metadata.
      if (cd "$work" && sha256sum database.dump >SHA256SUMS) &&
         printf '%s\n' "$revision" >"$work/target-revision" &&
         tar -cf "$next" -C "$work" database.dump metadata.json SHA256SUMS contents.txt target-revision &&
         tar -tf "$next" >/dev/null &&
         archive_hash=$(sha256sum "$next"); then
        # Mark the update pending before replacement so a failed retry cannot overwrite the original.
        if [[ "$slot" != update ]] || printf '%s\n%s\n' "$revision" "${archive_hash%% *}" >"$root/.update-pending"; then
          if mv -f "$next" "$root/$slot.tar"; then success=1; fi
        fi
      fi
    fi
  fi
  cleanup
  work= next=
  flock -u 9
  if [[ "$success" != 1 ]]; then
    echo "Backup failed; the previous $slot archive is unchanged." >&2
    return 1
  fi
  echo "Completed $slot database backup."
}

case "${1:-schedule}" in
  update) backup update "${2:?Provide the deployment revision}" ;;
  complete)
    flock -w 120 9
    revision=${2:?Provide the healthy deployment revision}
    [[ "$revision" =~ ^[a-zA-Z0-9._-]{1,80}$ ]] || exit 2
    printf '%s\n' "$revision" >"$root/.deployed-revision"
    rm -f "$root/.update-pending"
    flock -u 9
    ;;
  quick|daily) backup "$1" ;;
  schedule)
    while true; do
      quick_bucket=$(($(date +%s) / 14400))
      daily_bucket=$(date -d '5 hours ago' +%F)
      if [[ ! -f "$root/PAUSED" ]]; then
        if [[ "$(head -n 1 "$root/.quick-bucket" 2>/dev/null || true)" != "$quick_bucket" ]]; then
          if backup quick; then printf '%s\n' "$quick_bucket" >"$root/.quick-bucket"; fi
        fi
        if [[ "$(head -n 1 "$root/.daily-bucket" 2>/dev/null || true)" != "$daily_bucket" ]]; then
          if backup daily; then printf '%s\n' "$daily_bucket" >"$root/.daily-bucket"; fi
        fi
      fi
      sleep 60
    done
    ;;
  *) echo "Usage: activity-backup.sh [schedule|quick|daily|update REVISION|complete]" >&2; exit 2 ;;
esac
