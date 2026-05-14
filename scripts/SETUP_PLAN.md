# Backup & Restore Setup Plan — Self-Hosted Supabase (Docker)

> **Target:** University virtual server running Supabase in Docker
> **Agent:** Execute each task sequentially. Verify the acceptance criteria before moving to the next task.
> **Estimated tasks:** 8

---

## Pre-requisites (verify before starting)

- [ ] SSH access to the server
- [ ] `docker` and `docker compose` installed and running
- [ ] Supabase running in Docker (`docker ps` shows postgres container)
- [ ] The files `scripts/pg_backup.sh` and `scripts/pg_restore.sh` exist in the project repo

---

## Task 1: Discover the Environment

**Goal:** Identify the Postgres container name, user, database, and Supabase data directory.

**Steps:**
```bash
# 1. Find the Postgres container
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" | grep -i postgres

# 2. Find the Supabase project directory (where docker-compose.yml lives)
find / -name "docker-compose.yml" -path "*/supabase*" 2>/dev/null | head -5

# 3. Check Postgres version inside the container
docker exec <CONTAINER_NAME> pg_dump --version

# 4. Check the database name and user
docker exec <CONTAINER_NAME> psql -U postgres -c "SELECT current_database(), current_user;"

# 5. List all schemas to confirm oracle schema exists
docker exec <CONTAINER_NAME> psql -U postgres -c "\dn"

# 6. Count rows in key tables to have a baseline
docker exec <CONTAINER_NAME> psql -U postgres -c "
  SELECT 'users' as t, count(*) FROM public.users
  UNION ALL SELECT 'students', count(*) FROM public.students
  UNION ALL SELECT 'treatment_records', count(*) FROM public.treatment_records
  UNION ALL SELECT 'patients', count(*) FROM public.patients
  ORDER BY t;
"
```

**Acceptance criteria:**
- Container name is known (e.g. `supabase-db`)
- Postgres version confirmed (15.x expected)
- Database name confirmed (likely `postgres`)
- Oracle schema exists
- Row counts recorded for post-restore verification

**Output:** Record these values — they are used in all subsequent tasks:
```
CONTAINER_NAME=<value>
PG_USER=postgres
PG_DB=postgres
```

---

## Task 2: Create Backup Directory Structure

**Goal:** Create the directory tree for backup files with proper permissions.

**Steps:**
```bash
# 1. Create directories
sudo mkdir -p /var/backups/supabase/{daily,weekly,monthly,archive}

# 2. Set ownership to current user
sudo chown -R $(whoami):$(whoami) /var/backups/supabase

# 3. Set permissions (owner read/write, group read, others none)
chmod -R 750 /var/backups/supabase

# 4. Create log file
sudo touch /var/log/pg_backup.log
sudo chown $(whoami):$(whoami) /var/log/pg_backup.log

# 5. Verify
ls -la /var/backups/supabase/
```

**Acceptance criteria:**
- All 4 subdirectories exist: `daily/`, `weekly/`, `monthly/`, `archive/`
- Current user owns the directories
- Log file exists and is writable

---

## Task 3: Deploy Backup Scripts

**Goal:** Copy backup and restore scripts to the server and make them executable.

**Steps:**
```bash
# 1. Create scripts directory on server
mkdir -p ~/supabase-backup

# 2. Copy scripts (from local machine via SCP, or create directly)
# Option A: SCP from local
# scp scripts/pg_backup.sh scripts/pg_restore.sh user@server:~/supabase-backup/

# Option B: If already on server, copy from repo
cp /path/to/repo/scripts/pg_backup.sh ~/supabase-backup/
cp /path/to/repo/scripts/pg_restore.sh ~/supabase-backup/

# 3. Make executable
chmod +x ~/supabase-backup/pg_backup.sh
chmod +x ~/supabase-backup/pg_restore.sh

# 4. Verify scripts are valid bash
bash -n ~/supabase-backup/pg_backup.sh && echo "pg_backup.sh: syntax OK"
bash -n ~/supabase-backup/pg_restore.sh && echo "pg_restore.sh: syntax OK"
```

**Acceptance criteria:**
- Both scripts exist in `~/supabase-backup/`
- Both have execute permission
- Both pass syntax check

---

## Task 4: Test Manual Backup

**Goal:** Run a backup manually and verify the dump file is valid.

