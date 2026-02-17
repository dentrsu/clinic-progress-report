/**
 * Code.gs — Entry point for the Clinic Progress Report web app
 *
 * Responsibilities:
 *   1. Serve the landing page via doGet()
 *   2. Authenticate the user (Google account, @rsu.ac.th domain)
 *   3. Authorize based on role (Student, Instructor, Admin)
 *   4. Route frontend requests to Supabase
 */

// ──────────────────────────────────────────────
//  Web App entry point
// ──────────────────────────────────────────────

/**
 * Get assigned patients for the current student.
 * @returns {Array} List of patient objects
 */
function getStudentPatients() {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (!profile.found || !profile.active || profile.role !== "student") {
    throw new Error("User is not an active student.");
  }

  var records =
    SupabaseProvider.listPatientsByStudent(profile.student_id) || [];

  // Normalize/Flatten names & IDs
  return records.map(function (p) {
    // Helper to extract name/id safely
    var getName = function (obj) {
      return obj && obj.user && obj.user.name ? obj.user.name : null;
    };
    var getAcad = function (obj) {
      return obj && obj.academic_id ? obj.academic_id : null;
    };

    p.student_1_name = getName(p.s1) || p.student_id_1 || "-";
    p.student_1_acad = getAcad(p.s1) || ""; // Empty if not set

    // Normalize HN (case-insensitive fallback)
    if (!p.hn && p.HN) p.hn = p.HN;
    if (!p.hn && p.Hn) p.hn = p.Hn;

    p.student_2_name = getName(p.s2) || p.student_id_2 || "-";
    p.student_2_acad = getAcad(p.s2) || "";

    p.student_3_name = getName(p.s3) || p.student_id_3 || "-";
    p.student_3_acad = getAcad(p.s3) || "";

    p.student_4_name = getName(p.s4) || p.student_id_4 || "-";
    p.instructor_name =
      getName(p.inst) ||
      (p.instructor_id ? "Inst ID: " + p.instructor_id : "-");

    return p;
  });
}

/**
 * Update patient details (Student).
 * Validates ownership before updating.
 * @param {string} hn
 * @param {Object} form
 */
function studentUpdatePatient(hn, form) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (!profile.found || !profile.active || profile.role !== "student") {
    throw new Error("User is not an active student.");
  }

  // 1. Fetch existing patient to verify ownership
  var patient = SupabaseProvider.getPatientByHn(hn);

  if (!patient) {
    throw new Error("Patient not found: " + hn);
  }

  // 2. Verify Ownership (Must be one of the assigned students)
  var myId = profile.student_id;
  var isAssigned =
    patient.student_id_1 === myId ||
    patient.student_id_2 === myId ||
    patient.student_id_3 === myId ||
    patient.student_id_4 === myId ||
    patient.student_id_5 === myId;

  if (!isAssigned) {
    throw new Error("You are not assigned to this patient.");
  }

  // 3. Prepare Update Payload
  // Whitelist fields to prevent overwriting metadata or unauthorized fields
  // Note: Student CAN update assigned student IDs (Handover/Referral)

  var payload = {
    status: form.status,
    birthdate: form.birthdate ? form.birthdate : null, // String YYYY-MM-DD is fine
    tel: form.tel,
    note: form.note,

    // Care Team Updates - Resolve Academic IDs to UUIDs
    student_id_1: _resolveStudentId(form.student_1_acad),
    student_id_2: _resolveStudentId(form.student_2_acad),
    student_id_3: _resolveStudentId(form.student_3_acad),
    student_id_4: _resolveStudentId(form.student_4_acad),
    student_id_5: _resolveStudentId(form.student_5_acad),

    updated_at: new Date().toISOString(),
  };

  // 4. Execute Update
  SupabaseProvider.updatePatient(patient.patient_id, payload);

  return { success: true };
}

/**
 * Helper to resolve Academic ID to Student UUID.
 * @param {string} academicId
 * @returns {string|null} UUID or null
 */
function _resolveStudentId(academicId) {
  if (!academicId || !String(academicId).trim()) return null;
  var acad = String(academicId).trim();

  // Try to find by Academic ID
  var s = SupabaseProvider.getStudentByAcademicId(acad);
  if (s) return s.student_id;

  // Optional: Fallback if they entered a UUID (legacy support or copy-paste)
  // But user specifically asked to show/use Academic ID.
  // Let's assume input is strictly Academic ID for now,
  // or check if input matches UUID pattern?
  // For strictness/correctness based on request, we stick to lookup.
  // If not found, we could throw or return null. Returning null clears assignment.
  // Throwing might be better UX if they typo.

  throw new Error("Student with ID '" + acad + "' not found.");
}

