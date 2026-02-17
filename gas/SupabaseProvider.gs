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
      return _get("/rest/v1/users?select=" + select + "&order=created_at.desc");
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
      return _get("/rest/v1/instructors?select=*,users(name)");
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
      return _get("/rest/v1/divisions?select=*&order=name.asc");
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
      return _get("/rest/v1/floors?select=*&order=label.asc");
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
     * List treatment records for a patient, enriched with Catalog/Step/Division info.
     * @param {string} patientId
     * @returns {Array}
     */
    listTreatmentRecords: function (patientId) {
      var select =
        "*" +
        ",treatment_catalog(treatment_name,divisions(name),requirement_list(requirement_type))" +
        ",treatment_steps(step_name)";

      return _get(
        "/rest/v1/treatment_records?patient_id=eq." +
          patientId +
          "&select=" +
          select +
          "&order=treatment_order.asc,created_at.asc",
      );
    },

    /**
     * Create treatment record.
     */
    createTreatmentRecord: function (record) {
      var rows = _post("/rest/v1/treatment_records", record);
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
  };
})();
