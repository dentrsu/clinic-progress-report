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
 * If targetStudentId is provided and the user is an instructor/admin, fetch for that student.
 * @param {string} targetStudentId Optional student ID to fetch data for
 * @returns {Array} List of patient objects
 */
function getStudentPatients(targetStudentId) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (!profile.found || !profile.active) {
    throw new Error("User not found or inactive.");
  }

  var finalStudentId = targetStudentId || profile.student_id;

  if (profile.role === "student") {
    finalStudentId = profile.student_id;
  } else if (profile.role === "instructor" || profile.role === "admin") {
    if (!finalStudentId) throw new Error("targetStudentId is required.");
  }

  var records = SupabaseProvider.listPatientsByStudent(finalStudentId) || [];

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
 * Request an instructor to verify a treatment record via Email.
 * @param {string} recordId
 * @param {string} instructorId (User ID or Instructor ID, assuming instructor_id from UI)
 * @returns {Object} { success, message, error }
 */
function studentRequestEmailVerification(recordId, instructorId) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (!profile.found || !profile.active || profile.role !== "student") {
    throw new Error("Only students can request verification.");
  }

  try {
    // 1. Fetch Record & Validate
    // Use SupabaseProvider to get record details. We'd need to fetch treatment & patient details for the email.
    // Assuming SupabaseProvider has a way to get a single record. If not, we fetch student's records and find it.
    var records =
      SupabaseProvider.listVaultRecordsByStudent(profile.student_id) || [];
    // We might need a direct getTreatmentRecord function, let's assume it exists or use raw fetch if needed.
    // The existing code has SupabaseProvider.getTreatmentRecord. Let's assume it exists or fallback to finding in vault.
    var record = records.find(function (r) {
      return r.record_id === recordId;
    });
    if (!record) {
      record = SupabaseProvider.getTreatmentRecord
        ? SupabaseProvider.getTreatmentRecord(recordId)
        : null;
    }

    if (!record) {
      throw new Error("Record not found or not authorized to access.");
    }

    if (record.status !== "completed") {
      throw new Error(
        "Record must be in 'completed' status to request verification.",
      );
    }

    // 2. Resolve Instructor Email
    var instructor = SupabaseProvider.getInstructorById(instructorId);
    if (!instructor) {
      throw new Error("Instructor not found.");
    }
    var instEmail = instructor.users
      ? instructor.users.email
      : instructor.user
        ? instructor.user.email
        : null;
    if (!instEmail) {
      throw new Error("Instructor email not found.");
    }

    // 3. Prepare Email Details
    var patientName =
      record.patient_name || (record.patient ? record.patient.name : "-");
    var patientHn = record.hn || (record.patient ? record.patient.hn : "-");
    var treatmentName = record.treatment_catalog
      ? record.treatment_catalog.treatment_name
      : "Treatment";
    var stepName = record.treatment_steps
      ? record.treatment_steps.step_name
      : "Step";
    var studentName = profile.name;

    var appUrl = ScriptApp.getService().getUrl();
    var verifyUrl =
      appUrl +
      "?action=verify_record&record_id=" +
      recordId +
      "&status=verified";
    var rejectUrl =
      appUrl +
      "?action=verify_record&record_id=" +
      recordId +
      "&status=rejected";

    var htmlBody =
      "<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;'>" +
      "<h2 style='color: #1a365d; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;'>Verification Request</h2>" +
      "<p><strong>Student:</strong> " +
      studentName +
      " has requested verification for a completed treatment step.</p>" +
      "<table style='width: 100%; border-collapse: collapse; margin: 20px 0;'>" +
      "<tr><td style='padding: 8px; border-bottom: 1px solid #edf2f7;'><strong>Patient HN:</strong></td><td style='padding: 8px; border-bottom: 1px solid #edf2f7;'>" +
      patientHn +
      "</td></tr>" +
      "<tr><td style='padding: 8px; border-bottom: 1px solid #edf2f7;'><strong>Patient Name:</strong></td><td style='padding: 8px; border-bottom: 1px solid #edf2f7;'>" +
      patientName +
      "</td></tr>" +
      "<tr><td style='padding: 8px; border-bottom: 1px solid #edf2f7;'><strong>Treatment:</strong></td><td style='padding: 8px; border-bottom: 1px solid #edf2f7;'>" +
      treatmentName +
      "</td></tr>" +
      "<tr><td style='padding: 8px; border-bottom: 1px solid #edf2f7;'><strong>Step:</strong></td><td style='padding: 8px; border-bottom: 1px solid #edf2f7;'>" +
      stepName +
      "</td></tr>" +
      "<tr><td style='padding: 8px; border-bottom: 1px solid #edf2f7;'><strong>Area:</strong></td><td style='padding: 8px; border-bottom: 1px solid #edf2f7;'>" +
      (record.area || "-") +
      "</td></tr>" +
      "</table>" +
      "<p style='margin-bottom: 30px;'>Please review the work and click one of the actions below:</p>" +
      "<div style='text-align: center;'>" +
      "<a href='" +
      verifyUrl +
      "' style='background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; margin-right: 15px; display: inline-block;'>Verify Treatment</a>" +
      "<a href='" +
      rejectUrl +
      "' style='background-color: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;'>Reject Treatment</a>" +
      "</div>" +
      "<p style='margin-top: 30px; font-size: 12px; color: #718096; border-top: 1px solid #e2e8f0; padding-top: 10px;'>Note: Clicking these links will securely process the action based on your active Google Workspace login.</p>" +
      "</div>";

    MailApp.sendEmail({
      to: instEmail,
      subject:
        "Verification Request: " + treatmentName + " for HN " + patientHn,
      htmlBody: htmlBody,
    });

    return { success: true, message: "Email sent successfully to advisor." };
  } catch (e) {
    Logger.log("studentRequestEmailVerification error: " + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Handle the web app route for email verifications
 * @param {Object} e - DoGet event parameter
 */
function processEmailVerification(e) {
  var recordId = e.parameter.record_id;
  var actionStatus = e.parameter.status; // 'verified' or 'rejected'
  var url = ScriptApp.getService().getUrl();

  var htmlTemplate =
    "<div style='font-family: Arial, sans-serif; text-align: center; padding: 50px; max-width: 500px; margin: 0 auto; border: 1px solid #ccc; border-radius: 10px; margin-top: 50px;'>" +
    "<h2>{TITLE}</h2><p>{MESSAGE}</p><a href='" +
    url +
    "' style='display: inline-block; margin-top: 20px; padding: 10px 20px; background: #1a365d; color: white; text-decoration: none; border-radius: 5px;'>Go to Dashboard</a></div>";

  try {
    var user = getCurrentUser();
    if (!user.allowed)
      throw new Error(
        "Access Denied: You must be logged in with an authorized account.",
      );

    var profile = getUserProfile(user.email);
    if (
      !profile.found ||
      !profile.active ||
      (profile.role !== "instructor" && profile.role !== "admin")
    ) {
      throw new Error("Access Denied: Only instructors can verify treatments.");
    }

    if (
      !recordId ||
      (actionStatus !== "verified" && actionStatus !== "rejected")
    ) {
      throw new Error("Invalid request parameters.");
    }

    var updates = {
      status: actionStatus,
      updated_at: new Date().toISOString(),
    };

    if (actionStatus === "verified") {
      updates.verified_by = profile.user_id;
      updates.verified_at = new Date().toISOString();
    }

    SupabaseProvider.updateTreatmentRecord(recordId, updates);

    // Attempt to notify student
    try {
      var record = SupabaseProvider.getTreatmentRecord(recordId);
      if (record && record.student_id) {
        var student = SupabaseProvider.getStudentById(record.student_id);
        if (student && student.user && student.user.email) {
          var statusLabel =
            actionStatus === "verified" ? "Verified ✅" : "Rejected ❌";
          var treatName = record.treatment_catalog
            ? record.treatment_catalog.treatment_name
            : "Treatment";
          var stepLabel = record.treatment_steps
            ? record.treatment_steps.step_name
            : "";
          var pHn = record.hn || (record.patient ? record.patient.hn : "-");

          var pName =
            record.patient_name || (record.patient ? record.patient.name : "-");
          var areaTeeth = record.area || "-";
          var rsuUnits = record.rsu_units != null ? record.rsu_units : "-";
          var cdaUnits = record.cda_units != null ? record.cda_units : "-";

          MailApp.sendEmail({
            to: student.user.email,
            subject:
              "Treatment " +
              (actionStatus === "verified" ? "Verified" : "Rejected") +
              ": " +
              treatName +
              " (HN " +
              pHn +
              ")",
            htmlBody:
              "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e0e0e0;border-radius:8px;'>" +
              "<h2 style='color:#1a365d;border-bottom:2px solid #e2e8f0;padding-bottom:10px;'>Treatment " +
              statusLabel +
              "</h2>" +
              "<p>Your verification request has been <b>" +
              actionStatus +
              "</b> by " +
              (profile.name || "an instructor") +
              ".</p>" +
              "<table style='width:100%;border-collapse:collapse;margin:20px 0;'>" +
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Patient HN:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              pHn +
              "</td></tr>" +
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Patient Name:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              pName +
              "</td></tr>" +
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Treatment:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              treatName +
              "</td></tr>" +
              (stepLabel
                ? "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Step:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
                  stepLabel +
                  "</td></tr>"
                : "") +
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Area / Teeth:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              areaTeeth +
              "</td></tr>" +
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>RSU Units:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              rsuUnits +
              "</td></tr>" +
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>CDA Units:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              cdaUnits +
              "</td></tr>" +
              "</table></div>",
          });
        }
      }
    } catch (emailErr) {
      // Log but don't fail the verification
      Logger.log("Failed to notify student: " + emailErr.message);
    }

    var title =
      actionStatus === "verified"
        ? "✅ Treatment Verified"
        : "❌ Treatment Rejected";
    var msg =
      "The record has been successfully " + actionStatus + ". Thank you.";
    return HtmlService.createHtmlOutput(
      htmlTemplate.replace("{TITLE}", title).replace("{MESSAGE}", msg),
    );
  } catch (e) {
    Logger.log("processEmailVerification error: " + e.message);
    return HtmlService.createHtmlOutput(
      htmlTemplate
        .replace("{TITLE}", "⚠️ Error")
        .replace("{MESSAGE}", e.message),
    );
  }
}

/**
 * Serves the landing page.
 * @param {GoogleAppsScript.Events.DoGet} e
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  var action = e.parameter.action;
  if (action === "verify_record") {
    return processEmailVerification(e);
  }

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

    if (
      e.parameter.student_id &&
      (profile.role === "instructor" || profile.role === "admin")
    ) {
      var targetStudent = SupabaseProvider.getStudentById(
        e.parameter.student_id,
      );
      t.academic_id = targetStudent ? targetStudent.academic_id : "-";
      var sName = "-";
      if (targetStudent) {
        if (targetStudent.user && targetStudent.user.name)
          sName = targetStudent.user.name;
        else if (targetStudent.users && targetStudent.users.name)
          sName = targetStudent.users.name;
      }
      t.student_name = sName;
      t.target_student_id = e.parameter.student_id;
    } else {
      t.academic_id = profile.academic_id || "-";
      t.student_name = profile.name || "-";
      t.target_student_id = profile.student_id || "-";
    }

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

  if (page === "advisor") {
    var t = HtmlService.createTemplateFromFile("advisor");
    t.appUrl = url;
    t.appDevUrl = devUrl;
    return t
      .evaluate()
      .setTitle("Advisor Portal — Clinic Progress Report")
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

// ─── Division Processor Registry ─────────────────────────────────────────────
//
// Add an entry here ONLY when a division needs vault aggregation logic that
// cannot be expressed through `aggregation_config` on requirement_list.
//
// Interface:
//   processor(divReqs, divRecords, progressMap)
//     divReqs    — Array of requirement_list rows for this division
//     divRecords — Array of treatment_records (verified/completed) for this student+division
//     progressMap — { [requirement_id]: { rsu, cda, p_rsu, p_cda } }  ← modify in place
//
// Called AFTER the two-pass aggregation, so progressMap already has values
// from aggregation_config. Override specific entries as needed.
//
// Example:
//   'PERIO': function(divReqs, divRecords, progressMap) {
//     // custom PERIO logic here
//   }
//
var DIVISION_PROCESSORS = {
  // Populated when a division requires logic beyond aggregation_config
};

/**
 * Apply aggregation for one requirement based on its aggregation_config.
 * Called twice per division: pass 1 (isPass2=false) handles sum/count/count_exam;
 * pass 2 (isPass2=true) handles 'derived' which reads from pass-1 results.
 *
 * aggregation_config types:
 *   null / "sum"        — sum rsu_units / cda_units from records linked to this req (default)
 *   "count"             — count records linked to this req (not sum units)
 *   "count_exam"        — count is_exam=true records in this division
 *                         optional: { "source_ids": [...] } to scope to specific reqs
 *   "derived"           — read progressMap values from source_ids and aggregate
 *                         { "source_ids": [...], "operation": "sum_both|sum_rsu|sum_cda" }
 *
 * @param {Object} req          — requirement_list row
 * @param {Array}  divRecords   — all verified/completed records in this division for this student
 * @param {Object} progressMap  — { [req_id]: { rsu, cda, p_rsu, p_cda } }
 * @param {boolean} isPass2     — true = only process 'derived'; false = skip 'derived'
 */
function _applyRequirementAggregation(req, divRecords, progressMap, isPass2) {
  var config = null;
  try {
    config =
      typeof req.aggregation_config === "string"
        ? JSON.parse(req.aggregation_config)
        : req.aggregation_config || null;
  } catch (e) {
    config = null;
  }

  // Determine effective type: config > is_exam fallback > default sum
  var type = config ? config.type : req.is_exam === true ? "count_exam" : "sum";

  if (isPass2 && type !== "derived") return; // pass 2: derived only
  if (!isPass2 && type === "derived") return; // pass 1: skip derived

  var reqId = req.requirement_id;
  if (!progressMap[reqId]) {
    progressMap[reqId] = { rsu: 0, cda: 0, p_rsu: 0, p_cda: 0 };
  }

  if (type === "sum") {
    divRecords.forEach(function (rec) {
      if (rec.requirement_id !== reqId) return;
      var rsu = parseFloat(rec.rsu_units) || 0;
      var cda = parseFloat(rec.cda_units) || 0;
      if (rec.status === "verified") {
        progressMap[reqId].rsu += rsu;
        progressMap[reqId].cda += cda;
      } else if (rec.status === "completed") {
        progressMap[reqId].p_rsu += rsu;
        progressMap[reqId].p_cda += cda;
      }
    });
  } else if (type === "count") {
    // Count records (not sum units) linked directly to this requirement
    divRecords.forEach(function (rec) {
      if (rec.requirement_id !== reqId) return;
      if (rec.status === "verified") {
        progressMap[reqId].rsu += 1;
        progressMap[reqId].cda += 1;
      } else if (rec.status === "completed") {
        progressMap[reqId].p_rsu += 1;
        progressMap[reqId].p_cda += 1;
      }
    });
  } else if (type === "count_exam") {
    // Count is_exam=true records in this division, optionally scoped to source_ids
    var filterReqs = config && config.source_ids ? config.source_ids : null;
    divRecords.forEach(function (rec) {
      if (!rec.is_exam) return;
      if (filterReqs && filterReqs.indexOf(rec.requirement_id) === -1) return;
      if (rec.status === "verified") {
        progressMap[reqId].rsu += 1;
        progressMap[reqId].cda += 1;
      } else if (rec.status === "completed") {
        progressMap[reqId].p_rsu += 1;
        progressMap[reqId].p_cda += 1;
      }
    });
  } else if (type === "derived") {
    // Sum computed values from other requirements (must be processed in pass 1 first)
    var sourceIds = config.source_ids || [];
    var op = config.operation || "sum_both"; // sum_both | sum_rsu | sum_cda
    var rsu = 0,
      cda = 0,
      pRsu = 0,
      pCda = 0;
    sourceIds.forEach(function (sid) {
      var p = progressMap[sid] || { rsu: 0, cda: 0, p_rsu: 0, p_cda: 0 };
      rsu += p.rsu;
      cda += p.cda;
      pRsu += p.p_rsu;
      pCda += p.p_cda;
    });
    progressMap[reqId] = {
      rsu: op === "sum_cda" ? cda : rsu,
      cda: op === "sum_rsu" ? rsu : cda,
      p_rsu: op === "sum_cda" ? pCda : pRsu,
      p_cda: op === "sum_rsu" ? pRsu : pCda,
    };
  }
}

/**
 * Get student requirement progress for the vault.
 * @param {string} targetStudentId Optional student ID to fetch data for (instructor/admin only)
 * @returns {Array} Divisions sorted by name, each with requirements + completion percentages
 */
function getStudentVaultData(targetStudentId) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (!profile.found || !profile.active) {
    throw new Error("User not found or inactive.");
  }

  var finalStudentId = targetStudentId || profile.student_id;
  if (profile.role === "student") {
    finalStudentId = profile.student_id;
  } else if (!finalStudentId) {
    throw new Error("No student specified.");
  }

  // 1. Fetch all requirements and student records
  var requirements = SupabaseProvider.listRequirements() || [];
  var records =
    SupabaseProvider.listVaultRecordsByStudent(finalStudentId) || [];

  // 2. Build division metadata index: divName -> { name, code, reqs[] }
  var divisionMeta = {};
  var reqDivMap = {}; // requirement_id -> divName (for quick lookup)
  requirements.forEach(function (req) {
    var divName =
      req.divisions && req.divisions.name ? req.divisions.name : "Other";
    var divCode =
      req.divisions && req.divisions.code
        ? req.divisions.code.toUpperCase()
        : "";
    reqDivMap[req.requirement_id] = divName;
    if (!divisionMeta[divName]) {
      divisionMeta[divName] = { name: divName, code: divCode, reqs: [] };
    }
    divisionMeta[divName].reqs.push(req);
  });

  // 3. Group records by division and build detail map for expanded vault rows
  var recordsByDiv = {}; // divName -> [records]
  var recordsDetailMap = {}; // requirement_id -> [detail objects]
  records.forEach(function (rec) {
    if (!rec.requirement_id) return;
    var divName = reqDivMap[rec.requirement_id] || "Other";
    if (!recordsByDiv[divName]) recordsByDiv[divName] = [];
    recordsByDiv[divName].push(rec);

    if (!recordsDetailMap[rec.requirement_id]) {
      recordsDetailMap[rec.requirement_id] = [];
    }
    var recHn = rec.hn || (rec.patient && rec.patient.hn) || "-";
    var recName = rec.patient_name || (rec.patient && rec.patient.name) || "-";
    recordsDetailMap[rec.requirement_id].push({
      hn: recHn,
      patient_name: recName,
      area: rec.area || "-",
      rsu_units: parseFloat(rec.rsu_units) || 0,
      cda_units: parseFloat(rec.cda_units) || 0,
      status: rec.status,
      is_exam: rec.is_exam === true,
    });
  });

  // 4. Per-division: two-pass aggregation then optional division processor
  var progressMaps = {}; // divName -> { requirement_id -> { rsu, cda, p_rsu, p_cda } }
  Object.values(divisionMeta).forEach(function (div) {
    var divReqs = div.reqs;
    var divRecords = recordsByDiv[div.name] || [];
    var progressMap = {};

    // Initialize all requirements to zero
    divReqs.forEach(function (req) {
      progressMap[req.requirement_id] = { rsu: 0, cda: 0, p_rsu: 0, p_cda: 0 };
    });

    // Pass 1: sum / count / count_exam (non-derived)
    divReqs.forEach(function (req) {
      _applyRequirementAggregation(req, divRecords, progressMap, false);
    });

    // Pass 2: derived (reads from progressMap values built in pass 1)
    divReqs.forEach(function (req) {
      _applyRequirementAggregation(req, divRecords, progressMap, true);
    });

    // Optional division-specific processor (override / extend progressMap)
    var processor = DIVISION_PROCESSORS[div.code];
    if (processor) {
      try {
        processor(divReqs, divRecords, progressMap);
      } catch (e) {
        console.error(
          "DIVISION_PROCESSORS[" + div.code + "] error: " + e.message,
        );
      }
    }

    progressMaps[div.name] = progressMap;
  });

  // 5. Build output: group requirements by division with computed progress
  var divisions = {};
  requirements.forEach(function (req) {
    var divName = reqDivMap[req.requirement_id] || "Other";
    if (!divisions[divName]) {
      divisions[divName] = { name: divName, requirements: [] };
    }

    var prog =
      progressMaps[divName] && progressMaps[divName][req.requirement_id]
        ? progressMaps[divName][req.requirement_id]
        : { rsu: 0, cda: 0, p_rsu: 0, p_cda: 0 };

    // is_exam: use DB field, with legacy fallback for Endo Exam RCT
    var isExam =
      req.is_exam === true ||
      (divisionMeta[divName] &&
        divisionMeta[divName].code === "ENDO" &&
        req.requirement_type === "Exam RCT");

    // Detail records: for exam-type show all division exam records; otherwise per-requirement
    var detailRecords;
    if (isExam) {
      detailRecords = (recordsByDiv[divName] || [])
        .filter(function (r) {
          return r.is_exam === true;
        })
        .map(function (r) {
          return {
            hn: r.hn || (r.patient && r.patient.hn) || "-",
            patient_name:
              r.patient_name || (r.patient && r.patient.name) || "-",
            area: r.area || "-",
            rsu_units: parseFloat(r.rsu_units) || 0,
            cda_units: parseFloat(r.cda_units) || 0,
            status: r.status,
            is_exam: true,
          };
        });
    } else {
      detailRecords = recordsDetailMap[req.requirement_id] || [];
    }

    divisions[divName].requirements.push({
      requirement_id: req.requirement_id,
      requirement_type: req.requirement_type,
      cda_requirement_type: req.cda_requirement_type || null,
      minimum_rsu: req.minimum_rsu || 0,
      minimum_cda: req.minimum_cda || 0,
      current_rsu: Math.round(prog.rsu * 100) / 100,
      current_cda: Math.round(prog.cda * 100) / 100,
      pending_rsu: Math.round(prog.p_rsu * 100) / 100,
      pending_cda: Math.round(prog.p_cda * 100) / 100,
      rsu_unit: req.rsu_unit || "Case",
      cda_unit: req.cda_unit || "Case",
      is_exam: isExam,
      is_selectable: req.is_selectable !== false, // default true if column not yet migrated
      records: detailRecords,
    });
  });

  // 6. Compute per-division completion percentages for radar chart
  Object.values(divisions).forEach(function (div) {
    var rsuReqs = div.requirements.filter(function (r) {
      return r.minimum_rsu > 0 || r.is_exam;
    });
    var cdaReqs = div.requirements.filter(function (r) {
      return r.minimum_cda > 0 || r.is_exam;
    });

    div.rsu_completion_pct =
      rsuReqs.length > 0
        ? Math.round(
            (rsuReqs.reduce(function (sum, r) {
              var min = r.is_exam ? 1 : r.minimum_rsu;
              return sum + Math.min(r.current_rsu / (min || 1), 1);
            }, 0) /
              rsuReqs.length) *
              100,
          )
        : 0;

    div.cda_completion_pct =
      cdaReqs.length > 0
        ? Math.round(
            (cdaReqs.reduce(function (sum, r) {
              var min = r.is_exam ? 1 : r.minimum_cda;
              return sum + Math.min(r.current_cda / (min || 1), 1);
            }, 0) /
              cdaReqs.length) *
              100,
          )
        : 0;
  });

  return Object.values(divisions).sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
}

/**
 * Get students for the logged-in instructor's team.
 * Calculates student year based on 'Aug 20' cutoff date.
 * Filters 5th years to team_leader_1_id, and others to team_leader_2_id.
 * @returns {Array} List of student objects
 */
function instructorGetTeamStudents() {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (!profile.found || !profile.active || profile.role !== "instructor") {
    throw new Error("User is not an active instructor.");
  }

  var instructorId = profile.instructor_id;
  var students = SupabaseProvider.listStudentsByTeamLeader(instructorId) || [];

  var today = new Date();
  var currentYear = today.getFullYear();

  // Cutoff is Aug 20 (Month is 0-indexed, so August is 7)
  var isNewAcademicYear =
    today.getMonth() > 7 || (today.getMonth() === 7 && today.getDate() >= 20);

  var instructorsCache = SupabaseProvider.listInstructors() || [];
  function getTeamLeaderName(id) {
    if (!id) return "-";
    for (var i = 0; i < instructorsCache.length; i++) {
      var inst = instructorsCache[i];
      if (inst.instructor_id === id) {
        return inst.users
          ? inst.users.name
          : inst.user
            ? inst.user.name
            : "Unknown";
      }
    }
    return "Unknown";
  }

  var filtered = [];

  for (var i = 0; i < students.length; i++) {
    var s = students[i];
    if (!s.first_clinic_year) continue;

    var studentYears;
    if (isNewAcademicYear) {
      studentYears = currentYear - s.first_clinic_year + 5;
    } else {
      studentYears = currentYear - s.first_clinic_year + 4;
    }

    s.calculated_year = studentYears;

    // Filter logic
    if (studentYears === 5) {
      if (s.team_leader_1_id !== instructorId) continue;
    } else {
      if (s.team_leader_2_id !== instructorId) continue;
    }

    // Format for frontend
    filtered.push({
      student_id: s.student_id,
      academic_id: s.academic_id,
      name: s.user ? s.user.name : "Unknown",
      email: s.user ? s.user.email : "-",
      status: s.status,
      calculated_year: s.calculated_year,
      first_clinic_year: s.first_clinic_year,
      floor_id: s.floor_id,
      floor_label: s.floor ? s.floor.label : "-",
      unit_id: s.unit_id || "-",
      team_leader_1_name: getTeamLeaderName(s.team_leader_1_id),
      team_leader_2_name: getTeamLeaderName(s.team_leader_2_id),
    });
  }

  // Sort by year descending, then by academic_id
  filtered.sort(function (a, b) {
    if (a.calculated_year !== b.calculated_year) {
      return b.calculated_year - a.calculated_year;
    }
    return String(a.academic_id).localeCompare(String(b.academic_id));
  });

  return filtered;
}

/**
 * Get all configured advisees for an instructor.
 * Advisees are students where the student's `<division_code>_instructor_id` matches the instructor's ID.
 */
function advisorGetAdvisees() {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (!profile.found || !profile.active || profile.role !== "instructor") {
    throw new Error("User is not an active instructor.");
  }

  if (!profile.division || !profile.division.code) {
    throw new Error("Instructor is not assigned to a division.");
  }

  var instructorId = profile.instructor_id;
  var divisionCode = profile.division.code.toLowerCase();
  var columnName = divisionCode + "_instructor_id";

  // Verify it's a valid column pattern. Students table only goes up to pediatric, etc.
  var students =
    SupabaseProvider.listStudentsByDivisionInstructor(
      columnName,
      instructorId,
    ) || [];

  var today = new Date();
  var currentYear = today.getFullYear();

  // Cutoff is Aug 20 (Month is 0-indexed, so August is 7)
  var isNewAcademicYear =
    today.getMonth() > 7 || (today.getMonth() === 7 && today.getDate() >= 20);

  var instructorsCache = SupabaseProvider.listInstructors() || [];
  function getTeamLeaderName(id) {
    if (!id) return "-";
    for (var i = 0; i < instructorsCache.length; i++) {
      var inst = instructorsCache[i];
      if (inst.instructor_id === id) {
        return inst.users
          ? inst.users.name
          : inst.user
            ? inst.user.name
            : "Unknown";
      }
    }
    return "Unknown";
  }

  var formatted = [];

  for (var i = 0; i < students.length; i++) {
    var s = students[i];
    var studentYears = "-";
    if (s.first_clinic_year) {
      if (isNewAcademicYear) {
        studentYears = currentYear - s.first_clinic_year + 5;
      } else {
        studentYears = currentYear - s.first_clinic_year + 4;
      }
    }

    // Format for frontend
    formatted.push({
      student_id: s.student_id,
      academic_id: s.academic_id,
      name: s.user ? s.user.name : "Unknown",
      email: s.user ? s.user.email : "-",
      status: s.status,
      calculated_year: studentYears,
      first_clinic_year: s.first_clinic_year,
      floor_id: s.floor_id,
      floor_label: s.floor ? s.floor.label : "-",
      unit_id: s.unit_id || "-",
      team_leader_1_name: getTeamLeaderName(s.team_leader_1_id),
      team_leader_2_name: getTeamLeaderName(s.team_leader_2_id),
    });
  }

  // Sort by year descending, then by academic_id
  formatted.sort(function (a, b) {
    var yearA = a.calculated_year === "-" ? 0 : a.calculated_year;
    var yearB = b.calculated_year === "-" ? 0 : b.calculated_year;
    if (yearA !== yearB) {
      return yearB - yearA;
    }
    return String(a.academic_id).localeCompare(String(b.academic_id));
  });

  return {
    profile: profile,
    students: formatted,
  };
}

/**
 * Get the vault data for a specific student for the advisor's division.
 * @param {string} studentId The UUID of the student (not academic_id).
 * @param {string} divisionName The name of the division to filter (e.g. 'Operative').
 * @returns {Object|null} Division vault object or null.
 */
function advisorGetStudentDivisionVault(studentId, divisionName) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (!profile.found || !profile.active || profile.role !== "instructor") {
    throw new Error("User is not an active instructor.");
  }

  // Reuse the full vault generation, then pick only the requested division
  var fullVault = getStudentVaultData(studentId);
  for (var i = 0; i < fullVault.length; i++) {
    if (fullVault[i].name === divisionName) {
      return fullVault[i];
    }
  }

  // Return empty structure if not found (or student has no requirements in division)
  return {
    name: divisionName,
    requirements: [],
  };
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
        oper_instructor_id: form.oper_instructor_id || null,
        endo_instructor_id: form.endo_instructor_id || null,
        perio_instructor_id: form.perio_instructor_id || null,
        prosth_instructor_id: form.prosth_instructor_id || null,
        diag_instructor_id: form.diag_instructor_id || null,
        radio_instructor_id: form.radio_instructor_id || null,
        sur_instructor_id: form.sur_instructor_id || null,
        ortho_instructor_id: form.ortho_instructor_id || null,
        pedo_instructor_id: form.pedo_instructor_id || null,
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
          oper_instructor_id: form.oper_instructor_id || null,
          endo_instructor_id: form.endo_instructor_id || null,
          perio_instructor_id: form.perio_instructor_id || null,
          prosth_instructor_id: form.prosth_instructor_id || null,
          diag_instructor_id: form.diag_instructor_id || null,
          radio_instructor_id: form.radio_instructor_id || null,
          sur_instructor_id: form.sur_instructor_id || null,
          ortho_instructor_id: form.ortho_instructor_id || null,
          pedo_instructor_id: form.pedo_instructor_id || null,
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
          oper_instructor_id: form.oper_instructor_id || null,
          endo_instructor_id: form.endo_instructor_id || null,
          perio_instructor_id: form.perio_instructor_id || null,
          prosth_instructor_id: form.prosth_instructor_id || null,
          diag_instructor_id: form.diag_instructor_id || null,
          radio_instructor_id: form.radio_instructor_id || null,
          sur_instructor_id: form.sur_instructor_id || null,
          ortho_instructor_id: form.ortho_instructor_id || null,
          pedo_instructor_id: form.pedo_instructor_id || null,
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
    var aggConfig = null;
    if (form.aggregation_config && form.aggregation_config.trim()) {
      try {
        aggConfig = JSON.parse(form.aggregation_config);
      } catch (e) {
        throw new Error("Invalid aggregation_config JSON: " + e.message);
      }
    }
    SupabaseProvider.createRequirement({
      division_id: form.division_id,
      requirement_type: form.requirement_type,
      cda_requirement_type: form.cda_requirement_type || null,
      minimum_rsu: parseFloat(form.minimum_rsu) || 0,
      minimum_cda: parseFloat(form.minimum_cda) || 0,
      rsu_unit: form.rsu_unit || "Case",
      cda_unit: form.cda_unit || "Case",
      is_patient_treatment:
        form.is_patient_treatment === true ||
        form.is_patient_treatment === "true",
      non_mc_pateint_req:
        form.non_mc_pateint_req === true || form.non_mc_pateint_req === "true",
      is_exam: form.is_exam === true || form.is_exam === "true",
      is_selectable:
        form.is_selectable !== false && form.is_selectable !== "false",
      aggregation_config: aggConfig,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function adminUpdateRequirement(id, form) {
  _assertAdmin();
  try {
    var aggConfigUpd = null;
    if (form.aggregation_config && form.aggregation_config.trim()) {
      try {
        aggConfigUpd = JSON.parse(form.aggregation_config);
      } catch (e) {
        throw new Error("Invalid aggregation_config JSON: " + e.message);
      }
    }
    SupabaseProvider.updateRequirement(id, {
      division_id: form.division_id,
      requirement_type: form.requirement_type,
      cda_requirement_type: form.cda_requirement_type || null,
      minimum_rsu: parseFloat(form.minimum_rsu) || 0,
      minimum_cda: parseFloat(form.minimum_cda) || 0,
      rsu_unit: form.rsu_unit || "Case",
      cda_unit: form.cda_unit || "Case",
      is_patient_treatment:
        form.is_patient_treatment === true ||
        form.is_patient_treatment === "true",
      non_mc_pateint_req:
        form.non_mc_pateint_req === true || form.non_mc_pateint_req === "true",
      is_exam: form.is_exam === true || form.is_exam === "true",
      is_selectable:
        form.is_selectable !== false && form.is_selectable !== "false",
      aggregation_config: aggConfigUpd,
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
