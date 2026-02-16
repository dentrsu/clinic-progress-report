/**
 * SheetsProvider.gs — Google Sheets fallback data access
 *
 * Mirrors the SupabaseProvider interface so the FailoverProvider
 * can swap transparently. Reads from a Google Spreadsheet where
 * each sheet corresponds to a database table.
 *
 * Expected sheets: users, students, instructors, divisions
 * Each sheet must have a header row matching the column names.
 */

var SheetsProvider = (function () {
  /**
   * Open the fallback spreadsheet.
   * @returns {Spreadsheet}
   */
  function _ss() {
    var id = getFallbackSheetId();
    if (!id)
      throw new Error("FALLBACK_SHEET_ID not configured in Script Properties");
    return SpreadsheetApp.openById(id);
  }

  /**
   * Read all rows from a named sheet and return as array of objects.
   * @param {string} sheetName
   * @returns {Object[]}
   */
  function _readAll(sheetName) {
    var sheet = _ss().getSheetByName(sheetName);
    if (!sheet) return [];
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];

    var headers = data[0].map(function (h) {
      return String(h).trim();
    });
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j]] = data[i][j];
      }
      rows.push(obj);
    }
    return rows;
  }

  /**
   * Append a row to a sheet.
   * @param {string} sheetName
   * @param {Object} rowObj
   * @returns {Object} The inserted object
   */
  function _append(sheetName, rowObj) {
    var sheet = _ss().getSheetByName(sheetName);
    if (!sheet) return null;

    // Get headers
    var headersRange = sheet.getRange(1, 1, 1, sheet.getLastColumn());
    var headers = headersRange.getValues()[0];

    var row = [];
    for (var i = 0; i < headers.length; i++) {
      var key = String(headers[i]).trim();
      var val = rowObj[key];
      // Handle missing values or dates
      if (val === undefined || val === null) {
        val = ""; // Default to empty string for Sheets
      } else if (val instanceof Date) {
        val = val.toISOString();
      }
      row.push(val);
    }

    sheet.appendRow(row);
    return rowObj;
  }

  /**
   * Update a row in a sheet.
   * @param {string} sheetName
   * @param {string} keyCol     Column name to match (e.g. 'user_id')
   * @param {string} keyValue   Value to match
   * @param {Object} updates    Object with keys to update
   * @returns {Object|null}     Updated object or null
   */
  function _update(sheetName, keyCol, keyValue, updates) {
    var sheet = _ss().getSheetByName(sheetName);
    if (!sheet) return null;

    var dataRange = sheet.getDataRange();
    var values = dataRange.getValues();
    if (values.length < 2) return null;

    var headers = values[0].map(function (h) {
      return String(h).trim();
    });
    var keyIndex = headers.indexOf(keyCol);
    if (keyIndex === -1) return null;

    // Find row (1-based index for getRange)
    var rowIndex = -1;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][keyIndex]) === String(keyValue)) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) return null;

    // Update cells
    for (var key in updates) {
      var colIndex = headers.indexOf(key);
      if (colIndex !== -1) {
        var val = updates[key];
        if (val instanceof Date) val = val.toISOString();
        // Set value (rowIndex, colIndex + 1)
        sheet.getRange(rowIndex, colIndex + 1).setValue(val);
      }
    }

    // Return merged object for convenience (re-read or merge in memory)
    return _findOne(sheetName, keyCol, keyValue);
  }

  /**
   * Find the first row in a sheet where column == value.
   * @param {string} sheetName
   * @param {string} column
   * @param {*} value
   * @returns {Object|null}
   */
  function _findOne(sheetName, column, value) {
    var rows = _readAll(sheetName);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][column]) === String(value)) {
        return rows[i];
      }
    }
    return null;
  }

  /**
   * Delete a row from a sheet.
   * @param {string} sheetName
   * @param {string} keyCol
   * @param {string} keyValue
   * @returns {boolean}
   */
  function _delete(sheetName, keyCol, keyValue) {
    var sheet = _ss().getSheetByName(sheetName);
    if (!sheet) return false;

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return false;

    var headers = data[0].map(function (h) {
      return String(h).trim();
    });
    var keyIndex = headers.indexOf(keyCol);
    if (keyIndex === -1) return false;

    // Iterate backwards to safely delete if multiple? (Assuming unique for now)
    // For users/students via ID, it should be unique.
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][keyIndex]) === String(keyValue)) {
        sheet.deleteRow(i + 1);
        return true;
      }
    }
    return false;
  }

  // ──────────────────────────────────────────────
  //  Public interface
  // ──────────────────────────────────────────────

  return {
    /** Health check — just tries to open the spreadsheet */
    ping: function () {
      try {
        _ss();
        return true;
      } catch (e) {
        return false;
      }
    },

    /**
     * Look up a user by email.
     * @param {string} email
     * @returns {Object|null}
     */
    getUserByEmail: function (email) {
      return _findOne("users", "email", email);
    },

    /**
     * Get student record by user_id.
     * @param {string} userId
     * @returns {Object|null}
     */
    getStudentByUserId: function (userId) {
      return _findOne("students", "user_id", userId);
    },

    /**
     * Get instructor record by user_id.
     * Enriches with division data if division_id exists.
     * @param {string} userId
     * @returns {Object|null}
     */
    getInstructorByUserId: function (userId) {
      var instructor = _findOne("instructors", "user_id", userId);
      if (instructor && instructor.division_id) {
        var division = _findOne(
          "divisions",
          "division_id",
          instructor.division_id,
        );
        if (division) {
          instructor.divisions = { name: division.name, code: division.code };
        }
      }
      return instructor;
    },

    /**
     * Get division by division_id.
     * @param {string} divisionId
     * @returns {Object|null}
     */
    getDivisionById: function (divisionId) {
      return _findOne("divisions", "division_id", divisionId);
    },

    // ──────────────────────────────────────────────
    //  Write Interface (Mirrors Supabase)
    // ──────────────────────────────────────────────

    /**
     * Create public.users record.
     */
    createUser: function (user) {
      return _append("users", user);
    },

    /**
     * Update public.users record.
     */
    updateUser: function (userId, updates) {
      return _update("users", "user_id", userId, updates);
    },

    /**
     * Create public.students record.
     */
    createStudent: function (student) {
      return _append("students", student);
    },

    /**
     * Update public.students record.
     */
    updateStudent: function (studentId, updates) {
      return _update("students", "student_id", studentId, updates);
    },

    /**
     * Create public.instructors record.
     */
    createInstructor: function (instructor) {
      return _append("instructors", instructor);
    },

    /**
     * Update public.instructors record.
     */
    updateInstructor: function (instructorId, updates) {
      return _update("instructors", "instructor_id", instructorId, updates);
    },

    /**
     * List all users.
     */
    listUsers: function () {
      return _readAll("users");
    },

    /**
     * Delete public.users record.
     */
    deleteUser: function (userId) {
      return _delete("users", "user_id", userId);
    },

    /**
     * Delete public.students record.
     */
    deleteStudentByUserId: function (userId) {
      return _delete("students", "user_id", userId);
    },

    /**
     * Delete public.instructors record.
     */
    deleteInstructorByUserId: function (userId) {
      return _delete("instructors", "user_id", userId);
    },
  };
})();
