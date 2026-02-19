/**
 * Config.gs — Configuration & Script Properties helpers
 *
 * All secrets live in Script Properties (File → Project properties → Script properties).
 * Required keys:
 *   SUPABASE_URL        — e.g. https://xxxxx.supabase.co
 *   SUPABASE_KEY        — service-role key (never exposed to the browser)
 *   FALLBACK_SHEET_ID   — Google Spreadsheet ID for fallback/backup
 */

// ──────────────────────────────────────────────
//  Script Properties accessors
// ──────────────────────────────────────────────

function getSupabaseUrl() {
  return (
    PropertiesService.getScriptProperties().getProperty("SUPABASE_URL") || ""
  );
}

function getSupabaseKey() {
  return (
    PropertiesService.getScriptProperties().getProperty("SUPABASE_KEY") || ""
  );
}

function getFallbackSheetId() {
  return (
    PropertiesService.getScriptProperties().getProperty("FALLBACK_SHEET_ID") ||
    ""
  );
}

function getPatientSheetId() {
  return (
    PropertiesService.getScriptProperties().getProperty("PATIENT_SHEET_ID") ||
    ""
  );
}

function getInstructorSheetId() {
  return (
    PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID") || ""
  );
}

// ──────────────────────────────────────────────
//  Constants
// ──────────────────────────────────────────────

/** Circuit-breaker: max consecutive Supabase failures before switching to Sheets */
var CB_MAX_FAILURES = 3;

/** Circuit-breaker: cooldown period in seconds before retrying Supabase */
var CB_COOLDOWN_SECONDS = 60;

/** Cache keys used by FailoverProvider */
var CACHE_KEY_FAILURE_COUNT = "supabase_failure_count";
var CACHE_KEY_LAST_FAILURE = "supabase_last_failure_ts";
