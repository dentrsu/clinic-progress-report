# Clinic Progress Report

A web application for tracking dental student clinical progress at Rangsit University, College of Dental Medicine. Built on Google Apps Script with Supabase (PostgreSQL) as the sole database. Google Sheets serves as a nightly backup destination.

---

## Architecture

```
Browser UI  →  GAS Web App  →  SupabaseProvider  →  Supabase (Single Source of Truth)
                                └─ BackupScheduler  →  1. Google Sheets (Failover)
                                                    →  2. Google Drive ZIP (Point-in-Time)
Server Shell →  backup.sh   →  rclone + Restic     →  3. Google Drive Repo (Full Dump)
```

### Data Strategy & Multi-Layer Backup

The system follows a **Three-Layer Backup Strategy** to ensure zero data loss and rapid recovery:

1.  **Failover Layer (Google Sheets)**: A nightly trigger (`runAllBackups`) mirrors all Supabase tables to a Google Spreadsheet. This provides a human-readable, instant-access recovery point if the primary database is unreachable.
2.  **Archive Layer (Google Drive ZIP)**: The same trigger produces individual JSON dumps of every table, compresses them into a ZIP archive, and stores them in the `backup-tracker` folder on Google Drive. It maintains daily, weekly, and monthly rotations.
3.  **Infrastructure Layer (Server Restic)**: A shell script on the Supabase host runs a full `pg_dumpall`, which is then encrypted and deduplicated via **Restic** before being pushed to a dedicated repository on Google Drive (`dentrsu-tracker`). This captured everything—including Auth schemas, functions, and RLS policies.

---

## Admin Console

A dedicated interface for administrators to manage users.

### Features

- **User Management**: Create, Read, Update, Delete (CRUD) for all user roles.
- **Role Switching**: Seamlessly migrate users between 'Student' and 'Instructor' roles (automatically handles underlying data records).
- **Student Portal**:
  - **Patient Management**: Detail modal to edit patient info and complexity (1, 2, >=2).
  - **Dynamic Card Coloring**: Patient cards change background color (Emerald/Blue/Amber) based on complexity level.
  - **Treatment Plans**: Dedicated page for viewing/managing treatment records.
    - **Verification Workflow**: Students can request email verification for 'Completed' records (automatically shifts to 'Pending Verification'). Supports re-requests if 'Rejected'.
  - **Requirement Vault**: Per-division progress tracking with RSU/CDA tables and radar chart. Tracks both 'Verified' and 'Estimated' status (Completed/Pending/Rejected).
  - **Verify Email Proof**: Students can access the standalone hash verifier (`?page=verify`) to validate verification proof emails.
  - **Announcements**: Receives system announcements with dismissal support (same as landing page).
  - **Auto-Redirect**: Students are automatically redirected from the landing page to the Student Portal.
  - **N/A Progress Distribution Calculation**:
    - Choose the **Whole Division** view as an administrator.
    - Select the dropdown filters (e.g., Year 4) to narrow the student list.
    - **Verify**: The progress distribution bars accurately compute an **"N/A"** baseline for each requirement. The N/A segment represents the minimum requirement multiplied by the number of currently filtered students who have no submitted records for that component.
- **Instructor Portal**:
  - View assigned students (team leader view).
  - Student detail modal with patient list and requirement vault link.
  - **Verify Treatment Hash**: Collapsible section to validate a student's verification proof by recomputing the HMAC-SHA256 hash.
- **Advisor Portal** (`?page=advisor`):
  - View advisee students filtered by the instructor's assigned division.
  - Student detail modal with embedded division-specific requirement progress (RSU & CDA tables).
  - Click-to-expand records for each requirement.
- **Admin Console**:
  - Manage Users (Students/Instructors).
  - **System Announcements**: Broadcast messages to specific user roles (Students, Instructors, or Both) with scheduled start/end dates. Users can dismiss announcements so they don't load again.
  - **Academic ID Support**: Manage Real-world Student IDs.
  - **Verify Hash Tab**: Validate student verification proof hashes (HMAC-SHA256).
  - **Email Send Controls**: Separate toggles for verification request emails (to instructors) and verification result emails (to students).
  - System Health Check.