/**
 * Serves the landing page.
 * @param {GoogleAppsScript.Events.DoGet} e
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  var page = e.parameter.page;
  var url = ScriptApp.getService().getUrl(); // Always returns /exec URL
  var scriptId = ScriptApp.getScriptId();
  var devUrl = "https://script.google.com/macros/s/" + scriptId + "/dev";

  if (page === "admin") {
    var t = HtmlService.createTemplateFromFile("admin");
    t.appUrl = url;
    t.appDevUrl = devUrl;
    return t
      .evaluate()
      .setTitle("Admin Console — Clinic Progress Report")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  if (page === "treatment_plan") {
    var t = HtmlService.createTemplateFromFile("treatment_plan");
    t.appUrl = url;
    t.appDevUrl = devUrl;
    t.hn = e.parameter.hn || "";
    return t
      .evaluate()
      .setTitle("Treatment Plan — Clinic Progress Report")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  var t = HtmlService.createTemplateFromFile("landing");
  t.appUrl = url;
  t.appDevUrl = devUrl;
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
    // Look up base user record
    var user = SupabaseProvider.getUserByEmail(email);

    if (!user) {
      return { found: false, reason: "user_not_found" };
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
        source: "supabase",
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
      source: "supabase",
    };

    if (user.role === "student") {
      var student = SupabaseProvider.getStudentByUserId(user.user_id);
      if (student) {
        profile.student_id = student.student_id;
        profile.academic_id = student.academic_id; // Added for display
        profile.first_clinic_year = student.first_clinic_year;
        profile.floor_id = student.floor_id || null;
        profile.unit_id = student.unit_id || null;

        // Resolve Team Leaders
        var tl1Id = student.team_leader_1_id;
        var tl2Id = student.team_leader_2_id;

        if (tl1Id || tl2Id) {
          var instructors = SupabaseProvider.listInstructors() || [];

          if (tl1Id) {
            var tl1 = instructors.find(function (i) {
              return i.instructor_id === tl1Id;
            });
            if (tl1) {
              if (tl1.users && tl1.users.name)
                profile.team_leader_1_name = tl1.users.name;
              else if (tl1.user && tl1.user.name)
                profile.team_leader_1_name = tl1.user.name;
            }
          }
          if (tl2Id) {
            var tl2 = instructors.find(function (i) {
              return i.instructor_id === tl2Id;
            });
            if (tl2) {
              if (tl2.users && tl2.users.name)
                profile.team_leader_2_name = tl2.users.name;
              else if (tl2.user && tl2.user.name)
                profile.team_leader_2_name = tl2.user.name;
            }
          }
        }
      }
    } else if (user.role === "instructor" || user.role === "admin") {
      var instructor = SupabaseProvider.getInstructorByUserId(user.user_id);
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
  try {
    var ok = SupabaseProvider.ping();
    return { healthy: ok, source: "supabase" };
  } catch (e) {
    return { healthy: false, source: "supabase", error: e.message };
  }
}

// ──────────────────────────────────────────────
//  Admin Console Handlers
// ──────────────────────────────────────────────

/**
 * Get current maintenance mode status.
 */
function adminGetMaintenanceMode() {
  _assertAdmin();
  return false; // Maintenance mode removed — always connected to Supabase
}

/**
 * Set maintenance mode status.
 */
function adminSetMaintenanceMode(enabled) {
  _assertAdmin();
  // Maintenance mode removed — always connected to Supabase
  return { success: true, mode: false };
}

/**
 * Ensure current user is an admin.
 * @throws {Error} if not admin
 */
function _assertAdmin() {
  var email = Session.getActiveUser().getEmail();
  // We can't use getUserProfile here effectively if it recursively calls something?
  // Direct SupabaseProvider lookup.
  var user = SupabaseProvider.getUserByEmail(email);
  if (!user || user.role !== "admin") {
    throw new Error("Access denied: Unauthorized.");
  }
  return user;
}

/**
 * List all users (Admin only).
 */
function adminListUsers() {
  _assertAdmin();
  return SupabaseProvider.listUsers() || [];
}

