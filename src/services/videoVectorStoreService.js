const { Pool } = require('pg');
const { DB } = require('../config/constants');

class VideoVectorStoreService {
  constructor() {
    this.pool = new Pool({
      host: DB.host,
      user: DB.user,
      password: DB.password,
      database: DB.database,
      port: DB.port,
      ssl: { rejectUnauthorized: false }
    });
    this.schema = DB.schema.toLowerCase();
  }

  async saveVideoMetadata(metadata) {
    const query = `
      INSERT INTO "${this.schema}".video_metadata (video_id, transcript, total_frames, processed_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (video_id) DO UPDATE 
      SET transcript = EXCLUDED.transcript, 
          total_frames = EXCLUDED.total_frames, 
          processed_at = EXCLUDED.processed_at
    `;
    const values = [
      metadata.videoId,
      metadata.transcript,
      metadata.totalFrames,
      metadata.processedAt
    ];
    await this.pool.query(query, values);
  }

  async saveFrameEmbeddings(videoId, frames) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const frame of frames) {
        const frameId = frame.id || `${videoId}_f${frame.timestamp}`;
        const query = `
          INSERT INTO "${this.schema}".video_embeddings 
          (video_id, frame_id, timestamp, frame_file, caption, ocr_text, visual_embedding, textual_embedding)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        const values = [
          videoId,
          frameId,
          frame.timestamp,
          frame.frameFile,
          frame.caption,
          frame.ocrText,
          `[${frame.visualEmbedding.join(',')}]`,
          `[${frame.textualEmbedding.join(',')}]`
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

  /**
   * Comprehensive multimodal search across visual and textual embeddings.
   * Returns rounded similarity scores (1 - distance).
   */
  async searchSimilarFrames(visualVector, textualVector, originalText, limit = 10) {
    let query;
    let params;

    if (visualVector && textualVector) {
        query = `
          SELECT video_id, frame_id, timestamp, frame_file, caption, ocr_text,
                 (1 - (visual_embedding <=> $1)) as visual_sim,
                 (1 - (textual_embedding <=> $2)) as textual_sim
          FROM "${this.schema}".video_embeddings
          ORDER BY (visual_sim * 0.5 + textual_sim * 0.5) DESC
          LIMIT $3
        `;
        params = [`[${visualVector.join(',')}]`, `[${textualVector.join(',')}]`, limit];
    } else if (visualVector) {
        query = `
          SELECT video_id, frame_id, timestamp, frame_file, caption, ocr_text,
                 (1 - (visual_embedding <=> $1)) as similarity
          FROM "${this.schema}".video_embeddings
          ORDER BY similarity DESC
          LIMIT $2
        `;
        params = [`[${visualVector.join(',')}]`, limit];
    } else {
        query = `
          SELECT video_id, frame_id, timestamp, frame_file, caption, ocr_text,
                 (1 - (textual_embedding <=> $1)) as similarity
          FROM "${this.schema}".video_embeddings
          ORDER BY similarity DESC
          LIMIT $2
        `;
        params = [`[${textualVector.join(',')}]`, limit];
    }

    const res = await this.pool.query(query, params);
    return res.rows.map(row => {
        let sim = row.similarity !== undefined ? parseFloat(row.similarity) : (row.visual_sim * 0.5 + row.textual_sim * 0.5);
        
        // Ensure similarity is within [0, 1] for display purposes
        // and rounded to 4 decimal places for readability
        const finalScore = Math.max(0, Math.min(1, sim));
        
        return {
            ...row,
            score: parseFloat(finalScore.toFixed(4))
        };
    });
  }

  async findSimilarFrames(queryEmbedding, limit = 5) {
    const query = `
      SELECT video_id, frame_id, timestamp, frame_file, caption, ocr_text,
             (1 - (textual_embedding <=> $1)) as similarity
      FROM "${this.schema}".video_embeddings
      ORDER BY similarity DESC
      LIMIT $2
    `;
    const res = await this.pool.query(query, [`[${queryEmbedding.join(',')}]`, limit]);
    return res.rows.map(row => ({
        ...row,
        score: parseFloat(Math.max(0, Math.min(1, row.similarity)).toFixed(4))
    }));
  }

  async getVideoMetadata(videoId) {
    const res = await this.pool.query(`
      SELECT * FROM "${this.schema}".video_metadata WHERE video_id = $1
    `, [videoId]);
    return res.rows[0];
  }
}

module.exports = new VideoVectorStoreService();
