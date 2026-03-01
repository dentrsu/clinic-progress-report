function testUpdateRequirement() {
  var reqs = SupabaseProvider.listRequirements();
  if (!reqs || reqs.length === 0) {
    Logger.log("No requirements found to test.");
    return;
  }

  var testReq = reqs[0];
  var id = testReq.requirement_id;
  Logger.log(
    "Testing update for requirement: " +
      testReq.requirement_type +
      " (ID: " +
      id +
      ")",
  );
  Logger.log("Original default_rsu: " + testReq.default_rsu);

  var newDefaultRsu = (testReq.default_rsu || 0) + 1;
  var payload = {
    default_rsu: newDefaultRsu,
  };

  Logger.log("Sending payload: " + JSON.stringify(payload));
  var updated = SupabaseProvider.updateRequirement(id, payload);
  Logger.log("Updated record from Supabase: " + JSON.stringify(updated));

  if (updated && updated.default_rsu == newDefaultRsu) {
    Logger.log("SUCCESS: default_rsu was updated to " + newDefaultRsu);
  } else {
    Logger.log("FAILURE: default_rsu was NOT updated correctly.");
  }
}
