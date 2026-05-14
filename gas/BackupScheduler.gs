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
// Grouped by: core auth, structure/lookups, clinical data, oracle analytics
var BACKUP_TABLES = [
  // Core auth & profiles
  { name: "users", key: "user_id" },
  { name: "students", key: "student_id" },
  { name: "instructors", key: "instructor_id" },

  // Structure & lookups
  { name: "divisions", key: "division_id" },
  { name: "floors", key: "floor_id" },
  { name: "treatment_phases", key: "phase_id" },
  { name: "treatment_catalog", key: "treatment_id" },
  { name: "treatment_steps", key: "step_id" },
  { name: "requirement_list", key: "requirement_id" },
  { name: "type_of_case", key: "id" },

  // Clinical data
  { name: "patients", key: "patient_id" },
  { name: "treatment_records", key: "record_id" },

  // Announcements
  { name: "announcements", key: "id" },
  { name: "announcement_dismissals", key: "user_email" },

  // Oracle analytics (oracle schema — requires Accept-Profile header)
  { name: "cohort_calendar", key: "cohort_year", schema: "oracle" },
  { name: "student_progress_snapshots", key: "student_id", schema: "oracle" },
  { name: "explanation_factors", key: "id", schema: "oracle" },
  { name: "recommendations", key: "id", schema: "oracle" },
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
    var sheetName = table.schema ? table.schema + "." + table.name : table.name;
    try {
      // Fetch all rows from Supabase
      var rows = _fetchSupabaseTable(table.name, table.schema);

      if (!rows || rows.length === 0) {
        results.push({ table: sheetName, status: "empty", count: 0 });
        // Clear the sheet but keep headers if sheet exists
        var emptySheet = ss.getSheetByName(sheetName);
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
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
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

      // Clear entire sheet, remove data validation rules, and write fresh data
      sheet.clearContents();
      var fullRange = sheet.getRange(
        1,
        1,
        Math.max(sheet.getMaxRows(), data.length),
        Math.max(sheet.getMaxColumns(), headers.length),
      );
      fullRange.clearDataValidations();
      sheet.getRange(1, 1, data.length, headers.length).setValues(data);

      // Format: bold headers
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");

      results.push({ table: sheetName, status: "ok", count: rows.length });
      Logger.log("Backup OK: " + sheetName + " (" + rows.length + " rows)");
    } catch (e) {
      results.push({ table: sheetName, status: "error", error: e.message });
      Logger.log("Backup FAILED: " + sheetName + " — " + e.message);
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
 * @param {string} [schema] — optional schema name (e.g. "oracle"); defaults to "public"
 * @returns {Array}
 */
function _fetchSupabaseTable(tableName, schema) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL");
  var key = props.getProperty("SUPABASE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_KEY not configured");
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

    var headers = {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };

    // Non-public schemas require Accept-Profile header for PostgREST
    if (schema && schema !== "public") {
      headers["Accept-Profile"] = schema;
    }

    var response = UrlFetchApp.fetch(endpoint, {
      method: "GET",
      headers: headers,
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
//  Drive Backup: Database Dump → ZIP → Google Drive
// ──────────────────────────────────────────────

var DRIVE_BACKUP_FOLDER = "backup-tracker";

/**
 * Get or create the backup folder in Google Drive.
 * @returns {Folder}
 */
function _getBackupFolder() {
  var folders = DriveApp.getFoldersByName(DRIVE_BACKUP_FOLDER);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(DRIVE_BACKUP_FOLDER);
}

/**
 * Dump all Supabase tables to JSON, zip them, and save to Google Drive.
 * Produces three rotation files that replace themselves:
 *   - backup-daily.zip    (replaced every day)
 *   - backup-weekly.zip   (replaced every Sunday)
 *   - backup-monthly.zip  (replaced on the 1st of each month)
 *
 * Call this from the nightly trigger or run manually.
 */
function backupDatabaseToDrive() {
  var now = new Date();
  var folder = _getBackupFolder();

  // 1. Fetch all tables as JSON
  var dump = {};
  var tableResults = [];

  for (var t = 0; t < BACKUP_TABLES.length; t++) {
    var table = BACKUP_TABLES[t];
    var fullName = table.schema ? table.schema + "." + table.name : table.name;
    try {
      var rows = _fetchSupabaseTable(table.name, table.schema);
      dump[fullName] = rows || [];
      tableResults.push({
        table: fullName,
        count: (rows || []).length,
        status: "ok",
      });
    } catch (e) {
      dump[fullName] = [];
      tableResults.push({ table: fullName, status: "error", error: e.message });
      Logger.log(
        "Drive backup: failed to fetch " + fullName + ": " + e.message,
      );
    }
  }

  // 2. Build individual JSON blobs for each table
  var blobs = [];
  for (var tableName in dump) {
    var json = JSON.stringify(dump[tableName], null, 2);
    blobs.push(
      Utilities.newBlob(json, "application/json", tableName + ".json"),
    );
  }

  // 3. Add a manifest with metadata
  var manifest = {
    created_at: now.toISOString(),
    table_count: BACKUP_TABLES.length,
    tables: tableResults,
  };
  blobs.push(
    Utilities.newBlob(
      JSON.stringify(manifest, null, 2),
      "application/json",
      "_manifest.json",
    ),
  );

  // 4. Create ZIP
  var zip = Utilities.zip(blobs, "backup.zip");

  // 5. Determine which rotation files to write
  var filesToWrite = ["backup-daily.zip"]; // always

  if (now.getDay() === 0) {
    // Sunday
    filesToWrite.push("backup-weekly.zip");
  }

  if (now.getDate() === 1) {
    // 1st of month
    filesToWrite.push("backup-monthly.zip");
  }

  // 6. Write/replace each rotation file
  for (var f = 0; f < filesToWrite.length; f++) {
    var fileName = filesToWrite[f];
    _replaceFileInFolder(folder, fileName, zip);
    Logger.log("Drive backup: wrote " + fileName);
  }

  Logger.log(
    "Drive backup complete: " +
      filesToWrite.join(", ") +
      " (" +
      BACKUP_TABLES.length +
      " tables)",
  );
  return {
    files: filesToWrite,
    tables: tableResults,
    folder: folder.getUrl(),
  };
}

/**
 * Replace (or create) a file in the given folder.
 * Deletes existing file with the same name first.
 *
 * @param {Folder} folder
 * @param {string} fileName
 * @param {Blob} blob
 * @returns {File}
 */
function _replaceFileInFolder(folder, fileName, blob) {
  // Delete existing
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }
  // Create new
  blob.setName(fileName);
  return folder.createFile(blob);
}

/**
 * Run both backups: Sheets + Drive.
 * This is the main function called by the nightly trigger.
 */
function runAllBackups() {
  Logger.log("=== Starting nightly backup ===");

  // 1. Sheets backup (failover data)
  try {
    backupAllTablesToSheets();
  } catch (e) {
    Logger.log("Sheets backup failed: " + e.message);
  }

  // 2. Drive backup (ZIP archive)
  try {
    backupDatabaseToDrive();
  } catch (e) {
    Logger.log("Drive backup failed: " + e.message);
  }

  Logger.log("=== Nightly backup complete ===");
}

// ──────────────────────────────────────────────
//  Trigger Management
// ──────────────────────────────────────────────

/**
 * Create a nightly trigger to run all backups at midnight.
 * Run this function ONCE from the GAS editor.
 */
function setupNightlyBackupTrigger() {
  // Remove existing backup triggers first
  removeNightlyBackupTrigger();

  ScriptApp.newTrigger("runAllBackups")
    .timeBased()
    .atHour(0) // midnight
    .everyDays(1)
    .create();

  Logger.log(
    "Nightly backup trigger created. Will run runAllBackups() daily at midnight.",
  );
}

/**
 * Remove all existing backup triggers.
 */
function removeNightlyBackupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var handlerNames = [
    "runAllBackups",
    "backupAllTablesToSheets",
    "backupDatabaseToDrive",
  ];
  for (var i = 0; i < triggers.length; i++) {
    if (handlerNames.indexOf(triggers[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(triggers[i]);
      Logger.log(
        "Removed existing backup trigger: " + triggers[i].getHandlerFunction(),
      );
    }
  }
}
