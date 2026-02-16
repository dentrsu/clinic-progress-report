# Clinic Progress Report

A web application for tracking dental student clinical progress at Rangsit University, College of Dental Medicine. Built on Google Apps Script with Supabase (PostgreSQL) as the primary database and Google Sheets as a fallback.

---

## Architecture

```
Browser UI  →  GAS Web App  →  FailoverProvider  →  Supabase (Primary)
                                                 ↘  Google Sheets (Backup/Mirror)
```

- **Frontend**: HtmlService + Tailwind CSS (CDN) + Alpine.js
- **Backend**: Google Apps Script acts as a **Backend-for-Frontend** (BFF).
- **Dual-Write Strategy**: Writes are sent to Supabase first. If successful, they are asynchronously mirrored to Google Sheets. If Supabase fails, the app falls back to Sheets transparently.

---

## Admin Console

A dedicated interface for administrators to manage users.

### Features

- **User Management**: Create, Read, Update, Delete (CRUD) for all user roles.
- **Role Switching**: Seamlessly migrate users between 'Student' and 'Instructor' roles (automatically handles underlying data records).
- **Failover-Ready**: Admin actions work even if Supabase is down (writing to Sheets only), and sync when the primary DB recovers (manual sync required currently).
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
│   ├── SupabaseProvider.gs     # Supabase REST API wrapper
│   ├── SheetsProvider.gs       # Google Sheets fallback provider
│   ├── FailoverProvider.gs     # Circuit breaker + health check
│   ├── landing.html            # Landing page (Tailwind + Alpine.js)
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

## Failover Mechanism

The app uses a **circuit breaker** pattern:

1. **Closed** (normal) — all requests go to Supabase
2. **Open** (outage) — after 3 consecutive failures, switches to Sheets for 60 seconds
3. **Half-open** — after cooldown, tries Supabase again; resets on success

State is stored in `CacheService.getScriptCache()` (shared across all users).

---

## Setup Instructions

### Prerequisites

- A Google Workspace account with `@rsu.ac.th` domain
- [Node.js](https://nodejs.org/) installed (for clasp)
- A Supabase project with the schema from `database-context.md`
- A Google Spreadsheet for fallback (with sheets: `users`, `students`, `instructors`, `divisions`)

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

### 6. Set up the fallback spreadsheet

Create a Google Spreadsheet with these sheets (one per table):

| Sheet Name    | Required Columns                                                              |
| ------------- | ----------------------------------------------------------------------------- |
| `users`       | `user_id`, `email`, `name`, `role`, `status`                                  |
| `students`    | `student_id`, `user_id`, `first_clinic_year`, `floor_id`, `unit_id`, `status` |
| `instructors` | `instructor_id`, `user_id`, `division_id`, `teamleader_role`, `status`        |
| `divisions`   | `division_id`, `code`, `name`                                                 |

---

## Development Workflow

1. Edit files in `gas/` locally
2. Push with `clasp push`
3. Test via the deployment URL
4. Commit to GitHub: `git add . && git commit -m "message" && git push`

For separate dev/prod environments, create two GAS deployments and maintain separate Script Properties.

---

## Limitations & Best Practices

| Constraint                   | Mitigation                                                  |
| ---------------------------- | ----------------------------------------------------------- |
| GAS 6-min execution limit    | Paginate large queries; avoid bulk operations               |
| GAS quota limits             | Cache repeated reads; batch API calls                       |
| Concurrent writes            | Use `LockService` for critical sections (e.g., outbox sync) |
| Sheets row limit (10M cells) | Keep Sheets as a lightweight mirror, not a complete replica |

---

## License

Internal use — Rangsit University, College of Dental Medicine.
