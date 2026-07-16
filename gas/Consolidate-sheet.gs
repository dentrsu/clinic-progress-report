/**
 * Consolidates treatment_records with lookup data from related sheets
 * into a single "Consolidated" sheet. Uses upsert logic on record_id.
 *
 * Lookups:
 *   patient_id   → patients (hn, name, birthdate, tel, status, complexity, type_of_case)
 *   division_id  → divisions (code, name)
 *   treatment_id → treatment_catalog (treatment_name)
 *   step_id      → treatment_steps (step_name)
 *   student_id   → students → users (student name)
 *   instructor_id→ instructors → users (instructor name)
 *   phase_id     → treatment_phases (phase_name)
 *   requirement_id → requirement_list (requirement_type)
 *   type_of_case → type_of_case (type_of_case label)
 */

// ─── Configuration ──────────────────────────────────────────────────────────────

var CONFIG = {
  SOURCE_SHEET: 'treatment_records',
  OUTPUT_SHEET: 'Consolidated',
  BATCH_SIZE: 500 // rows per flush when writing
};

// The columns that will appear in the consolidated sheet
var OUTPUT_HEADERS = [
  'record_id',
  'patient_id',
  'patient_hn',
  'patient_name',
  'patient_birthdate',
  'patient_tel',
  'patient_status',
  'patient_complexity',
  'patient_type_of_case',
  'type_of_case_label',
  'student_id',
  'student_name',
  'instructor_id',
  'instructor_name',
  'division_id',
  'division_code',
  'division_name',
  'treatment_id',
  'treatment_name',
  'step_id',
  'step_name',
  'phase_id',
  'phase_name',
  'requirement_id',
  'requirement_type',
  'status',
  'rsu_units',
  'cda_units',
  'treatment_order',
  'area',
  'start_date',
  'complete_date',
  'severity',
  'book_number',
  'page_number',
  'hn',
  'is_exam',
  'perio_exams',
  'verified_at',
  'verified_by',
  'created_at',
  'updated_at'
];

// ─── Entry Point ────────────────────────────────────────────────────────────────

function consolidateTreatmentRecords() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var startTime = new Date();
  Logger.log('=== Consolidation started at ' + startTime.toISOString() + ' ===');

  // 1. Build all lookup maps
  var lookups = buildLookupMaps_(ss);

  // 2. Read treatment_records
  var records = readSheetAsObjects_(ss, CONFIG.SOURCE_SHEET);
  Logger.log('Treatment records to process: ' + records.length);

  // 3. Build consolidated rows
  var consolidatedRows = records.map(function(rec) {
    return buildConsolidatedRow_(rec, lookups);
  });

  // 4. Upsert into the Consolidated sheet
  upsertToSheet_(ss, consolidatedRows);

  var elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  Logger.log('=== Consolidation finished in ' + elapsed + 's — ' + consolidatedRows.length + ' records processed ===');
}

// ─── Lookup Map Builders ────────────────────────────────────────────────────────

function buildLookupMaps_(ss) {
  Logger.log('Building lookup maps...');

  var patients       = buildMap_(ss, 'patients',          'patient_id');
  var divisions      = buildMap_(ss, 'divisions',         'division_id');
  var treatments     = buildMap_(ss, 'treatment_catalog', 'treatment_id');
  var steps          = buildMap_(ss, 'treatment_steps',   'step_id');
  var phases         = buildMap_(ss, 'treatment_phases',  'phase_id');
  var requirements   = buildMap_(ss, 'requirement_list',  'requirement_id');
  var typeOfCase     = buildMap_(ss, 'type_of_case',      'id');
  var students       = buildMap_(ss, 'students',          'student_id');
  var instructors    = buildMap_(ss, 'instructors',       'instructor_id');
  var users          = buildMap_(ss, 'users',             'user_id');

  // Pre-resolve student_id → user name and instructor_id → user name
  var studentNameMap = {};
  Object.keys(students).forEach(function(sid) {
    var uid = String(students[sid]['user_id'] || '');
    studentNameMap[sid] = (users[uid] || {})['name'] || '';
  });

  var instructorNameMap = {};
  Object.keys(instructors).forEach(function(iid) {
    var uid = String(instructors[iid]['user_id'] || '');
    instructorNameMap[iid] = (users[uid] || {})['name'] || '';
  });

  Logger.log('Lookup maps ready.');

  return {
    patients: patients,
    divisions: divisions,
    treatments: treatments,
    steps: steps,
    phases: phases,
    requirements: requirements,
    typeOfCase: typeOfCase,
    studentNames: studentNameMap,
    instructorNames: instructorNameMap
  };
}

/**
 * Reads a sheet into a map keyed by the given column.
 * Returns { "keyValue": { col1: val1, col2: val2, ... }, ... }
 */
function buildMap_(ss, sheetName, keyColumn) {
  var rows = readSheetAsObjects_(ss, sheetName);
  var map = {};
  rows.forEach(function(row) {
    var key = String(row[keyColumn] || '');
    if (key !== '') {
      map[key] = row;
    }
  });
  Logger.log('  ' + sheetName + ': ' + Object.keys(map).length + ' entries');
  return map;
}

