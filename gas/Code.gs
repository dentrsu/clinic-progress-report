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

/** Domain required for access */
var ALLOWED_DOMAIN = "rsu.ac.th";

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
    p.student_4_acad = getAcad(p.s4) || "";

    p.student_5_name = getName(p.s5) || p.student_id_5 || "-";
    p.student_5_acad = getAcad(p.s5) || "";

    p.instructor_name =
      getName(p.inst) ||
      (p.instructor_id ? "Inst ID: " + p.instructor_id : "-");

    p.case_type_name = p.case_type ? p.case_type.type_of_case : "-";

    // Set type_of_case to the text value for standard dropdown selection in UI
    p.type_of_case = p.case_type ? p.case_type.type_of_case : "";

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
    is_completed_case: !!form.is_completed_case,
    complexity: form.complexity || null,
    // Resolve text to ID (alignment logic)
    type_of_case: SupabaseProvider.getTypeOfCaseIdByText(form.type_of_case),

    updated_at: new Date().toISOString(),
  };

  // 4. Execute Update
  SupabaseProvider.updatePatient(patient.patient_id, payload);

  return { success: true };
}

/**
 * Toggle Complete Case status for a patient (Student).
 * @param {string} hn
 * @param {boolean} isComplete
 */
function studentToggleCompleteCase(hn, isComplete) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (!profile.found || !profile.active || profile.role !== "student") {
    throw new Error("User is not an active student.");
  }

  var patient = SupabaseProvider.getPatientByHn(hn);
  if (!patient) throw new Error("Patient not found.");

  var myId = profile.student_id;
  var isAssigned =
    patient.student_id_1 === myId ||
    patient.student_id_2 === myId ||
    patient.student_id_3 === myId ||
    patient.student_id_4 === myId ||
    patient.student_id_5 === myId;

  if (!isAssigned) throw new Error("Access Denied: Not assigned.");

  SupabaseProvider.updatePatient(patient.patient_id, {
    is_completed_case: !!isComplete,
    updated_at: new Date().toISOString(),
  });

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
 * Search for a student by Academic ID (for Referral).
 * @param {string} academicId
 * @returns {Object} result
 */
function studentSearchByAcademicId(academicId) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  // Instructors can search too? The requirement said hide button for instructors.
  // But if we reuse this, it's fine.

  if (!academicId) return { found: false };

  var student = SupabaseProvider.getStudentByAcademicId(
    String(academicId).trim(),
  );
  if (student) {
    // Enrich with name
    var u = SupabaseProvider.getUserByEmail(
      student.users ? student.users.email : "",
    ); // We might not have email easily in all objects if not joined
    // Actually getStudentByAcademicId might not return Joined User?
    // Let's check SupabaseProvider.getStudentByAcademicId implementation.
    // It calls: /rest/v1/students?academic_id=eq...&select=*
    // It does NOT join users. We need to fetch user name.

    // Better: Helper to get student details
    var fullStudent = SupabaseProvider.getStudentById(student.student_id); // This joins user:users(name)

    return {
      found: true,
      student: {
        student_id: fullStudent.student_id,
        academic_id: fullStudent.academic_id,
        name: fullStudent.user ? fullStudent.user.name : "Unknown",
        user: fullStudent.user, // Match structure expected by frontend
      },
    };
  }

  return { found: false };
}

/**
 * Refer a treatment to another student.
 * Updates treatment_records (if recordId present) and patients (slots 2-4).
 * @param {string|null} recordId
 * @param {string} studentId (UUID of the student to refer to)
 * @param {string} hn
 */
