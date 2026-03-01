/**
 * Code.gs — Entry point for the DentRSU Tracker web app
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
    // First confirm the record belongs to this student (authorization check).
    var records =
      SupabaseProvider.listVaultRecordsByStudent(profile.student_id) || [];
    var owned = records.find(function (r) {
      return r.record_id === recordId;
    });
    if (!owned) {
      throw new Error("Record not found or not authorized to access.");
    }
    // Then fetch the full record with joins (treatment_catalog, treatment_steps, patient) for email details.
    var record = SupabaseProvider.getTreatmentRecord(recordId);
    if (!record) {
      throw new Error("Record not found.");
    }

    if (
      record.status !== "completed" &&
      record.status !== "pending verification" &&
      record.status !== "rejected"
    ) {
      throw new Error(
        "Record must be in 'completed', 'pending verification', or 'rejected' status to request verification.",
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
    var divCode = record.division ? record.division.code : "";
    var reqType = record.requirement ? record.requirement.requirement_type : "";

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

    // Build division-specific detail rows
    var td = "padding: 8px; border-bottom: 1px solid #edf2f7;";
    var divRows = "";

    // Requirement type (if available)
    if (reqType) {
      divRows +=
        "<tr><td style='" +
        td +
        "'><strong>Requirement:</strong></td>" +
        "<td style='" +
        td +
        "'>" +
        reqType +
        "</td></tr>";
    }

    // RSU units — label as "Complexities" for PERIO Case G/P
    if (record.rsu_units != null && record.rsu_units !== "") {
      var rsuLabel =
        divCode === "PERIO" && (reqType === "Case G" || reqType === "Case P")
          ? "Complexities"
          : "RSU Units";
      divRows +=
        "<tr><td style='" +
        td +
        "'><strong>" +
        rsuLabel +
        ":</strong></td>" +
        "<td style='" +
        td +
        "'>" +
        record.rsu_units +
        "</td></tr>";
    }

    // CDA units
    if (record.cda_units != null && record.cda_units !== "") {
      divRows +=
        "<tr><td style='" +
        td +
        "'><strong>CDA Units:</strong></td>" +
        "<td style='" +
        td +
        "'>" +
        record.cda_units +
        "</td></tr>";
    }

    // OPER: book number, page number
    if (divCode === "OPER") {
      if (record.book_number != null && record.book_number !== "") {
        divRows +=
          "<tr><td style='" +
          td +
          "'><strong>Book No.:</strong></td>" +
          "<td style='" +
          td +
          "'>" +
          record.book_number +
          "</td></tr>";
      }
      if (record.page_number != null && record.page_number !== "") {
        divRows +=
          "<tr><td style='" +
          td +
          "'><strong>Page No.:</strong></td>" +
          "<td style='" +
          td +
          "'>" +
          record.page_number +
          "</td></tr>";
      }
    }

    // PERIO: severity, perio_exams flags
    if (divCode === "PERIO") {
      if (record.severity != null && record.severity !== "") {
        divRows +=
          "<tr><td style='" +
          td +
          "'><strong>Severity:</strong></td>" +
          "<td style='" +
          td +
          "'>" +
          record.severity +
          "</td></tr>";
      }
      var pe = record.perio_exams;
      if (pe && typeof pe === "object") {
        var examParts = [];
        if (pe.ohi_1st) examParts.push("OHI 1st Exam");
        if (pe.ohi_2nd) examParts.push("OHI 2nd Exam");
        if (pe.srp_1st) examParts.push("SRP 1st Exam");
        if (pe.srp_2nd) examParts.push("SRP 2nd Exam");
        if (examParts.length > 0) {
          divRows +=
            "<tr><td style='" +
            td +
            "'><strong>Exams Performed:</strong></td>" +
            "<td style='" +
            td +
            "'>" +
            examParts.join(", ") +
            "</td></tr>";
        }
      }
    }

    // ENDO: exam case flag
    if (divCode === "ENDO" && record.is_exam) {
      divRows +=
        "<tr><td style='" +
        td +
        "'><strong>Exam Case:</strong></td>" +
        "<td style='" +
        td +
        "'>Yes</td></tr>";
    }

    var htmlBody =
      "<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;'>" +
      "<h2 style='color: #1a365d; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;'>Verification Request</h2>" +
      "<p><strong>Student:</strong> " +
      studentName +
      " has requested verification for a completed treatment step.</p>" +
      "<table style='width: 100%; border-collapse: collapse; margin: 20px 0;'>" +
      "<tr><td style='" +
      td +
      "'><strong>Patient HN:</strong></td><td style='" +
      td +
      "'>" +
      patientHn +
      "</td></tr>" +
      "<tr><td style='" +
      td +
      "'><strong>Patient Name:</strong></td><td style='" +
      td +
      "'>" +
      patientName +
      "</td></tr>" +
      "<tr><td style='" +
      td +
      "'><strong>Treatment:</strong></td><td style='" +
      td +
      "'>" +
      treatmentName +
      "</td></tr>" +
      "<tr><td style='" +
      td +
      "'><strong>Step:</strong></td><td style='" +
      td +
      "'>" +
      stepName +
      "</td></tr>" +
      "<tr><td style='" +
      td +
      "'><strong>Area:</strong></td><td style='" +
      td +
      "'>" +
      (record.area || "-") +
      "</td></tr>" +
      divRows +
      "</table>" +
      "<p style='margin-bottom: 30px;'>Please review the work and click one of the actions below:</p>" +
      "<div style='text-align: center;'>" +
      "<p style='margin: 0 0 12px 0;'><a href='" +
      verifyUrl +
      "' style='background-color: #10b981; color: white; padding: 14px 32px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;'>Verify Treatment</a></p>" +
      "<p style='margin: 0;'><a href='" +
      rejectUrl +
      "' style='background-color: #ef4444; color: white; padding: 14px 32px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;'>Reject Treatment</a></p>" +
      "</div>" +
      "<p style='margin-top: 30px; font-size: 12px; color: #718096; border-top: 1px solid #e2e8f0; padding-top: 10px;'>Note: Clicking these links will securely process the action based on your active Google Workspace login.</p>" +
      "</div>";

    MailApp.sendEmail({
      to: instEmail,
      subject:
        "Verification Request: " + treatmentName + " for HN " + patientHn,
      htmlBody: htmlBody,
    });

    // Update record status to 'pending verification' after successful email send
    SupabaseProvider.updateTreatmentRecord(recordId, {
      status: "pending verification",
      updated_at: new Date().toISOString(),
    });

    return { success: true, message: "Email sent successfully to advisor." };
  } catch (e) {
    Logger.log("studentRequestEmailVerification error: " + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Compute a one-way verification hash for a treatment record.
 * Input: SHA-256( verifiedAt | recordId | VERIFICATION_SECRET )
 * @param {string} verifiedAt  ISO-8601 timestamp of verification
 * @param {string} recordId    UUID of the treatment record
 * @returns {string} Hex-encoded SHA-256 hash
 */
function _computeVerificationHash(verifiedAt, recordId) {
  var secret =
    PropertiesService.getScriptProperties().getProperty(
      "VERIFICATION_SECRET",
    ) || "";
  var raw = verifiedAt + "|" + recordId + "|" + secret;
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    raw,
    Utilities.Charset.UTF_8,
  );
  // Convert byte array to hex string
  return digest
    .map(function (b) {
      return ("0" + ((b + 256) % 256).toString(16)).slice(-2);
    })
    .join("");
}

/**
 * Admin function: recompute verification hash and compare.
 * @param {string} verifiedAt  ISO-8601 timestamp
 * @param {string} recordId    UUID
 * @param {string} hash        Hash string provided by the student
 * @returns {{ valid: boolean, computed: string }}
 */
