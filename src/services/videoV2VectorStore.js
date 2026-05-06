const { Pool } = require('pg');
const { DB } = require('../config/constants');

class VideoV2VectorStore {
  constructor() {
    this.pool = new Pool({
      host: DB.host,
      user: DB.user,
      password: DB.password,
      database: DB.database,
      port: DB.port,
      ssl: { rejectUnauthorized: false }
    });
    this.schema = (DB.schema || 'public').toLowerCase();
  }

  async initTables() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${this.schema}".video_v2_sessions (
          session_id VARCHAR(255) PRIMARY KEY,
          s3_path TEXT,
          status VARCHAR(50),
          total_frames INT DEFAULT 0,
          transcript TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMPTZ,
          deleted_at TIMESTAMPTZ
        );
      `);

      // Add columns if they do not exist for backwards compatibility with earlier V2 tables
      await client.query(`
        ALTER TABLE "${this.schema}".video_v2_sessions
        ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      `);

      // Ensure types are TIMESTAMPTZ for existing columns
      await client.query(`
        ALTER TABLE "${this.schema}".video_v2_sessions
        ALTER COLUMN created_at TYPE TIMESTAMPTZ,
        ALTER COLUMN expires_at TYPE TIMESTAMPTZ,
        ALTER COLUMN deleted_at TYPE TIMESTAMPTZ;
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS "${this.schema}".video_v2_embeddings (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(255) REFERENCES "${this.schema}".video_v2_sessions(session_id) ON DELETE CASCADE,
          frame_id VARCHAR(255),
          timestamp INT,
          frame_file TEXT,
          caption TEXT,
          ocr_text TEXT,
          visual_embedding vector,
          textual_embedding vector
        );
      `);
      return true;
    } catch (error) {
      console.error('[VideoV2VectorStore] Error initializing tables:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async createSession(sessionId, expiresAt) {
    await this.initTables();
    const query = `
      INSERT INTO "${this.schema}".video_v2_sessions (session_id, status, expires_at)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const res = await this.pool.query(query, [sessionId, 'created', expiresAt]);
    return res.rows[0];
  }

  async updateSession(sessionId, updates) {
    const keys = Object.keys(updates);
    if (keys.length === 0) return;
    
    const setString = keys.map((key, idx) => `${key} = $${idx + 2}`).join(', ');
    const values = keys.map(key => updates[key]);
    
    const query = `
      UPDATE "${this.schema}".video_v2_sessions
      SET ${setString}
      WHERE session_id = $1
      RETURNING *
    `;
    const res = await this.pool.query(query, [sessionId, ...values]);
    return res.rows[0];
  }

  async getSession(sessionId) {
    const res = await this.pool.query(`
      SELECT *, CASE WHEN expires_at < NOW() THEN true ELSE false END as is_expired 
      FROM "${this.schema}".video_v2_sessions 
      WHERE session_id = $1
    `, [sessionId]);
    return res.rows[0];
  }

  async saveFrameEmbeddings(sessionId, frames) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const frame of frames) {
        const frameId = frame.id || `${sessionId}_f${frame.timestamp}`;
        const query = `
          INSERT INTO "${this.schema}".video_v2_embeddings 
          (session_id, frame_id, timestamp, frame_file, caption, ocr_text, visual_embedding, textual_embedding)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        const values = [
          sessionId,
          frameId,
          frame.timestamp,
          frame.frameFile,
          frame.caption,
          frame.ocrText,
          frame.visualEmbedding && frame.visualEmbedding.length > 0 ? `[${frame.visualEmbedding.join(',')}]` : null,
          frame.textualEmbedding && frame.textualEmbedding.length > 0 ? `[${frame.textualEmbedding.join(',')}]` : null
        ];
        await client.query(query, values);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async searchSimilarFrames(sessionId, queryEmbedding, limit = 5) {
    const query = `
      SELECT session_id, frame_id, timestamp, frame_file, caption, ocr_text,
             (1 - (textual_embedding <=> $1)) as similarity
      FROM "${this.schema}".video_v2_embeddings
      WHERE session_id = $2 AND textual_embedding IS NOT NULL
      ORDER BY similarity DESC
      LIMIT $3
    `;
    const res = await this.pool.query(query, [`[${queryEmbedding.join(',')}]`, sessionId, limit]);
    return res.rows.map(row => ({
        ...row,
        score: parseFloat(Math.max(0, Math.min(1, row.similarity)).toFixed(4))
    }));
  }

  async searchSimilarFramesVisual(sessionId, visualVector, textualVector, limit = 5) {
    let query;
    let params;

    if (visualVector && textualVector) {
        query = `
          SELECT session_id, frame_id, timestamp, frame_file, caption, ocr_text,
                 (1 - (visual_embedding <=> $1)) as visual_sim,
                 (1 - (textual_embedding <=> $2)) as textual_sim
          FROM "${this.schema}".video_v2_embeddings
          WHERE session_id = $3 AND visual_embedding IS NOT NULL AND textual_embedding IS NOT NULL
          ORDER BY (visual_sim * 0.5 + textual_sim * 0.5) DESC
          LIMIT $4
        `;
        params = [`[${visualVector.join(',')}]`, `[${textualVector.join(',')}]`, sessionId, limit];
    } else if (visualVector) {
        query = `
          SELECT session_id, frame_id, timestamp, frame_file, caption, ocr_text,
                 (1 - (visual_embedding <=> $1)) as similarity
          FROM "${this.schema}".video_v2_embeddings
          WHERE session_id = $2 AND visual_embedding IS NOT NULL
          ORDER BY similarity DESC
          LIMIT $3
        `;
        params = [`[${visualVector.join(',')}]`, sessionId, limit];
    } else {
        query = `
          SELECT session_id, frame_id, timestamp, frame_file, caption, ocr_text,
                 (1 - (textual_embedding <=> $1)) as similarity
          FROM "${this.schema}".video_v2_embeddings
          WHERE session_id = $2 AND textual_embedding IS NOT NULL
          ORDER BY similarity DESC
          LIMIT $3
        `;
        params = [`[${textualVector.join(',')}]`, sessionId, limit];
    }

    const res = await this.pool.query(query, params);
    return res.rows.map(row => {
        let sim = row.similarity !== undefined ? parseFloat(row.similarity) : (row.visual_sim * 0.5 + row.textual_sim * 0.5);
        const finalScore = Math.max(0, Math.min(1, sim));
        return {
            ...row,
            score: parseFloat(finalScore.toFixed(4))
        };
    });
  }

  async getExpiredSessions() {
    const query = `
      SELECT session_id, s3_path FROM "${this.schema}".video_v2_sessions
      WHERE expires_at < NOW() AND status != 'deleted'
    `;
    const res = await this.pool.query(query);
    return res.rows;
  }

  async deleteSession(sessionId) {
    // First mark as deleted, then we might do actual row deletion or keep it for logs
    await this.pool.query(`DELETE FROM "${this.schema}".video_v2_sessions WHERE session_id = $1`, [sessionId]);
    return true;
  }
}

module.exports = new VideoV2VectorStore();
