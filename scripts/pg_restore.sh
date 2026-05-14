#!/bin/bash
# ================================================================
# pg_restore.sh — Restore PostgreSQL from a backup dump
#
# Usage:
#   ./scripts/pg_restore.sh <dump_file>
#   ./scripts/pg_restore.sh /var/backups/supabase/daily/backup-daily.dump
#
# Options:
#   --dry-run     Show what would be restored without doing it
#   --list        List tables/objects in the dump file
#   --table NAME  Restore only a specific table
#
# Requirements:
#   - pg_restore (PostgreSQL client tools)
#   - Optional: Docker (if Supabase runs in Docker)
# ================================================================

set -euo pipefail

# ────────────────────────────────────────────────
#  CONFIGURATION — Same as pg_backup.sh
# ────────────────────────────────────────────────

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-postgres}"
DOCKER_CONTAINER="${DOCKER_CONTAINER:-}"

# ────────────────────────────────────────────────
#  PARSE ARGUMENTS
# ────────────────────────────────────────────────

DUMP_FILE=""
DRY_RUN=false
LIST_ONLY=false
TABLE_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)  DRY_RUN=true; shift ;;
    --list)     LIST_ONLY=true; shift ;;
    --table)    TABLE_NAME="$2"; shift 2 ;;
    -*)         echo "Unknown option: $1"; exit 1 ;;
    *)          DUMP_FILE="$1"; shift ;;
  esac
done

if [ -z "${DUMP_FILE}" ]; then
  echo "Usage: $0 [--dry-run] [--list] [--table NAME] <dump_file>"
  echo ""
  echo "Examples:"
  echo "  $0 --list backup-daily.dump              # List contents"
  echo "  $0 --dry-run backup-daily.dump            # Preview restore"
  echo "  $0 backup-daily.dump                      # Full restore"
  echo "  $0 --table treatment_records backup.dump  # Restore one table"
  exit 1
fi

if [ ! -f "${DUMP_FILE}" ]; then
  echo "ERROR: File not found: ${DUMP_FILE}"
  exit 1
fi

LOG_PREFIX="[pg_restore $(date '+%Y-%m-%d %H:%M:%S')]"
log() { echo "${LOG_PREFIX} $1"; }

# ────────────────────────────────────────────────
#  LIST MODE
# ────────────────────────────────────────────────

if [ "${LIST_ONLY}" = true ]; then
  log "Listing contents of: ${DUMP_FILE}"
  echo "──────────────────────────────────────────"
  pg_restore --list "${DUMP_FILE}" | grep -E "TABLE DATA|TABLE|SEQUENCE" | head -60
  echo "──────────────────────────────────────────"
  local_size=$(du -h "${DUMP_FILE}" | cut -f1)
  log "File size: ${local_size}"
  exit 0
fi

# ────────────────────────────────────────────────
#  DRY RUN MODE
# ────────────────────────────────────────────────

if [ "${DRY_RUN}" = true ]; then
  log "DRY RUN — would restore from: ${DUMP_FILE}"
  log "Target: ${PG_HOST}:${PG_PORT}/${PG_DB}"
  [ -n "${DOCKER_CONTAINER}" ] && log "Via Docker: ${DOCKER_CONTAINER}"
  [ -n "${TABLE_NAME}" ] && log "Table filter: ${TABLE_NAME}"
  echo ""
  log "Objects in dump:"
  pg_restore --list "${DUMP_FILE}" | grep "TABLE DATA" | while read line; do
    echo "  - ${line}"
  done
  echo ""
  log "To run for real, remove --dry-run"
  exit 0
fi

# ────────────────────────────────────────────────
#  CONFIRMATION
# ────────────────────────────────────────────────

echo ""
echo "  ┌──────────────────────────────────────────┐"
echo "  │         DATABASE RESTORE WARNING          │"
echo "  ├──────────────────────────────────────────┤"
echo "  │  This will OVERWRITE existing data in:   │"
echo "  │  Host: ${PG_HOST}:${PG_PORT}"
echo "  │  DB:   ${PG_DB}"
[ -n "${TABLE_NAME}" ] && \
echo "  │  Table: ${TABLE_NAME} (single table)"
[ -z "${TABLE_NAME}" ] && \
echo "  │  Scope: ALL tables (full restore)"
echo "  │  File:  $(basename "${DUMP_FILE}")"
echo "  └──────────────────────────────────────────┘"
echo ""
read -p "  Type 'RESTORE' to confirm: " confirm

if [ "${confirm}" != "RESTORE" ]; then
  echo "Cancelled."
  exit 0
fi

# ────────────────────────────────────────────────
#  RESTORE
# ────────────────────────────────────────────────

log "Starting restore from: ${DUMP_FILE}"

RESTORE_ARGS=(
  --dbname="${PG_DB}"
  --clean
  --if-exists
  --no-owner
  --no-privileges
  --verbose
)

if [ -n "${TABLE_NAME}" ]; then
  RESTORE_ARGS+=(--table="${TABLE_NAME}")
  log "Restoring single table: ${TABLE_NAME}"
fi

if [ -n "${DOCKER_CONTAINER}" ]; then
  log "Restoring via Docker container: ${DOCKER_CONTAINER}"
  docker exec -i "${DOCKER_CONTAINER}" \
    pg_restore -U "${PG_USER}" "${RESTORE_ARGS[@]}" \
    < "${DUMP_FILE}" 2>&1
else
  log "Restoring via direct connection"
  pg_restore -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" \
    "${RESTORE_ARGS[@]}" \
    "${DUMP_FILE}" 2>&1
fi

RESULT=$?

echo ""
if [ ${RESULT} -eq 0 ]; then
  log "Restore completed successfully!"
else
  # pg_restore returns non-zero for warnings (e.g., "table already exists" with --clean)
  # This is usually fine
  log "Restore completed with warnings (exit code: ${RESULT})"
  log "This is normal if some objects already existed."
fi

log "Post-restore checklist:"
log "  1. Verify data: SELECT count(*) FROM treatment_records;"
log "  2. Oracle snapshots will regenerate on next oracle_refresh_student() call"
log "  3. Test the application at the web URL"
