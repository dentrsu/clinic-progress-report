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
     * @returns {Object} auth user object (contains .id)
     */
    createAuthUser: function (email, password) {
      return _post("/auth/v1/admin/users", {
        email: email,
        password: password,
        email_confirm: true,
      });
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
      return _get("/rest/v1/users?select=*&order=created_at.desc");
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
     * Create public.students record.
     */
    createStudent: function (student) {
      var rows = _post("/rest/v1/students", student);
      return rows[0];
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
  };
})();
