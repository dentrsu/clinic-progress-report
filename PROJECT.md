# Clinic Progress Report

A web application for tracking dental student clinical progress at Rangsit University, College of Dental Medicine. Built on Google Apps Script with Supabase (PostgreSQL) as the sole database. Google Sheets serves as a nightly backup destination.

---

## Architecture

```
Browser UI  →  GAS Web App  →  SupabaseProvider  →  Supabase (Single Source of Truth)
                                BackupScheduler   →  Google Sheets (Nightly Backup)
```

- **Frontend**: HtmlService + Tailwind CSS (CDN) + Alpine.js
- **Backend**: Google Apps Script acts as a **Backend-for-Frontend** (BFF).
- **Data Strategy**: All reads and writes go directly to Supabase. A nightly scheduled trigger (`BackupScheduler.gs`) syncs all tables to Google Sheets for disaster recovery.

---

## Admin Console

A dedicated interface for administrators to manage users.

### Features

- **User Management**: Create, Read, Update, Delete (CRUD) for all user roles.
- **Role Switching**: Seamlessly migrate users between 'Student' and 'Instructor' roles (automatically handles underlying data records).
- **Student Portal**:
  - Dashboard with "My Patients" and "Referred Patients".
  - **Patient Management**: Detail modal to edit patient info and assign students (using Academic ID or Name).
  - **Treatment Plans**: Dedicated page for viewing/managing treatment records.
    - **Verification Workflow**: Students can request email verification for 'Completed' records (automatically shifts to 'Pending Verification'). Supports re-requests if 'Rejected'.
  - **Requirement Vault**: Per-division progress tracking with RSU/CDA tables and radar chart. Tracks both 'Verified' and 'Estimated' status (Completed/Pending/Rejected).
- **Instructor Portal**:
  - View assigned students (team leader view).
  - Student detail modal with patient list and requirement vault link.
- **Advisor Portal** (`?page=advisor`):
  - View advisee students filtered by the instructor's assigned division.
  - Student detail modal with embedded division-specific requirement progress (RSU & CDA tables).
  - Click-to-expand records for each requirement.
- **Admin Console**:
  - Manage Users (Students/Instructors).
  - **Academic ID Support**: Manage Real-world Student IDs.
  - System Health Check.
- **Nightly Backup**: All Supabase tables are automatically synced to Google Sheets at midnight via a GAS time-based trigger.
- **Security**: Access restricted to users with `role: admin`.

---

## Design System

| Token          | Value                                            | Usage                             |
| -------------- | ------------------------------------------------ | --------------------------------- |
| Primary (Navy) | `#1B2A4A`                                        | Headers, buttons, branding        |
| Accent (Gold)  | `#C4972F`                                        | Highlights, badges, admin accents |
| Background     | `#F8F7F4`                                        | Page background                   |
| Card           | `#FFFFFF`                                        | Content cards                     |
| Font           | [Inter](https://fonts.google.com/specimen/Inter) | All text                          |

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

## Nightly Backup

A scheduled trigger runs `backupAllTablesToSheets()` daily at midnight:

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

- Each table is written to a dedicated sheet in the fallback spreadsheet.
- Pagination handles tables with >1000 rows.
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

| Key                 | Value                              |
| ------------------- | ---------------------------------- |
| `SUPABASE_URL`      | `https://your-project.supabase.co` |
| `SUPABASE_KEY`      | Your Supabase **service_role** key |
| `FALLBACK_SHEET_ID` | Google Spreadsheet ID for fallback |

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
