/**
 * Code.gs — Entry point for the Clinic Progress Report web app
 *
 * Responsibilities:
 *   1. Serve the landing page via doGet()
 *   2. Authenticate the user (Google account, @rsu.ac.th domain)
 *   3. Provide server-side functions callable from the frontend
 */

// ──────────────────────────────────────────────
//  Web App entry point
// ──────────────────────────────────────────────

/**
 * Serves the landing page.
 * @param {GoogleAppsScript.Events.DoGet} e
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  var page = e.parameter.page;
  var url = ScriptApp.getService().getUrl();

  if (page === "admin") {
    var t = HtmlService.createTemplateFromFile("admin");
    t.appUrl = url;
    return t
      .evaluate()
      .setTitle("Admin Console — Clinic Progress Report")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  var t = HtmlService.createTemplateFromFile("landing");
  t.appUrl = url;
  return t
    .evaluate()
    .setTitle("Clinic Progress Report — RSU")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/**
 * Get the Web App URL (backend helper).
 * @returns {string}
 */
function getAppUrl() {
  return ScriptApp.getService().getUrl();
}

/**
 * Include helper — allows <?!= include('styles') ?> in HTML templates.
 * @param {string} filename
 * @returns {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ──────────────────────────────────────────────
//  Authentication & authorization
// ──────────────────────────────────────────────

/**
 * Get the current user's email from the Google session.
 * Called from the frontend via google.script.run.
 *
 * @returns {{ email: string, allowed: boolean }}
 */
function getCurrentUser() {
  var email = Session.getActiveUser().getEmail();
  var allowed = email && email.toLowerCase().endsWith("@" + ALLOWED_DOMAIN);
  return {
    email: email || "",
    allowed: !!allowed,
  };
}

/**
 * Fetch the full user profile from the database.
 * Combines data from users + students/instructors tables.
 * Called from the frontend via google.script.run.
 *
 * @param {string} email
 * @returns {Object} profile object
 */
function getUserProfile(email) {
  if (!email) return { found: false, reason: "No email provided" };

  // Validate domain
  if (!email.toLowerCase().endsWith("@" + ALLOWED_DOMAIN)) {
    return { found: false, reason: "access_denied" };
  }

  try {
    // Look up base user record (via failover)
    var userResult = FailoverProvider.getUserByEmail(email);
    var user = userResult.data;
    var source = userResult.source; // 'supabase' or 'sheets'

    if (!user) {
      return { found: false, reason: "user_not_found", source: source };
    }

    // Check active status
    if (user.status && user.status !== "active") {
      return {
        found: true,
        active: false,
        reason: "inactive",
        email: user.email,
        name: user.name || "",
        role: user.role,
        status: user.status,
        source: source,
      };
    }

    // Build profile based on role
    var profile = {
      found: true,
      active: true,
      email: user.email,
      name: user.name || "",
      role: user.role,
      status: user.status,
      user_id: user.user_id,
      source: source,
    };

    if (user.role === "student") {
      var studentResult = FailoverProvider.getStudentByUserId(user.user_id);
      var student = studentResult.data;
      if (student) {
        profile.student_id = student.student_id;
        profile.first_clinic_year = student.first_clinic_year;
        profile.floor_id = student.floor_id || null;
        profile.unit_id = student.unit_id || null;
      }
    } else if (user.role === "instructor" || user.role === "admin") {
      var instrResult = FailoverProvider.getInstructorByUserId(user.user_id);
      var instructor = instrResult.data;
      if (instructor) {
        profile.instructor_id = instructor.instructor_id;
        profile.teamleader_role = instructor.teamleader_role || false;
        profile.division = instructor.divisions
          ? { name: instructor.divisions.name, code: instructor.divisions.code }
          : null;
      }
    }

    return profile;
  } catch (e) {
    Logger.log("getUserProfile error: " + e.message);
    return { found: false, reason: "error", message: e.message };
  }
}

/**
 * Check system health (for admin dashboard use).
 * @returns {Object}
 */
function checkSystemHealth() {
  return FailoverProvider.healthCheck();
}

// ──────────────────────────────────────────────
//  Admin Console Handlers
// ──────────────────────────────────────────────

/**
 * Ensure current user is an admin.
 * @throws {Error} if not admin
 */
function _assertAdmin() {
  var email = Session.getActiveUser().getEmail();
  // We can't use getUserProfile here effectively if it recursively calls something?
  // FailoverProvider is safe.
  var user = FailoverProvider.getUserByEmail(email);
  if (!user || !user.data || user.data.role !== "admin") {
    throw new Error("Access denied: Unauthorized.");
  }
  return user.data;
}

/**
 * List all users (Admin only).
 */
function adminListUsers() {
  _assertAdmin();
  var result = FailoverProvider.listUsers();
  // Result is { source: '...', data: [...] } or just data if we called listUsers directly?
  // FailoverProvider.listUsers returns { source, data } (from _call)
  return result.data || [];
}

/**
 * Create a new user (Admin only).
 * Handles Auth creation + Public User + Role Record.
 */