/**
 * List all instructors (Admin only).
 * Needed for Team Leader dropdowns.
 */
function adminListInstructors() {
  _assertAdmin();
  return SupabaseProvider.listInstructors() || [];
}

/**
 * Create a new user (Admin only).
 * Handles Auth creation + Public User + Role Record.
 */
function adminCreateUser(form) {
  _assertAdmin();

  try {
    // 1. Check if exists
    var existing = SupabaseProvider.getUserByEmail(form.email);
    if (existing) {
      return { success: false, error: "User with this email already exists." };
    }

    // 2. Create Auth User
    var password = Utilities.getUuid();
    var authUser = SupabaseProvider.createAuthUser(form.email, password, {
      role: form.role,
      name: form.name,
    });
    var userId = authUser.id;

    // 3. Create Public User
    try {
      SupabaseProvider.createUser({
        user_id: userId,
        email: form.email,
        name: form.name,
        role: form.role,
        status: form.status || "active",
      });
    } catch (dupErr) {
      // Duplicate key (23505) is OK — Supabase trigger may have created it
      if (
        !dupErr.message ||
        (!dupErr.message.includes("23505") &&
          !dupErr.message.includes("duplicate key"))
      ) {
        throw dupErr;
      }
    }

    // 4. Create Role Record
    if (form.role === "student") {
      SupabaseProvider.createStudent({
        student_id: Utilities.getUuid(),
        user_id: userId,
        academic_id: form.academic_id ? String(form.academic_id).trim() : null,
        first_clinic_year:
          parseInt(form.first_clinic_year) || new Date().getFullYear(),
        floor_id: form.floor_id ? form.floor_id : null,
        unit_id: form.unit_id ? form.unit_id : null,
        team_leader_1_id: form.team_leader_1_id ? form.team_leader_1_id : null,
        team_leader_2_id: form.team_leader_2_id ? form.team_leader_2_id : null,
        status: form.status || "active",
      });
    } else if (form.role === "instructor" || form.role === "admin") {
      if (form.bay && !/^[A-Z]{1,2}$/.test(form.bay)) {
        return { success: false, error: "Bay must be 1-2 uppercase letters." };
      }
      SupabaseProvider.createInstructor({
        instructor_id: Utilities.getUuid(),
        user_id: userId,
        teamleader_role:
          form.role === "instructor" ? !!form.teamleader_role : false,
        division_id: form.division_id || null,
        floor: form.floor_id || null,
        bay: form.bay || null,
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
    SupabaseProvider.updateUser(userId, {
      name: form.name,
      status: form.status,
      role: form.role, // Update role in users table
    });

    // 2. Upsert Role Data (Student/Instructor)
    // If user switched role, we create the new record if it doesn't exist.

    if (form.role === "student") {
      var s = SupabaseProvider.getStudentByUserId(userId);
      if (s) {
        // Update existing student record
        SupabaseProvider.updateStudent(s.student_id, {
          academic_id: form.academic_id
            ? String(form.academic_id).trim()
            : null,
          first_clinic_year: parseInt(form.first_clinic_year),
          floor_id: form.floor_id ? form.floor_id : null,
          unit_id: form.unit_id ? form.unit_id : null,
          team_leader_1_id: form.team_leader_1_id
            ? form.team_leader_1_id
            : null,
          team_leader_2_id: form.team_leader_2_id
            ? form.team_leader_2_id
            : null,
          status: form.status,
          updated_at: new Date().toISOString(),
        });
      } else {
        // Create new student record (Role Migration)
        SupabaseProvider.createStudent({
          student_id: Utilities.getUuid(),
          user_id: userId,
          academic_id: form.academic_id
            ? String(form.academic_id).trim()
            : null,
          first_clinic_year:
            parseInt(form.first_clinic_year) || new Date().getFullYear(),
          floor_id: form.floor_id || null,
          unit_id: form.unit_id || null,
          status: form.status || "active",
        });
      }
    } else if (form.role === "instructor" || form.role === "admin") {
      // Validate
      if (form.bay && !/^[A-Z]{1,2}$/.test(form.bay)) {
        return { success: false, error: "Bay must be 1-2 uppercase letters." };
      }

      var i = SupabaseProvider.getInstructorByUserId(userId);
      if (i) {
        // Update existing instructor record
        SupabaseProvider.updateInstructor(i.instructor_id, {
          teamleader_role: !!form.teamleader_role,
          division_id: form.division_id || null,
          floor: form.floor_id || null,
          bay: form.bay || null,
          status: form.status,
          updated_at: new Date().toISOString(),
        });
      } else {
        // Create new instructor record (Role Migration)
        SupabaseProvider.createInstructor({
          instructor_id: Utilities.getUuid(),
          user_id: userId,
          teamleader_role: !!form.teamleader_role,
          division_id: form.division_id || null,
          floor: form.floor_id || null,
          bay: form.bay || null,
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
  var user = SupabaseProvider.getUserByEmail(email);
  if (!user) {
    throw new Error("User not found: " + email);
  }

  // 2. Enrich with role data
  if (user.role === "student") {
    var s = SupabaseProvider.getStudentByUserId(user.user_id);
    if (s) {
      user.academic_id = s.academic_id;
      user.first_clinic_year = s.first_clinic_year;
      user.floor_id = s.floor_id;
      user.unit_id = s.unit_id;
      user.team_leader_1_id = s.team_leader_1_id;
      user.team_leader_2_id = s.team_leader_2_id;
    }
  } else if (user.role === "instructor" || user.role === "admin") {
    var i = SupabaseProvider.getInstructorByUserId(user.user_id);
    if (i) {
      user.teamleader_role = !!i.teamleader_role;
      user.division_id = i.division_id;
      user.floor_id = i.floor_id || i.floor;
      user.bay = i.bay;
    }
  }

  return user;
}

/**
 * Syncs patient data from a configured Google Sheet to the active data source.
 * (Admin only).
 */
/**
 * Syncs patient data from a configured Google Sheet to the active data source.
 * (Admin only).
 */
function adminSyncPatients() {
  _assertAdmin();

  var sheetId = getPatientSheetId();
  if (!sheetId) {
    return { success: false, error: "PATIENT_SHEET_ID not configured." };
  }

  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName("patients");
    if (!sheet) {
      return { success: false, error: "Sheet named 'patients' not found." };
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return {
        success: false,
        error: "Patient sheet is empty or has only headers.",
      };
    }

    // Pre-fetch Users/Instructors for Lookup
    var allUsers = SupabaseProvider.listUsers() || [];
    var allInstructors = SupabaseProvider.listInstructors() || [];

    // Maps
    var emailMap = {}; // email -> user_id
    allUsers.forEach(function (u) {
      if (u.email) emailMap[u.email.toLowerCase()] = u.user_id;
    });

    var instructorMap = {}; // user_id -> instructor_id
    allInstructors.forEach(function (i) {
      instructorMap[i.user_id] = i.instructor_id;
    });

    var stats = { created: 0, updated: 0, errors: 0 };

    // Data starts at row 2 (index 1)
    // Columns:
    // A(0): HN, B(1): Name, C(2): Tel, D(3): TeamLeaderEmail, E(4): StudentEmail
    // L(11): Birthdate, P(15): Status, Q(16): Note

    for (var i = 1; i < data.length; i++) {
      try {
        var row = data[i];
        var hn = String(row[0]).trim();
        if (!hn) continue;

        // Normalize Status
        var rawStatus = String(row[15]).trim();
        var validStatuses = [
          "Waiting to Be Assigned",
          "Full Chart",
          "Treatment Plan",
          "First Treatment Plan",
          "Treatment Plan Approved",
          "Initial Treatment",
          "Inactive",
          "Discharged",
          "Orthodontic Treatment",
          "Waiting in Recall Lists",
        ];

        // Simple case-insensitive match
        var status = validStatuses.find(
          (s) => s.toLowerCase() === rawStatus.toLowerCase(),
        );
        if (!status) status = "Waiting to Be Assigned"; // Default

        var patientPayload = {
          hn: hn,
          name: String(row[1]).trim(),
          tel: String(row[2]).trim(),
          birthdate: row[11] instanceof Date ? row[11] : null,
          status: status,
          note: String(row[16]).trim(),
          updated_at: new Date().toISOString(),
        };

        // Lookup Team Leader
        var tlEmail = String(row[3]).trim().toLowerCase();
        if (tlEmail && emailMap[tlEmail]) {
          var tlUserId = emailMap[tlEmail];
          if (instructorMap[tlUserId]) {
            patientPayload.instructor_id = instructorMap[tlUserId];
          }
        }

        // Lookup Student
        var stEmail = String(row[4]).trim().toLowerCase();
        if (stEmail) {
          if (emailMap[stEmail]) {
            var stUserId = emailMap[stEmail];
            var studentData = SupabaseProvider.getStudentByUserId(stUserId);

            if (studentData && studentData.student_id) {
              patientPayload.student_id_1 = studentData.student_id;
              // console.log("Mapped Student: " + stEmail + " -> " + studentData.student_id);
            } else {
              console.log(
                "Sync Warning: Student Profile NOT FOUND for User: " +
                  stEmail +
                  " (ID: " +
                  stUserId +
                  ")",
              );
              if (!stats.warnings) stats.warnings = [];
              if (stats.warnings.length < 10)
                stats.warnings.push(
                  "Skipped Student Assignment: Profile missing for " + stEmail,
                );
            }
          } else {
            console.log(
              "Sync Warning: Student Email NOT FOUND in System: " + stEmail,
            );
            if (!stats.warnings) stats.warnings = [];
            if (stats.warnings.length < 10)
              stats.warnings.push(
                "Skipped Student Assignment: Email not found " + stEmail,
              );
          }
        }

        // Check Existence - DEPRECATED in favor of Upsert

        // Use UPSERT
        SupabaseProvider.upsertPatient(patientPayload);
        stats.updated++;
      } catch (rowErr) {
        Logger.log("Error processing row " + (i + 1) + ": " + rowErr.message);
        stats.errors++;
      }
    }

    // Format a helpful message if fallback occurred OR we have data warnings
    var warningMsg = "";
    if (stats.supabaseErrors && stats.supabaseErrors.length > 0) {
      warningMsg +=
        "Supabase Write Failed: " + stats.supabaseErrors.join(", ") + ". ";
    }
    if (stats.warnings && stats.warnings.length > 0) {
      warningMsg += "Data Warnings: " + stats.warnings.join(", ");
    }

    if (warningMsg) {
      return {
        success: true,
        stats: stats,
        warning: warningMsg,
      };
    }

    return { success: true, stats: stats };
  } catch (e) {
    Logger.log("adminSyncPatients error: " + e.message);
    return { success: false, error: "Error syncing patients: " + e.message };
  }
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
  var users = SupabaseProvider.listUsers() || [];
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
    // Delete Auth user, role record, then public user
    SupabaseProvider.deleteAuthUser(userId);
    if (target.role === "student")
      SupabaseProvider.deleteStudentByUserId(userId);
    else SupabaseProvider.deleteInstructorByUserId(userId);
    SupabaseProvider.deleteUser(userId);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * List all divisions (Admin only).
 */
function adminListDivisions() {
  _assertAdmin();
  return SupabaseProvider.listDivisions() || [];
}

/**
 * Create a new division (Admin only).
 */
function adminCreateDivision(form) {
  _assertAdmin();

  try {
    // Basic validation?
    SupabaseProvider.createDivision({
      code: form.code,
      name: form.name,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function adminUpdateDivision(id, form) {
  _assertAdmin();
  try {
    SupabaseProvider.updateDivision(id, {
      code: form.code,
      name: form.name,
      updated_at: new Date().toISOString(),
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Floors ---
function adminListFloors() {
  _assertAdmin();
  return SupabaseProvider.listFloors() || [];
}

function adminCreateFloor(form) {
  _assertAdmin();
  try {
    SupabaseProvider.createFloor({
      label: form.label,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function adminUpdateFloor(id, form) {
  _assertAdmin();
  try {
    SupabaseProvider.updateFloor(id, {
      label: form.label,
      // updated_at not in simple schema but good practice if column exists
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Get treatment plan details for a patient.
 * @param {string} hn
 * @returns {Object} { patient, records }
 */
function studentGetTreatmentPlan(hn) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  // Fetch Patient
  var patient = SupabaseProvider.getPatientByHn(hn);

  if (!patient) {
    return { patient: null, records: [] };
  }

  // Normalize HN
  if (!patient.hn && patient.HN) patient.hn = patient.HN;
  if (!patient.hn && patient.Hn) patient.hn = patient.Hn;

  // Fetch Records
  var records = SupabaseProvider.listTreatmentRecords(patient.patient_id) || [];

  return {
    patient: JSON.parse(JSON.stringify(patient)),
    records: JSON.parse(JSON.stringify(records)),
  };
}
