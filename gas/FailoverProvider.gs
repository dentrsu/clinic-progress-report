/**
 * FailoverProvider.gs — Circuit breaker + health check + provider switching
 *
 * Wraps SupabaseProvider and SheetsProvider behind a unified interface.
 * Uses CacheService to track Supabase health state across requests.
 *
 * Circuit-breaker logic:
 *   1. Try Supabase first.
 *   2. On failure, increment failure counter.
 *   3. If failures >= CB_MAX_FAILURES, enter "open" state (use Sheets).
 *   4. After CB_COOLDOWN_SECONDS, try Supabase again ("half-open").
 *   5. If it succeeds, reset counter; if it fails, stay open.
 */

var FailoverProvider = (function () {
  var cache = CacheService.getScriptCache();

  // ──────────────────────────────────────────────
  //  Circuit-breaker state management
  // ──────────────────────────────────────────────

  function _getFailureCount() {
    var v = cache.get(CACHE_KEY_FAILURE_COUNT);
    return v ? parseInt(v, 10) : 0;
  }

  function _setFailureCount(n) {
    cache.put(CACHE_KEY_FAILURE_COUNT, String(n), 600); // TTL 10 min
  }

  function _getLastFailureTs() {
    var v = cache.get(CACHE_KEY_LAST_FAILURE);
    return v ? parseInt(v, 10) : 0;
  }

  function _setLastFailureTs(ts) {
    cache.put(CACHE_KEY_LAST_FAILURE, String(ts), 600);
  }

  function _recordFailure() {
    var count = _getFailureCount() + 1;
    _setFailureCount(count);
    _setLastFailureTs(Date.now());
    return count;
  }

  function _resetCircuit() {
    _setFailureCount(0);
  }

  /**
   * Determine current circuit state.
   * @returns {'closed'|'open'|'half-open'}
   *   closed    = Supabase is healthy, use it
   *   open      = too many failures, use Sheets
   *   half-open = cooldown expired, try Supabase again
   */
  function _circuitState() {
    var failures = _getFailureCount();
    if (failures < CB_MAX_FAILURES) return "closed";

    var elapsed = (Date.now() - _getLastFailureTs()) / 1000;
    if (elapsed >= CB_COOLDOWN_SECONDS) return "half-open";

    return "open";
  }

  // ──────────────────────────────────────────────
  //  Provider selection
  // ──────────────────────────────────────────────

  /**
   * Returns which data source is currently active.
   * @returns {'supabase'|'sheets'}
   */
  function getActiveSource() {
    return _circuitState() === "open" ? "sheets" : "supabase";
  }

  /**
   * Execute `fn` against Supabase first; fall back to Sheets on failure.
   *
   * @param {string} methodName — name of the method on both providers
   * @param {Array} args        — arguments to pass
   * @returns {*}
   */
  function _call(methodName, args) {
    var state = _circuitState();

    // Circuit open → go straight to Sheets
    if (state === "open") {
      return {
        source: "sheets",
        data: SheetsProvider[methodName].apply(null, args),
      };
    }

    // Closed or half-open → try Supabase
    try {
      var result = SupabaseProvider[methodName].apply(null, args);
      // Success → reset circuit if we were half-open
      if (state === "half-open") _resetCircuit();
      return { source: "supabase", data: result };
    } catch (e) {
      var count = _recordFailure();
      Logger.log(
        "FailoverProvider: Supabase." +
          methodName +
          " failed (count=" +
          count +
          "): " +
          e.message,
      );
      // Fall back to Sheets
      return {
        source: "sheets",
        data: SheetsProvider[methodName].apply(null, args),
      };
    }
  }

  /**
   * Execute `fn` against Supabase first; if success, MIRROR to Sheets.
   * If Supabase fails, FALLBACK to Sheets.
   *
   * @param {string} methodName
   * @param {Array} args
   * @returns {*}
   */
  function _dualWrite(methodName, args) {
    var state = _circuitState();

    // Circuit Open → Sheets only (Fallback)
    if (state === "open") {
      return {
        source: "sheets",
        data: SheetsProvider[methodName].apply(null, args),
      };
    }

    // Try Supabase (Primary)
    try {
      var result = SupabaseProvider[methodName].apply(null, args);

      // Success → Mirror to Sheets (Best effort)
      if (state === "half-open") _resetCircuit();
      try {
        SheetsProvider[methodName].apply(null, args);
      } catch (e) {
        Logger.log(
          "FailoverProvider: Mirror write to Sheets failed (" +
            methodName +
            "): " +
            e.message,
        );
      }

      return { source: "supabase", data: result };
    } catch (e) {
      // Supabase failed → Record failure & Fallback
      var count = _recordFailure();
      Logger.log(
        "FailoverProvider: Supabase write failed (" +
          methodName +
          "): " +
          e.message,
      );
      return {
        source: "sheets",
        data: SheetsProvider[methodName].apply(null, args),
      };
    }
  }

  // ──────────────────────────────────────────────
  //  Public interface (mirrors provider methods)
  // ──────────────────────────────────────────────

  return {
    getActiveSource: getActiveSource,

    // Reads (Load Balancing / Fallback)
    getUserByEmail: function (email) {
      return _call("getUserByEmail", [email]);
    },
    getStudentByUserId: function (userId) {
      return _call("getStudentByUserId", [userId]);
    },
    getInstructorByUserId: function (userId) {
      return _call("getInstructorByUserId", [userId]);
    },
    getDivisionById: function (divisionId) {
      return _call("getDivisionById", [divisionId]);
    },
    listUsers: function () {
      return _call("listUsers", []);
    },

    // Writes (Dual Write / Fallback)
    createUser: function (user) {
      return _dualWrite("createUser", [user]);
    },
    updateUser: function (id, data) {
      return _dualWrite("updateUser", [id, data]);
    },

    createStudent: function (data) {
      return _dualWrite("createStudent", [data]);
    },
    updateStudent: function (id, data) {
      return _dualWrite("updateStudent", [id, data]);
    },

    createInstructor: function (data) {
      return _dualWrite("createInstructor", [data]);
    },
    updateInstructor: function (id, data) {
      return _dualWrite("updateInstructor", [id, data]);
    },

    /**
     * Special handling for Auth User creation.
     * Sheets doesn't have an Auth table, so we simulate an ID if Supabase is down.
     */
    createAuthUser: function (email, password) {
      var state = _circuitState();

      if (state !== "open") {
        try {
          var authUser = SupabaseProvider.createAuthUser(email, password);
          if (state === "half-open") _resetCircuit();
          return { source: "supabase", data: authUser }; // Contains .id
        } catch (e) {
          _recordFailure();
          Logger.log("Failover: createAuthUser failed: " + e.message);
        }
      }

      // Fallback: Generate UUID locally
      return {
        source: "sheets",
        data: { id: Utilities.getUuid(), email: email, mocked: true },
      };
    },

    /**
     * Special handling for Auth User deletion.
     */
    deleteAuthUser: function (userId) {
      var state = _circuitState();
      if (state !== "open") {
        try {
          SupabaseProvider.deleteAuthUser(userId);
          if (state === "half-open") _resetCircuit();
          return { source: "supabase", success: true };
        } catch (e) {
          _recordFailure();
          Logger.log("Failover: deleteAuthUser failed: " + e.message);
        }
      }
      return { source: "sheets", success: true }; // No-op for Sheets
    },

    /**
     * Fully delete a user from Auth and DB (mirroring to Sheets).
     */
    deleteFullUser: function (userId, role) {
      // 1. Delete Auth (Supabase)
      this.deleteAuthUser(userId);

      // 2. Delete Public Data (Supabase - optional if cascade works, but good for safety)
      var state = _circuitState();
      if (state !== "open") {
        try {
          if (role === "student")
            SupabaseProvider.deleteStudentByUserId(userId);
          else if (role === "instructor" || role === "admin")
            SupabaseProvider.deleteInstructorByUserId(userId);
          SupabaseProvider.deleteUser(userId);
        } catch (e) {
          // Ignore if already deleted by cascade
          Logger.log(
            "Failover: Supabase public delete failed (likely cascade?): " +
              e.message,
          );
        }
      }

      // 3. Delete from Sheets (Manual Cascade)
      try {
        if (role === "student") SheetsProvider.deleteStudentByUserId(userId);
        else if (role === "instructor" || role === "admin")
          SheetsProvider.deleteInstructorByUserId(userId);
        SheetsProvider.deleteUser(userId);
      } catch (e) {
        Logger.log("Failover: Sheets delete failed: " + e.message);
      }

      return { success: true };
    },

    /**
     * Explicitly check Supabase health and return the result.
     * @returns {{ healthy: boolean, source: string }}
     */
    healthCheck: function () {
      try {
        var ok = SupabaseProvider.ping();
        if (ok) _resetCircuit();
        return { healthy: ok, source: ok ? "supabase" : "sheets" };
      } catch (e) {
        _recordFailure();
        return { healthy: false, source: "sheets" };
      }
    },
  };
})();