function adminVerifyHash(verifiedAt, recordId, hash) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");
  var profile = getUserProfile(user.email);
  if (
    !profile.found ||
    !profile.active ||
    (profile.role !== "admin" && profile.role !== "instructor")
  ) {
    throw new Error("Access Denied: Admin or instructor only.");
  }
  var computed = _computeVerificationHash(verifiedAt, recordId);
  return {
    valid: computed === (hash || "").trim().toLowerCase(),
    computed: computed,
  };
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
          var reqType = record.requirement
            ? record.requirement.requirement_type
            : "-";
          var divName = record.division ? record.division.name : "-";
          var severity = record.severity;
          var bookNum = record.book_number;
          var pageNum = record.page_number;

          // Build verification proof section (only for verified)
          var hashSection = "";
          if (actionStatus === "verified") {
            var vAt = updates.verified_at;
            var vHash = _computeVerificationHash(vAt, recordId);
            hashSection =
              "<div style='margin-top:20px;padding:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;'>" +
              "<p style='margin:0 0 8px;font-size:12px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.05em;'>Verification Proof</p>" +
              "<table style='width:100%;border-collapse:collapse;font-size:13px;'>" +
              "<tr><td style='padding:4px 0;color:#374151;font-weight:600;width:100px;'>Verified At</td><td style='padding:4px 0;font-family:monospace;color:#1f2937;'>" +
              vAt +
              "</td></tr>" +
              "<tr><td style='padding:4px 0;color:#374151;font-weight:600;'>Record ID</td><td style='padding:4px 0;font-family:monospace;color:#1f2937;word-break:break-all;'>" +
              recordId +
              "</td></tr>" +
              "<tr><td style='padding:4px 0;color:#374151;font-weight:600;'>Hash</td><td style='padding:4px 0;font-family:monospace;color:#1f2937;word-break:break-all;font-size:11px;'>" +
              vHash +
              "</td></tr>" +
              "</table>" +
              "<p style='margin:8px 0 0;font-size:11px;color:#6b7280;'>Keep this email as proof of verification. The hash can be validated by your program administrator.</p>" +
              "</div>";
          }

          // Build optional detail rows
          var optionalRows = "";
          if (severity != null) {
            optionalRows +=
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Severity:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              severity +
              "</td></tr>";
          }
          if (bookNum != null) {
            optionalRows +=
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Book Number:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              bookNum +
              "</td></tr>";
          }
          if (pageNum != null) {
            optionalRows +=
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Page Number:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              pageNum +
              "</td></tr>";
          }

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
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Division:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              divName +
              "</td></tr>" +
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Requirement:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              reqType +
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
              optionalRows +
              "</table>" +
              "<p style='font-size:11px;color:#6b7280;margin:0 0 4px;'>📌 Please archive or label this email as part of your RSU requirements record.</p>" +
              hashSection +
              "</div>",
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

  var favicon = "https://img2.pic.in.th/image2aa7d890b471f6fa.th.png";
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
      .setTitle("Admin Console — DentRSU Tracker")
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
      .setTitle("Treatment Plan — DentRSU Tracker")
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
      .setTitle("Requirement Vault — DentRSU Tracker")
      .setFaviconUrl(favicon)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  if (page === "student") {
    var t = HtmlService.createTemplateFromFile("student");
    t.appUrl = url;
    t.appDevUrl = devUrl;
    return t
      .evaluate()
      .setTitle("Student Portal — DentRSU Tracker")
      .setFaviconUrl(favicon)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  if (page === "instructor") {
    var t = HtmlService.createTemplateFromFile("instructor");
    t.appUrl = url;
    t.appDevUrl = devUrl;
    return t
      .evaluate()
      .setTitle("Instructor Portal — DentRSU Tracker")
      .setFaviconUrl(favicon)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  if (page === "advisor") {
    var t = HtmlService.createTemplateFromFile("advisor");
    t.appUrl = url;
    t.appDevUrl = devUrl;
    return t
      .evaluate()
      .setTitle("Advisor Portal — DentRSU Tracker")
      .setFaviconUrl(favicon)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  if (page === "verification_queue") {
    var t = HtmlService.createTemplateFromFile("verification_queue");
    t.appUrl = url;
    t.appDevUrl = devUrl;
    return t
      .evaluate()
      .setTitle("Verification Queue — DentRSU Tracker")
      .setFaviconUrl(favicon)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  if (page === "dashboard") {
    var t = HtmlService.createTemplateFromFile("dashboard");
    t.appUrl = url;
    t.appDevUrl = devUrl;
    return t
      .evaluate()
      .setTitle("Division Dashboard — DentRSU Tracker")
      .setFaviconUrl(favicon)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  var t = HtmlService.createTemplateFromFile("landing");
  t.appUrl = url;
  t.appDevUrl = devUrl;
  return t
    .evaluate()
    .setTitle("DentRSU Tracker")
    .setFaviconUrl(favicon)
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
  /**
   * Operative (OPER) — cross-requirement overflow / substitution rules.
   *
   * Prerequisite aggregation_config on requirement_list rows:
   *   Class I–VI, PRR  → { "type": "count" }
   *   Class IV         → { "type": "sum_union", "also_sum": ["<DIASTEMA_CLOSURE_REQ_ID>"] }
   *   Diastema Closure → null  (minimum_rsu=0, minimum_cda=0; absorbed by Class IV above)
   *   Recall (any)     → { "type": "count_met", "source_ids": ["<I>","<II>","<III>","<IV>","<V>","<VI>"] }
   *                      is_selectable=false
   *
   * This processor runs AFTER both passes. Recall has already been computed in pass-2
   * using raw counts — do NOT overwrite it here.
   *
   * All overflow rules use TRANSFER semantics: the source requirement's count
   * decreases by the amount given, so records are never double-counted.
   *
   * RSU rules (in order):
   *   1. Class II excess → Class I  (transfer: Class II count decreases)
   *   2. Class IV excess → Class III (transfer: Class IV count decreases)
   *   3. If Class I still short → PRR bonus, max 1 (transfer: PRR count decreases)
   *
   * CDA rules:
   *   4. Class II excess → Class I CDA first (fill deficit), remainder → Class III or IV CDA
   *      (transfer: Class II CDA decreases by total given away)
   */
  OPER: function (divReqs, divRecords, progressMap) {
    // Build lookup maps keyed by requirement_type and cda_requirement_type (case-insensitive)
    var byType = {};
    var byCdaType = {};
    divReqs.forEach(function (req) {
      if (req.requirement_type) {
        byType[req.requirement_type.toLowerCase().trim()] = req;
      }
      if (req.cda_requirement_type) {
        byCdaType[req.cda_requirement_type.toLowerCase().trim()] = req;
      }
    });

    function getByType(label) {
      return byType[label.toLowerCase().trim()] || null;
    }
    // For CDA lookups: prefer cda_requirement_type match, fall back to requirement_type
    function getForCda(label) {
      var key = label.toLowerCase().trim();
      return byCdaType[key] || byType[key] || null;
    }
    function prog(req) {
      if (!req) return { rsu: 0, cda: 0, p_rsu: 0, p_cda: 0 };
      return (
        progressMap[req.requirement_id] || {
          rsu: 0,
          cda: 0,
          p_rsu: 0,
          p_cda: 0,
        }
      );
    }

    // ── Record-level transfer helpers ─────────────────────────────────────
    // Build a detail record shape matching recordsDetailMap entries, with
    // an extra `transferred_from` label identifying the source requirement.
    function buildDetailRec(rec, fromLabel) {
      return {
        record_id: rec.record_id,
        hn: rec.hn || (rec.patient && rec.patient.hn) || "-",
        patient_name:
          rec.patient_name || (rec.patient && rec.patient.name) || "-",
        area: rec.area || "-",
        rsu_units: parseFloat(rec.rsu_units) || 0,
        cda_units: parseFloat(rec.cda_units) || 0,
        status: rec.status,
        is_exam: rec.is_exam === true,
        transferred_from: fromLabel,
      };
    }
    // Ensure transfer arrays exist on a progressMap entry.
    function ensureTransfer(reqId) {
      var p = progressMap[reqId];
      if (!p.transferred_in_rsu) p.transferred_in_rsu = [];
      if (!p.transferred_in_cda) p.transferred_in_cda = [];
      if (!p.transferred_out_ids_rsu) p.transferred_out_ids_rsu = [];
      if (!p.transferred_out_ids_cda) p.transferred_out_ids_cda = [];
    }
    // Return verified divRecords whose requirement_id is in reqIds[].
    function verifiedFor(reqIds) {
      return divRecords.filter(function (r) {
        return (
          reqIds.indexOf(r.requirement_id) !== -1 && r.status === "verified"
        );
      });
    }

    var r1 = getByType("class i");
    var r2 = getByType("class ii");
    var r3 = getByType("class iii");
    var r4 = getByType("class iv");
    var rPrr = getByType("prr");
    // CDA: "Class III or IV" may be the cda_requirement_type on the Class III row, or its own row
    var r3or4Cda = getForCda("class iii or iv") || r3;

    // ── Helper: greedy transfer selection ──────────────────────────────────
    // Given an array of verified records, a unit field ('rsu_units' or 'cda_units'),
    // and a minimum the source must keep, return the records that can be
    // transferred.  Sorts ascending by unit value so that the smallest-value
    // records leave first (maximises transfer count).
    function greedyTransfer(records, unitField, minKeep) {
      var total = 0;
      records.forEach(function (r) {
        total += parseFloat(r[unitField]) || 0;
      });
      if (total <= minKeep) return [];
      var sorted = records.slice().sort(function (a, b) {
        return (
          (parseFloat(a[unitField]) || 0) - (parseFloat(b[unitField]) || 0)
        );
      });
      var remaining = total;
      var out = [];
      for (var i = 0; i < sorted.length; i++) {
        var u = parseFloat(sorted[i][unitField]) || 0;
        if (remaining - u >= minKeep) {
          out.push(sorted[i]);
          remaining -= u;
        }
      }
      return out;
    }

    // ── RSU Rule 1: Class II excess → Class I (transfer) ──────────────────
    // Source progress = SUM(rsu_units). Each transferred record = 1 at target.
    if (r2 && r1) {
      var c2MinRsu = parseFloat(r2.minimum_rsu) || 0;
      var c2VerRecs = verifiedFor([r2.requirement_id]);
      var toR1 = greedyTransfer(c2VerRecs, "rsu_units", c2MinRsu);
      if (toR1.length > 0) {
        // Target gains 1 per record
        progressMap[r1.requirement_id].rsu += toR1.length;
        // Source keeps remaining sum (override pass-1 value)
        var c2Removed = 0;
        toR1.forEach(function (r) {
          c2Removed += parseFloat(r.rsu_units) || 0;
        });
        progressMap[r2.requirement_id].rsu -= c2Removed;
        // Record tracking
        ensureTransfer(r1.requirement_id);
        ensureTransfer(r2.requirement_id);
        toR1.forEach(function (rec) {
          progressMap[r1.requirement_id].transferred_in_rsu.push(
            buildDetailRec(rec, r2.requirement_type),
          );
          progressMap[r2.requirement_id].transferred_out_ids_rsu.push({
            record_id: rec.record_id,
            to_label: r1.requirement_type,
          });
        });
      }
    }

    // ── RSU Rule 2: Class IV excess → Class III (transfer) ────────────────
    // Class IV effective pool includes Diastema Closure (via sum_union).
    if (r4 && r3) {
      var c4MinRsu = parseFloat(r4.minimum_rsu) || 0;
      // Safe parse aggregation_config (may be string or object from Supabase)
      var r4AggCfg =
        typeof r4.aggregation_config === "string"
          ? (function () {
              try {
                return JSON.parse(r4.aggregation_config);
              } catch (e) {
                return {};
              }
            })()
          : r4.aggregation_config || {};
      var r4AllIds = [r4.requirement_id].concat(r4AggCfg.also_sum || []);
      var c4VerRecs = verifiedFor(r4AllIds);
      var toR3 = greedyTransfer(c4VerRecs, "rsu_units", c4MinRsu);
      if (toR3.length > 0) {
        progressMap[r3.requirement_id].rsu += toR3.length;
        var c4Removed = 0;
        toR3.forEach(function (r) {
          c4Removed += parseFloat(r.rsu_units) || 0;
        });
        progressMap[r4.requirement_id].rsu -= c4Removed;
        ensureTransfer(r3.requirement_id);
        ensureTransfer(r4.requirement_id);
        toR3.forEach(function (rec) {
          var fromLabel =
            rec.requirement_id === r4.requirement_id
              ? r4.requirement_type
              : "Diastema Closure";
          progressMap[r3.requirement_id].transferred_in_rsu.push(
            buildDetailRec(rec, fromLabel),
          );
          if (rec.requirement_id === r4.requirement_id) {
            progressMap[r4.requirement_id].transferred_out_ids_rsu.push({
              record_id: rec.record_id,
              to_label: r3.requirement_type,
            });
          }
        });
      }
    }

    // ── RSU Rule 3: PRR bonus to Class I, max 1 (transfer) ────────────────
    if (r1 && rPrr) {
      var c1MinRsu = parseFloat(r1.minimum_rsu) || 0;
      var c1RsuNow = progressMap[r1.requirement_id].rsu;
      if (c1RsuNow < c1MinRsu) {
        var prrVerRecs = verifiedFor([rPrr.requirement_id]);
        if (prrVerRecs.length > 0) {
          // Transfer exactly 1 PRR record (the last one)
          var prrRec = prrVerRecs[prrVerRecs.length - 1];
          progressMap[r1.requirement_id].rsu += 1;
          progressMap[rPrr.requirement_id].rsu -=
            parseFloat(prrRec.rsu_units) || 0;
          ensureTransfer(r1.requirement_id);
          ensureTransfer(rPrr.requirement_id);
          progressMap[r1.requirement_id].transferred_in_rsu.push(
            buildDetailRec(prrRec, rPrr.requirement_type),
          );
          progressMap[rPrr.requirement_id].transferred_out_ids_rsu.push({
            record_id: prrRec.record_id,
            to_label: r1.requirement_type,
          });
        }
      }
    }

    // ── CDA Rule 4: Class II excess → Class I (priority), remainder → Class III/IV ──
    // Same principle: SUM(cda_units) for source, 1 per record at target.
    if (r2) {
      var c2MinCda = parseFloat(r2.minimum_cda) || 0;
      var c2CdaVerRecs = verifiedFor([r2.requirement_id]);
      var toCda = greedyTransfer(c2CdaVerRecs, "cda_units", c2MinCda);
      if (toCda.length > 0) {
        // Determine how many go to Class I (fill deficit) vs Class III/IV (remainder)
        var cdaGoToI = 0;
        if (r1) {
          var c1MinCda = parseFloat(r1.minimum_cda) || 0;
          var c1CdaNow = progressMap[r1.requirement_id].cda;
          var c1Deficit = Math.max(0, c1MinCda - c1CdaNow);
          cdaGoToI = Math.min(toCda.length, c1Deficit);
        }
        var cdaGoToIII = toCda.length - cdaGoToI;

        // Update target progress (1 per record)
        if (cdaGoToI > 0 && r1) {
          progressMap[r1.requirement_id].cda += cdaGoToI;
        }
        if (cdaGoToIII > 0 && r3or4Cda) {
          progressMap[r3or4Cda.requirement_id].cda += cdaGoToIII;
        }

        // Source loses actual cda_units sum
        var c2CdaRemoved = 0;
        toCda.forEach(function (r) {
          c2CdaRemoved += parseFloat(r.cda_units) || 0;
        });
        progressMap[r2.requirement_id].cda -= c2CdaRemoved;

        // Record tracking
        ensureTransfer(r2.requirement_id);
        toCda.forEach(function (rec, idx) {
          var destLabel =
            idx < cdaGoToI
              ? r1
                ? r1.requirement_type
                : "Class I"
              : r3or4Cda
                ? r3or4Cda.cda_requirement_type || r3or4Cda.requirement_type
                : "Class III or IV";
          progressMap[r2.requirement_id].transferred_out_ids_cda.push({
            record_id: rec.record_id,
            to_label: destLabel,
          });
        });
        if (cdaGoToI > 0 && r1) {
          ensureTransfer(r1.requirement_id);
          toCda.slice(0, cdaGoToI).forEach(function (rec) {
            progressMap[r1.requirement_id].transferred_in_cda.push(
              buildDetailRec(rec, r2.requirement_type),
            );
          });
        }
        if (cdaGoToIII > 0 && r3or4Cda) {
          ensureTransfer(r3or4Cda.requirement_id);
          toCda.slice(cdaGoToI).forEach(function (rec) {
            progressMap[r3or4Cda.requirement_id].transferred_in_cda.push(
              buildDetailRec(rec, r2.requirement_type),
            );
          });
        }
      }
    }
  },

  /**
   * Periodontics (PERIO) — vault aggregation for derived RSU/CDA requirements.
   *
   * Source requirements (students link records to these):
   *   Case G — 418523ff-0fa6-430c-b9d1-1693ef74fa44
   *   Case P — 1ee6edcc-aba0-4b5a-876d-af81fc5c978c
   *
   * Derived requirements handled here (is_selectable=false):
   *   RSU: "Total Cases"          aggregation_config type = "perio_total_cases"
   *        "Total Severity Case P" aggregation_config type = "perio_severity_casep"
   *        "Complexities"          aggregation handled by sum_union pass-1;
   *                                this processor only populates rsu_records.
   *   CDA: "CDA Cases"            aggregation handled by count_union pass-1;
   *                                this processor only populates cda_records.
   *
   * Qualifying records = Case G or Case P with rsu_units > 0.
   *   calculatePerioUnits() in treatment_plan.html sets rsu_units = 0 when
   *   step_order < 7, so rsu_units > 0 is a reliable proxy for step >= 7.
   *
   * Severity is reverse-computed: severity = rsu_units × 0.5  (Case P formula:
   *   rsu_units = severity / 0.5, so severity = rsu_units × 0.5).
   */
  PERIO: function (divReqs, divRecords, progressMap) {
    var CASE_G_ID = "418523ff-0fa6-430c-b9d1-1693ef74fa44";
    var CASE_P_ID = "1ee6edcc-aba0-4b5a-876d-af81fc5c978c";
    var ONLY_RECALL_ID = "854f959d-6919-4e82-b093-91aa0a729415";

    // Build requirement lookups by type label (lowercase)
    var byType = {};
    var byCdaType = {};
    divReqs.forEach(function (req) {
      if (req.requirement_type)
        byType[req.requirement_type.toLowerCase().trim()] = req;
      if (req.cda_requirement_type)
        byCdaType[req.cda_requirement_type.toLowerCase().trim()] = req;
    });
    function getByType(label) {
      return byType[label.toLowerCase().trim()] || null;
    }
    function getByCdaType(label) {
      return byCdaType[label.toLowerCase().trim()] || null;
    }

    // Build a plain detail record for the expanded panel (no transfer badge).
    function mkRec(r, extra) {
      var base = {
        record_id: r.record_id,
        hn: r.hn || (r.patient && r.patient.hn) || "-",
        patient_name: r.patient_name || (r.patient && r.patient.name) || "-",
        area: r.area || "-",
        rsu_units: parseFloat(r.rsu_units) || 0,
        cda_units: parseFloat(r.cda_units) || 0,
        status: r.status,
        is_exam: false,
      };
      if (extra) {
        for (var k in extra) {
          if (extra.hasOwnProperty(k)) base[k] = extra[k];
        }
      }
      return base;
    }

    // Separate raw Case G, Case P, and Only Recall or Miscellaneous records
    var caseGRecs = divRecords.filter(function (r) {
      return r.requirement_id === CASE_G_ID;
    });
    var casePRecs = divRecords.filter(function (r) {
      return r.requirement_id === CASE_P_ID;
    });
    var onlyRecallRecs = divRecords.filter(function (r) {
      return r.requirement_id === ONLY_RECALL_ID;
    });

    // Qualifying records: rsu_units > 0 (proxy for step order >= 7)
    var qualG = caseGRecs.filter(function (r) {
      return (parseFloat(r.rsu_units) || 0) > 0;
    });
    var qualP = casePRecs.filter(function (r) {
      return (parseFloat(r.rsu_units) || 0) > 0;
    });

    function countVerPen(recs) {
      var v = 0,
        p = 0;
      recs.forEach(function (r) {
        if (r.status === "verified") v++;
        else p++;
      });
      return { verified: v, pending: p };
    }

    // ── Total Cases ───────────────────────────────────────────────────────────
    var tcReq = getByType("total cases");
    if (tcReq) {
      var tcId = tcReq.requirement_id;
      var gStats = countVerPen(qualG);
      var pStats = countVerPen(qualP);
      var vAll = gStats.verified + pStats.verified;
      var penAll = gStats.pending + pStats.pending;
      progressMap[tcId].rsu = vAll;
      progressMap[tcId].p_rsu = penAll;
      progressMap[tcId].cda = 0;
      progressMap[tcId].p_cda = 0;
      progressMap[tcId].sub_counts = { case_g: gStats, case_p: pStats };
      progressMap[tcId].sub_counts_labels = {
        case_g: "Case G",
        case_p: "Case P",
      };
      // Populate rsu_records for expanded panel
      progressMap[tcId].transferred_in_rsu = qualG
        .concat(qualP)
        .map(function (r) {
          return mkRec(r);
        });
    }

    // ── Total Severity Case P ─────────────────────────────────────────────────
    // severity = rsu_units × 0.5  (Case P: rsu = sev / 0.5 → sev = rsu × 0.5)
    var sevReq = getByType("total severity case p");
    if (sevReq) {
      var sevId = sevReq.requirement_id;
      var vSev = 0,
        pSev = 0;
      qualP.forEach(function (r) {
        var sev = Math.round(parseFloat(r.rsu_units) * 0.5 * 100) / 100;
        if (r.status === "verified") vSev += sev;
        else pSev += sev;
      });
      progressMap[sevId].rsu = Math.round(vSev * 100) / 100;
      progressMap[sevId].p_rsu = Math.round(pSev * 100) / 100;
      progressMap[sevId].cda = 0;
      progressMap[sevId].p_cda = 0;
      // Signal vault HTML to label and render this column as "Severity"
      progressMap[sevId].display_field = "severity";
      // Each record carries display_value = severity (not rsu_units)
      progressMap[sevId].transferred_in_rsu = qualP.map(function (r) {
        var sev = Math.round(parseFloat(r.rsu_units) * 0.5 * 100) / 100;
        return mkRec(r, { display_value: sev });
      });
    }

    // ── Complexities: populate rsu_records for expanded panel ─────────────────
    // The sum_union aggregation already ran in pass 1 and set the total correctly.
    // This processor only adds the qualifying records so the expanded panel shows them.
    var cxReq = getByType("complexities");
    if (cxReq) {
      var cxId = cxReq.requirement_id;
      progressMap[cxId].transferred_in_rsu = qualG
        .concat(qualP)
        .map(function (r) {
          return mkRec(r);
        });
    }

    // ── CDA Cases: populate cda_records for expanded panel ────────────────────
    // The count_union aggregation already ran in pass 1.
    // This processor adds all Case G + Case P records to the panel.
    var cdaCasesReq = getByCdaType("cda cases");
    if (cdaCasesReq) {
      var cdaId = cdaCasesReq.requirement_id;
      progressMap[cdaId].transferred_in_cda = caseGRecs
        .concat(casePRecs)
        .concat(onlyRecallRecs)
        .map(function (r) {
          return mkRec(r);
        });
    }

    // ── Exam Flags ────────────────────────────────────────────────────────────
    // For each perio_exam_flag requirement, count Case G+P records where
    // perio_exams[flagKey] === true; populate rsu/cda and rsu_records/cda_records.
    var allCasesForExam = caseGRecs.concat(casePRecs);
    divReqs.forEach(function (req) {
      var cfg = _parseAggConfig(req.aggregation_config);
      if (!cfg || cfg.type !== "perio_exam_flag") return;
      var flagKey = cfg.flag_key;
      if (!flagKey) return;
      var reqId = req.requirement_id;
      var v = 0,
        p = 0;
      var recList = [];
      allCasesForExam.forEach(function (r) {
        var exams = r.perio_exams || {};
        if (exams[flagKey] !== true) return;
        if (r.status === "verified") v++;
        else p++;
        recList.push(mkRec(r));
      });
      progressMap[reqId].rsu = req.minimum_rsu > 0 ? v : 0;
      progressMap[reqId].p_rsu = req.minimum_rsu > 0 ? p : 0;
      progressMap[reqId].cda = req.minimum_cda > 0 ? v : 0;
      progressMap[reqId].p_cda = req.minimum_cda > 0 ? p : 0;
      if (req.minimum_rsu > 0) progressMap[reqId].transferred_in_rsu = recList;
      if (req.minimum_cda > 0) progressMap[reqId].transferred_in_cda = recList;
    });
  },

  /**
   * Prosthodontics (PROSTH) — sub-count breakdown for derived requirements.
   *
   * Handles any requirement whose RSU/CDA is derived from two source requirements.
   * Pass-2 "derived" already fills progressMap[parentId].rsu / .cda.
   * This processor adds sub_counts + record lists for the expanded vault panel.
   *
   * Derived pairs (see migrations):
   *   RPD  ← MRPD  + ARPD
   *   CD   ← CD (Upper) + CD (Lower)
   */
  PROSTH: function (divReqs, divRecords, progressMap) {
    // Stable requirement UUIDs — CD pair confirmed 2026-03-01
    var CD_ID       = "4c282f32-2d62-4285-b3c7-76a0225b9639";
    var CD_UPPER_ID = "d8e91cd3-6fb2-42e0-8843-53836d5cc44d";
    var CD_LOWER_ID = "9b3872fd-b738-4f19-841e-7575b853f185";

    function getById(id) {
      return divReqs.find(function (r) { return r.requirement_id === id; }) || null;
    }

    function getByType(t) {
      var lower = t.toLowerCase();
      return (
        divReqs.find(function (r) {
          return r.requirement_type.toLowerCase() === lower;
        }) || null
      );
    }

    function countVerPen(recs) {
      var v = 0,
        p = 0;
      recs.forEach(function (r) {
        if (r.status === "verified") v++;
        else p++;
      });
      return { verified: v, pending: p };
    }

    function mkRec(r) {
      return {
        record_id: r.record_id,
        hn: r.hn || (r.patient ? r.patient.hn : ""),
        patient_name: r.patient_name || (r.patient ? r.patient.name : ""),
        area: r.area || "",
        rsu_units: r.rsu_units,
        cda_units: r.cda_units,
        status: r.status,
      };
    }

    // Generic helper: inject sub_counts + record lists into a derived parent requirement.
    // sources = [{ key, label, req }, ...]
    function applySubcounts(parentReq, sources) {
      if (!parentReq) return;
      var subCounts = {};
      var subLabels = {};
      var allRecs = [];
      sources.forEach(function (s) {
        if (!s.req) return;
        var recs = divRecords.filter(function (r) {
          return r.requirement_id === s.req.requirement_id;
        });
        subCounts[s.key] = countVerPen(recs);
        subLabels[s.key] = s.label;
        allRecs = allRecs.concat(recs.map(mkRec));
      });
      progressMap[parentReq.requirement_id].sub_counts = subCounts;
      progressMap[parentReq.requirement_id].sub_counts_labels = subLabels;
      progressMap[parentReq.requirement_id].transferred_in_rsu = allRecs;
      if (parentReq.minimum_cda > 0) {
        progressMap[parentReq.requirement_id].transferred_in_cda = allRecs;
      }
    }

    // ── RPD ← MRPD + ARPD ────────────────────────────────────────────────
    applySubcounts(getByType("rpd"), [
      { key: "mrpd", label: "MRPD", req: getByType("mrpd") },
      { key: "arpd", label: "ARPD", req: getByType("arpd") },
    ]);

    // ── CD ← CD (Upper) + CD (Lower) — look up by UUID for reliability ───
    applySubcounts(getById(CD_ID), [
      { key: "cd_upper", label: "CD (Upper)", req: getById(CD_UPPER_ID) },
      { key: "cd_lower", label: "CD (Lower)", req: getById(CD_LOWER_ID) },
    ]);
  },
};

/**
 * Apply aggregation for one requirement based on its aggregation_config.
 * Called twice per division: pass 1 (isPass2=false) and pass 2 (isPass2=true).
 *
 * aggregation_config types:
 *   null / "sum"         — sum rsu_units / cda_units from records linked to this req (default)
 *   "count"              — count records linked directly to this req (not sum units)
 *   "count_union"        — count records linked to this req + also_count req IDs (pass 1)
 *                          { "also_count": ["<req_id>", ...] }
 *   "sum_union"          — sum rsu_units/cda_units from this req + also_sum req IDs (pass 1)
 *                          { "also_sum": ["<req_id>", ...] }
 *   "count_exam"         — count is_exam=true records in this division (pass 1)
 *                          optional: { "source_ids": [...] } to scope to specific reqs
 *   "derived"            — sum progressMap values from source_ids (pass 2)
 *                          { "source_ids": [...], "operation": "sum_both|sum_rsu|sum_cda" }
 *   "count_met"          — count sources whose pass-1 progress >= their minimum (pass 2)
 *                          { "source_ids": [...] }
 *                          requires divReqs (5th param) to look up each source's minimum
 *
 * @param {Object}  req          — requirement_list row
 * @param {Array}   divRecords   — all verified/completed records in this division for this student
 * @param {Object}  progressMap  — { [req_id]: { rsu, cda, p_rsu, p_cda } }
 * @param {boolean} isPass2      — true = only process pass-2 types; false = skip pass-2 types
 * @param {Array}   [divReqs]    — optional; all requirement rows for this division (needed for count_met)
 */
function _applyRequirementAggregation(
  req,
  divRecords,
  progressMap,
  isPass2,
  divReqs,
) {
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

  // Pass-2 types: derived, count_met
  var isPass2Type = type === "derived" || type === "count_met";
  if (isPass2 && !isPass2Type) return; // pass 2: skip pass-1 types
  if (!isPass2 && isPass2Type) return; // pass 1: skip pass-2 types

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
      } else if (
        rec.status === "completed" ||
        rec.status === "pending verification" ||
        rec.status === "rejected"
      ) {
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
      } else if (
        rec.status === "completed" ||
        rec.status === "pending verification" ||
        rec.status === "rejected"
      ) {
        progressMap[reqId].p_rsu += 1;
        progressMap[reqId].p_cda += 1;
      }
    });
  } else if (type === "count_union") {
    // Count records linked to this req + also_count requirement IDs
    var alsoCount = config.also_count || [];
    var unionIds = [reqId].concat(alsoCount);
    divRecords.forEach(function (rec) {
      if (unionIds.indexOf(rec.requirement_id) === -1) return;
      if (rec.status === "verified") {
        progressMap[reqId].rsu += 1;
        progressMap[reqId].cda += 1;
      } else if (
        rec.status === "completed" ||
        rec.status === "pending verification" ||
        rec.status === "rejected"
      ) {
        progressMap[reqId].p_rsu += 1;
        progressMap[reqId].p_cda += 1;
      }
    });
  } else if (type === "sum_union") {
    // Sum rsu_units/cda_units from records linked to this req + also_sum requirement IDs
    var alsoSum = config.also_sum || [];
    var unionIds = [reqId].concat(alsoSum);
    divRecords.forEach(function (rec) {
      if (unionIds.indexOf(rec.requirement_id) === -1) return;
      var rsu = parseFloat(rec.rsu_units) || 0;
      var cda = parseFloat(rec.cda_units) || 0;
      if (rec.status === "verified") {
        progressMap[reqId].rsu += rsu;
        progressMap[reqId].cda += cda;
      } else if (
        rec.status === "completed" ||
        rec.status === "pending verification" ||
        rec.status === "rejected"
      ) {
        progressMap[reqId].p_rsu += rsu;
        progressMap[reqId].p_cda += cda;
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
      } else if (
        rec.status === "completed" ||
        rec.status === "pending verification" ||
        rec.status === "rejected"
      ) {
        progressMap[reqId].p_rsu += 1;
        progressMap[reqId].p_cda += 1;
      }
    });
  } else if (type === "derived") {
    // Compute value from other requirements (must be processed in pass 1 first)
    var sourceIds = config.source_ids || [];
    var op = config.operation || "sum_both"; // sum_both | sum_rsu | sum_cda | count_both
    if (op === "count_both") {
      // Count raw records from divRecords matching any source_id (ignores unit values)
      var sourceSet = {};
      sourceIds.forEach(function (sid) { sourceSet[sid] = true; });
      var vCount = 0, pCount = 0;
      divRecords.forEach(function (rec) {
        if (!sourceSet[rec.requirement_id]) return;
        if (rec.status === "verified") {
          vCount += 1;
        } else if (
          rec.status === "completed" ||
          rec.status === "pending verification" ||
          rec.status === "rejected"
        ) {
          pCount += 1;
        }
      });
      progressMap[reqId] = { rsu: vCount, cda: vCount, p_rsu: pCount, p_cda: pCount };
    } else {
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
  } else if (type === "count_met") {
    // Count how many source requirements have pass-1 verified progress >= their minimum.
    // Each qualifying source contributes 1. Requires divReqs for minimum lookups.
    var sourceIds = config.source_ids || [];
    var reqMinMap = {};
    if (divReqs) {
      divReqs.forEach(function (r) {
        reqMinMap[r.requirement_id] = {
          min_rsu: parseFloat(r.minimum_rsu) || 0,
          min_cda: parseFloat(r.minimum_cda) || 0,
        };
      });
    }
    var metRsu = 0,
      metCda = 0;
    sourceIds.forEach(function (sid) {
      var p = progressMap[sid] || { rsu: 0, cda: 0 };
      var mins = reqMinMap[sid] || { min_rsu: 0, min_cda: 0 };
      if (mins.min_rsu > 0 && p.rsu >= mins.min_rsu) metRsu += 1;
      if (mins.min_cda > 0 && p.cda >= mins.min_cda) metCda += 1;
    });
    progressMap[reqId].rsu = metRsu;
    progressMap[reqId].cda = metCda;
    // p_rsu / p_cda intentionally left 0: Recall is a verified-only metric
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
  } else if (!finalStudentId || finalStudentId === "-") {
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
      record_id: rec.record_id,
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

    // Pass 1: sum / count / count_union / count_exam (non-pass-2 types)
    divReqs.forEach(function (req) {
      _applyRequirementAggregation(
        req,
        divRecords,
        progressMap,
        false,
        divReqs,
      );
    });

    // Pass 2: derived / count_met (reads from pass-1 progressMap; needs divReqs for minimums)
    divReqs.forEach(function (req) {
      _applyRequirementAggregation(req, divRecords, progressMap, true, divReqs);
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

    // Detail records: separate rsu_records / cda_records to reflect transfer semantics.
    // Transferred records are added to the target and excluded from the source.
    var rsuRecords, cdaRecords;
    if (isExam) {
      var examRecs = (recordsByDiv[divName] || [])
        .filter(function (r) {
          return r.is_exam === true;
        })
        .map(function (r) {
          return {
            record_id: r.record_id,
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
      rsuRecords = examRecs;
      cdaRecords = examRecs;
    } else {
      // Check if this is a derived requirement → collect records from source requirements
      var _derivedCfg = null;
      try {
        _derivedCfg =
          typeof req.aggregation_config === "string"
            ? JSON.parse(req.aggregation_config)
            : req.aggregation_config || null;
      } catch (e) {}

      if (
        _derivedCfg &&
        _derivedCfg.type === "derived" &&
        _derivedCfg.source_ids &&
        _derivedCfg.source_ids.length > 0
      ) {
        // Build a name map: requirement_id → requirement_type label
        var _srcNameMap = {};
        (divisionMeta[divName] ? divisionMeta[divName].reqs : []).forEach(
          function (r) {
            _srcNameMap[r.requirement_id] = r.requirement_type;
          },
        );
        // Collect records from each source and stamp with transferred_from
        var derivedRsuRecs = [];
        var derivedCdaRecs = [];
        _derivedCfg.source_ids.forEach(function (sid) {
          var srcLabel = _srcNameMap[sid] || "Other";
          var srcRecs = recordsDetailMap[sid] || [];
          srcRecs.forEach(function (r) {
            var copy = {};
            for (var k in r) {
              if (r.hasOwnProperty(k)) copy[k] = r[k];
            }
            copy.transferred_from = srcLabel;
            derivedRsuRecs.push(copy);
            derivedCdaRecs.push(copy);
          });
        });
        rsuRecords = derivedRsuRecs;
        cdaRecords = derivedCdaRecs;
      } else if (
        _derivedCfg &&
        _derivedCfg.type === "count_exam" &&
        _derivedCfg.source_ids &&
        _derivedCfg.source_ids.length > 0
      ) {
        // count_exam + source_ids: collect is_exam=true records from the source requirements
        var examSourceRecs = [];
        _derivedCfg.source_ids.forEach(function (sid) {
          var srcRecs = recordsDetailMap[sid] || [];
          srcRecs.forEach(function (r) {
            if (r.is_exam) examSourceRecs.push(r);
          });
        });
        rsuRecords = examSourceRecs;
        cdaRecords = examSourceRecs;
      } else {
        var ownRecs = recordsDetailMap[req.requirement_id] || [];
        var outIdsRsu = prog.transferred_out_ids_rsu || []; // [{ record_id, to_label }]
        var outIdsCda = prog.transferred_out_ids_cda || []; // [{ record_id, to_label }]
        // Keep transferred-out records but stamp them with transferred_to label
        var markedRsu = ownRecs.map(function (r) {
          for (var oi = 0; oi < outIdsRsu.length; oi++) {
            if (outIdsRsu[oi].record_id === r.record_id) {
              var copy = {};
              for (var k in r) {
                if (r.hasOwnProperty(k)) copy[k] = r[k];
              }
              copy.transferred_to = outIdsRsu[oi].to_label;
              return copy;
            }
          }
          return r;
        });
        var markedCda = ownRecs.map(function (r) {
          for (var oi = 0; oi < outIdsCda.length; oi++) {
            if (outIdsCda[oi].record_id === r.record_id) {
              var copy = {};
              for (var k in r) {
                if (r.hasOwnProperty(k)) copy[k] = r[k];
              }
              copy.transferred_to = outIdsCda[oi].to_label;
              return copy;
            }
          }
          return r;
        });
        rsuRecords = markedRsu.concat(prog.transferred_in_rsu || []);
        cdaRecords = markedCda.concat(prog.transferred_in_cda || []);
      }
    }

    // Compute human-readable calculation method label from aggregation_config
    var aggCfgRaw = req.aggregation_config;
    var aggCfgParsed = null;
    try {
      aggCfgParsed =
        typeof aggCfgRaw === "string"
          ? JSON.parse(aggCfgRaw)
          : aggCfgRaw || null;
    } catch (e) {}
    var calcMethod = "Sum";
    if (isExam || (aggCfgParsed && aggCfgParsed.type === "count_exam")) {
      calcMethod = "Exam";
    } else if (
      aggCfgParsed &&
      (aggCfgParsed.type === "count" ||
        aggCfgParsed.type === "count_union" ||
        aggCfgParsed.type === "perio_total_cases" ||
        aggCfgParsed.type === "perio_exam_flag")
    ) {
      calcMethod = "Count";
    } else if (
      aggCfgParsed &&
      aggCfgParsed.type === "derived" &&
      aggCfgParsed.operation === "count_both"
    ) {
      calcMethod = "Count";
    } else if (aggCfgParsed && aggCfgParsed.type === "derived") {
      calcMethod = "Derived";
    } else if (aggCfgParsed && aggCfgParsed.type === "count_met") {
      calcMethod = "Met";
    }

    // Compute per-requirement calc hints showing exact numbers (for non-trivial aggregations)
    var rsuCalcHint = null;
    var cdaCalcHint = null;
    var _divProgMap = progressMaps[divName] || {};
    var _divReqsList =
      (divisionMeta[divName] && divisionMeta[divName].reqs) || [];
    var _divRecordsList = recordsByDiv[divName] || [];

    if (
      calcMethod === "Count" &&
      aggCfgParsed &&
      aggCfgParsed.type === "derived" &&
      aggCfgParsed.operation === "count_both" &&
      aggCfgParsed.source_ids
    ) {
      // Hint: per-source record counts
      var _srcIds = aggCfgParsed.source_ids;
      var _nameMap = {};
      _divReqsList.forEach(function (r) {
        _nameMap[r.requirement_id] = r.requirement_type;
      });
      var _sourceSet = {};
      _srcIds.forEach(function (sid) { _sourceSet[sid] = true; });
      var _srcCountMap = {};
      _srcIds.forEach(function (sid) { _srcCountMap[sid] = 0; });
      _divRecordsList.forEach(function (rec) {
        if (_sourceSet[rec.requirement_id] && rec.status === "verified") {
          _srcCountMap[rec.requirement_id] = (_srcCountMap[rec.requirement_id] || 0) + 1;
        }
      });
      var _parts = [], _total = 0;
      _srcIds.forEach(function (sid) {
        var cnt = _srcCountMap[sid] || 0;
        _parts.push((_nameMap[sid] || "Unknown") + " (" + cnt + ")");
        _total += cnt;
      });
      if (_parts.length > 0) {
        rsuCalcHint = _parts.join(" + ") + " = " + _total;
        cdaCalcHint = rsuCalcHint;
      }
    } else if (calcMethod === "Derived" && aggCfgParsed && aggCfgParsed.source_ids) {
      var _srcIds = aggCfgParsed.source_ids;
      var _op = aggCfgParsed.operation || "sum_both";
      var _nameMap = {};
      _divReqsList.forEach(function (r) {
        _nameMap[r.requirement_id] = r.requirement_type;
      });
      var _rParts = [],
        _cParts = [],
        _rTotal = 0,
        _cTotal = 0;
      _srcIds.forEach(function (sid) {
        var sp = _divProgMap[sid] || { rsu: 0, cda: 0 };
        var nm = _nameMap[sid] || "Unknown";
        var rv = Math.round((_op === "sum_cda" ? sp.cda : sp.rsu) * 100) / 100;
        var cv = Math.round((_op === "sum_rsu" ? sp.rsu : sp.cda) * 100) / 100;
        _rParts.push(nm + " (" + rv + ")");
        _cParts.push(nm + " (" + cv + ")");
        _rTotal += rv;
        _cTotal += cv;
      });
      if (_rParts.length > 0) {
        rsuCalcHint =
          _rParts.join(" + ") + " = " + Math.round(_rTotal * 100) / 100;
        cdaCalcHint =
          _cParts.join(" + ") + " = " + Math.round(_cTotal * 100) / 100;
      }
    } else if (
      calcMethod === "Met" &&
      aggCfgParsed &&
      aggCfgParsed.source_ids
    ) {
      var _srcIds = aggCfgParsed.source_ids;
      var _reqMap = {};
      _divReqsList.forEach(function (r) {
        _reqMap[r.requirement_id] = r;
      });
      var _rLines = [],
        _cLines = [],
        _rMet = 0,
        _cMet = 0,
        _rTotal = 0,
        _cTotal = 0;
      _srcIds.forEach(function (sid) {
        var sp = _divProgMap[sid] || { rsu: 0, cda: 0 };
        var sr = _reqMap[sid];
        var nm = sr ? sr.requirement_type : "Unknown";
        var minR = sr ? parseFloat(sr.minimum_rsu) || 0 : 0;
        var minC = sr ? parseFloat(sr.minimum_cda) || 0 : 0;
        if (minR > 0) {
          var ok = sp.rsu >= minR;
          if (ok) _rMet++;
          _rTotal++;
          _rLines.push(nm + (ok ? " \u2713" : " \u2717"));
        }
        if (minC > 0) {
          var ok = sp.cda >= minC;
          if (ok) _cMet++;
          _cTotal++;
          _cLines.push(nm + (ok ? " \u2713" : " \u2717"));
        }
      });
      if (_rTotal > 0)
        rsuCalcHint =
          _rLines.join("\n") + "\n\u2192  " + _rMet + " / " + _rTotal;
      if (_cTotal > 0)
        cdaCalcHint =
          _cLines.join("\n") + "\n\u2192  " + _cMet + " / " + _cTotal;
    } else if (aggCfgParsed && aggCfgParsed.type === "sum_union") {
      var _alsoIds = aggCfgParsed.also_sum || [];
      var _nameMap = {};
      _divReqsList.forEach(function (r) {
        _nameMap[r.requirement_id] = r.requirement_type;
      });
      var _ownRsuSum = 0,
        _ownCdaSum = 0;
      _divRecordsList
        .filter(function (r) {
          return (
            r.requirement_id === req.requirement_id && r.status === "verified"
          );
        })
        .forEach(function (r) {
          _ownRsuSum += parseFloat(r.rsu_units) || 0;
          _ownCdaSum += parseFloat(r.cda_units) || 0;
        });
      var _rParts = ["Own (" + Math.round(_ownRsuSum * 100) / 100 + ")"];
      var _cParts = ["Own (" + Math.round(_ownCdaSum * 100) / 100 + ")"];
      _alsoIds.forEach(function (sid) {
        var rsuSum = 0,
          cdaSum = 0;
        _divRecordsList
          .filter(function (r) {
            return r.requirement_id === sid && r.status === "verified";
          })
          .forEach(function (r) {
            rsuSum += parseFloat(r.rsu_units) || 0;
            cdaSum += parseFloat(r.cda_units) || 0;
          });
        var nm = _nameMap[sid] || "Other";
        _rParts.push(nm + " (" + Math.round(rsuSum * 100) / 100 + ")");
        _cParts.push(nm + " (" + Math.round(cdaSum * 100) / 100 + ")");
      });
      rsuCalcHint =
        _rParts.join(" + ") + " = " + Math.round(prog.rsu * 100) / 100;
      cdaCalcHint =
        _cParts.join(" + ") + " = " + Math.round(prog.cda * 100) / 100;
    } else if (aggCfgParsed && aggCfgParsed.type === "count_union") {
      var _alsoIds = aggCfgParsed.also_count || [];
      var _nameMap = {};
      _divReqsList.forEach(function (r) {
        _nameMap[r.requirement_id] = r.requirement_type;
      });
      var _ownCnt = _divRecordsList.filter(function (r) {
        return (
          r.requirement_id === req.requirement_id && r.status === "verified"
        );
      }).length;
      var _parts = ["Own (" + _ownCnt + ")"];
      _alsoIds.forEach(function (sid) {
        var cnt = _divRecordsList.filter(function (r) {
          return r.requirement_id === sid && r.status === "verified";
        }).length;
        _parts.push((_nameMap[sid] || "Other") + " (" + cnt + ")");
      });
      var _hint = _parts.join(" + ") + " = " + Math.round(prog.rsu);
      rsuCalcHint = _hint;
      cdaCalcHint = _hint;
    } else if (calcMethod === "Exam") {
      var _filterReqs =
        aggCfgParsed && aggCfgParsed.source_ids
          ? aggCfgParsed.source_ids
          : null;
      var _examCnt = _divRecordsList.filter(function (r) {
        if (!r.is_exam) return false;
        if (_filterReqs && _filterReqs.indexOf(r.requirement_id) === -1)
          return false;
        return r.status === "verified";
      }).length;
      var _hint = _examCnt + " exam record" + (_examCnt !== 1 ? "s" : "");
      rsuCalcHint = _hint;
      cdaCalcHint = _hint;
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
      calc_method: calcMethod,
      rsu_calc_hint: rsuCalcHint,
      cda_calc_hint: cdaCalcHint,
      rsu_records: rsuRecords,
      cda_records: cdaRecords,
      aggregation_config: (function () {
        try {
          return typeof req.aggregation_config === "string"
            ? JSON.parse(req.aggregation_config)
            : req.aggregation_config || null;
        } catch (e) {
          return null;
        }
      })(),
      sub_counts: prog.sub_counts || null,
      sub_counts_labels: prog.sub_counts_labels || null,
      display_field: prog.display_field || null,
    });
  });

  // 6. Compute per-division completion percentages for radar chart
  Object.values(divisions).forEach(function (div) {
    // Exclude source-only rows (e.g. PERIO Case G) from completion calculation
    var rsuReqs = div.requirements.filter(function (r) {
      return (
        (r.minimum_rsu > 0 || r.is_exam) &&
        !(r.aggregation_config && r.aggregation_config.type === "source_only")
      );
    });
    var cdaReqs = div.requirements.filter(function (r) {
      return (
        (r.minimum_cda > 0 || r.is_exam) &&
        !(r.aggregation_config && r.aggregation_config.type === "source_only")
      );
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
  if (
    !profile.found ||
    !profile.active ||
    (profile.role !== "instructor" && profile.role !== "admin")
  ) {
    throw new Error("Access Denied.");
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
 * Aggregate all treatment records for an advisor's division into a flat dataset
 * used by the division dashboard page.
 * @param {string} viewMode  'advisor' (my advisees only) | 'division' (all division students)
 * @returns {{ profile, students, requirements, records, floors }}
 */
/**
 * Returns the caller's role and available divisions for the dashboard.
 * Called once on dashboard init to decide whether to show a division picker (admin)
 * or load directly (instructor).
 * @returns {{ role: string, name: string, divisions: Array }}
 */
function dashboardGetMeta() {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (!profile.found || !profile.active)
    throw new Error("User not found or inactive.");

  if (profile.role === "admin") {
    var divs = (SupabaseProvider.listDivisions() || [])
      .map(function (d) {
        return { division_id: d.division_id, code: d.code, name: d.name };
      })
      .sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
    return { role: "admin", name: profile.name, divisions: divs };
  }

  if (profile.role === "instructor") {
    return {
      role: "instructor",
      name: profile.name,
      divisions: profile.division
        ? [{ code: profile.division.code, name: profile.division.name }]
        : [],
    };
  }

  throw new Error("Access Denied.");
}

function advisorGetDashboardData(viewMode, divisionCode) {
  var user = getCurrentUser();
  if (!user.allowed) throw new Error("Access Denied");

  var profile = getUserProfile(user.email);
  if (!profile.found || !profile.active)
    throw new Error("User not found or inactive.");

  var isAdmin = profile.role === "admin";
  var isInstructor = profile.role === "instructor";
  if (!isAdmin && !isInstructor) throw new Error("Access Denied.");

  var divCode, divisionObj;
  if (isAdmin) {
    if (!divisionCode)
      throw new Error("Division code is required for admin access.");
    var allDivs = SupabaseProvider.listDivisions() || [];
    divisionObj = allDivs.find(function (d) {
      return d.code && d.code.toLowerCase() === divisionCode.toLowerCase();
    });
    if (!divisionObj) throw new Error("Division not found: " + divisionCode);
    divCode = divisionObj.code.toLowerCase();
  } else {
    if (!profile.division || !profile.division.code) {
      throw new Error("Instructor is not assigned to a division.");
    }
    divCode = profile.division.code.toLowerCase();
    divisionObj = profile.division;
  }

  var columnName = divCode + "_instructor_id";

  // 1. Students by view mode (admin always uses whole-division view)
  var rawStudents;
  if (!isAdmin && viewMode === "advisor") {
    rawStudents =
      SupabaseProvider.listStudentsByDivisionInstructor(
        columnName,
        profile.instructor_id,
      ) || [];
  } else {
    rawStudents = (SupabaseProvider.listStudents() || []).filter(function (s) {
      return s[columnName] != null;
    });
  }

  // 2. Format students + compute year (same logic as advisorGetAdvisees)
  var today = new Date();
  var yr = today.getFullYear();
  var isNewAY =
    today.getMonth() > 7 || (today.getMonth() === 7 && today.getDate() >= 20);

  var students = rawStudents.map(function (s) {
    var calcYear = "-";
    if (s.first_clinic_year) {
      calcYear = isNewAY
        ? yr - s.first_clinic_year + 5
        : yr - s.first_clinic_year + 4;
    }
    var uObj = s.user || s.users || {};
    var fObj = s.floor || s.floors || {};
    return {
      student_id: s.student_id,
      academic_id: s.academic_id || "-",
      name: uObj.name || "Unknown",
      email: uObj.email || "-",
      calculated_year: calcYear,
      floor_id: s.floor_id || null,
      floor_label: fObj.label || "-",
      unit_id: s.unit_id || "-",
      status: s.status || "active",
    };
  });

  students.sort(function (a, b) {
    var ya = typeof a.calculated_year === "number" ? a.calculated_year : 0;
    var yb = typeof b.calculated_year === "number" ? b.calculated_year : 0;
    if (ya !== yb) return yb - ya;
    return String(a.academic_id).localeCompare(String(b.academic_id));
  });

  // 3. Requirements for this division only
  var allReqs = SupabaseProvider.listRequirements() || [];
  var divReqs = allReqs
    .filter(function (r) {
      return (
        r.divisions &&
        r.divisions.code &&
        r.divisions.code.toLowerCase() === divCode
      );
    })
    .map(function (r) {
      return {
        requirement_id: r.requirement_id,
        requirement_type: r.requirement_type,
        cda_requirement_type: r.cda_requirement_type || null,
        minimum_rsu: r.minimum_rsu || 0,
        minimum_cda: r.minimum_cda || 0,
        is_exam: r.is_exam || false,
        is_selectable: r.is_selectable !== false,
        aggregation_config: (function () {
          try {
            var raw = r.aggregation_config;
            return typeof raw === "string" ? JSON.parse(raw) : raw || null;
          } catch (e) {
            return null;
          }
        })(),
      };
    });

  // 4. Batch-fetch records for all students
  var studentIds = students.map(function (s) {
    return s.student_id;
  });
  var rawRecords =
    studentIds.length > 0
      ? SupabaseProvider.listRecordsForDashboard(studentIds)
      : [];

  var records = rawRecords.map(function (r) {
    return {
      record_id: r.record_id,
      student_id: r.student_id,
      requirement_id: r.requirement_id,
      status: r.status,
      rsu_units: r.rsu_units,
      cda_units: r.cda_units,
      is_exam: r.is_exam || false,
      step_name: r.treatment_steps ? r.treatment_steps.step_name : null,
    };
  });

  // 5. Unique floors for filter dropdown
  var floorSet = {};
  students.forEach(function (s) {
    if (s.floor_id) floorSet[s.floor_id] = s.floor_label;
  });
  var floors = Object.keys(floorSet).map(function (id) {
    return { floor_id: id, label: floorSet[id] };
  });
  floors.sort(function (a, b) {
    return a.label.localeCompare(b.label);
  });

  return {
    profile: {
      instructor_id: profile.instructor_id || null,
      name: profile.name,
      role: profile.role,
      division: { code: divisionObj.code, name: divisionObj.name },
    },
    students: students,
    requirements: divReqs,
    records: records,
    floors: floors,
  };
}

/**
 * Get all pending-verification treatment records for the instructor's team students.
 * Returns records grouped by student, sorted by year desc then academic_id.
 * @returns {Array} [{ student_id, academic_id, name, email, calculated_year, records[] }]
 */
function instructorGetPendingVerifications() {
  _assertInstructor();

  var profile = getUserProfile(Session.getActiveUser().getEmail());
  var instructorId = profile.instructor_id;
  if (!instructorId) throw new Error("Instructor record not found.");

  // 1. Get team students
  var students = SupabaseProvider.listStudentsByTeamLeader(instructorId) || [];
  if (students.length === 0) return [];

  // 2. Compute year and build student map (same filter logic as instructorGetTeamStudents)
  var today = new Date();
  var currentYear = today.getFullYear();
  var isNewAY =
    today.getMonth() > 7 || (today.getMonth() === 7 && today.getDate() >= 20);

  var studentMap = {};
  students.forEach(function (s) {
    if (!s.first_clinic_year) return;
    var yr = isNewAY
      ? currentYear - s.first_clinic_year + 5
      : currentYear - s.first_clinic_year + 4;
    if (yr === 5 && s.team_leader_1_id !== instructorId) return;
    if (yr !== 5 && s.team_leader_2_id !== instructorId) return;
    studentMap[s.student_id] = {
      student_id: s.student_id,
      academic_id: s.academic_id,
      name: s.user ? s.user.name : "Unknown",
      email: s.user ? s.user.email : null,
      calculated_year: yr,
      records: [],
    };
  });

  var studentIds = Object.keys(studentMap);
  if (studentIds.length === 0) return [];

  // 3. Fetch pending verification records for all team students in one query
  var records =
    SupabaseProvider.listPendingRecordsByStudentIds(studentIds) || [];

  // 4. Attach records to their student
  records.forEach(function (rec) {
    var stu = studentMap[rec.student_id];
    if (!stu) return;
    stu.records.push({
      record_id: rec.record_id,
      student_email: stu.email,
      student_name: stu.name,
      hn: rec.hn || (rec.patient && rec.patient.hn) || "-",
      patient_name:
        rec.patient_name || (rec.patient && rec.patient.name) || "-",
      area: rec.area || "-",
      rsu_units: rec.rsu_units != null ? rec.rsu_units : "-",
      cda_units: rec.cda_units != null ? rec.cda_units : "-",
      severity: rec.severity != null ? rec.severity : null,
      book_number: rec.book_number != null ? rec.book_number : null,
      page_number: rec.page_number != null ? rec.page_number : null,
      is_exam: !!rec.is_exam,
      perio_exams: rec.perio_exams || null,
      treatment_name: rec.treatment_catalog
        ? rec.treatment_catalog.treatment_name
        : "-",
      step_name: rec.treatment_steps ? rec.treatment_steps.step_name : "-",
      division_code:
        rec.treatment_catalog && rec.treatment_catalog.divisions
          ? rec.treatment_catalog.divisions.code
          : "",
      division_name:
        rec.treatment_catalog && rec.treatment_catalog.divisions
          ? rec.treatment_catalog.divisions.name
          : "-",
      requirement_type: rec.requirement_list
        ? rec.requirement_list.requirement_type
        : "-",
      updated_at: rec.updated_at || null,
    });
  });

  // 5. Return only students with pending records
  return Object.values(studentMap)
    .filter(function (s) {
      return s.records.length > 0;
    })
    .sort(function (a, b) {
      if (a.calculated_year !== b.calculated_year) {
        return b.calculated_year - a.calculated_year;
      }
      return String(a.academic_id).localeCompare(String(b.academic_id));
    });
}

/**
 * Bulk verify or reject a set of treatment records (Instructor only).
 * Sends one summary email per affected student.
 *
 * @param {Object} payload
 *   payload.records  — Array of enriched record objects (must have record_id, student_email,
 *                      student_name, treatment_name, step_name, hn/patient_hn)
 *   payload.action   — 'verified' | 'rejected'
 * @returns {{ success: boolean, count: number, errors: Array }}
 */
function instructorBulkUpdateRecordStatus(payload) {
  _assertInstructor();

  var records = payload.records || [];
  var action = payload.action;

  if (!records.length) return { success: false, error: "No records selected." };
  if (action !== "verified" && action !== "rejected") {
    return { success: false, error: "Invalid action." };
  }

  var profile = getUserProfile(Session.getActiveUser().getEmail());
  var successCount = 0;
  var errors = [];
  var studentSummary = {}; // email -> { name, items[] }

  records.forEach(function (rec) {
    try {
      var updates = {
        status: action,
        updated_at: new Date().toISOString(),
      };
      if (action === "verified") {
        updates.verified_by = profile.user_id;
        updates.verified_at = new Date().toISOString();
        rec._verified_at = updates.verified_at; // store for hash proof
      }
      SupabaseProvider.updateTreatmentRecord(rec.record_id, updates);
      successCount++;

      // Accumulate for per-student summary email
      if (rec.student_email) {
        if (!studentSummary[rec.student_email]) {
          studentSummary[rec.student_email] = {
            name: rec.student_name || "Student",
            items: [],
          };
        }
        studentSummary[rec.student_email].items.push(rec);
      }
    } catch (e) {
      errors.push({ record_id: rec.record_id, error: e.message });
    }
  });

  // Send one summary email per student
  var statusLabel = action === "verified" ? "Verified ✅" : "Rejected ❌";
  var instructorName = profile.name || "Your instructor";
  Object.keys(studentSummary).forEach(function (email) {
    try {
      var sum = studentSummary[email];
      var rows = sum.items
        .map(function (r) {
          return (
            "<tr>" +
            "<td style='padding:6px 8px;border-bottom:1px solid #edf2f7;'>" +
            (r.hn || r.patient_hn || "-") +
            "</td>" +
            "<td style='padding:6px 8px;border-bottom:1px solid #edf2f7;'>" +
            (r.treatment_name || "-") +
            (r.step_name && r.step_name !== "-"
              ? " &middot; " + r.step_name
              : "") +
            "</td>" +
            "<td style='padding:6px 8px;border-bottom:1px solid #edf2f7;'>" +
            (r.requirement_type || "-") +
            "</td>" +
            "<td style='padding:6px 8px;border-bottom:1px solid #edf2f7;text-align:center;font-family:monospace;'>" +
            (r.rsu_units != null ? r.rsu_units : "-") +
            "</td>" +
            "<td style='padding:6px 8px;border-bottom:1px solid #edf2f7;text-align:center;font-family:monospace;'>" +
            (r.cda_units != null ? r.cda_units : "-") +
            "</td>" +
            "</tr>"
          );
        })
        .join("");

      // Build hash proof section for verified records
      var hashProofSection = "";
      if (action === "verified") {
        var proofRows = sum.items
          .map(function (r) {
            var vHash = _computeVerificationHash(r._verified_at, r.record_id);
            // Build optional detail chips
            var details = "";
            if (r.area && r.area !== "-")
              details +=
                "<span style='display:inline-block;margin:2px 4px 2px 0;padding:2px 6px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:4px;font-size:10px;color:#4338ca;'>Area: " +
                r.area +
                "</span>";
            if (r.severity != null)
              details +=
                "<span style='display:inline-block;margin:2px 4px 2px 0;padding:2px 6px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:4px;font-size:10px;color:#047857;'>Severity: " +
                r.severity +
                "</span>";
            if (r.book_number != null)
              details +=
                "<span style='display:inline-block;margin:2px 4px 2px 0;padding:2px 6px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;font-size:10px;color:#1d4ed8;'>Book: " +
                r.book_number +
                "</span>";
            if (r.page_number != null)
              details +=
                "<span style='display:inline-block;margin:2px 4px 2px 0;padding:2px 6px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;font-size:10px;color:#1d4ed8;'>Page: " +
                r.page_number +
                "</span>";
            return (
              "<div style='padding:10px;border-bottom:1px solid #d1fae5;'>" +
              "<div style='font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;'>" +
              (r.treatment_name || "Treatment") +
              " — HN " +
              (r.hn || r.patient_hn || "-") +
              " — " +
              (r.requirement_type || "-") +
              "</div>" +
              (details
                ? "<div style='margin-bottom:4px;'>" + details + "</div>"
                : "") +
              "<table style='width:100%;border-collapse:collapse;font-size:11px;'>" +
              "<tr><td style='padding:2px 0;color:#6b7280;width:80px;'>Verified At</td><td style='font-family:monospace;color:#1f2937;'>" +
              r._verified_at +
              "</td></tr>" +
              "<tr><td style='padding:2px 0;color:#6b7280;'>Record ID</td><td style='font-family:monospace;color:#1f2937;word-break:break-all;'>" +
              r.record_id +
              "</td></tr>" +
              "<tr><td style='padding:2px 0;color:#6b7280;'>Hash</td><td style='font-family:monospace;color:#1f2937;word-break:break-all;font-size:10px;'>" +
              vHash +
              "</td></tr>" +
              "</table></div>"
            );
          })
          .join("");
        hashProofSection =
          "<div style='margin-top:20px;padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;'>" +
          "<p style='margin:0 0 8px;font-size:12px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.05em;'>Verification Proof</p>" +
          proofRows +
          "<p style='margin:8px 0 0;font-size:11px;color:#6b7280;'>Keep this email as proof. The hash can be validated by your program administrator.</p>" +
          "</div>";
      }

      MailApp.sendEmail({
        to: email,
        subject:
          sum.items.length +
          " Treatment Record(s) " +
          (action === "verified" ? "Verified" : "Rejected"),
        htmlBody:
          "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;" +
          "padding:20px;border:1px solid #e0e0e0;border-radius:8px;'>" +
          "<h2 style='color:#1a365d;border-bottom:2px solid #e2e8f0;padding-bottom:10px;'>" +
          "Treatment Records " +
          statusLabel +
          "</h2>" +
          "<p>" +
          sum.items.length +
          " record(s) have been <b>" +
          action +
          "</b> by " +
          instructorName +
          ".</p>" +
          "<table style='width:100%;border-collapse:collapse;margin:16px 0;'>" +
          "<thead><tr style='background:#f7fafc;'>" +
          "<th style='padding:6px 8px;text-align:left;font-size:12px;color:#718096;'>Patient HN</th>" +
          "<th style='padding:6px 8px;text-align:left;font-size:12px;color:#718096;'>Treatment</th>" +
          "<th style='padding:6px 8px;text-align:left;font-size:12px;color:#718096;'>Requirement</th>" +
          "<th style='padding:6px 8px;text-align:center;font-size:12px;color:#718096;'>RSU</th>" +
          "<th style='padding:6px 8px;text-align:center;font-size:12px;color:#718096;'>CDA</th>" +
          "</tr></thead><tbody>" +
          rows +
          "</tbody></table>" +
          "<p style='font-size:11px;color:#6b7280;margin:0 0 4px;'>📌 Please archive or label this email as part of your RSU requirements record.</p>" +
          hashProofSection +
          "</div>",
      });
    } catch (mailErr) {
      Logger.log(
        "Bulk action email failed for " + email + ": " + mailErr.message,
      );
    }
  });

  return { success: true, count: successCount, errors: errors };
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
 * Ensure current user is an instructor or admin.
 * @throws {Error} if not instructor/admin
 */
function _assertInstructor() {
  var email = Session.getActiveUser().getEmail();
  var user = SupabaseProvider.getUserByEmail(email);
  if (!user || (user.role !== "instructor" && user.role !== "admin")) {
    throw new Error("Access denied: Instructors only.");
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
      user.oper_instructor_id = s.oper_instructor_id;
      user.endo_instructor_id = s.endo_instructor_id;
      user.perio_instructor_id = s.perio_instructor_id;
      user.prosth_instructor_id = s.prosth_instructor_id;
      user.diag_instructor_id = s.diag_instructor_id;
      user.radio_instructor_id = s.radio_instructor_id;
      user.sur_instructor_id = s.sur_instructor_id;
      user.ortho_instructor_id = s.ortho_instructor_id;
      user.pedo_instructor_id = s.pedo_instructor_id;
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

/**
 * Parse an aggregation_config string entered by an admin.
 * Strips invisible Unicode characters (BOM, non-breaking spaces, zero-width chars)
 * that browsers sometimes inject during copy-paste, causing JSON.parse to fail with
 * "Unexpected non-whitespace character after JSON".
 * @param {string} raw
 * @returns {Object|null}
 */
function _parseAggConfig(raw) {
  if (!raw || !raw.trim()) return null;
  // Strip BOM and invisible/non-standard Unicode whitespace before parsing
  var cleaned = raw
    .replace(/[\uFEFF\u00A0\u200B\u200C\u200D\u2028\u2029]/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error("Invalid aggregation_config JSON: " + e.message);
  }
}

function adminCreateRequirement(form) {
  _assertAdmin();
  try {
    Logger.log(
      "adminCreateRequirement called. default_rsu=" +
        JSON.stringify(form.default_rsu) +
        " default_cda=" +
        JSON.stringify(form.default_cda),
    );
    var aggConfig = _parseAggConfig(form.aggregation_config);
    var payload = {
      division_id: form.division_id,
      requirement_type: form.requirement_type,
      cda_requirement_type: form.cda_requirement_type || null,
      minimum_rsu: parseFloat(form.minimum_rsu) || 0,
      minimum_cda: parseFloat(form.minimum_cda) || 0,
      rsu_unit: form.rsu_unit || "Case",
      cda_unit: form.cda_unit || "Case",
      default_rsu:
        form.default_rsu !== "" && form.default_rsu != null
          ? parseFloat(form.default_rsu)
          : null,
      default_cda:
        form.default_cda !== "" && form.default_cda != null
          ? parseFloat(form.default_cda)
          : null,
      is_patient_treatment:
        form.is_patient_treatment === true ||
        form.is_patient_treatment === "true",
      non_mc_pateint_req:
        form.non_mc_pateint_req === true || form.non_mc_pateint_req === "true",
      is_exam: form.is_exam === true || form.is_exam === "true",
      is_selectable:
        form.is_selectable !== false && form.is_selectable !== "false",
      aggregation_config: aggConfig,
      display_order: parseInt(form.display_order) || 0,
    };
    Logger.log("Payload to Supabase (Create): " + JSON.stringify(payload));
    var created = SupabaseProvider.createRequirement(payload);
    Logger.log("Supabase response (Create): " + JSON.stringify(created));
    return {
      success: true,
      _debug: {
        sent: payload,
        received: created,
      },
    };
  } catch (e) {
    Logger.log("adminCreateRequirement error: " + e.message);
    return { success: false, error: e.message };
  }
}

function adminUpdateRequirement(id, form) {
  _assertAdmin();
  try {
    Logger.log(
      "adminUpdateRequirement called. id=" +
        id +
        " default_rsu=" +
        JSON.stringify(form.default_rsu) +
        " default_cda=" +
        JSON.stringify(form.default_cda) +
        " typeof_default_rsu=" +
        typeof form.default_rsu,
    );
    var aggConfigUpd = _parseAggConfig(form.aggregation_config);
    var payload = {
      division_id: form.division_id,
      requirement_type: form.requirement_type,
      cda_requirement_type: form.cda_requirement_type || null,
      minimum_rsu: parseFloat(form.minimum_rsu) || 0,
      minimum_cda: parseFloat(form.minimum_cda) || 0,
      rsu_unit: form.rsu_unit || "Case",
      cda_unit: form.cda_unit || "Case",
      default_rsu:
        form.default_rsu !== "" && form.default_rsu != null
          ? parseFloat(form.default_rsu)
          : null,
      default_cda:
        form.default_cda !== "" && form.default_cda != null
          ? parseFloat(form.default_cda)
          : null,
      is_patient_treatment:
        form.is_patient_treatment === true ||
        form.is_patient_treatment === "true",
      non_mc_pateint_req:
        form.non_mc_pateint_req === true || form.non_mc_pateint_req === "true",
      is_exam: form.is_exam === true || form.is_exam === "true",
      is_selectable:
        form.is_selectable !== false && form.is_selectable !== "false",
      aggregation_config: aggConfigUpd,
      display_order: parseInt(form.display_order) || 0,
    };
    Logger.log(
      "Payload to Supabase: default_rsu=" +
        payload.default_rsu +
        " default_cda=" +
        payload.default_cda,
    );
    var updated = SupabaseProvider.updateRequirement(id, payload);
    Logger.log("Supabase response: " + JSON.stringify(updated));
    return {
      success: true,
      _debug: {
        sent: payload,
        received: updated,
      },
    };
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
    var verifiedAt = new Date().toISOString();

    SupabaseProvider.updateTreatmentRecord(recordId, {
      status: "verified",
      verified_by: verifierId,
      verified_at: verifiedAt,
      updated_at: new Date().toISOString(),
    });

    // Notify student with verification proof
    try {
      var record = SupabaseProvider.getTreatmentRecord(recordId);
      if (record && record.student_id) {
        var student = SupabaseProvider.getStudentById(record.student_id);
        if (student && student.user && student.user.email) {
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
          var reqType = record.requirement
            ? record.requirement.requirement_type
            : "-";
          var divName = record.division ? record.division.name : "-";
          var severity = record.severity;
          var bookNum = record.book_number;
          var pageNum = record.page_number;

          var vHash = _computeVerificationHash(verifiedAt, recordId);
          var hashSection =
            "<div style='margin-top:20px;padding:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;'>" +
            "<p style='margin:0 0 8px;font-size:12px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.05em;'>Verification Proof</p>" +
            "<table style='width:100%;border-collapse:collapse;font-size:13px;'>" +
            "<tr><td style='padding:4px 0;color:#374151;font-weight:600;width:100px;'>Verified At</td><td style='padding:4px 0;font-family:monospace;color:#1f2937;'>" +
            verifiedAt +
            "</td></tr>" +
            "<tr><td style='padding:4px 0;color:#374151;font-weight:600;'>Record ID</td><td style='padding:4px 0;font-family:monospace;color:#1f2937;word-break:break-all;'>" +
            recordId +
            "</td></tr>" +
            "<tr><td style='padding:4px 0;color:#374151;font-weight:600;'>Hash</td><td style='padding:4px 0;font-family:monospace;color:#1f2937;word-break:break-all;font-size:11px;'>" +
            vHash +
            "</td></tr>" +
            "</table>" +
            "<p style='margin:8px 0 0;font-size:11px;color:#6b7280;'>Keep this email as proof of verification. The hash can be validated by your program administrator.</p>" +
            "</div>";

          // Build optional detail rows
          var optionalRows = "";
          if (severity != null) {
            optionalRows +=
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Severity:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              severity +
              "</td></tr>";
          }
          if (bookNum != null) {
            optionalRows +=
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Book Number:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              bookNum +
              "</td></tr>";
          }
          if (pageNum != null) {
            optionalRows +=
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Page Number:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              pageNum +
              "</td></tr>";
          }

          MailApp.sendEmail({
            to: student.user.email,
            subject: "Treatment Verified: " + treatName + " (HN " + pHn + ")",
            htmlBody:
              "<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e0e0e0;border-radius:8px;'>" +
              "<h2 style='color:#1a365d;border-bottom:2px solid #e2e8f0;padding-bottom:10px;'>Treatment Verified ✅</h2>" +
              "<p>Your treatment record has been <b>verified</b> by " +
              (profile.name || "an instructor") +
              ".</p>" +
              "<table style='width:100%;border-collapse:collapse;margin:20px 0;'>" +
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Patient HN:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              pHn +
              "</td></tr>" +
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Patient Name:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              pName +
              "</td></tr>" +
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Division:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              divName +
              "</td></tr>" +
              "<tr><td style='padding:8px;border-bottom:1px solid #edf2f7;'><strong>Requirement:</strong></td><td style='padding:8px;border-bottom:1px solid #edf2f7;'>" +
              reqType +
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
              optionalRows +
              "</table>" +
              "<p style='font-size:11px;color:#6b7280;margin:0 0 4px;'>📌 Please archive or label this email as part of your RSU requirements record.</p>" +
              hashSection +
              "</div>",
          });
        }
      }
    } catch (emailErr) {
      Logger.log(
        "instructorVerifyTreatmentRecord email error: " + emailErr.message,
      );
    }

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
      perio_exams:
        form.perio_exams && typeof form.perio_exams === "object"
          ? form.perio_exams
          : null,
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
      perio_exams:
        form.perio_exams && typeof form.perio_exams === "object"
          ? form.perio_exams
          : null,
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
