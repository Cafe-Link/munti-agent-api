const { Pool } = require('pg');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { DB, JWT_SECRET, ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY_MINUTES } = require('../config/constants');

const pool = new Pool({
  host: DB.host,
  user: DB.user,
  password: DB.password,
  database: DB.database,
  port: DB.port,
  ssl: { rejectUnauthorized: false }
});

const schema = DB.schema.toLowerCase();

class SessionManager {
  constructor() {
    this.pool = pool;
  }

  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  generateAccessToken(payload) {
    // Already sanitized in constants.js, but keeping basic guarding here
    let expiry = ACCESS_TOKEN_EXPIRY;
    
    if (typeof expiry === 'string') {
      expiry = expiry.trim();
      if (/^\d+$/.test(expiry)) {
        expiry = parseInt(expiry, 10);
      }
    }
    
    if (!expiry) expiry = '15m';

    console.log('[SessionManager] Final Expiry Value:', expiry, `(Type: ${typeof expiry})`);
    
    return jwt.sign(payload, JWT_SECRET, { expiresIn: expiry });
  }

  generateRefreshToken() {
    return crypto.randomBytes(40).toString('hex');
  }

  async createAuthSession(userId, metadata = {}) {
    const refreshToken = this.generateRefreshToken();
    const refreshTokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + (REFRESH_TOKEN_EXPIRY_MINUTES || 30));

    const query = `
      INSERT INTO ${schema}.auth_sessions (user_id, refresh_token_hash, expires_at, metadata)
      VALUES ($1, $2, $3, $4)
      RETURNING id, created_at, expires_at
    `;
    const result = await this.pool.query(query, [userId, refreshTokenHash, expiresAt, metadata]);
    
    return {
      session: result.rows[0],
      refreshToken
    };
  }

  async getSessionByRefreshToken(refreshToken) {
    const hash = this.hashToken(refreshToken);
    const query = `
      SELECT s.*, u.name, u.role, u.allowed_agents 
      FROM ${schema}.auth_sessions s
      JOIN ${schema}.user_details u ON s.user_id = u.id
      WHERE s.refresh_token_hash = $1 AND s.status = 'active' AND s.expires_at > NOW()
    `;
    const result = await this.pool.query(query, [hash]);
    return result.rows[0];
  }

  async refreshAuthSession(oldRefreshToken) {
    const session = await this.getSessionByRefreshToken(oldRefreshToken);
    if (!session) throw new Error('Invalid or expired refresh token');

    const newRefreshToken = this.generateRefreshToken();
    const newHash = this.hashToken(newRefreshToken);
    
    // Rotate token and extend expiry
    const newExpiresAt = new Date();
    newExpiresAt.setMinutes(newExpiresAt.getMinutes() + (REFRESH_TOKEN_EXPIRY_MINUTES || 30));

    await this.pool.query(
      `UPDATE ${schema}.auth_sessions SET refresh_token_hash = $1, expires_at = $2, last_active_at = NOW() WHERE id = $3`,
      [newHash, newExpiresAt, session.id]
    );

    return {
      session,
      newRefreshToken
    };
  }

  async revokeSession(sessionId) {
    await this.pool.query(
      `UPDATE ${schema}.auth_sessions SET status = 'logged_out' WHERE id = $1`,
      [sessionId]
    );
    
    // Trigger internal cleanup
    await this.cleanupAuthSession(sessionId);
  }

  // Feature Sessions (Child Sessions)
  async startFeatureSession(authSessionId, moduleName, moduleSessionId) {
    const query = `
      INSERT INTO ${schema}.feature_sessions (auth_session_id, module_name, module_session_id)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await this.pool.query(query, [authSessionId, moduleName, moduleSessionId]);
    return result.rows[0];
  }

  async endFeatureSession(moduleSessionId) {
    await this.pool.query(
      `UPDATE ${schema}.feature_sessions SET status = 'closed', closed_at = NOW() WHERE module_session_id = $1`,
      [moduleSessionId]
    );
  }

  async cleanupAuthSession(authSessionId) {
    console.log(`[SessionManager] Running cleanup for auth session: ${authSessionId}`);
    
    // 1. Find all active feature sessions
    const query = `SELECT module_name, module_session_id FROM ${schema}.feature_sessions WHERE auth_session_id = $1 AND status = 'active'`;
    const result = await this.pool.query(query, [authSessionId]);
    
    for (const row of result.rows) {
      try {
        await this.cleanupFeature(row.module_name, row.module_session_id);
      } catch (err) {
        console.error(`[SessionManager] Failed to cleanup feature ${row.module_name}:`, err.message);
      }
    }
    
    // 2. Mark all as closed
    await this.pool.query(
      `UPDATE ${schema}.feature_sessions SET status = 'closed', closed_at = NOW() WHERE auth_session_id = $1`,
      [authSessionId]
    );
  }

  async cleanupFeature(moduleName, moduleSessionId) {
    console.log(`[SessionManager] Cleaning up module: ${moduleName}, ID: ${moduleSessionId}`);
    
    if (moduleName === 'video_oracle_v2') {
      const videoV2Service = require('./videoV2Service');
      await videoV2Service.deleteSession(moduleSessionId);
    }
    
    // For RAG/Knowledge Oracle, the moduleSessionId is the authSessionId itself
    if (moduleName === 'knowledge_oracle') {
      const { clearKnowledgeBase } = require('./ragAgent');
      clearKnowledgeBase(moduleSessionId);
    }
  }
}

module.exports = new SessionManager();
