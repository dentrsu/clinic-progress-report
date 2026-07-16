/**
 * Create Google Sheets "tables" that mirror your Supabase schema.
 * - Each table becomes a Sheet
 * - Row 1 becomes the header row (column names)
 * - Optional: enum-like columns get dropdown validation
 */
function createSchemaSheets_fromDDL() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ---- Define "tables" (sheet name + columns)
  const tables = [
    {
      name: "users",
      columns: ["user_id", "email", "name", "role", "status"],
      enums: {
        role: ["student", "instructor", "admin"],
        status: ["active", "inactive", "blocked"], // adjust to your real user_status values
      },
    },
    {
      name: "students",
      columns: ["student_id", "user_id", "first_clinic_year"],
    },
    {
      name: "instructors",
      columns: ["instructor_id", "user_id", "division_id"],
    },
    {
      name: "treatment_catalog",
      columns: ["treatment_id", "division_id", "treatment_name"],
    },
    {
      name: "treatment_steps",
      columns: ["step_id", "treatment_id", "step_order", "step_name"],
    },
    {
      name: "treatment_records",
      columns: [
        "record_id",
        "patient_id",
        "student_id",
        "treatment_id",
        "step_id",
        "status",
        "rsu_units",
        "verified_by",
      ],
      enums: {
        status: ["planned", "in_progress", "completed", "verified", "rejected", "void"],
      },
    },
  ];

  // ---- Create / reset sheets
  tables.forEach((t) => {
    let sh = ss.getSheetByName(t.name);
    if (!sh) sh = ss.insertSheet(t.name);

    // Clear contents but keep sheet
    sh.clear({ contentsOnly: true });

    // Write header row
    sh.getRange(1, 1, 1, t.columns.length).setValues([t.columns]);
    sh.setFrozenRows(1);

    // Basic header styling
    sh.getRange(1, 1, 1, t.columns.length).setFontWeight("bold");
    sh.autoResizeColumns(1, t.columns.length);

    // Optional: add enum dropdown validations for certain columns
    if (t.enums) applyEnumValidations_(sh, t.columns, t.enums);

    // Optional: add notes for "PK-like" columns (helpful for humans)
    addPkNotes_(sh, t.columns);
  });
}

/**
 * Apply dropdown validation for enum-like columns.
 * Applies to rows 2..1000 by default (adjust as you like).
 */
function applyEnumValidations_(sheet, columns, enumsMap) {
  const MAX_ROWS = 1000; // change to something bigger if you want

  Object.keys(enumsMap).forEach((colName) => {
    const idx = columns.indexOf(colName);
    if (idx === -1) return;

    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(enumsMap[colName], true)
      .setAllowInvalid(false)
      .build();

    const range = sheet.getRange(2, idx + 1, MAX_ROWS - 1, 1);
    range.setDataValidation(rule);
  });
}

/**
 * Add simple notes to columns that look like primary keys.
 */
function addPkNotes_(sheet, columns) {
  columns.forEach((c, i) => {
    if (c.endsWith("_id") || c === "record_id") {
      sheet.getRange(1, i + 1).setNote("ID column (treat like primary key / foreign key in Sheets).");
    }
  });
}

/**
 * Optional: add a custom menu so you can run it from the spreadsheet UI.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Schema Tools")
    .addItem("Create Sheets from DDL", "createSchemaSheets_fromDDL")
    .addToUi();
}