// ─── Row Builder ────────────────────────────────────────────────────────────────

function buildConsolidatedRow_(rec, lk) {
  var patientId    = String(rec['patient_id'] || '');
  var divisionId   = String(rec['division_id'] || '');
  var treatmentId  = String(rec['treatment_id'] || '');
  var stepId       = String(rec['step_id'] || '');
  var studentId    = String(rec['student_id'] || '');
  var instructorId = String(rec['instructor_id'] || '');
  var phaseId      = String(rec['phase_id'] || '');
  var requirementId = String(rec['requirement_id'] || '');

  var patient   = lk.patients[patientId] || {};
  var division  = lk.divisions[divisionId] || {};
  var treatment = lk.treatments[treatmentId] || {};
  var step      = lk.steps[stepId] || {};
  var phase     = lk.phases[phaseId] || {};
  var req       = lk.requirements[requirementId] || {};

  // type_of_case lookup: from the patient's type_of_case value
  var tocKey    = String(patient['type_of_case'] || '');
  var toc       = lk.typeOfCase[tocKey] || {};

  return [
    rec['record_id'],
    patientId,
    patient['hn'] || '',
    patient['name'] || '',
    patient['birthdate'] || '',
    patient['tel'] || '',
    patient['status'] || '',
    patient['complexity'] || '',
    patient['type_of_case'] || '',
    toc['type_of_case'] || '',
    studentId,
    lk.studentNames[studentId] || '',
    instructorId,
    lk.instructorNames[instructorId] || '',
    divisionId,
    division['code'] || '',
    division['name'] || '',
    treatmentId,
    treatment['treatment_name'] || '',
    stepId,
    step['step_name'] || '',
    phaseId,
    phase['phase_name'] || '',
    requirementId,
    req['requirement_type'] || '',
    rec['status'] || '',
    rec['rsu_units'] || '',
    rec['cda_units'] || '',
    rec['treatment_order'] || '',
    rec['area'] || '',
    rec['start_date'] || '',
    rec['complete_date'] || '',
    rec['severity'] || '',
    rec['book_number'] || '',
    rec['page_number'] || '',
    rec['hn'] || '',
    rec['is_exam'] || '',
    rec['perio_exams'] || '',
    rec['verified_at'] || '',
    rec['verified_by'] || '',
    rec['created_at'] || '',
    rec['updated_at'] || ''
  ];
}

// ─── Upsert Logic ───────────────────────────────────────────────────────────────

function upsertToSheet_(ss, newRows) {
  var sheet = ss.getSheetByName(CONFIG.OUTPUT_SHEET);

  // Create the sheet if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.OUTPUT_SHEET);
    sheet.appendRow(OUTPUT_HEADERS);
    sheet.getRange(1, 1, 1, OUTPUT_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#4a86c8')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    Logger.log('Created new sheet: ' + CONFIG.OUTPUT_SHEET);
  }

  // Read existing record_ids (column A, starting row 2) into a map: record_id → row number
  var lastRow = sheet.getLastRow();
  var existingMap = {}; // { record_id: spreadsheet_row_number }

  if (lastRow >= 2) {
    var existingIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < existingIds.length; i++) {
      var id = String(existingIds[i][0]);
      if (id !== '') {
        existingMap[id] = i + 2; // +2 because row 1 = header, array is 0-based
      }
    }
  }

  Logger.log('Existing records in Consolidated: ' + Object.keys(existingMap).length);

  var rowsToAppend = [];
  var updateCount = 0;

  for (var r = 0; r < newRows.length; r++) {
    var row = newRows[r];
    var recordId = String(row[0]);

    if (existingMap.hasOwnProperty(recordId)) {
      // UPDATE: overwrite the existing row in-place
      var targetRow = existingMap[recordId];
      sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
      updateCount++;
    } else {
      // INSERT: queue for batch append
      rowsToAppend.push(row);
    }
  }

  // Batch-append new rows
  if (rowsToAppend.length > 0) {
    var appendStart = sheet.getLastRow() + 1;
    sheet.getRange(appendStart, 1, rowsToAppend.length, OUTPUT_HEADERS.length)
      .setValues(rowsToAppend);
  }

  Logger.log('Upsert complete — Updated: ' + updateCount + ', Inserted: ' + rowsToAppend.length);
}

// ─── Sheet Reader Utility ───────────────────────────────────────────────────────

/**
 * Reads an entire sheet into an array of objects keyed by header names.
 * Returns [] if the sheet is empty or missing.
 */
function readSheetAsObjects_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log('WARNING: Sheet "' + sheetName + '" not found.');
    return [];
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return []; // header only or empty

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var objects = [];

  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    objects.push(obj);
  }

  return objects;
}

// ─── Menu (optional convenience) ────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ Data Tools')
    .addItem('Consolidate Treatment Records', 'consolidateTreatmentRecords')
    .addToUi();
}