- **Nightly Backup**: All Supabase tables are automatically synced to Google Sheets at midnight via a GAS time-based trigger.
- **Patient Synchronization**:
  - **Full Sync**: Manual or scheduled import of all patient records from the configured `PATIENT_SHEET_ID` Google Sheet.
  - **Targeted Sync**: Admin and Students can sync specific Hospital Numbers (HNs) for faster updates.
  - **Auto-Verification**: Student-triggered syncs automatically verify if the patient is assigned to the current user and provide feedback.
- **Progress Tracking**: Real-time progress bars in the Admin Console for long-running sync processes.
- **Security**: Access restricted to users with `role: admin`.

---

## 9. Patient Synchronization

Follow these steps to verify the patient data synchronization tools.

1. **Admin: Full Sync**
   - Go to **Admin Console** → **Patients** tab.
   - Click **"Sync All Patients"**.
   - **Verify**: A progress bar appears showing the current HN, total count, and updated record count.
   - **Verify**: Check the browser console or toast message for final results (Created/Updated stats).

2. **Admin: Targeted Sync**
   - In the **Patients** tab, enter one or more HNs into the **"Sync Selected Patients by HN"** textarea.
   - Click **"Sync X Patient(s)"**.
   - **Verify**: Only the specified HNs are processed. The progress bar updates accordingly.

3. **Student: Personal Sync**
   - Log in as a **student**.
   - At the top of the **Patient List**, enter an HN in the sync strip and click **"Sync"**.
   - **Case A (Assigned)**: Sync an HN that matches your student email in the Master Sheet.
     - **Verify**: Success message appears and the patient card is added/updated in your list.
   - **Case B (Unassigned)**: Sync an HN not assigned to you.
     - **Verify**: Success message confirms the database update, but an amber warning informs you that the patient is not yet assigned to you.

---

## Design System