**Steps:**
```bash
# 1. Run the backup script with environment variables
DOCKER_CONTAINER=<CONTAINER_NAME> \
BACKUP_DIR=/var/backups/supabase \
~/supabase-backup/pg_backup.sh

# 2. Check output files
ls -lh /var/backups/supabase/daily/
ls -lh /var/backups/supabase/archive/

# 3. Verify dump file is not empty and is valid
DUMP_FILE=$(ls -t /var/backups/supabase/archive/*.dump | head -1)
echo "Latest dump: $DUMP_FILE"
echo "Size: $(du -h "$DUMP_FILE" | cut -f1)"

# 4. List contents of the dump to verify tables are captured
pg_restore --list "$DUMP_FILE" 2>/dev/null | grep "TABLE DATA" | wc -l
echo "tables found in dump"

# 5. Verify specific critical tables are present
pg_restore --list "$DUMP_FILE" 2>/dev/null | grep -E "treatment_records|patients|students|users"

# 6. Verify oracle schema is included
pg_restore --list "$DUMP_FILE" 2>/dev/null | grep -i "oracle" || echo "WARNING: oracle schema not found"
```

**Acceptance criteria:**
- `backup-daily.dump` exists in `/var/backups/supabase/daily/`
- Timestamped archive exists in `/var/backups/supabase/archive/`
- Dump file size is > 0 (typically several MB)
- TABLE DATA entries found for `treatment_records`, `patients`, `students`, `users`
- Log shows "Backup complete!"

**If pg_restore --list fails or oracle schema is missing:**
The Docker `pg_dump` may not have access to all schemas. Fix by running pg_dump with `--schema=public --schema=oracle` or by dumping from outside Docker with direct port access. Adjust the `run_pg_dump()` function in `pg_backup.sh` accordingly.

---

## Task 5: Test Restore (Dry Run)

**Goal:** Verify the restore script works without actually modifying data.

**Steps:**
```bash
# 1. List mode — see what's in the dump
DOCKER_CONTAINER=<CONTAINER_NAME> \
~/supabase-backup/pg_restore.sh --list /var/backups/supabase/daily/backup-daily.dump

# 2. Dry run — preview what would happen
DOCKER_CONTAINER=<CONTAINER_NAME> \
~/supabase-backup/pg_restore.sh --dry-run /var/backups/supabase/daily/backup-daily.dump
```

**Acceptance criteria:**
- `--list` shows table names and object types
- `--dry-run` completes without errors and shows the correct target database

**Do NOT run actual restore** unless explicitly requested. This task is verification only.

---

## Task 6: Create Environment Config File

**Goal:** Create a config file so cron doesn't need inline env vars.

**Steps:**
```bash
# 1. Create environment file (not in a git-tracked directory)
cat > ~/supabase-backup/.env << 'EOF'
# Supabase Backup Configuration
# Created: $(date -I)

DOCKER_CONTAINER=<CONTAINER_NAME>
PG_USER=postgres
PG_DB=postgres
BACKUP_DIR=/var/backups/supabase
RETENTION_DAYS=30

# Optional: Google Drive upload via rclone
# RCLONE_REMOTE=gdrive
# RCLONE_FOLDER=backup-tracker/pg-dumps
EOF

# 2. Restrict permissions (contains no secrets, but good practice)
chmod 600 ~/supabase-backup/.env

# 3. Create a wrapper script that loads the env file
cat > ~/supabase-backup/run_backup.sh << 'WRAPPER'
#!/bin/bash
# Wrapper: loads config and runs backup
set -a
source "$(dirname "$0")/.env"
set +a
exec "$(dirname "$0")/pg_backup.sh"
WRAPPER

chmod +x ~/supabase-backup/run_backup.sh

# 4. Test the wrapper
~/supabase-backup/run_backup.sh
```

**Acceptance criteria:**
- `.env` file exists with correct `DOCKER_CONTAINER` value
- `run_backup.sh` wrapper exists and is executable
- Running the wrapper produces a successful backup

---

## Task 7: Set Up Cron Job

**Goal:** Schedule the backup to run automatically at 1:00 AM daily.

