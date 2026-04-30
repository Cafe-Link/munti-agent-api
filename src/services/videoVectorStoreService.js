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

  async findSimilarFrames(queryEmbedding, limit = 5) {
    // We can search against visual_embedding or textual_embedding. 
    // Usually for multimodal chat, textual_embedding (caption + ocr) or visual_embedding works.
    // Let's search against textual_embedding as it's more common for text queries.
    // In VideoChatService, it uses getMultimodalEmbedding which returns either depending on input.
    
    const query = `
      SELECT video_id, frame_id, timestamp, frame_file, caption, ocr_text,
             (textual_embedding <=> $1) as distance
      FROM "${this.schema}".video_embeddings
      ORDER BY distance ASC
      LIMIT $2
    `;
    const res = await this.pool.query(query, [`[${queryEmbedding.join(',')}]`, limit]);
    return res.rows.map(row => ({
      ...row,
      distance: 1 - row.distance // Convert cosine distance to similarity if needed, or just keep as is. 
      // pgvector <=> is cosine distance. 0 is identical, 2 is opposite.
      // Vertex AI similarity is usually 1 - distance.
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