| Token          | Value                                            | Usage                             |
| -------------- | ------------------------------------------------ | --------------------------------- |
| Primary (Navy) | `#1B2A4A`                                        | Headers, buttons, branding        |
| Accent (Gold)  | `#C4972F`                                        | Highlights, badges, admin accents |
| Background     | `#F8F7F4`                                        | Page background                   |
| Card           | `#FFFFFF`                                        | Content cards                     |
| Font           | [Inter](https://fonts.google.com/specimen/Inter) | All text                          |
| Complexity 1   | `#ECFDF5` (Emerald-50)                           | Low complexity patient cards      |
| Complexity 2   | `#EFF6FF` (Blue-50)                              | Moderate complexity patient cards |
| Complexity >=2 | `#FEF3C7` (Amber-50)                             | High complexity patient cards     |

Style: **clean, minimalist, academic, professional**.

---

## Project Structure

```
clinic-progress-report/
├── gas/                        # Google Apps Script project
│   ├── Code.gs                 # Entry point: doGet(), auth, profile API
│   ├── Config.gs               # Script Properties helpers, constants
│   ├── SupabaseProvider.gs     # Supabase REST API wrapper (sole data provider)
│   ├── BackupScheduler.gs      # Nightly Supabase → Sheets backup + trigger mgmt
│   ├── SheetsProvider.gs       # Google Sheets helper (used by BackupScheduler)
│   ├── landing.html            # Landing page (Tailwind + Alpine.js)
│   ├── instructor.html         # Instructor portal (team leader view)
│   ├── advisor.html            # Advisor portal (division advisee view)
│   ├── admin.html              # Admin console
│   ├── treatment_plan.html     # Treatment plan page
│   ├── requirement_vault.html  # Student requirement vault
│   └── styles.html             # Shared CSS design tokens
├── database-context.md         # Database schema documentation
└── table-order-and-constraints.md  # Table DDL reference
```

---

## User Roles

| Role           | Stored In           | Permissions                                   |
| -------------- | ------------------- | --------------------------------------------- |
| **Admin**      | `instructors` table | Full access, system management                |
| **Instructor** | `instructors` table | View/verify student records in their division |
| **Student**    | `students` table    | View/create own treatment records             |

Access is restricted to **@rsu.ac.th** Google accounts only.

---

## Backup & Disaster Recovery

A scheduled trigger runs `runAllBackups()` daily at midnight, executing both the Sheets and Drive ZIP backups.

### 1. Google Sheets (Failover)
Standard spreadsheet with dedicated tabs for each table. Managed via `backupAllTablesToSheets()`.

| Table               | Backed Up |
| ------------------- | --------- |
| `users`             | ✅        |
| `students`          | ✅        |
| `instructors`       | ✅        |
| `divisions`         | ✅        |
| `floors`            | ✅        |
| `patients`          | ✅        |
| `treatment_phases`  | ✅        |
| `treatment_records` | ✅        |

### 2. Google Drive ZIP (Point-in-Time)
JSON dumps compressed into ZIP files. Stored in folder: **`backup-tracker`**.

- **`backup-daily.zip`**: Latest nightly snapshot.
- **`backup-weekly.zip`**: Sunday archive.
- **`backup-monthly.zip`**: 1st of month archive.

### 3. Server Restic (Infrastructure)
Encrypted, deduplicated repository for full server recovery. Stored in folder: **`dentrsu-tracker`**.
- Includes: `auth` schema, triggers, functions, and RLS policies.
- Tool: `restic` via `rclone`.

### Trigger Management
- Run `setupNightlyBackupTrigger()` once from the GAS editor to activate.
- Run `removeNightlyBackupTrigger()` to deactivate.

---

## Setup Instructions

### Prerequisites

- A Google Workspace account with `@rsu.ac.th` domain
- [Node.js](https://nodejs.org/) installed (for clasp)
- A Supabase project with the schema from `database-context.md`
- A Google Spreadsheet for nightly backups (sheets are created automatically by BackupScheduler)

### 1. Install clasp

```bash
npm install -g @google/clasp
clasp login
```

### 2. Create or clone the Apps Script project

**Option A — Create new:**

```bash
cd gas
clasp create --type webapp --title "Clinic Progress Report"
```

**Option B — Link existing:**

```bash
cd gas
clasp clone <SCRIPT_ID>
```

### 3. Push the code

```bash
cd gas
clasp push
```

### 4. Set Script Properties

In the Apps Script editor (`script.google.com`), go to **Project Settings → Script Properties** and add:

| Key                   | Value                                         |
| --------------------- | --------------------------------------------- |
| `SUPABASE_URL`        | `https://your-project.supabase.co`            |
| `SUPABASE_KEY`        | Your Supabase **service_role** key            |
| `FALLBACK_SHEET_ID`   | Google Spreadsheet ID for fallback            |
| `PATIENT_SHEET_ID`    | Google Sheet ID containing patient master records |
| `VERIFICATION_SECRET` | Random secret for verification hash (SHA-256) |

> ⚠️ **Never commit keys to version control.** They live only in Script Properties.

### 5. Deploy

1. In the Apps Script editor, click **Deploy → New deployment**
2. Select **Web app**
3. Set:
   - **Execute as:** User accessing the web app
   - **Who has access:** Anyone within your organization (RSU)
4. Click **Deploy** and copy the URL

### 6. Set up nightly backup

1. Create an empty Google Spreadsheet (sheets will be auto-created by the backup)
2. Add its ID as `FALLBACK_SHEET_ID` in Script Properties
3. In the GAS editor, run `setupNightlyBackupTrigger()` once
4. Optionally run `backupAllTablesToSheets()` to verify the first backup

---

## Development Workflow

1. Edit files in `gas/` locally
2. Push with `clasp push`
3. Test via the deployment URL
4. Commit to GitHub: `git add . && git commit -m "message" && git push`

For separate dev/prod environments, create two GAS deployments and maintain separate Script Properties.

---

## Limitations & Best Practices

| Constraint                   | Mitigation                                                   |
| ---------------------------- | ------------------------------------------------------------ |
| GAS 6-min execution limit    | Paginate large queries; avoid bulk operations                |
| GAS quota limits             | Cache repeated reads; batch API calls                        |
| Supabase is sole data source | Nightly backup to Sheets provides disaster recovery          |
| Sheets row limit (10M cells) | Backup is a snapshot, not a live mirror; manageable at scale |

---

## License

Internal use — Rangsit University, College of Dental Medicine.
