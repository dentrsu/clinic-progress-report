#!/bin/bash
# ================================================================
# pg_backup.sh — Automated PostgreSQL Backup for Self-Hosted Supabase
#
# Produces daily/weekly/monthly rotation dumps + optional upload
# to Google Drive via rclone.
#
# Usage:
#   1. Edit the CONFIGURATION section below
#   2. chmod +x scripts/pg_backup.sh
#   3. Run manually:  ./scripts/pg_backup.sh
#   4. Add to cron:   Run setup_cron() or add manually:
#      0 1 * * * /path/to/scripts/pg_backup.sh >> /var/log/pg_backup.log 2>&1
#
# Requirements:
#   - pg_dump (PostgreSQL client tools)
#   - gzip
#   - Optional: rclone (for Google Drive upload)
#   - Optional: Docker (if Supabase runs in Docker)
# ================================================================

set -euo pipefail

# ────────────────────────────────────────────────
#  CONFIGURATION — Edit these values
# ────────────────────────────────────────────────

# PostgreSQL connection
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-postgres}"
# Set PGPASSWORD env var or use .pgpass file for authentication
# export PGPASSWORD="your-password-here"

# Docker mode: set to your Supabase Postgres container name (e.g. "supabase-db")
# Leave empty to connect directly without Docker
DOCKER_CONTAINER="${DOCKER_CONTAINER:-}"

# Backup directory (created automatically)
BACKUP_DIR="${BACKUP_DIR:-/var/backups/supabase}"

# Retention: how many days to keep old backups (beyond the rotation files)
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# rclone remote name for Google Drive (leave empty to skip upload)
# Setup: rclone config → create remote named "gdrive"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
RCLONE_FOLDER="${RCLONE_FOLDER:-backup-tracker/pg-dumps}"

# ────────────────────────────────────────────────
#  INTERNAL VARIABLES
# ────────────────────────────────────────────────

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATE_YYYMMDD=$(date +%Y%m%d)
DAY_OF_WEEK=$(date +%u)   # 1=Monday, 7=Sunday
DAY_OF_MONTH=$(date +%d)

LOG_PREFIX="[pg_backup $(date '+%Y-%m-%d %H:%M:%S')]"

# ────────────────────────────────────────────────
#  FUNCTIONS
# ────────────────────────────────────────────────

log() {
  echo "${LOG_PREFIX} $1"
}

error() {
  echo "${LOG_PREFIX} ERROR: $1" >&2
}

# Create backup directory if it doesn't exist
ensure_dirs() {
  mkdir -p "${BACKUP_DIR}/daily"
  mkdir -p "${BACKUP_DIR}/weekly"
  mkdir -p "${BACKUP_DIR}/monthly"
  mkdir -p "${BACKUP_DIR}/archive"
}

# Run pg_dump (direct or via Docker)
run_pg_dump() {
  local output_file="$1"

  if [ -n "${DOCKER_CONTAINER}" ]; then
    log "Dumping via Docker container: ${DOCKER_CONTAINER}"
    docker exec "${DOCKER_CONTAINER}" \
      pg_dump -U "${PG_USER}" -d "${PG_DB}" \
        --format=custom \
        --no-owner \
        --no-privileges \
        --verbose \
      2>&1 > "${output_file}"
  else
    log "Dumping via direct connection: ${PG_HOST}:${PG_PORT}"
    pg_dump -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}" \
      --format=custom \
      --no-owner \
      --no-privileges \
      --verbose \
      --file="${output_file}" \
      2>&1
  fi
}

# Upload to Google Drive via rclone
upload_to_drive() {
  local file="$1"
  local remote_path="$2"

  if [ -z "${RCLONE_REMOTE}" ]; then
    return 0
  fi

  if ! command -v rclone &> /dev/null; then
    log "rclone not installed — skipping Drive upload"
    return 0
  fi

  log "Uploading to ${RCLONE_REMOTE}:${remote_path}"
  rclone copyto "${file}" "${RCLONE_REMOTE}:${remote_path}" --progress 2>&1
  log "Upload complete: ${remote_path}"
}

# Clean up old archive files beyond retention
cleanup_old() {
  log "Cleaning up archives older than ${RETENTION_DAYS} days"
  find "${BACKUP_DIR}/archive" -name "*.dump" -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
  local remaining=$(find "${BACKUP_DIR}/archive" -name "*.dump" | wc -l)
  log "Archive files remaining: ${remaining}"
}

# ────────────────────────────────────────────────
#  MAIN
# ────────────────────────────────────────────────

main() {
  log "========================================="
  log "Starting PostgreSQL backup"
  log "========================================="

  ensure_dirs

  # 1. Create the dump
  local archive_file="${BACKUP_DIR}/archive/supabase_${TIMESTAMP}.dump"
  log "Dump target: ${archive_file}"

  if ! run_pg_dump "${archive_file}"; then
    error "pg_dump failed!"
    exit 1
  fi

  local file_size=$(du -h "${archive_file}" | cut -f1)
  log "Dump complete: ${file_size}"

  # 2. Copy to rotation slots

  # Daily — always
  cp "${archive_file}" "${BACKUP_DIR}/daily/backup-daily.dump"
  log "Updated: daily/backup-daily.dump"

  # Weekly — every Sunday (day 7)
  if [ "${DAY_OF_WEEK}" = "7" ]; then
    cp "${archive_file}" "${BACKUP_DIR}/weekly/backup-weekly.dump"
    log "Updated: weekly/backup-weekly.dump"
  fi

  # Monthly — 1st of month
  if [ "${DAY_OF_MONTH}" = "01" ]; then
    cp "${archive_file}" "${BACKUP_DIR}/monthly/backup-monthly.dump"
    log "Updated: monthly/backup-monthly.dump"
  fi

  # 3. Upload to Google Drive (if configured)
  upload_to_drive "${BACKUP_DIR}/daily/backup-daily.dump" "${RCLONE_FOLDER}/backup-daily.dump"

  if [ "${DAY_OF_WEEK}" = "7" ]; then
    upload_to_drive "${BACKUP_DIR}/weekly/backup-weekly.dump" "${RCLONE_FOLDER}/backup-weekly.dump"
  fi

  if [ "${DAY_OF_MONTH}" = "01" ]; then
    upload_to_drive "${BACKUP_DIR}/monthly/backup-monthly.dump" "${RCLONE_FOLDER}/backup-monthly.dump"
  fi

  # 4. Clean up old archives
  cleanup_old

  log "========================================="
  log "Backup complete!"
  log "  Archive:  ${archive_file} (${file_size})"
  log "  Daily:    updated"
  log "  Weekly:   $([ "${DAY_OF_WEEK}" = "7" ] && echo 'updated' || echo 'skipped (not Sunday)')"
  log "  Monthly:  $([ "${DAY_OF_MONTH}" = "01" ] && echo 'updated' || echo 'skipped (not 1st)')"
  log "  Drive:    $([ -n "${RCLONE_REMOTE}" ] && echo 'uploaded' || echo 'skipped (no rclone remote)')"
  log "========================================="
}

main "$@"
