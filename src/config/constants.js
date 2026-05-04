require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 5001,
  MAIL_KEY: process.env.AGENTMAIL_API_KEY,
  INBOX_ID: process.env.INBOX_ID,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'gemini-embedding-001',

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
