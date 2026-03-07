function diagnosePatients() {
  var data = getStudentVaultData("all"); // or a specific ID if you know one
  Logger.log(
    "Complete Cases Length: " +
      (data.completeCases ? data.completeCases.length : 0),
  );
  if (data.completeCases && data.completeCases.length > 0) {
    Logger.log(
      "First Complete Case Complexity: " + data.completeCases[0].complexity,
    );
    Logger.log(JSON.stringify(data.completeCases[0], null, 2));
  }
}
