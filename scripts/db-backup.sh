#!/usr/bin/env bash
#
# O'QUV MARKAZ — database backup.
#
# A backup nobody has restored is a hope, not a backup. This script therefore
# does two things: it takes the dump, and it restores it into a scratch database
# and counts the rows. A dump that cannot be restored fails here, on a quiet
# Tuesday, rather than on the day it is needed.
#
#   ./scripts/db-backup.sh                 take and verify a backup
#   ./scripts/db-backup.sh --no-verify     take one without the restore check
#
# Environment:
#   DATABASE_URL   required — the database to back up
#   BACKUP_DIR     optional — defaults to ./backups
#   KEEP_DAYS      optional — defaults to 30
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
VERIFY=1
[ "${1:-}" = "--no-verify" ] && VERIFY=0

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$BACKUP_DIR/oquv-markaz-$STAMP.dump"

echo "→ dumping to $DUMP"
# Custom format: compressed, and restorable table by table.
pg_dump --format=custom --no-owner --no-privileges --file="$DUMP" "$DATABASE_URL"

SIZE=$(du -h "$DUMP" | cut -f1)
echo "  wrote $SIZE"

# A dump that is suspiciously small is usually a dump of an empty database.
BYTES=$(stat -c%s "$DUMP" 2>/dev/null || stat -f%z "$DUMP")
if [ "$BYTES" -lt 10240 ]; then
  echo "✗ dump is only $BYTES bytes — refusing to treat this as a backup" >&2
  exit 1
fi

if [ "$VERIFY" = "1" ]; then
  SCRATCH="oquv_markaz_restore_check_$$"
  echo "→ verifying by restoring into $SCRATCH"

  ADMIN_URL="${DATABASE_URL%/*}/postgres"
  psql "$ADMIN_URL" -q -c "CREATE DATABASE \"$SCRATCH\";"

  cleanup() {
    psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$SCRATCH\";" || true
  }
  trap cleanup EXIT

  pg_restore --no-owner --no-privileges --dbname="${DATABASE_URL%/*}/$SCRATCH" "$DUMP" >/dev/null

  # The tables that must never come back empty from a real deployment.
  for table in organizations students payments subscriptions; do
    COUNT=$(psql -tAX "${DATABASE_URL%/*}/$SCRATCH" -c "SELECT count(*) FROM $table;")
    echo "  $table: $COUNT rows"
  done
  echo "✓ restore verified"
fi

echo "→ pruning backups older than $KEEP_DAYS days"
find "$BACKUP_DIR" -name 'oquv-markaz-*.dump' -mtime +"$KEEP_DAYS" -print -delete

echo "✓ done"
