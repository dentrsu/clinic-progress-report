function clearAllCaches() {
  try {
    var cache = CacheService.getScriptCache();
    cache.removeAll([
      "cache:phases",
      "cache:divisions",
      "cache:catalog",
      "cache:steps",
      "cache:instructors",
      "cache:requirements",
    ]);
    console.log("Caches cleared successfully.");
  } catch (e) {
    console.error("Cache clear error:", e.message);
  }
}