function adminCreateUser(form) {
  _assertAdmin();

  try {
    // 1. Check if exists
    var check = FailoverProvider.getUserByEmail(form.email);
    if (check.data) {
      return { success: false, error: "User with this email already exists." };
    }

    // 2. Create Auth User (or generate ID)
    // Use a random password since we use Google Auth for login
    var password = Utilities.getUuid();
    var authResult = FailoverProvider.createAuthUser(form.email, password);
    var userId = authResult.data.id;

    // 3. Create Public User
    var userPayload = {
      user_id: userId,
      email: form.email,
      name: form.name,
      role: form.role,
      status: form.status || "active",
    };
    FailoverProvider.createUser(userPayload);

    // 4. Create Role Record
    if (form.role === "student") {
      FailoverProvider.createStudent({
        student_id: Utilities.getUuid(),
        user_id: userId,
        first_clinic_year:
          parseInt(form.first_clinic_year) || new Date().getFullYear(),
        // floor_id, unit_id optional
        status: form.status || "active",
      });
    } else if (form.role === "instructor") {
      FailoverProvider.createInstructor({
        instructor_id: Utilities.getUuid(),
        user_id: userId,
        teamleader_role: !!form.teamleader_role,
        // division_id optional (UI doesn't support picking division yet? Plan said Add/Edit modals...
        // Logic for division is complex (UUIDs). For now, leave null or default?)
        status: form.status || "active",
      });
    } // Admin has no extra table? Or is Admin also an Instructor?
    // Schema says "instructors" table has division. "users" table has role 'admin'.
    // If Admin needs to be in instructors table (e.g. they verified stuff), they should be created there too?
    // User requested "Admin... stored in instructors table".
    // So separate logic:
    if (form.role === "admin") {
      // Admins are usually instructors too, or separate?
      // User said "Admin and instructor information is stored in the instructors table"
      FailoverProvider.createInstructor({
        instructor_id: Utilities.getUuid(),
        user_id: userId,
        teamleader_role: false,
        status: form.status || "active",
      });
    }

    return { success: true };
  } catch (e) {
    Logger.log("adminCreateUser error: " + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Update a user (Admin only).
 * Handles role changes by ensuring role-specific record exists (Upsert).
 */
function adminUpdateUser(userId, form) {
  _assertAdmin();

  try {
    // 1. Update Public User (including optional role change)
    FailoverProvider.updateUser(userId, {
      name: form.name,
      status: form.status,
      role: form.role, // Update role in users table
    });

    // 2. Upsert Role Data (Student/Instructor)
    // If user switched role, we create the new record if it doesn't exist.

    if (form.role === "student") {
      var s = FailoverProvider.getStudentByUserId(userId);
      if (s.data) {
        // Update existing student record
        FailoverProvider.updateStudent(s.data.student_id, {
          first_clinic_year:
            parseInt(form.first_clinic_year) || new Date().getFullYear(),
          status: form.status,
          updated_at: new Date().toISOString(),
        });
      } else {
        // Create new student record (Role Migration)
        FailoverProvider.createStudent({
          student_id: Utilities.getUuid(),
          user_id: userId,
          first_clinic_year:
            parseInt(form.first_clinic_year) || new Date().getFullYear(),
          status: form.status || "active",
        });
      }
    } else if (form.role === "instructor" || form.role === "admin") {
      var i = FailoverProvider.getInstructorByUserId(userId);
      if (i.data) {
        // Update existing instructor record
        FailoverProvider.updateInstructor(i.data.instructor_id, {
          teamleader_role: !!form.teamleader_role,
          status: form.status,
          updated_at: new Date().toISOString(),
        });
      } else {
        // Create new instructor record (Role Migration)
        FailoverProvider.createInstructor({
          instructor_id: Utilities.getUuid(),
          user_id: userId,
          teamleader_role: !!form.teamleader_role,
          status: form.status || "active",
        });
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Get full user details for editing (Admin only).
 * Fetches base user + role-specific data using email.
 */
function adminGetUserDetail(email) {
  _assertAdmin();

  // 1. Get Base User
  var userResult = FailoverProvider.getUserByEmail(email);
  if (!userResult || !userResult.data) {
    throw new Error("User not found: " + email);
  }
  var user = userResult.data;

  // 2. Enrich with role data
  if (user.role === "student") {
    var s = FailoverProvider.getStudentByUserId(user.user_id);
    if (s.data) {
      user.first_clinic_year = s.data.first_clinic_year;
      // Add other student fields if needed
    }
  } else if (user.role === "instructor" || user.role === "admin") {
    var i = FailoverProvider.getInstructorByUserId(user.user_id);
    if (i.data) {
      user.teamleader_role = !!i.data.teamleader_role;
      // Add other instructor fields
    }
  }

  return user;
}

/**
 * Delete a user (Admin only).
 * Restricted to Students and Instructors.
 */
function adminDeleteUser(userId) {
  var admin = _assertAdmin();

  // Prevent self-deletion
  if (admin.user_id === userId) {
    return { success: false, error: "Cannot delete yourself." };
  }

  // Find target user to verify role
  var users = FailoverProvider.listUsers().data || [];
  var target = users.find(function (u) {
    return u.user_id === userId;
  });

  if (!target) {
    return { success: false, error: "User not found." };
  }

  // Strict check per requirement
  if (target.role !== "student" && target.role !== "instructor") {
    return {
      success: false,
      error: "Only Students and Instructors can be deleted.",
    };
  }

  try {
    FailoverProvider.deleteFullUser(userId, target.role);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
