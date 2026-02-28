/**
 * SupabaseProvider.gs — Supabase REST API wrapper
 *
 * Every function mirrors the SheetsProvider interface so the
 * FailoverProvider can swap transparently.
 */

var SupabaseProvider = (function () {
  /**
   * Build standard headers for Supabase REST calls.
   */
  function _headers() {
    return {
      apikey: getSupabaseKey(),
      Authorization: "Bearer " + getSupabaseKey(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
  }

  /**
   * Generic GET helper.
   * @param {string} path  — REST path, e.g. '/rest/v1/users?email=eq.foo'
   * @returns {Array|Object}
   */
  function _get(path) {
    var url = getSupabaseUrl() + path;
    var response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: _headers(),
      muteHttpExceptions: true,
    });

    var code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(
        "Supabase GET " +
          path +
          " returned " +
          code +
          ": " +
          response.getContentText(),
      );
    }
    return JSON.parse(response.getContentText());
  }

  /**
   * Cached GET helper using CacheService.
   */
  function _getCached(path, ttlSeconds) {
    var cache = CacheService.getScriptCache();
    var version = cache.get("sb_v") || "1";
    var cacheKey =
      "sb_" + version + "_" + Utilities.base64Encode(path).substring(0, 80);

    var cached = cache.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        console.warn("Cache parse error", e);
      }
    }

    var data = _get(path);
    if (data) {
      try {
        cache.put(cacheKey, JSON.stringify(data), ttlSeconds || 600); // Default 10 mins
      } catch (e) {
        console.warn("Cache put error (likely size limit)", e);
      }
    }
    return data;
  }

  /**
   * Invalidate all cached Supabase data by incrementing the version.
   */
  function _invalidateCache() {
    var cache = CacheService.getScriptCache();
    var v = parseInt(cache.get("sb_v") || "1");
    cache.put("sb_v", (v + 1).toString(), 21600);
    Logger.log("Supabase cache invalidated (new version: " + (v + 1) + ")");
  }

  /**
   * Generic POST helper.
   */
  function _post(path, payload) {
    var url = getSupabaseUrl() + path;
    var response = UrlFetchApp.fetch(url, {
      method: "post",
      headers: _headers(),
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    var code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(
        "Supabase POST " +
          path +
          " returned " +
          code +
          ": " +
          response.getContentText(),
      );
    }
    _invalidateCache();
    return JSON.parse(response.getContentText());
  }

  /**
   * Generic PATCH helper.
   */
  function _patch(path, payload) {
    var url = getSupabaseUrl() + path;
    var response = UrlFetchApp.fetch(url, {
      method: "patch",
      headers: _headers(),
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    var code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(
        "Supabase PATCH " +
          path +
          " returned " +
          code +
          ": " +
          response.getContentText(),
      );
    }
    _invalidateCache();
    // PATCH might return 204 No Content
    if (code === 204) return null;
    return JSON.parse(response.getContentText());
  }

  /**
   * Generic DELETE helper.
   */
  function _delete(path) {
    var url = getSupabaseUrl() + path;
    var response = UrlFetchApp.fetch(url, {
      method: "delete",
      headers: _headers(),
      muteHttpExceptions: true,
    });
    var code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(
        "Supabase DELETE " +
          path +
          " returned " +
          code +
          ": " +
          response.getContentText(),
      );
    }
    _invalidateCache();
    return true;
  }

  // ──────────────────────────────────────────────
  //  Public interface
  // ──────────────────────────────────────────────

  return {
    /** Lightweight health check */
    ping: function () {
      var url = getSupabaseUrl() + "/rest/v1/";
      var response = UrlFetchApp.fetch(url, {
        method: "get",
        headers: _headers(),
        muteHttpExceptions: true,
      });
      return response.getResponseCode() === 200;
    },

    /**
     * Create a user in Supabase Auth (Admin API).
     * @param {string} email
     * @param {string} password (temporary)
     * @param {Object} data (optional metadata)
     * @returns {Object} auth user object (contains .id)
     */
    createAuthUser: function (email, password, data) {
      var payload = {
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: data || {},
        app_metadata: data || {}, // Send in both to satisfy trigger regardless of which one it uses
      };
      Logger.log(
        "SupabaseProvider: Creating Auth User with payload: " +
          JSON.stringify(payload),
      );
      return _post("/auth/v1/admin/users", payload);
    },

    /**
     * Delete a user from Supabase Auth.
     * @param {string} userId
     */
    deleteAuthUser: function (userId) {
      return _delete("/auth/v1/admin/users/" + userId);
    },

    /**
     * List all users with optional search/filter.
     * @returns {Array}
     */
    listUsers: function () {
      // Returns all users, ordered by created_at desc
      // Join with students to get academic_id for student users
      var select = "*,students(academic_id)";
      return _getCached(
        "/rest/v1/users?select=" + select + "&order=created_at.desc",
        600,
      );
    },

    deleteUser: function (userId) {
      return _delete("/rest/v1/users?user_id=eq." + userId);
    },

    deleteStudentByUserId: function (userId) {
      return _delete("/rest/v1/students?user_id=eq." + userId);
    },

    deleteInstructorByUserId: function (userId) {
      return _delete("/rest/v1/instructors?user_id=eq." + userId);
    },

    /**
     * List all instructors.
     */
    listInstructors: function () {
      return _getCached(
        "/rest/v1/instructors?select=*,users(name,email),divisions(code)",
        600,
      );
    },

    /**
     * Create public.users record.
     */
    createUser: function (user) {
      // Prefer=return=representation is set in headers, so this returns [new_row]
      var rows = _post("/rest/v1/users", user);
      return rows[0];
    },

    /**
     * Update public.users record.
     */
    updateUser: function (userId, updates) {
      var rows = _patch("/rest/v1/users?user_id=eq." + userId, updates);
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * Update public.patients record.
     */
    updatePatient: function (patientId, updates) {
      var rows = _patch(
        "/rest/v1/patients?patient_id=eq." + patientId,
        updates,
      );
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * Upsert patient (Create or Update based on HN).
     * Uses Supabase upsert capability.
     */
    upsertPatient: function (patient) {
      // POST with resolution=merge-duplicates and on_conflict=hn
      var url = getSupabaseUrl() + "/rest/v1/patients?on_conflict=hn";
      var headers = _headers();
      headers["Prefer"] = "resolution=merge-duplicates,return=representation";

      var response = UrlFetchApp.fetch(url, {
        method: "post",
        headers: headers,
        payload: JSON.stringify(patient),
        muteHttpExceptions: true,
      });

      var code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        throw new Error(
          "Supabase UPSERT patients returned " +
            code +
            ": " +
            response.getContentText(),
        );
      }
      var rows = JSON.parse(response.getContentText());
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * Create public.students record.
     */
    createStudent: function (student) {
      // student object should now include academic_id if provided
      var rows = _post("/rest/v1/students", student);
      return rows[0];
    },

    getStudentByAcademicId: function (academicId) {
      var rows = _get(
        "/rest/v1/students?academic_id=eq." + academicId + "&select=*",
      );
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * Update public.students record.
     */
    updateStudent: function (studentId, updates) {
      var rows = _patch(
        "/rest/v1/students?student_id=eq." + studentId,
        updates,
      );
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * Create public.instructors record.
     */
    createInstructor: function (instructor) {
      var rows = _post("/rest/v1/instructors", instructor);
      return rows[0];
    },

    /**
     * Update public.instructors record.
     */
    updateInstructor: function (instructorId, updates) {
      var rows = _patch(
        "/rest/v1/instructors?instructor_id=eq." + instructorId,
        updates,
      );
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * Look up a user by email.
     * @param {string} email
     * @returns {Object|null}  user row or null
     */
    getUserByEmail: function (email) {
      var rows = _get(
        "/rest/v1/users?email=eq." + encodeURIComponent(email) + "&select=*",
      );
      return rows.length > 0 ? rows[0] : null;
    },

    /**
     * Get student record by user_id.
     * @param {string} userId  (uuid)
     * @returns {Object|null}
     */
    getStudentByUserId: function (userId) {
      var rows = _get("/rest/v1/students?user_id=eq." + userId + "&select=*");
      return rows.length > 0 ? rows[0] : null;
    },

    /**
     * Get student record by student_id (with user name).
     * @param {string} studentId (uuid)
     * @returns {Object|null}
     */
    getStudentById: function (studentId) {
      var rows = _get(
        "/rest/v1/students?student_id=eq." +
          studentId +
          "&select=*,user:users(name,email)",
      );
      return rows.length > 0 ? rows[0] : null;
    },

    /**
     * List all students assigned to a specific team leader (as 1 or 2).
     * @param {string} instructorId
     * @returns {Array}
     */
    listStudentsByTeamLeader: function (instructorId) {
      var query =
        "team_leader_1_id.eq." +
        instructorId +
        ",team_leader_2_id.eq." +
        instructorId;
      // also join floor to display it if needed later
      var select = "*,user:users(name,email),floor:floors(label)";
      return _get(
        "/rest/v1/students?or=(" +
          query +
          ")&select=" +
          select +
          "&order=academic_id.asc",
      );
    },

    /**
     * List all students assigned to an instructor as division advisor.
     * @param {string} columnName e.g., 'oper_instructor_id'
     * @param {string} instructorId the UUID of the instructor
     * @returns {Array}
     */
    listStudentsByDivisionInstructor: function (columnName, instructorId) {
      var params = encodeURIComponent(columnName) + "=eq." + instructorId;
      var select = "*,user:users(name,email),floor:floors(label)";
      // Need to catch potential error if the column name is invalid
      try {
        return _get(
          "/rest/v1/students?" +
            params +
            "&select=" +
            select +
            "&order=academic_id.asc",
        );
      } catch (e) {
        console.error("Failed to list advisees for column: " + columnName, e);
        throw new Error("Invalid division column or database error.");
      }
    },

    /**
     * Get instructor record by user_id, including division info.
     * @param {string} userId  (uuid)
     * @returns {Object|null}
     */
    getInstructorByUserId: function (userId) {
      var rows = _get(
        "/rest/v1/instructors?user_id=eq." +
          userId +
          "&select=*,divisions(name,code)",
      );
      return rows.length > 0 ? rows[0] : null;
    },

    /**
     * Get instructor by instructor_id (with user email for notifications).
     * @param {string} instructorId
     * @returns {Object|null}
     */
    getInstructorById: function (instructorId) {
      var rows = _get(
        "/rest/v1/instructors?instructor_id=eq." +
          instructorId +
          "&select=*,users(name,email),divisions(name,code)",
      );
      return rows.length > 0 ? rows[0] : null;
    },

    /**
     * Get division by division_id.
     * @param {string} divisionId (uuid)
     * @returns {Object|null}
     */
    getDivisionById: function (divisionId) {
      var rows = _get(
        "/rest/v1/divisions?division_id=eq." + divisionId + "&select=*",
      );
      return rows.length > 0 ? rows[0] : null;
    },

    /**
     * List all divisions, ordered by name.
     * @returns {Array}
     */
    listDivisions: function () {
      return _getCached("/rest/v1/divisions?select=*&order=name.asc", 3600);
    },

    /**
     * Create public.divisions record.
     */
    createDivision: function (division) {
      var rows = _post("/rest/v1/divisions", division);
      return rows[0];
    },

    /**
     * Update public.divisions record.
     */
    updateDivision: function (divisionId, updates) {
      var rows = _patch(
        "/rest/v1/divisions?division_id=eq." + divisionId,
        updates,
      );
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * List all floors, ordered by label.
     * @returns {Array}
     */
    listFloors: function () {
      return _getCached("/rest/v1/floors?select=*&order=label.asc", 3600);
    },

    /**
     * Create public.floors record.
     */
    createFloor: function (payload) {
      var rows = _post("/rest/v1/floors", payload);
      return rows[0];
    },

    /**
     * Update public.floors record.
     */
    updateFloor: function (id, payload) {
      var rows = _patch("/rest/v1/floors?floor_id=eq." + id, payload);
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * List patients assigned to a student (checking student_id_1...5).
     * @param {string} studentId
     * @returns {Array}
     */
    listPatientsByStudent: function (studentId) {
      // or=(student_id_1.eq.ID,student_id_2.eq.ID,...)
      var query =
        "student_id_1.eq." +
        studentId +
        "," +
        "student_id_2.eq." +
        studentId +
        "," +
        "student_id_3.eq." +
        studentId +
        "," +
        "student_id_4.eq." +
        studentId +
        "," +
        "student_id_5.eq." +
        studentId;

      // Select with nested joins to get Names AND Academic IDs
      // Using !column_name to disambiguate multiple FKs to 'students'
      var select =
        "*" +
        ",s1:students!student_id_1(academic_id, user:users(name))" +
        ",s2:students!student_id_2(academic_id, user:users(name))" +
        ",s3:students!student_id_3(academic_id, user:users(name))" +
        ",s4:students!student_id_4(academic_id, user:users(name))" +
        ",s5:students!student_id_5(academic_id, user:users(name))" +
        ",case_type:type_of_case(type_of_case)" +
        ",inst:instructors(user:users(name))";

      return _get(
        "/rest/v1/patients?or=(" +
          query +
          ")&select=" +
          select +
          "&order=updated_at.desc",
      );
    },

    /**
     * List treatment records for a patient, enriched with Catalog/Step/Division/Phase/Student info.
     * @param {string} patientId
     * @returns {Array}
     */
    listTreatmentRecords: function (patientId) {
      var select =
        "*" +
        ",treatment_phases(phase_name,phase_order)" +
        ",treatment_catalog(treatment_name,division_id,divisions(name,code))" +
        ",requirement_list(requirement_type)" +
        ",treatment_steps(step_name,step_order)" +
        ",student:students!student_id(student_id,user:users(name))";

      return _get(
        "/rest/v1/treatment_records?patient_id=eq." +
          patientId +
          "&select=" +
          select +
          "&order=treatment_phases(phase_order).asc,treatment_order.asc,created_at.asc",
      );
    },

    /**
     * List all treatment phases, ordered by phase_order ascending.
     * @returns {Array}
     */
    listTreatmentPhases: function () {
      return _getCached(
        "/rest/v1/treatment_phases?select=*&order=phase_order.asc",
        3600,
      );
    },

    /**
     * Create public.treatment_phases record.
     */
    createTreatmentPhase: function (payload) {
      var rows = _post("/rest/v1/treatment_phases", payload);
      return rows[0];
    },

    /**
     * Update public.treatment_phases record.
     */
    updateTreatmentPhase: function (id, payload) {
      var rows = _patch("/rest/v1/treatment_phases?phase_id=eq." + id, payload);
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * Delete public.treatment_phases record.
     */
    deleteTreatmentPhase: function (id) {
      return _delete("/rest/v1/treatment_phases?phase_id=eq." + id);
    },

    /**
     * List all treatment catalog entries with division info.
     * @returns {Array}
     */
    listTreatmentCatalog: function () {
      return _getCached(
        "/rest/v1/treatment_catalog?select=*,divisions(name,code)&order=treatment_name.asc",
        900,
      );
    },

    /**
     * Create public.treatment_catalog record.
     */
    createTreatmentCatalog: function (payload) {
      var rows = _post("/rest/v1/treatment_catalog", payload);
      return rows[0];
    },

    /**
     * Update public.treatment_catalog record.
     */
    updateTreatmentCatalog: function (id, payload) {
      var rows = _patch(
        "/rest/v1/treatment_catalog?treatment_id=eq." + id,
        payload,
      );
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * Delete public.treatment_catalog record.
     */
    deleteTreatmentCatalog: function (id) {
      return _delete("/rest/v1/treatment_catalog?treatment_id=eq." + id);
    },

    /**
     * List all treatment steps, ordered by step_order.
     * @returns {Array}
     */
    listAllTreatmentSteps: function () {
      return _getCached(
        "/rest/v1/treatment_steps?select=*,treatment_catalog(treatment_name,division_id,divisions(name))&order=step_order.asc",
        900,
      );
    },

    /**
     * Create public.treatment_steps record.
     */
    createTreatmentStep: function (payload) {
      var rows = _post("/rest/v1/treatment_steps", payload);
      return rows[0];
    },

    /**
     * Update public.treatment_steps record.
     */
    updateTreatmentStep: function (id, payload) {
      var rows = _patch("/rest/v1/treatment_steps?step_id=eq." + id, payload);
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * Delete public.treatment_steps record.
     */
    deleteTreatmentStep: function (id) {
      return _delete("/rest/v1/treatment_steps?step_id=eq." + id);
    },

    /**
     * List all requirements with division info.
     * @returns {Array}
     */
    listRequirements: function () {
      return _getCached(
        "/rest/v1/requirement_list?select=*,divisions(name,code)&order=display_order.asc,requirement_type.asc",
        1200,
      );
    },

    /**
     * Create public.requirement_list record.
     */
    createRequirement: function (payload) {
      var rows = _post("/rest/v1/requirement_list", payload);
      return rows[0];
    },

    /**
     * Update public.requirement_list record.
     */
    updateRequirement: function (id, payload) {
      var rows = _patch(
        "/rest/v1/requirement_list?requirement_id=eq." + id,
        payload,
      );
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * Delete public.requirement_list record.
     */
    deleteRequirement: function (id) {
      return _delete("/rest/v1/requirement_list?requirement_id=eq." + id);
    },

    /**
     * List all type_of_case records.
     */
    listTypeOfCases: function () {
      return _get("/rest/v1/type_of_case?select=*&order=type_of_case.asc");
    },

    /**
     * Resolve Type of Case text to its ID.
     * @param {string} text
     * @returns {string|null} UUID or null
     */
    getTypeOfCaseIdByText: function (text) {
      if (!text) return null;
      var rows = _get(
        "/rest/v1/type_of_case?type_of_case=eq." +
          encodeURIComponent(text) +
          "&select=id",
      );
      return rows && rows.length > 0 ? rows[0].id : null;
    },

    /**
     * Create public.type_of_case record.
     */
    createTypeOfCase: function (payload) {
      var rows = _post("/rest/v1/type_of_case", payload);
      return rows[0];
    },

    /**
     * Update public.type_of_case record.
     */
    updateTypeOfCase: function (id, payload) {
      var rows = _patch("/rest/v1/type_of_case?id=eq." + id, payload);
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * Delete public.type_of_case record.
     */
    deleteTypeOfCase: function (id) {
      return _delete("/rest/v1/type_of_case?id=eq." + id);
    },

    // ──────────────────────────────────────────────
    //  Rotate Clinic Workflow
    // ──────────────────────────────────────────────

    /**
     * List divisions where clinic = 'rotate'.
     */
    listRotateDivisions: function () {
      // Fetch divisions that are enabled for Non-Main-Clinic-Patient entries
      return _get(
        "/rest/v1/divisions?have_non_main_patient_requirements=eq.true&select=*&order=name.asc",
      );
    },

    /**
     * List verified records for a specific student for requirement aggregation.
     * @param {string} studentId
     * @returns {Array}
     */
    listVaultRecordsByStudent: function (studentId) {
      return _get(
        "/rest/v1/treatment_records?student_id=eq." +
          studentId +
          "&status=in.(verified,completed,pending verification,rejected)" +
          "&select=record_id,requirement_id,rsu_units,cda_units,status,is_exam,perio_exams,hn,patient_name,area,patient:patients(hn,name)",
      );
    },

    /**
     * List requirements for a specific division.
     */
    listRequirementsByDivision: function (divisionId) {
      return _get(
        "/rest/v1/requirement_list?division_id=eq." +
          divisionId +
          "&select=*&order=display_order.asc,requirement_type.asc",
      );
    },

    listNonMCRequirementsByDivision: function (divisionId) {
      return _get(
        "/rest/v1/requirement_list?division_id=eq." +
          divisionId +
          "&non_mc_pateint_req=eq.true&select=*&order=requirement_type.asc",
      );
    },

    /**
     * List instructors belonging to a specific division.
     */
    listInstructorsByDivision: function (divisionId) {
      return _get(
        "/rest/v1/instructors?division_id=eq." +
          divisionId +
          "&select=*,user:users(name)&order=user(name).asc",
      );
    },

    /**
     * Create a treatment record for a rotate clinic requirement.
     */
    createTreatmentRecord: function (payload) {
      var rows = _post("/rest/v1/treatment_records", payload);
      return rows[0];
    },

    /**
     * Update treatment record.
     */
    updateTreatmentRecord: function (recordId, updates) {
      var rows = _patch(
        "/rest/v1/treatment_records?record_id=eq." + recordId,
        updates,
      );
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * Delete treatment record.
     */
    deleteTreatmentRecord: function (recordId) {
      var rows = _delete("/rest/v1/treatment_records?record_id=eq." + recordId);
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * Get a single treatment record with necessary joins.
     * @param {string} recordId
     * @returns {Object|null}
     */
    getTreatmentRecord: function (recordId) {
      if (!recordId) return null;
      var select =
        "*,treatment_catalog(treatment_name,division_id),treatment_steps(step_name,step_order),patient:patients(hn,name),student:students(user:users(name)),division:divisions(code,name),requirement:requirement_list(requirement_type)";
      var rows = _get(
        "/rest/v1/treatment_records?record_id=eq." +
          recordId +
          "&select=" +
          select,
      );
      return rows && rows.length > 0 ? rows[0] : null;
    },

    /**
     * Get patient by HN.
     * @param {string} hn
     * @returns {Object|null}
     */
    getPatientByHn: function (hn) {
      var rows = _get(
        "/rest/v1/patients?hn=eq." + encodeURIComponent(hn) + "&select=*",
      );
      return rows && rows.length > 0 ? rows[0] : null;
    },

    /**
     * Create public.patients record.
     * @param {Object} patient
     * @returns {Object}
     */
    createPatient: function (patient) {
      var rows = _post("/rest/v1/patients", patient);
      return rows[0];
    },
    /**
     * Upsert user (Create Auth+Public or Update Public).
     * @param {string} email
     * @param {Object} details {name, role, status}
     * @returns {Object} public.users record
     */
    upsertUser: function (email, details) {
      var existing = this.getUserByEmail(email);
      if (existing) {
        return this.updateUser(existing.user_id, details);
      }

      // Create Auth User first
      // Note: We set a random temp password. User should reset or use generated link.
      // But for instructors synced from sheet, they might use Google Auth,
      // ensuring email matches is key.
      var tempPass = "Temp" + Math.random().toString(36).substring(2) + "!";
      var authRes = this.createAuthUser(email, tempPass, {
        name: details.name,
        role: details.role,
      });

      var userId = authRes.user ? authRes.user.id : authRes.id;
      if (!userId) throw new Error("Failed to create Auth user for " + email);

      // Try creating public user (in case no trigger)
      try {
        var payload = {
          user_id: userId,
          email: email,
          name: details.name,
          role: details.role,
          status: details.status || "active",
        };
        return this.createUser(payload);
      } catch (e) {
        // If creation fails (likely duplicate key from trigger), update instead
        return this.updateUser(userId, details);
      }
    },

    /**
     * Upsert instructor (Create or Update).
     * @param {string} userId
     * @param {Object} data {division_id?, ...}
     * @returns {Object} public.instructors record
     */
    upsertInstructor: function (userId, data) {
      var existing = this.getInstructorByUserId(userId);
      if (existing) {
        return this.updateInstructor(existing.instructor_id, data);
      }
      var payload = data || {};
      payload.user_id = userId;
      return this.createInstructor(payload);
    },

    /**
     * Upsert student (Create or Update).
     * @param {string} userId
     * @param {Object} data {academic_id?, ...}
     * @returns {Object} public.students record
     */
    upsertStudent: function (userId, data) {
      var existing = this.getStudentByUserId(userId);
      if (existing) {
        return this.updateStudent(existing.student_id, data);
      }
      var payload = data || {};
      payload.user_id = userId;
      // Default uuid for student_id if createStudent doesn't handle it (it does in Code.gs but let's check createStudent impl)
      // createStudent in SupabaseProvider takes a student object.
      if (!payload.student_id) payload.student_id = Utilities.getUuid();

      return this.createStudent(payload);
    },
    /**
     * List all students with user details.
     */
    listStudents: function () {
      return _getCached(
        "/rest/v1/students?select=*,users(name,email),floors(label)",
        600,
      );
    },

    /**
     * List treatment records with 'pending verification' status for a set of students.
     * Used by the instructor verification queue.
     * @param {Array<string>} studentIds — UUIDs
     * @returns {Array}
     */
    listPendingRecordsByStudentIds: function (studentIds) {
      if (!studentIds || studentIds.length === 0) return [];
      var inClause = "in.(" + studentIds.join(",") + ")";
      var select = [
        "record_id",
        "student_id",
        "hn",
        "patient_name",
        "area",
        "rsu_units",
        "cda_units",
        "severity",
        "book_number",
        "page_number",
        "is_exam",
        "perio_exams",
        "status",
        "updated_at",
        "treatment_catalog(treatment_name,divisions(name,code))",
        "treatment_steps(step_name)",
        "requirement_list(requirement_type)",
        "patient:patients(hn,name)",
      ].join(",");
      return _get(
        "/rest/v1/treatment_records?student_id=" +
          inClause +
          "&status=eq.pending verification" +
          "&select=" +
          select +
          "&order=updated_at.asc",
      );
    },

    /**
     * Batch-fetch all non-void treatment records for a set of students.
     * Used by the advisor division dashboard to build progress summaries.
     * Batches 40 student IDs per request to stay within URL length limits.
     * @param {Array<string>} studentIds — UUIDs
     * @returns {Array}
     */
    listRecordsForDashboard: function (studentIds) {
      if (!studentIds || studentIds.length === 0) return [];
      var BATCH = 40;
      var results = [];
      var select =
        "record_id,student_id,requirement_id,status,rsu_units,cda_units,is_exam," +
        "treatment_steps(step_name)";
      for (var i = 0; i < studentIds.length; i += BATCH) {
        var batch = studentIds.slice(i, i + BATCH);
        var rows = _get(
          "/rest/v1/treatment_records?student_id=in.(" +
            batch.join(",") +
            ")&status=neq.void&requirement_id=not.is.null&select=" +
            select,
        );
        results = results.concat(rows || []);
      }
      return results;
    },
  };
})();