function studentReferTreatment(recordId, studentId, hn) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  // 1. Validate Target Student
  var targetStudent = SupabaseProvider.getStudentById(studentId);
  if (!targetStudent) throw new Error("Target student not found.");

  // 2. Update Patient (Care Team)
  var patient = SupabaseProvider.getPatientByHn(hn);
  if (!patient) throw new Error("Patient not found.");

  var updates = {};
  var needsUpdate = false;

  // Check for duplicates
  var isAlreadyAssigned =
    patient.student_id_1 === studentId ||
    patient.student_id_2 === studentId ||
    patient.student_id_3 === studentId ||
    patient.student_id_4 === studentId ||
    patient.student_id_5 === studentId;

  if (!isAlreadyAssigned) {
    // Find empty slot (2, 3, 4, 5 only)
    if (!patient.student_id_2) {
      updates.student_id_2 = studentId;
      needsUpdate = true;
    } else if (!patient.student_id_3) {
      updates.student_id_3 = studentId;
      needsUpdate = true;
    } else if (!patient.student_id_4) {
      updates.student_id_4 = studentId;
      needsUpdate = true;
    } else if (!patient.student_id_5) {
      updates.student_id_5 = studentId;
      needsUpdate = true;
    } else {
      // All full
      throw new Error("Referral limit reached (Slots 2, 3, 4, 5 are full).");
    }
  }

  if (needsUpdate) {
    updates.updated_at = new Date().toISOString();
    SupabaseProvider.updatePatient(patient.patient_id, updates);
  }

  // 3. Update Treatment Record (if existing)
  if (recordId) {
    SupabaseProvider.updateTreatmentRecord(recordId, {
      student_id: studentId,
      updated_at: new Date().toISOString(),
    });
  }

  return {
    success: true,
    student: {
      student_id: targetStudent.student_id,
      academic_id: targetStudent.academic_id,
      name: targetStudent.user ? targetStudent.user.name : "Unknown",
      user: targetStudent.user,
    },
    message: isAlreadyAssigned
      ? "Student already in care team. Treatment updated."
      : "Referral successful.",
  };
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

  if (page === "vault") {
    var user = getCurrentUser();
    var profile = getUserProfile(user.email);
    var t = HtmlService.createTemplateFromFile("requirement_vault");
    t.appUrl = url;
    t.appDevUrl = devUrl;
    t.academic_id = profile.academic_id || "-";
    t.student_name = profile.name || "-";
    return t
      .evaluate()
      .setTitle("Requirement Vault — Clinic Progress Report")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  if (page === "student") {
    var t = HtmlService.createTemplateFromFile("student");
    t.appUrl = url;
    t.appDevUrl = devUrl;
    return t
      .evaluate()
      .setTitle("Student Portal — Clinic Progress Report")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  if (page === "instructor") {
    var t = HtmlService.createTemplateFromFile("instructor");
    t.appUrl = url;
    t.appDevUrl = devUrl;
    return t
      .evaluate()
      .setTitle("Instructor Portal — Clinic Progress Report")
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
 * Get student requirement progress for the vault.
 * @returns {Object} Grouped by division
 */
function getStudentVaultData() {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (!profile.found || !profile.active || profile.role !== "student") {
    throw new Error("User is not an active student.");
  }

  // 1. Fetch all requirements
  var requirements = SupabaseProvider.listRequirements() || [];

  // 2. Fetch all verified/completed records for this student
  var records =
    SupabaseProvider.listVaultRecordsByStudent(profile.student_id) || [];

  // 3. Aggregate progress
  var progressMap = {}; // requirement_id -> { total_rsu, total_cda, pending_rsu, pending_cda }
  records.forEach(function (rec) {
    if (!rec.requirement_id) return;
    if (!progressMap[rec.requirement_id]) {
      progressMap[rec.requirement_id] = { rsu: 0, cda: 0, p_rsu: 0, p_cda: 0 };
    }

    var rsu = parseFloat(rec.rsu_units) || 0;
    var cda = parseFloat(rec.cda_units) || 0;

    if (rec.status === "verified") {
      progressMap[rec.requirement_id].rsu += rsu;
      progressMap[rec.requirement_id].cda += cda;
    } else if (rec.status === "completed") {
      progressMap[rec.requirement_id].p_rsu += rsu;
      progressMap[rec.requirement_id].p_cda += cda;
    }
  });

  // 4. Map requirements with progress and group by division
  var divisions = {};
  requirements.forEach(function (req) {
    var divName =
      req.divisions && req.divisions.name ? req.divisions.name : "Other";
    if (!divisions[divName]) {
      divisions[divName] = {
        name: divName,
        requirements: [],
      };
    }

    var prog = progressMap[req.requirement_id] || {
      rsu: 0,
      cda: 0,
      p_rsu: 0,
      p_cda: 0,
    };

    divisions[divName].requirements.push({
      requirement_id: req.requirement_id,
      requirement_type: req.requirement_type,
      minimum_rsu: req.minimum_rsu || 0,
      minimum_cda: req.minimum_cda || 0,
      current_rsu: Math.round(prog.rsu * 100) / 100,
      current_cda: Math.round(prog.cda * 100) / 100,
      pending_rsu: Math.round(prog.p_rsu * 100) / 100,
      pending_cda: Math.round(prog.p_cda * 100) / 100,
      rsu_unit: req.rsu_unit || "Case",
      cda_unit: req.cda_unit || "Case",
    });
  });

  // Convert map to sorted array
  return Object.values(divisions).sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
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
 * Consolidated data fetch for Admin Console initialization.
 */
function adminGetInitData() {
  _assertAdmin();
  return {
    users: adminListUsers(),
    instructors: adminListInstructors(),
    students: adminListStudents(),
    divisions: adminListDivisions(),
    floors: adminListFloors(),
    phases: adminListTreatmentPhases(),
    catalog: adminListTreatmentCatalog(),
    steps: adminListTreatmentSteps(),
    requirements: adminListRequirements(),
    caseTypes: adminListTypeOfCases(),
  };
}

/**
 * List all students (Admin only).
 */
function adminListStudents() {
  _assertAdmin();
  return SupabaseProvider.listStudents() || [];
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
 * List all type_of_case records (Admin).
 */
function adminListTypeOfCases() {
  _assertAdmin();
  return SupabaseProvider.listTypeOfCases() || [];
}

/**
 * Create public.type_of_case record (Admin).
 */
function adminCreateTypeOfCase(form) {
  _assertAdmin();
  try {
    SupabaseProvider.createTypeOfCase({
      type_of_case: form.type_of_case,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function adminUpdateTypeOfCase(id, form) {
  _assertAdmin();
  try {
    SupabaseProvider.updateTypeOfCase(id, {
      type_of_case: form.type_of_case,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Delete public.type_of_case record (Admin).
 */
function adminDeleteTypeOfCase(id) {
  _assertAdmin();
  return SupabaseProvider.deleteTypeOfCase(id);
}

/**
 * List all type_of_case records (Public/Student).
 */
function studentListTypeOfCases() {
  return SupabaseProvider.listTypeOfCases() || [];
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
 * Syncs instructor data from the configured Google Sheet (MASTER_SHEET_ID).
 * (Admin only).
 */
function adminSyncInstructors() {
  _assertAdmin();

  var sheetId =
    PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
  if (!sheetId) {
    return { success: false, error: "MASTER_SHEET_ID not configured." };
  }

  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName("Teacher");
    if (!sheet) {
      return { success: false, error: "Sheet named 'Teacher' not found." };
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return {
        success: false,
        error: "Teacher sheet is empty or has only headers.",
      };
    }

    // Pre-fetch Divisions/Floors for Lookup
    var divisions = SupabaseProvider.listDivisions() || [];
    var floors = SupabaseProvider.listFloors() || [];

    var divMap = {}; // code -> division_id
    divisions.forEach(function (d) {
      if (d.code) divMap[d.code.trim().toUpperCase()] = d.division_id;
    });

    var floorMap = {}; // label -> floor_id
    floors.forEach(function (f) {
      if (f.label) floorMap[f.label.trim()] = f.floor_id;
    });

    var stats = { processed: 0, updated: 0, errors: 0, warnings: [] };

    // Data starts at row 2 (index 1)
    for (var i = 1; i < data.length; i++) {
      try {
        var row = data[i];
        // Col B (1): Name
        // Col C (2): Email
        // Col D (3): Division (Code)
        // Col E (4): Type ('ประจำ' or 'พิเศษ')
        // Col F (5): Status
        // Col G (6): Role ('Team Leader' or 'Instructor')
        // Col H (7): Bay
        // Col I (8): Floor Label

        var name = String(row[1]).trim();
        var email = String(row[2]).trim().toLowerCase();
        var divCode = String(row[3]).trim().toUpperCase();
        var type = String(row[4]).trim();
        var statusRaw = String(row[5]).trim().toLowerCase();
        var roleRaw = String(row[6]).trim();
        var bay = String(row[7]).trim().toUpperCase();
        var floorLabel = String(row[8]).trim();

        // 1. Filter: Sync only Active & Permanent (ประจำ)
        if (statusRaw !== "active") continue;
        if (type !== "ประจำ") continue;

        if (!email) {
          stats.warnings.push("Row " + (i + 1) + ": Missing email");
          continue;
        }

        stats.processed++;

        // 2. Upsert User
        // Note: For instructors, we force role='instructor'.
        var userRecord = SupabaseProvider.upsertUser(email, {
          name: name,
          role: "instructor",
          status: "active",
        });

        if (!userRecord || !userRecord.user_id) {
          throw new Error("Failed to upsert user for " + email);
        }

        // 3. Upsert Instructor
        var divId = divMap[divCode] || null;
        var floorId = floorMap[floorLabel] || null;
        var isTeamLeader = roleRaw === "Team Leader";

        if (!divId && divCode) {
          // stats.warnings.push("Row " + (i + 1) + ": Division code '" + divCode + "' not found.");
        }

        SupabaseProvider.upsertInstructor(userRecord.user_id, {
          division_id: divId,
          floor_id: floorId,
          bay: bay,
          teamleader_role: isTeamLeader,
          updated_at: new Date().toISOString(),
        });

        stats.updated++;
      } catch (rowErr) {
        Logger.log(
          "Error processing instructor row " + (i + 1) + ": " + rowErr.message,
        );
        stats.errors++;
        stats.warnings.push("Row " + (i + 1) + ": " + rowErr.message);
      }
    }

    return { success: true, stats: stats };
  } catch (e) {
    Logger.log("adminSyncInstructors error: " + e.message);
    return { success: false, error: "Error syncing instructors: " + e.message };
  }
}

/**
 * Delete a user (Admin only).
 * Restricted to Students and Instructors.
 */
/**
 * Syncs student data from the configured Google Sheet (MASTER_SHEET_ID).
 * (Admin only).
 */
function adminSyncStudents() {
  _assertAdmin();

  var sheetId =
    PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
  if (!sheetId) {
    return { success: false, error: "MASTER_SHEET_ID not configured." };
  }

  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName("Student");
    if (!sheet) {
      return { success: false, error: "Sheet named 'Student' not found." };
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return {
        success: false,
        error: "Student sheet is empty or has only headers.",
      };
    }

    // Pre-fetch Data for Lookups
    var floors = SupabaseProvider.listFloors() || [];
    var allUsers = SupabaseProvider.listUsers() || [];
    var allInstructors = SupabaseProvider.listInstructors() || [];

    // Maps
    var floorMap = {}; // label -> floor_id "2", "3"
    floors.forEach(function (f) {
      if (f.label) floorMap[f.label.trim()] = f.floor_id;
    });

    var emailMap = {}; // email -> user_id
    allUsers.forEach(function (u) {
      if (u.email) emailMap[u.email.toLowerCase()] = u.user_id;
    });

    var instructorMap = {}; // user_id -> instructor_id
    allInstructors.forEach(function (i) {
      instructorMap[i.user_id] = i.instructor_id;
    });

    // Helper to get instructor ID from email
    function getInstructorIdByEmail(email) {
      if (!email) return null;
      var cleanEmail = email.trim().toLowerCase();
      var uid = emailMap[cleanEmail];
      if (!uid) return null;
      return instructorMap[uid] || null;
    }

    var stats = { processed: 0, updated: 0, errors: 0, warnings: [] };

    // Data starts at row 2 (index 1)
    // B(1): Floor
    // D(3): Unit
    // E(4): Name
    // F(5): ID (Academic ID)
    // G(6): Email
    // H(7): Status
    // I(8): First Clinic Year
    // L(11): Team Leader 1 Email
    // N(13): Team Leader 2 Email

    for (var i = 1; i < data.length; i++) {
      try {
        var row = data[i];

        var floorRaw = String(row[1]).trim();
        var unitId = String(row[3]).trim();
        var name = String(row[4]).trim();
        var academicId = String(row[5]).trim();
        var email = String(row[6]).trim().toLowerCase();
        var statusRaw = String(row[7]).trim().toLowerCase();
        var yearRaw = row[8];
        var tl1Email = String(row[11]).trim();
        var tl2Email = String(row[13]).trim();

        // 1. Filter: Sync only Active
        if (statusRaw !== "active") continue;

        if (!email) {
          stats.warnings.push("Row " + (i + 1) + ": Missing email");
          continue;
        }

        stats.processed++;

        // 2. Upsert User
        var userRecord = SupabaseProvider.upsertUser(email, {
          name: name,
          role: "student",
          status: "active",
        });

        if (!userRecord || !userRecord.user_id) {
          throw new Error("Failed to upsert user for " + email);
        }

        // 3. Upsert Student
        var floorId = floorMap[floorRaw] || null;
        var firstClinicYear = parseInt(yearRaw) || new Date().getFullYear();
        var tl1Id = getInstructorIdByEmail(tl1Email);
        var tl2Id = getInstructorIdByEmail(tl2Email);

        SupabaseProvider.upsertStudent(userRecord.user_id, {
          academic_id: academicId,
          first_clinic_year: firstClinicYear,
          floor_id: floorId,
          unit_id: unitId,
          team_leader_1_id: tl1Id,
          team_leader_2_id: tl2Id,
          status: "active",
          updated_at: new Date().toISOString(),
        });

        stats.updated++;
      } catch (rowErr) {
        Logger.log(
          "Error processing student row " + (i + 1) + ": " + rowErr.message,
        );
        stats.errors++;
        stats.warnings.push("Row " + (i + 1) + ": " + rowErr.message);
      }
    }

    return { success: true, stats: stats };
  } catch (e) {
    Logger.log("adminSyncStudents error: " + e.message);
    return { success: false, error: "Error syncing students: " + e.message };
  }
}

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
      clinic: form.clinic || "N/A",
      have_non_main_patient_requirements:
        !!form.have_non_main_patient_requirements,
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
      clinic: form.clinic || "N/A",
      have_non_main_patient_requirements:
        !!form.have_non_main_patient_requirements,
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

// --- Treatment Phases ---
function adminListTreatmentPhases() {
  _assertAdmin();
  return SupabaseProvider.listTreatmentPhases() || [];
}

function adminCreateTreatmentPhase(form) {
  _assertAdmin();
  try {
    SupabaseProvider.createTreatmentPhase({
      phase_order: parseInt(form.phase_order),
      phase_name: form.phase_name,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function adminUpdateTreatmentPhase(id, form) {
  _assertAdmin();
  try {
    SupabaseProvider.updateTreatmentPhase(id, {
      phase_order: parseInt(form.phase_order),
      phase_name: form.phase_name,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function adminDeleteTreatmentPhase(id) {
  _assertAdmin();
  try {
    SupabaseProvider.deleteTreatmentPhase(id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Treatment Catalog ---
function adminListTreatmentCatalog() {
  _assertAdmin();
  return SupabaseProvider.listTreatmentCatalog() || [];
}

function adminCreateTreatmentCatalog(form) {
  _assertAdmin();
  try {
    SupabaseProvider.createTreatmentCatalog({
      division_id: form.division_id,
      treatment_name: form.treatment_name,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function adminUpdateTreatmentCatalog(id, form) {
  _assertAdmin();
  try {
    SupabaseProvider.updateTreatmentCatalog(id, {
      division_id: form.division_id,
      treatment_name: form.treatment_name,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function adminDeleteTreatmentCatalog(id) {
  _assertAdmin();
  try {
    SupabaseProvider.deleteTreatmentCatalog(id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Treatment Steps ---
function adminListTreatmentSteps() {
  _assertAdmin();
  var steps = SupabaseProvider.listAllTreatmentSteps() || [];

  // Sort: Division Name ASC, Step Order ASC
  steps.sort(function (a, b) {
    var divA =
      (a.treatment_catalog &&
        a.treatment_catalog.divisions &&
        a.treatment_catalog.divisions.name) ||
      "";
    var divB =
      (b.treatment_catalog &&
        b.treatment_catalog.divisions &&
        b.treatment_catalog.divisions.name) ||
      "";

    var cmp = divA.localeCompare(divB);
    if (cmp !== 0) return cmp;

    return (a.step_order || 0) - (b.step_order || 0);
  });

  return steps;
}

function adminCreateTreatmentStep(form) {
  _assertAdmin();
  try {
    SupabaseProvider.createTreatmentStep({
      treatment_id: form.treatment_id,
      step_order: parseInt(form.step_order),
      step_name: form.step_name,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function adminUpdateTreatmentStep(id, form) {
  _assertAdmin();
  try {
    SupabaseProvider.updateTreatmentStep(id, {
      treatment_id: form.treatment_id,
      step_order: parseInt(form.step_order),
      step_name: form.step_name,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function adminDeleteTreatmentStep(id) {
  _assertAdmin();
  try {
    SupabaseProvider.deleteTreatmentStep(id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Requirements ---
function adminListRequirements() {
  _assertAdmin();
  return SupabaseProvider.listRequirements() || [];
}

function adminCreateRequirement(form) {
  _assertAdmin();
  try {
    SupabaseProvider.createRequirement({
      division_id: form.division_id,
      requirement_type: form.requirement_type,
      minimum_rsu: parseFloat(form.minimum_rsu) || 0,
      minimum_cda: parseFloat(form.minimum_cda) || 0,
      rsu_unit: form.rsu_unit || "Case",
      cda_unit: form.cda_unit || "Case",
      is_patient_treatment:
        form.is_patient_treatment === true ||
        form.is_patient_treatment === "true",
      non_mc_pateint_req:
        form.non_mc_pateint_req === true || form.non_mc_pateint_req === "true",
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function adminUpdateRequirement(id, form) {
  _assertAdmin();
  try {
    SupabaseProvider.updateRequirement(id, {
      division_id: form.division_id,
      requirement_type: form.requirement_type,
      minimum_rsu: parseFloat(form.minimum_rsu) || 0,
      minimum_cda: parseFloat(form.minimum_cda) || 0,
      rsu_unit: form.rsu_unit || "Case",
      cda_unit: form.cda_unit || "Case",
      is_patient_treatment:
        form.is_patient_treatment === true ||
        form.is_patient_treatment === "true",
      non_mc_pateint_req:
        form.non_mc_pateint_req === true || form.non_mc_pateint_req === "true",
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function adminDeleteRequirement(id) {
  _assertAdmin();
  try {
    SupabaseProvider.deleteRequirement(id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Get treatment plan details + all form data for a patient (prefetched).
 * @param {string} hn
 * @returns {Object} { patient, records, phases, divisions, catalog, steps, students }
 */
function studentGetTreatmentPlan(hn) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");
  var profile = getUserProfile(user.email);

  // Fetch Patient (with student assignments)
  var patient = SupabaseProvider.getPatientByHn(hn);

  if (!patient) {
    return {
      patient: null,
      records: [],
      phases: [],
      divisions: [],
      catalog: [],
      steps: [],
      students: [],
    };
  }

  // Normalize HN
  if (!patient.hn && patient.HN) patient.hn = patient.HN;
  if (!patient.hn && patient.Hn) patient.hn = patient.Hn;

  // Fetch Records (enriched with joins)
  var records = SupabaseProvider.listTreatmentRecords(patient.patient_id) || [];

  // Prefetch all catalog data for dropdowns
  var phases = SupabaseProvider.listTreatmentPhases() || [];
  var divisions = SupabaseProvider.listDivisions() || [];
  var catalog = SupabaseProvider.listTreatmentCatalog() || [];
  var catalog = SupabaseProvider.listTreatmentCatalog() || [];
  var steps = SupabaseProvider.listAllTreatmentSteps() || [];
  var instructors = SupabaseProvider.listInstructors() || [];
  var requirements = SupabaseProvider.listRequirements() || [];

  // Build students list from patient's assigned student_id_1..5
  var students = [];
  for (var i = 1; i <= 5; i++) {
    var sid = patient["student_id_" + i];
    if (sid) {
      var s = SupabaseProvider.getStudentById(sid);
      if (s) {
        students.push({
          student_id: sid,
          name: s.user && s.user.name ? s.user.name : "Student " + i,
          academic_id: s.academic_id || "",
          slot: i,
        });
      } else {
        students.push({
          student_id: sid,
          name: "Student " + i,
          academic_id: "",
          slot: i,
        });
      }
    }
  }

  return {
    patient: JSON.parse(JSON.stringify(patient)),
    records: JSON.parse(JSON.stringify(records)),
    phases: JSON.parse(JSON.stringify(phases)),
    divisions: JSON.parse(JSON.stringify(divisions)),
    catalog: JSON.parse(JSON.stringify(catalog)),
    steps: JSON.parse(JSON.stringify(steps)),
    instructors: JSON.parse(JSON.stringify(instructors)),
    requirements: JSON.parse(JSON.stringify(requirements)),
    students: JSON.parse(JSON.stringify(students)),
    currentUser: {
      email: profile.email,
      role: profile.role,
      id: profile.instructor_id || profile.student_id || profile.user_id, // Prefer specific ID if avail
    },
  };
}

/**
 * Verify a treatment record (Instructor/Admin only).
 * @param {string} recordId
 * @returns {Object} { success, error? }
 */
function instructorVerifyTreatmentRecord(recordId) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (
    !profile.found ||
    !profile.active ||
    (profile.role !== "instructor" && profile.role !== "admin")
  ) {
    throw new Error("Access Denied: Instructors only.");
  }

  try {
    var verifierId = profile.user_id;

    SupabaseProvider.updateTreatmentRecord(recordId, {
      status: "verified",
      verified_by: verifierId,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { success: true };
  } catch (e) {
    Logger.log("instructorVerifyTreatmentRecord error: " + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Create a treatment record for a patient.
 * @param {string} hn — Patient HN
 * @param {Object} form — Form data from the modal
 * @returns {Object} { success, record?, error? }
 */
function studentCreateTreatmentRecord(hn, form) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  try {
    var patient = SupabaseProvider.getPatientByHn(hn);
    if (!patient) return { success: false, error: "Patient not found." };

    // Determine treatment_order: max existing + 1
    var existing =
      SupabaseProvider.listTreatmentRecords(patient.patient_id) || [];
    var maxOrder = 0;
    for (var i = 0; i < existing.length; i++) {
      var o = existing[i].treatment_order || 0;
      if (o > maxOrder) maxOrder = o;
    }

    var payload = {
      patient_id: patient.patient_id,
      phase_id: form.phase_id || null,
      division_id: form.division_id || null,
      treatment_id: form.treatment_id || null,
      step_id: form.step_id || null,
      student_id: form.student_id || null,
      instructor_id: form.instructor_id || null,
      requirement_id: form.requirement_id || null,
      area: form.area || null,
      status: form.status || "planned",
      rsu_units: form.rsu_units ? Number(form.rsu_units) : null,
      cda_units: form.cda_units ? Number(form.cda_units) : null,
      severity:
        form.severity != null && form.severity !== ""
          ? Number(form.severity)
          : null,
      book_number:
        form.book_number != null && form.book_number !== ""
          ? Number(form.book_number)
          : null,
      page_number:
        form.page_number != null && form.page_number !== ""
          ? Number(form.page_number)
          : null,
      start_date: form.start_date || null,
      complete_date: form.complete_date || null,
      is_exam: !!form.is_exam,
      // treatment_order: set below
    };

    // Determine Order
    var newOrder = form.treatment_order
      ? parseInt(form.treatment_order)
      : maxOrder + 1;
    if (isNaN(newOrder) || newOrder < 1) newOrder = maxOrder + 1;

    // If inserting in middle (newOrder <= maxOrder), shift others down
    if (newOrder <= maxOrder) {
      // Shift records with order >= newOrder
      // We can loop through existing and update them
      // Sort descending to avoid conflicts? validation?
      // Actually updates are independent if using unique IDs.
      for (var i = 0; i < existing.length; i++) {
        var r = existing[i];
        var ro = r.treatment_order || 0;
        if (ro >= newOrder) {
          SupabaseProvider.updateTreatmentRecord(r.record_id, {
            treatment_order: ro + 1,
          });
        }
      }
    }

    payload.treatment_order = newOrder;

    var record = SupabaseProvider.createTreatmentRecord(payload);
    return { success: true, record: record };
  } catch (e) {
    Logger.log("studentCreateTreatmentRecord error: " + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Update a treatment record.
 * @param {string} recordId
 * @param {Object} form
 * @returns {Object} { success, record?, error? }
 */
function studentUpdateTreatmentRecord(recordId, form) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  try {
    var updates = {
      phase_id: form.phase_id || null,
      division_id: form.division_id || null,
      treatment_id: form.treatment_id || null,
      step_id: form.step_id || null,
      student_id: form.student_id || null,
      instructor_id: form.instructor_id || null,
      requirement_id: form.requirement_id || null,
      area: form.area || null,
      status: form.status || "planned",
      rsu_units: form.rsu_units ? Number(form.rsu_units) : null,
      cda_units: form.cda_units ? Number(form.cda_units) : null,
      severity:
        form.severity != null && form.severity !== ""
          ? Number(form.severity)
          : null,
      book_number:
        form.book_number != null && form.book_number !== ""
          ? Number(form.book_number)
          : null,
      page_number:
        form.page_number != null && form.page_number !== ""
          ? Number(form.page_number)
          : null,
      start_date: form.start_date || null,
      complete_date: form.complete_date || null,
      is_exam: !!form.is_exam,
      updated_at: new Date().toISOString(),
    };

    var record = SupabaseProvider.updateTreatmentRecord(recordId, updates);
    return { success: true, record: record };
  } catch (e) {
    Logger.log("studentUpdateTreatmentRecord error: " + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Delete a treatment record and re-order remaining records.
 * @param {string} hn — Patient HN (for re-ordering)
 * @param {string} recordId
 * @returns {Object} { success, error? }
 */
function studentDeleteTreatmentRecord(hn, recordId) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  try {
    var patient = SupabaseProvider.getPatientByHn(hn);
    if (!patient) return { success: false, error: "Patient not found." };

    // Delete the record
    SupabaseProvider.deleteTreatmentRecord(recordId);

    // Re-order remaining records
    var remaining =
      SupabaseProvider.listTreatmentRecords(patient.patient_id) || [];
    for (var i = 0; i < remaining.length; i++) {
      var newOrder = i + 1;
      if (remaining[i].treatment_order !== newOrder) {
        SupabaseProvider.updateTreatmentRecord(remaining[i].record_id, {
          treatment_order: newOrder,
          updated_at: new Date().toISOString(),
        });
      }
    }

    return { success: true };
  } catch (e) {
    Logger.log("studentDeleteTreatmentRecord error: " + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Re-order a treatment record and shift others accordingly.
 * @param {string} hn
 * @param {string} recordId
 * @param {number} newOrder
 */
function studentUpdateTreatmentOrder(hn, recordId, newOrder) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  try {
    var patient = SupabaseProvider.getPatientByHn(hn);
    if (!patient) return { success: false, error: "Patient not found." };

    var records =
      SupabaseProvider.listTreatmentRecords(patient.patient_id) || [];

    // Find target record
    var target = records.find(function (r) {
      return r.record_id === recordId;
    });
    if (!target) return { success: false, error: "Record not found." };

    var oldOrder = target.treatment_order || 0;
    newOrder = parseInt(newOrder);

    if (isNaN(newOrder) || newOrder < 1)
      return { success: false, error: "Invalid order number." };
    if (newOrder > records.length) newOrder = records.length;
    if (newOrder === oldOrder) return { success: true }; // No change

    // Adjust orders
    // If moving down (e.g. 1 -> 3): shift items in (1, 3] down by 1 (decrement) -> Wait, logic check
    // If moving down (e.g. 1 -> 3): Items at 2 and 3 need to shift UP to 1 and 2.  (idx 1->0, 2->1)
    // Actually simpler: Remove target from array, splice into new index.

    // 1. Sort current by order
    records.sort(function (a, b) {
      return (a.treatment_order || 0) - (b.treatment_order || 0);
    });

    // 2. Remove target
    var currentIndex = records.findIndex(function (r) {
      return r.record_id === recordId;
    });
    if (currentIndex === -1)
      return { success: false, error: "Record index error." };
    records.splice(currentIndex, 1);

    // 3. Insert at new position (1-based newOrder maps to 0-based index)
    records.splice(newOrder - 1, 0, target);

    // 4. Check for Phase Change based on new neighbors
    var newIndex = newOrder - 1;
    var targetPhaseId = target.phase_id;
    var message = null;

    // Look at previous neighbor first (simulating "append to group")
    var neighbor = null;
    if (newIndex > 0) {
      neighbor = records[newIndex - 1]; // Prev
    } else if (records.length > 1) {
      neighbor = records[newIndex + 1]; // Next (if at top)
    }

    if (neighbor && neighbor.phase_id && neighbor.phase_id !== targetPhaseId) {
      // Phase changed!
      target.phase_id = neighbor.phase_id; // Update in memory object for consistent loop below?
      // Actually loop below updates treatment_order, we need to update phase_id too.
      // We will do specific update for target.

      SupabaseProvider.updateTreatmentRecord(target.record_id, {
        phase_id: neighbor.phase_id,
        updated_at: new Date().toISOString(),
      });

      // Get Phase Name for message (optional, need to fetch phases or join? simpler generic message)
      message = "Record moved to new phase group.";
    }

    // 5. Update records that have changed order
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var correctOrder = i + 1;

      // Ensure we don't double update if we just did phase update above,
      // but treatment_order might still need update.
      // SupabaseProvider.updateTreatmentRecord is distinct call.

      if (r.treatment_order !== correctOrder) {
        SupabaseProvider.updateTreatmentRecord(r.record_id, {
          treatment_order: correctOrder,
          updated_at: new Date().toISOString(),
        });
      }
    }

    return { success: true, message: message };
  } catch (e) {
    Logger.log("studentUpdateTreatmentOrder error: " + e.message);
    return { success: false, error: e.message };
  }
}

// ──────────────────────────────────────────────
//  Student: Rotate Clinic Workflow
// ──────────────────────────────────────────────

/**
 * List divisions for Out-of-Patient entries (clinic = 'out of patient').
 */
function studentListRotateDivisions() {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");
  return SupabaseProvider.listRotateDivisions();
}

/**
 * List requirements for a specific division.
 */
function studentListRequirementsByDivision(divisionId) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");
  return SupabaseProvider.listRequirementsByDivision(divisionId);
}

function studentListNonMCRequirementsByDivision(divisionId) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");
  return SupabaseProvider.listNonMCRequirementsByDivision(divisionId);
}

/**
 * List instructors for a specific division.
 */
function studentListInstructorsByDivision(divisionId) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");
  return SupabaseProvider.listInstructorsByDivision(divisionId);
}

/**
 * Submit a Rotate Clinic Requirement.
 * @param {Object} form
 * @returns {Object} { success, error? }
 */
function studentSubmitRotateRequirement(form) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (!profile.found || !profile.active || profile.role !== "student") {
    throw new Error("Student only.");
  }

  try {
    var payload = {
      student_id: profile.student_id,
      division_id: form.division_id,
      requirement_id: form.requirement_id,
      instructor_id: form.instructor_id || null,
      area: form.area || null,
      rsu_units: form.rsu_units ? Number(form.rsu_units) : 0,
      cda_units: form.cda_units ? Number(form.cda_units) : 0,
      status: "completed",
      hn: form.hn || null,
      patient_name: form.patient_name || null,
    };

    SupabaseProvider.createTreatmentRecord(payload);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
