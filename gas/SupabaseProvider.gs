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
   * Helper for robust network calls with exponential backoff.
   */
  function _fetchWithRetry(url, options) {
    var maxRetries = 3;
    var lastError;

    for (var i = 0; i < maxRetries; i++) {
      try {
        var response = UrlFetchApp.fetch(url, options);
        // If it returns a 5xx, we might want to retry as well if they are transient
        if (response.getResponseCode() >= 500 && i < maxRetries - 1) {
          throw new Error(
            "Transient server error: " + response.getResponseCode(),
          );
        }
        return response;
      } catch (e) {
        lastError = e;
        // Check if error is transient (e.g. Address unavailable, Timeout, etc.)
        var msg = e.toString();
        if (
          msg.includes("Address unavailable") ||
          msg.includes("Timeout") ||
          msg.includes("limit exceeded") ||
          msg.includes("Transient")
        ) {
          if (i < maxRetries - 1) {
            var sleepTime = Math.pow(2, i) * 1000 + Math.random() * 500;
            console.warn(
              "Retrying fetch due to error: " + msg + " in " + sleepTime + "ms",
            );
            Utilities.sleep(sleepTime);
            continue;
          }
        }
        throw e;
      }
    }
    throw lastError;
  }

  /**
   * Generic GET helper.
   * @param {string} path  — REST path, e.g. '/rest/v1/users?email=eq.foo'
   * @returns {Array|Object}
   */
  function _get(path) {
    var url = getSupabaseUrl() + path;
    var response = _fetchWithRetry(url, {
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
   * GET helper for the oracle schema.
   * Supabase PostgREST requires Accept-Profile header for non-public schemas.
   */
  function _oracleGet(path) {
    var url = getSupabaseUrl() + path;
    var hdrs = _headers();
    hdrs["Accept-Profile"] = "oracle";
    var response = _fetchWithRetry(url, {
      method: "get",
      headers: hdrs,
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
   * Parallel GET helper for the oracle schema (like _getAll but with Accept-Profile).
   * @param {string[]} paths — array of REST paths
   * @returns {Array[]} — array of parsed results, same order as paths
   */
  function _oracleGetAll(paths) {
    var baseUrl = getSupabaseUrl();
    var hdrs = _headers();
    hdrs["Accept-Profile"] = "oracle";
    var requests = paths.map(function (p) {
      return { url: baseUrl + p, method: "get", headers: hdrs, muteHttpExceptions: true };
    });
    var responses = UrlFetchApp.fetchAll(requests);
    return responses.map(function (resp, i) {
      var code = resp.getResponseCode();
      if (code < 200 || code >= 300) {
        throw new Error("Supabase GET " + paths[i] + " returned " + code + ": " + resp.getContentText());
      }
      return JSON.parse(resp.getContentText());
    });
  }

  /**
   * POST helper for the oracle schema.
   */
  function _oraclePost(path, payload) {
    var url = getSupabaseUrl() + path;
    var hdrs = _headers();
    hdrs["Content-Profile"] = "oracle";
    hdrs["Accept-Profile"] = "oracle";
    hdrs["Prefer"] = "return=representation, resolution=merge-duplicates";
    var response = _fetchWithRetry(url, {
      method: "post",
      headers: hdrs,
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
   * Parallel GET helper — fetches multiple paths in a single batch.
   * @param {string[]} paths — array of REST paths
   * @returns {Array[]} — array of parsed results, same order as paths
   */
  function _getAll(paths) {
    var baseUrl = getSupabaseUrl();
    var hdrs = _headers();
    var requests = paths.map(function (p) {
      return { url: baseUrl + p, method: "get", headers: hdrs, muteHttpExceptions: true };
    });
    var responses = UrlFetchApp.fetchAll(requests);
    return responses.map(function (resp, i) {
      var code = resp.getResponseCode();
      if (code < 200 || code >= 300) {
        throw new Error("Supabase GET " + paths[i] + " returned " + code + ": " + resp.getContentText());
      }
      return JSON.parse(resp.getContentText());
    });
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
    var response = _fetchWithRetry(url, {
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
    var response = _fetchWithRetry(url, {
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
    /** Expose internal helpers for advanced callers */
    _get: _get,
    _getAll: _getAll,
    _getCached: _getCached,

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
    /**
     * Returns users ordered by created_at desc, joined with students to get
     * academic_id for student users.
     *
     * Columns are listed explicitly rather than using `select=*`; the `profile`
     * jsonb column is read nowhere in the app and is unbounded in size.
     *
     * NOTE the default: unlike listStudents(), archived users are INCLUDED
     * unless the caller opts out. Most callers use this to resolve an email to
     * a user_id (the sync routines, adminDeleteUser). Hiding archived users
     * from those lookups would make a returning graduate look like a new
     * account and trigger a duplicate createAuthUser for an email that already
     * exists. Only the Admin Console user list opts out.
     *
     * @param {Object} [opts] {excludeArchived: boolean}
     * @returns {Array}
     */
    listUsers: function (opts) {
      opts = opts || {};
      var select = "user_id,email,name,role,status,students(academic_id)";
      var path =
        "/rest/v1/users?select=" + select + "&order=created_at.desc";
      if (opts.excludeArchived) path += "&status=neq.graduated";

      return _getCached(path, 600);
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
     * Batch-fetch multiple students by their IDs in a single query.
     * @param {string[]} studentIds
     * @returns {Array} rows with user:users(name,email) joined
     */
    listStudentsByIds: function (studentIds) {
      if (!studentIds || studentIds.length === 0) return [];
      return _get(
        "/rest/v1/students?student_id=in.(" +
          studentIds.join(",") +
          ")&select=*,user:users(name,email)",
      );
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
    /**
     * List students where instructorId appears in ANY division instructor column.
     * @param {string} instructorId
     * @returns {Array}
     */
    listStudentsByAnyDivisionInstructor: function (instructorId) {
      var cols = [
        "oper_instructor_id","endo_instructor_id","perio_instructor_id",
        "prosth_instructor_id","diag_instructor_id","radio_instructor_id",
        "sur_instructor_id","ortho_instructor_id","pedo_instructor_id"
      ];
      var orClauses = cols.map(function (c) { return c + ".eq." + instructorId; }).join(",");
      var select = "*,user:users(name,email),floor:floors(label)";
      return _get(
        "/rest/v1/students?or=(" + orClauses + ")&select=" + select + "&order=academic_id.asc"
      ) || [];
    },

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
        ",inst:instructors(user:users(name))" +
        ",complexity";

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
          "&select=record_id,requirement_id,rsu_units,cda_units,status,is_exam,perio_exams,hn,patient_name,area,patient:patients(hn,name,complexity)",
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
      var rec = rows[0];
      if (rec && rec.student_id) {
        this.refreshOracleSnapshot(rec.student_id);
      }
      return rec;
    },

    /**
     * Update treatment record.
     */
    updateTreatmentRecord: function (recordId, updates) {
      var rows = _patch(
        "/rest/v1/treatment_records?record_id=eq." + recordId,
        updates,
      );
      var rec = rows && rows.length ? rows[0] : null;
      if (rec && rec.student_id) {
        this.refreshOracleSnapshot(rec.student_id);
      }
      return rec;
    },

    /**
     * Delete treatment record.
     */
    deleteTreatmentRecord: function (recordId) {
      var existing = this.getTreatmentRecord(recordId);
      var rows = _delete("/rest/v1/treatment_records?record_id=eq." + recordId);
      if (existing && existing.student_id) {
        this.refreshOracleSnapshot(existing.student_id);
      }
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
     * Returns every existing HN as a flat array of strings (no other fields
     * fetched). Used by patient sync to distinguish first-time inserts from
     * updates so a different default status can be applied to new records.
     * NOTE: PostgREST default page size may apply — if patients grows past a
     * few thousand, switch this to a paginated loop using Range headers.
     */
    listAllPatientHns: function () {
      var rows = _get("/rest/v1/patients?select=hn&limit=10000");
      return (rows || [])
        .map(function (r) {
          return r && r.hn ? r.hn : null;
        })
        .filter(Boolean);
    },

    /**
     * Returns the subset of HNs from the input list that already exist in DB.
     * Targeted variant of listAllPatientHns for selected-HN sync — avoids
     * fetching unrelated HNs when only a handful are being synced.
     */
    listExistingHnsIn: function (hnList) {
      if (!hnList || !hnList.length) return [];
      var encoded = hnList
        .map(function (h) {
          return encodeURIComponent(String(h));
        })
        .join(",");
      var rows = _get("/rest/v1/patients?select=hn&hn=in.(" + encoded + ")");
      return (rows || [])
        .map(function (r) {
          return r && r.hn ? r.hn : null;
        })
        .filter(Boolean);
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
     * List students for admin/dashboard views.
     *
     * Columns are listed explicitly rather than using `select=*`: the nine
     * per-division instructor UUIDs are not rendered anywhere in these views
     * and roughly doubled the payload. That matters because CacheService
     * silently refuses to store an item over ~100KB, which would drop the
     * 10-minute cache without any error.
     *
     * Graduated students are excluded by default. They are retained for five
     * years, so this set would otherwise grow by a whole cohort every year.
     *
     * @param {boolean} [includeArchived] include status = 'graduated'
     * @returns {Array}
     */
    listStudents: function (includeArchived) {
      var select = [
        "student_id",
        "user_id",
        "academic_id",
        "first_clinic_year",
        "floor_id",
        "unit_id",
        "team_leader_1_id",
        "team_leader_2_id",
        "status",
        "archived_at",
        "forecast_completion_date",
        "forecast_at",
        "users(name,email,status)",
        "floors(label)",
      ].join(",");

      var path =
        "/rest/v1/students?select=" +
        select +
        "&order=academic_id.asc.nullslast";
      if (!includeArchived) path += "&status=neq.graduated";

      return _getCached(path, 600);
    },

    /**
     * List rotate clinic records (no patient_id) for a specific student and division.
     * @param {string} studentId
     * @param {string} divisionId
     * @returns {Array}
     */
    listRotateRecordsByStudentAndDivision: function (studentId, divisionId) {
      if (!studentId || !divisionId) return [];
      var select = [
        "record_id",
        "student_id",
        "division_id",
        "requirement_id",
        "patient_id",
        "hn",
        "patient_name",
        "area",
        "rsu_units",
        "cda_units",
        "status",
        "created_at",
        "updated_at",
        "treatment_catalog(treatment_name)",
        "requirement_list(requirement_type)",
      ].join(",");
      return _get(
        "/rest/v1/treatment_records?student_id=eq." +
          studentId +
          "&division_id=eq." +
          divisionId +
          "&status=neq.void" +
          "&select=" +
          select +
          "&order=created_at.desc",
      );
    },

    /**
     * List treatment records with 'pending verification' status for a set of students.
     * Used by the instructor verification queue.
     * @param {Array<string>} studentIds — UUIDs
     * @returns {Array}
     */
    /**
     * List all pending verification records assigned to a specific instructor.
     * @param {string} instructorId
     * @returns {Array}
     */
    listPendingRecordsByInstructor: function (instructorId) {
      if (!instructorId) return [];
      var select = [
        "record_id","student_id","hn","patient_name","area",
        "rsu_units","cda_units","severity","book_number","page_number",
        "is_exam","perio_exams","requirement_id","division_id","status","updated_at",
        "treatment_catalog(treatment_name,division_id,divisions(name,code))",
        "treatment_steps(step_name)",
        "requirement_list(requirement_type)",
        "patient:patients(hn,name)",
        "student:students(student_id,academic_id,first_clinic_year,user:users(name,email))"
      ].join(",");
      return _get(
        "/rest/v1/treatment_records?instructor_id=eq." + instructorId +
        "&status=eq.pending verification&select=" + select +
        "&order=updated_at.asc"
      ) || [];
    },

    /**
     * List ALL pending verification records (admin use).
     * @returns {Array}
     */
    listAllPendingRecords: function () {
      var select = [
        "record_id","student_id","hn","patient_name","area",
        "rsu_units","cda_units","severity","book_number","page_number",
        "is_exam","perio_exams","requirement_id","division_id","status","updated_at",
        "treatment_catalog(treatment_name,division_id,divisions(name,code))",
        "treatment_steps(step_name)",
        "requirement_list(requirement_type)",
        "patient:patients(hn,name)",
        "student:students(student_id,academic_id,first_clinic_year,user:users(name,email))"
      ].join(",");
      return _get(
        "/rest/v1/treatment_records?status=eq.pending verification&select=" + select +
        "&order=updated_at.asc"
      ) || [];
    },

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
        "requirement_id",
        "division_id",
        "status",
        "updated_at",
        "treatment_catalog(treatment_name,division_id,divisions(name,code))",
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
    // ── Announcements ──────────────────────────────────────────────────────

    /**
     * List all announcements ordered newest first (admin).
     */
    listAnnouncements: function () {
      return _getCached(
        "/rest/v1/announcements?select=*&order=created_at.desc",
        60,
      );
    },

    /**
     * Get the best active announcement for a given role.
     * Filters date range in JS so no complex PostgREST OR is needed.
     * @param {string} role — 'student' | 'instructor'
     * @returns {Object|null}
     */
    getActiveAnnouncementForRole: function (role) {
      var rows = _get(
        "/rest/v1/announcements?select=*&is_active=eq.true&order=created_at.desc",
      );
      if (!rows || rows.length === 0) return null;
      var now = new Date();
      return (
        rows.find(function (a) {
          if (a.start_date && new Date(a.start_date) > now) return false;
          if (a.end_date && new Date(a.end_date) < now) return false;
          return (
            a.target_audience === "both" ||
            a.target_audience === role ||
            role === "admin"
          );
        }) || null
      );
    },

    /**
     * Create a new announcement.
     */
    createAnnouncement: function (data) {
      return _post("/rest/v1/announcements", data);
    },

    ping: function () {
      return _get("/rest/v1/users?select=count");
    },

    /**
     * List all students in the system.
     */


    /**
     * Update an announcement by id.
     */
    updateAnnouncement: function (id, data) {
      return _patch(
        "/rest/v1/announcements?id=eq." + encodeURIComponent(id),
        data,
      );
    },

    /**
     * Insert a dismissal record for a user and announcement.
     * Fails silently if table doesn't exist yet to prevent breaking app.
     */
    saveDismissal: function (email, annId) {
      try {
        var payload = { user_email: email, announcement_id: annId };
        return _post("/rest/v1/announcement_dismissals", payload);
      } catch (e) {
        Logger.log("saveDismissal error: " + e.message);
        return null;
      }
    },

    /**
     * Check if a user has dismissed a given announcement.
     * Returns false if table is missing or query fails.
     */
    hasDismissed: function (email, annId) {
      try {
        var rows = _get(
          "/rest/v1/announcement_dismissals?user_email=eq." +
            encodeURIComponent(email) +
            "&announcement_id=eq." +
            encodeURIComponent(annId),
        );
        return rows && rows.length > 0;
      } catch (e) {
        Logger.log("hasDismissed error: " + e.message);
        return false;
      }
    },

    /**
     * Delete an announcement by id.
     */
    deleteAnnouncement: function (id) {
      return _delete("/rest/v1/announcements?id=eq." + encodeURIComponent(id));
    },

    // ── Beta feedback ──────────────────────────────────────────────────────

    /**
     * Insert a beta feedback row. Returns the created row.
     */
    insertBetaFeedback: function (payload) {
      var rows = _post("/rest/v1/beta_feedback", payload);
      return rows && rows.length ? rows[0] : null;
    },

    /**
     * List all beta feedback (admin), newest first.
     */
    listBetaFeedback: function () {
      return _get(
        "/rest/v1/beta_feedback?select=*&order=created_at.desc",
      );
    },

    /**
     * Delete a beta feedback row by id (admin).
     */
    deleteBetaFeedback: function (id) {
      return _delete(
        "/rest/v1/beta_feedback?id=eq." + encodeURIComponent(id),
      );
    },

    // ── Dashboard records ──────────────────────────────────────────────────

    listRecordsForDashboard: function (studentIds) {
      if (!studentIds || studentIds.length === 0) return [];
      var BATCH = 50;
      var select =
        "record_id,student_id,requirement_id,status,rsu_units,cda_units,is_exam," +
        "treatment_steps(step_name)";
      // Build all batch paths
      var paths = [];
      for (var i = 0; i < studentIds.length; i += BATCH) {
        var batch = studentIds.slice(i, i + BATCH);
        paths.push(
          "/rest/v1/treatment_records?student_id=in.(" +
            batch.join(",") +
            ")&status=neq.void&requirement_id=not.is.null&select=" +
            select
        );
      }
      // Fetch all batches in parallel
      if (paths.length === 1) return _get(paths[0]) || [];
      var allResults = _getAll(paths);
      var results = [];
      for (var j = 0; j < allResults.length; j++) {
        results = results.concat(allResults[j] || []);
      }
      return results;
    },

    // ── Oracle Analytics Layer ──────────────────────────────────────────────────

    /**
     * Trigger Oracle computation RPC for a student.
     * @param {string} studentId
     */
    refreshOracleSnapshot: function (studentId) {
      if (!studentId) return null;
      var url = getSupabaseUrl() + "/rest/v1/rpc/oracle_refresh_student";
      var payload = { p_student_id: studentId };
      var hdrs = _headers();
      hdrs["Content-Profile"] = "oracle";
      var response = UrlFetchApp.fetch(url, {
        method: "post",
        headers: hdrs,
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });

      var code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        console.error(
          "Supabase RPC oracle_refresh_student failed",
          response.getContentText(),
        );
      }
      return true;
    },

    /**
     * Get the student's primary Oracle snapshot summary.
     */
    getOracleStudentSnapshot: function (studentId) {
      if (!studentId) return null;
      var rows = _oracleGet(
        "/rest/v1/student_progress_snapshots?student_id=eq." + studentId,
      );
      if (!rows || rows.length === 0) return null;
      var s = rows[0];
      return {
        ...s,
        progress_score: s.verified_completion_pct
          ? Math.round(s.verified_completion_pct * 100)
          : 0,
        velocity_30d: s.verified_velocity_4w || 0,
        forecast_completion_date: s.forecast_completion_month,
        last_calculated_at: s.snapshot_at,
        risk_level:
          {
            green: "On Track",
            yellow: "At Risk",
            orange: "High Risk",
            red: "Critical",
          }[s.risk_level] || s.risk_level,
      };
    },

    /**
     * List Oracle snapshots for multiple students (e.g. team leader view)
     */
    listOracleSnapshots: function (studentIds) {
      if (!studentIds || studentIds.length === 0) return [];
      var BATCH = 40;
      var results = [];
      for (var i = 0; i < studentIds.length; i += BATCH) {
        var batch = studentIds.slice(i, i + BATCH);
        var rows = _oracleGet(
          "/rest/v1/student_progress_snapshots?student_id=in.(" +
            batch.join(",") +
            ")",
        );
        (rows || []).forEach(function (s) {
          results.push({
            ...s,
            progress_score: s.verified_completion_pct
              ? Math.round(s.verified_completion_pct * 100)
              : 0,
            velocity_30d: s.verified_velocity_4w || 0,
            forecast_completion_date: s.forecast_completion_month,
            last_calculated_at: s.snapshot_at,
            risk_level:
              {
                green: "On Track",
                yellow: "At Risk",
                orange: "High Risk",
                red: "Critical",
              }[s.risk_level] || s.risk_level,
          });
        });
      }
      return results;
    },

    /**
     * Get Oracle generated explanations for the student risk score.
     */
    getOracleStudentExplanations: function (studentId) {
      if (!studentId) return [];
      var rows = _oracleGet(
        "/rest/v1/explanation_factors?student_id=eq." +
          studentId +
          "&order=display_order.asc",
      );
      return (rows || []).map(function (e) {
        return {
          ...e,
          factor_name: e.factor_label,
          description: e.factor_code,
          impact_score: e.severity * -1,
        };
      });
    },

    /**
     * Get next-action recommendations.
     */
    getOracleStudentRecommendations: function (studentId) {
      if (!studentId) return [];
      var rows = _oracleGet(
        "/rest/v1/recommendations?student_id=eq." +
          studentId +
          "&order=priority_rank.asc",
      );
      return (rows || []).map(function (r) {
        return {
          ...r,
          action_type: r.recommendation_type,
          description: r.message,
        };
      });
    },

    /**
     * Fetch snapshot + explanations + recommendations in one parallel batch.
     * @param {string} studentId
     * @returns {{ snapshot: object|null, explanations: Array, recommendations: Array }}
     */
    getOracleDashboardBatch: function (studentId) {
      if (!studentId) return { snapshot: null, explanations: [], recommendations: [] };
      var paths = [
        "/rest/v1/student_progress_snapshots?student_id=eq." + studentId,
        "/rest/v1/explanation_factors?student_id=eq." + studentId + "&order=display_order.asc",
        "/rest/v1/recommendations?student_id=eq." + studentId + "&order=priority_rank.asc",
      ];
      var results = _oracleGetAll(paths);
      var snapRows = results[0] || [];
      var explRows = results[1] || [];
      var recRows = results[2] || [];

      var snapshot = null;
      if (snapRows.length > 0) {
        var s = snapRows[0];
        snapshot = {
          ...s,
          progress_score: s.verified_completion_pct ? Math.round(s.verified_completion_pct * 100) : 0,
          velocity_30d: s.verified_velocity_4w || 0,
          forecast_completion_date: s.forecast_completion_month,
          last_calculated_at: s.snapshot_at,
          risk_level: { green: "On Track", yellow: "At Risk", orange: "High Risk", red: "Critical" }[s.risk_level] || s.risk_level,
        };
      }

      var explanations = explRows.map(function (e) {
        return { ...e, factor_name: e.factor_label, description: e.factor_code, impact_score: e.severity * -1 };
      });

      var recommendations = recRows.map(function (r) {
        return { ...r, action_type: r.recommendation_type, description: r.message };
      });

      return { snapshot: snapshot, explanations: explanations, recommendations: recommendations };
    },

    /**
     * List all cohort calendars.
     */
    listCohortCalendars: function () {
      return _oracleGet("/rest/v1/cohort_calendar?order=cohort_year.desc");
    },

    /**
     * Upsert a cohort calendar.
     */
    upsertCohortCalendar: function (data) {
      return _oraclePost("/rest/v1/cohort_calendar", data);
    },

    /**
     * Delete a cohort calendar.
     */
    deleteCohort: function (cohortYear) {
      var hdrs = _headers();
      hdrs["Content-Profile"] = "oracle";
      hdrs["Accept-Profile"] = "oracle";
      var url =
        getSupabaseUrl() +
        "/rest/v1/cohort_calendar?cohort_year=eq." +
        cohortYear;
      var response = UrlFetchApp.fetch(url, {
        method: "delete",
        headers: hdrs,
        muteHttpExceptions: true,
      });
      var code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        throw new Error(
          "Supabase DELETE cohort_calendar returned " +
            code +
            ": " +
            response.getContentText(),
        );
      }
      _invalidateCache();
      return true;
    },
  };
})();
