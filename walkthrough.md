# Walkthrough — Clinic Progress Report Landing Page

The GAS backend and landing page are ready. Follow these steps to deploy and verify the application.

## 1. Credentials Setup

To answer your question: **You should use the `service_role` key.**

> Why? This GAS app acts as a secure backend. It authenticates the user via Google, then uses the Service Role key to query Supabase with full privileges, bypassing Row Level Security (RLS) policies that would otherwise block public access. This is safe because the key is never exposed to the browser.

## 2. Push to Google Apps Script

If you haven't already pushed the code:

```bash
cd gas
clasp push
```

## 3. Configuration

In the Apps Script editor (Actions → Script Properties):

1.  Add `SUPABASE_URL`: `https://your-project.supabase.co`
2.  Add `SUPABASE_KEY`: **[Your service_role key]**
3.  Add `FALLBACK_SHEET_ID`: **[Your Google Sheet ID]**

## 4. Deploy

1.  Click **Deploy** → **New deployment**.
2.  Select **Web app**.
3.  Configuration:
    - **Description**: `Initial landing page`
    - **Execute as**: `User accessing the web app` (Critical for `Session.getActiveUser()` to work)
    - **Who has access**: `Anyone within your organization` (Restricts to @rsu.ac.th)
4.  Click **Deploy**.

## 5. Verification Scenarios

### Scenario A: Normal Login (Supabase)

**Action:** Open the web app URL with your @rsu.ac.th account.
**Expected:**

- Loading spinner appears.
- Your name and role (e.g., Admin/Instructor/Student) appear in the card.
- **Data Source** indicator at the bottom shows **Supabase** (Green).

### Scenario B: Fallback Mode (Sheets)

**Action:**

1.  Temporarily change `SUPABASE_URL` in Script Properties to an invalid URL (e.g., `https://invalid.supabase.co`).
2.  Refresh the web app.
    **Expected:**

- Loading might take slightly longer (timeout).
- Profile still loads successfully.
- **Data Source** indicator shows **Google Sheets** (Amber).

### Scenario C: Access Control

**Action:** Try opening the link with a personal Gmail account (in Incognito).
**Expected:**

- Google standard "You need permission" screen OR our custom "Access Restricted" card (depending on deployment settings).

## 5.5 Advisor Portal Verification

1. **Access**:
   - Log in as an **instructor** user.
   - On the landing page, click **"Enter Advisor Portal"**.
   - Verify the header shows your division code (e.g., "My Advisees (OPER)").

2. **Student List**:
   - Verify your assigned advisees appear as cards.
   - If no students are assigned to your division column, the empty state message should appear.

3. **Student Detail Modal**:
   - Click on a student card.
   - Verify the modal opens with student details (Academic ID, Floor/Unit, Team Leaders).
   - Wait for the loading spinner to resolve under "Division Requirements".
   - Verify RSU and CDA requirement tables appear with progress bars.
   - Click on a requirement row to expand and see individual patient records.

4. **Navigation**:
   - Click **"Requirement Dashboard"** button → should open in a new tab.
   - Click **"Lobby"** button → should return to landing page.

## 5. Admin Console Verification

After re-deploying the script:

1. **Access**:
   - Ensure your user role is set to `admin` in Supabase (`users` table) or Google Sheets (`users` sheet).
   - Reload the landing page. You should see an **"Admin Console"** button.
   - Click it to open the user management interface.

2. **Create User**:
   - Click **Add User**.
   - Enter details: `test.student@rsu.ac.th`, Name: `Test Student`, Role: `Student`, Start Year: `2024`.
   - Click **Save**.
   - **Verify**: Check Supabase `public.users` and `public.students` tables. Check the Google Sheet tabs.

3. **Edit User / Switch Role**:
   - Find the user you just created in the list.
   - Click **Edit**.
   - Change Role to `Instructor`, set Team Leader checked.
   - Click **Save**.
   - **Verify**: The role updates in table. In DB, `public.instructors` now has a record for this user ID.

4. **Delete User**:
   - Find the user again.
   - Click **Trash Icon**.
   - Confirm deletion.
   - **Verify**: User is removed from list. Removed from Supabase (`users`, `students`, `instructors`) and Sheets.

5. **Failover Test (Optional)**:
   - Temporarily change `SUPABASE_URL` in Script Properties to an invalid URL.
   - Try to **Add User**.
   - It should succeed, but save data _only_ to Google Sheets.
   - The user list should still load (from Sheets).

> [!IMPORTANT]
> **Testing Limitations**: The "Admin Console" button generates a link to the **Published (Exec)** version of the app.
>
> - If you are testing in **Developer Mode** (`/dev` URL), clicking the button will take you to the _Published_ version.
> - If you haven't published a new version recently, this link may point to an old version or return a "You need access" error.
> - **Workaround**: Manually append `?page=admin` to your `/dev` URL in the browser address bar to test the Admin Console in developer mode, or **Deploy a New Version** to update the published app.