**Steps:**
```bash
# 1. Open crontab for editing
crontab -e

# 2. Add this line (adjust path to your home directory):
# ┌─ minute (0-59)
# │ ┌─ hour (0-23)
# │ │ ┌─ day of month (1-31)
# │ │ │ ┌─ month (1-12)
# │ │ │ │ ┌─ day of week (0-7, Sun=0 or 7)
# │ │ │ │ │
# 0 1 * * * /home/<USERNAME>/supabase-backup/run_backup.sh >> /var/log/pg_backup.log 2>&1

# 3. Verify cron is registered
crontab -l

# 4. Verify cron daemon is running
systemctl status cron || service cron status
```

**Acceptance criteria:**
- `crontab -l` shows the backup entry at `0 1 * * *`
- Cron daemon is active and running

**Verification (next day):**
```bash
# Check the log for last night's run
tail -30 /var/log/pg_backup.log

# Check the daily file was updated
ls -lh /var/backups/supabase/daily/backup-daily.dump
stat /var/backups/supabase/daily/backup-daily.dump | grep Modify
```

---

## Task 8: Verify End-to-End

**Goal:** Confirm the complete backup system is operational.

**Steps:**
```bash
# 1. Check all backup files
echo "=== Daily ==="
ls -lh /var/backups/supabase/daily/

echo "=== Archive ==="
ls -lh /var/backups/supabase/archive/ | tail -5

echo "=== Weekly (may be empty until Sunday) ==="
ls -lh /var/backups/supabase/weekly/ 2>/dev/null || echo "(empty — updates on Sunday)"

echo "=== Monthly (may be empty until 1st) ==="
ls -lh /var/backups/supabase/monthly/ 2>/dev/null || echo "(empty — updates on the 1st)"

# 2. Validate the latest dump
LATEST=$(ls -t /var/backups/supabase/archive/*.dump | head -1)
echo "Latest dump: $LATEST ($(du -h "$LATEST" | cut -f1))"
TABLE_COUNT=$(pg_restore --list "$LATEST" 2>/dev/null | grep "TABLE DATA" | wc -l)
echo "Tables in dump: $TABLE_COUNT"

# 3. Verify cron
echo "=== Cron entry ==="
crontab -l | grep backup

# 4. Check log
echo "=== Last log entry ==="
tail -5 /var/log/pg_backup.log

# 5. Check disk space for backup directory
echo "=== Disk usage ==="
du -sh /var/backups/supabase/
df -h /var/backups/supabase/
```

**Acceptance criteria:**
- [ ] Daily dump file exists and is recent (< 24h old)
- [ ] Dump contains expected number of tables (public + oracle)
- [ ] Cron entry is registered
- [ ] Log shows successful runs
- [ ] Disk has sufficient free space (dump size x 35 days as minimum)

---

## Summary: What Gets Created

```
~/supabase-backup/
├── .env                  # Configuration (container name, paths)
├── run_backup.sh         # Wrapper that loads .env and runs backup
├── pg_backup.sh          # Main backup script
└── pg_restore.sh         # Restore script

/var/backups/supabase/
├── daily/
│   └── backup-daily.dump       # Replaced every night
├── weekly/
│   └── backup-weekly.dump      # Replaced every Sunday
├── monthly/
│   └── backup-monthly.dump     # Replaced on the 1st
└── archive/
    ├── supabase_20260412_010000.dump
    ├── supabase_20260413_010000.dump
    └── ...                     # Kept for 30 days

/var/log/pg_backup.log          # Backup run log
```

## Cron Schedule

| Time | Action |
|------|--------|
| 00:00 | GAS `runAllBackups()` — Sheets + Drive ZIP (via Google) |
| 01:00 | `pg_backup.sh` — Full PostgreSQL dump (via server cron) |

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "permission denied" on backup dir | Wrong ownership | `sudo chown -R $(whoami) /var/backups/supabase` |
| "could not connect to server" | Wrong container name | Check `docker ps \| grep postgres` |
| Empty dump file (0 bytes) | pg_dump error inside Docker | Run `docker exec <container> pg_dump -U postgres -d postgres > /dev/null` to see errors |
| "command not found: pg_restore" | pg client tools not on host | Install: `sudo apt install postgresql-client` or use `--list` inside Docker |
| Cron not running | Cron daemon stopped | `sudo systemctl start cron` |
| Disk full | Archive not rotating | Check `RETENTION_DAYS` in `.env`; run `find /var/backups/supabase/archive -mtime +30 -delete` |
| Oracle schema not in dump | Docker pg_dump schema scope | Add `--schema=public --schema=oracle` to pg_dump args in `pg_backup.sh` |
