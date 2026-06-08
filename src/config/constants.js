require('dotenv').config();

/**
 * Robustly sanitizes environment variable strings that might contain 
 * trailing commas, stray quotes, or whitespace.
 */
function sanitizeEnv(value, defaultValue = '') {
  if (!value) return defaultValue;
  // Strip quotes and commas, then trim
  return value.toString().replace(/['",]/g, '').trim() || defaultValue;
}

module.exports = {
  PORT: process.env.PORT || 5001,
  MAIL_KEY: process.env.AGENTMAIL_API_KEY,
  INBOX_ID: process.env.INBOX_ID,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'gemini-embedding-001',
  CORS_ORIGIN: process.env.CORS_ORIGIN,

  // Authentication Settings
  JWT_SECRET: sanitizeEnv(process.env.JWT_SECRET, 'dev-access-secret-key-12345'),
  JWT_REFRESH_SECRET: sanitizeEnv(process.env.JWT_REFRESH_SECRET, 'dev-refresh-secret-key-67890'),
  ACCESS_TOKEN_EXPIRY: sanitizeEnv(process.env.ACCESS_TOKEN_EXPIRY, '15m'),
  
  // Prefer Minutes (per latest requirement), but check both
  REFRESH_TOKEN_EXPIRY_MINUTES: parseInt(sanitizeEnv(process.env.REFRESH_TOKEN_EXPIRY_MINUTES || '')) || 30,

  AI_API_BASE: process.env.AI_API_BASE || 'http://localhost:8000',
  DB: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    schema: process.env.DB_SCHEMA || 'public',
    port: process.env.DB_PORT || 5432,
    table: process.env.DB_TABLE
  },
  GCS_BUCKET: process.env.GCS_BUCKET,
  VECTOR_SEARCH: {
    apiEndpoint: process.env.API_ENDPOINT,
    indexEndpoint: process.env.INDEX_ENDPOINT,
    deployedIndexId: process.env.DEPLOYED_INDEX_ID
  }
};
