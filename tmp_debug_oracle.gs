function debugOracleData() {
  const studentEmail = "oddha.s@ku.th"; // Assuming this is the user's email or the student's email
  const profile = getUserProfile(studentEmail);
  console.log("Profile:", JSON.stringify(profile));

  if (!profile.found) {
    console.log("Student profile not found.");
    return;
  }

  const studentId = profile.student_id;
  console.log("Student ID:", studentId);

  // Check snapshot
  const snapshot = SupabaseProvider.getOracleStudentSnapshot(studentId);
  console.log("Snapshot:", JSON.stringify(snapshot));

  // Check counts
  const tables = [
    "oracle.cohort_calendar",
    "oracle.student_progress_snapshots",
    "public.treatment_records",
  ];

  tables.forEach((t) => {
    try {
      // Note: _get uses /rest/v1/...
      // For oracle schema, we need to handle it.
      const path = t.startsWith("oracle.")
        ? "/rest/v1/" + t.split(".")[1]
        : "/rest/v1/" + t.split(".")[1];

      const countUrl = getSupabaseUrl() + path + "?select=count";
      const hdrs = _headers();
      if (t.startsWith("oracle.")) hdrs["Accept-Profile"] = "oracle";

      const res = UrlFetchApp.fetch(countUrl, {
        headers: hdrs,
        muteHttpExceptions: true,
      });
      console.log(`Count ${t}:`, res.getContentText());
    } catch (e) {
      console.log(`Error counting ${t}:`, e.message);
    }
  });
}
