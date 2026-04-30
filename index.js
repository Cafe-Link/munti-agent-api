console.log("Starting Weather Agent Entry Point...");
/**
 * Entry point for the Weather Agent Server
 * Points to the production-ready source structure
 */
try {
  require('./src/index.js');
  console.log("Successfully loaded src/index.js");
} catch (e) {
  console.error("Failed to load src/index.js:", e.message);
  console.error(e.stack);
}
