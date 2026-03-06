function testApiCall() {
  try {
    var hns = SupabaseProvider.listPatients();
    if (!hns || !hns.length) {
      console.log("No patients");
      return;
    }
    var hn = hns[0].hn;
    var res = studentGetTreatmentPlan(hn);
    console.log(
      "phases:",
      res.phases.length,
      "divisions:",
      res.divisions.length,
      "catalog:",
      res.catalog.length,
      "steps:",
      res.steps.length,
    );
  } catch (e) {
    console.error(e.message);
  }
}
