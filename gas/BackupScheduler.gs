/**
 * BackupScheduler.gs — Nightly Supabase → Google Sheets Backup
 *
 * Reads all data from Supabase and writes it to the fallback
 * Google Spreadsheet. Designed to run as a time-based trigger
 * at midnight daily.
 *
 * Usage:
 *   1. Run setupNightlyBackupTrigger() once from the GAS editor
 *   2. Or run backupAllTablesToSheets() manually to test
 */

// Tables to backup and their primary key columns
var BACKUP_TABLES = [
  { name: "users", key: "user_id" },
  { name: "students", key: "student_id" },
  { name: "instructors", key: "instructor_id" },
  { name: "divisions", key: "division_id" },
  { name: "floors", key: "floor_id" },
  { name: "patients", key: "patient_id" },
  { name: "treatment_records", key: "record_id" },
];

/**
 * Main backup function: reads all Supabase tables and writes to Sheets.
 * Each table gets its own sheet (created if missing).
 */
function backupAllTablesToSheets() {
  var ssId =
    PropertiesService.getScriptProperties().getProperty("FALLBACK_SHEET_ID");
  if (!ssId) {
    Logger.log("BackupScheduler: FALLBACK_SHEET_ID not set. Aborting.");
    return;
  }

  var ss;
  try {
    ss = SpreadsheetApp.openById(ssId);
  } catch (e) {
    Logger.log("BackupScheduler: Cannot open spreadsheet: " + e.message);
    return;
  }

  var results = [];

  for (var t = 0; t < BACKUP_TABLES.length; t++) {
    var table = BACKUP_TABLES[t];
    try {
      // Fetch all rows from Supabase
      var rows = _fetchSupabaseTable(table.name);

      if (!rows || rows.length === 0) {
        results.push({ table: table.name, status: "empty", count: 0 });
        // Clear the sheet but keep headers if sheet exists
        var emptySheet = ss.getSheetByName(table.name);
        if (emptySheet) {
          var lastRow = emptySheet.getLastRow();
          if (lastRow > 1) {
            emptySheet
              .getRange(2, 1, lastRow - 1, emptySheet.getLastColumn())
              .clearContent();
          }
        }
        continue;
      }

      // Get or create the sheet
      var sheet = ss.getSheetByName(table.name);
      if (!sheet) {
        sheet = ss.insertSheet(table.name);
      }

      // Build headers from the first row's keys
      var headers = Object.keys(rows[0]);

      // Build data matrix
      var data = [];
      data.push(headers); // Row 1 = headers

      for (var r = 0; r < rows.length; r++) {
        var rowData = [];
        for (var h = 0; h < headers.length; h++) {
          var val = rows[r][headers[h]];
          // Flatten objects/arrays to JSON strings for Sheets compatibility
          if (val !== null && typeof val === "object") {
            rowData.push(JSON.stringify(val));
          } else if (val === null || val === undefined) {
            rowData.push("");
          } else {
            rowData.push(val);
          }
        }
        data.push(rowData);
      }

      // Clear entire sheet and write fresh data
      sheet.clearContents();
      sheet.getRange(1, 1, data.length, headers.length).setValues(data);

      // Format: bold headers
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");

      results.push({ table: table.name, status: "ok", count: rows.length });
      Logger.log("Backup OK: " + table.name + " (" + rows.length + " rows)");
    } catch (e) {
      results.push({ table: table.name, status: "error", error: e.message });
      Logger.log("Backup FAILED: " + table.name + " — " + e.message);
    }
  }

  // Log summary
  Logger.log("Backup complete: " + JSON.stringify(results));
  return results;
}

/**
 * Fetch all rows from a Supabase table using the REST API.
 * Handles pagination (Supabase default limit is 1000).
 *
 * @param {string} tableName
 * @returns {Array}
 */
function _fetchSupabaseTable(tableName) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_SERVICE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_KEY not configured");
  }

  var allRows = [];
  var limit = 1000;
  var offset = 0;
  var hasMore = true;

  while (hasMore) {
    var endpoint =
      url +
      "/rest/v1/" +
      tableName +
      "?select=*&limit=" +
      limit +
      "&offset=" +
      offset;

    var response = UrlFetchApp.fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      muteHttpExceptions: true,
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      throw new Error(
        "Supabase API error " + code + ": " + response.getContentText(),
      );
    }

    var batch = JSON.parse(response.getContentText());
    if (batch.length === 0) {
      hasMore = false;
    } else {
      allRows = allRows.concat(batch);
      offset += limit;
      // If we got fewer than limit, no more pages
      if (batch.length < limit) {
        hasMore = false;
      }
    }
  }

  return allRows;
}

// ──────────────────────────────────────────────
//  Trigger Management
// ──────────────────────────────────────────────

/**
 * Create a nightly trigger to run backupAllTablesToSheets at midnight.
 * Run this function ONCE from the GAS editor.
 */
function setupNightlyBackupTrigger() {
  // Remove existing backup triggers first
  removeNightlyBackupTrigger();

  ScriptApp.newTrigger("backupAllTablesToSheets")
    .timeBased()
    .atHour(0) // midnight
    .everyDays(1)
    .create();

  Logger.log("Nightly backup trigger created. Will run daily at midnight.");
}

/**
 * Remove all existing backup triggers.
 */
function removeNightlyBackupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "backupAllTablesToSheets") {
      ScriptApp.deleteTrigger(triggers[i]);
      Logger.log("Removed existing backup trigger.");
    }
  }
}
