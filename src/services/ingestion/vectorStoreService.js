const { Pool } = require('pg');
const { DB } = require('../../config/constants');

class VectorStoreService {
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
    this.table = (DB.table || '').toLowerCase();
  }

  /**
   * Dynamically creates a new vector table for a new agent.
   */
  async createTable(tableName) {
    const client = await this.pool.connect();
    const fullTable = `"${this.schema}"."${tableName.toLowerCase()}"`;
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${fullTable} (
          id SERIAL PRIMARY KEY,
          content TEXT NOT NULL,
          department TEXT,
          document_name TEXT,
          summary TEXT,
          embedding vector(3072)
        );
      `);
      return true;
    } finally {
      client.release();
    }
  }

  /**
   * Saves a batch of embedded chunks to a specific AlloyDB table.
   */
  async saveChunks(embeddedChunks, tableName) {
    const client = await this.pool.connect();
    const fullTable = `"${this.schema}"."${tableName.toLowerCase()}"`;
    
    try {
      await client.query('BEGIN');
      
      for (const chunk of embeddedChunks) {
        const query = `
          INSERT INTO ${fullTable} (content, department, document_name, summary, embedding)
          VALUES ($1, $2, $3, $4, $5)
        `;
        const values = [
          chunk.content,
          chunk.metadata.department,
          chunk.metadata.document_name,
          chunk.metadata.summary,
          `[${chunk.embedding.join(',')}]`
        ];
        await client.query(query, values);
      }
      
      await client.query('COMMIT');
      return { success: true, count: embeddedChunks.length };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[VectorStore] Error saving chunks to ${tableName}:`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Performs semantic search in a specific AlloyDB table.
   */
  async semanticSearch(queryVector, tableName, limit = 5) {
    const targetTable = tableName || this.table;
    const fullTable = `"${this.schema}"."${targetTable.toLowerCase()}"`;
    const query = `
      SELECT content, department, document_name, summary, 
             (embedding <=> $1) as distance 
      FROM ${fullTable}
      ORDER BY distance ASC 
      LIMIT $2;
    `;
    
    const res = await this.pool.query(query, [`[${queryVector.join(',')}]`, limit]);
    return res.rows;
  }

  /**
   * Retrieves specific chunks by their IDs from a table.
   */
  async getChunksByIds(ids, tableName) {
    const targetTable = tableName || this.table;
    const fullTable = `"${this.schema}"."${targetTable.toLowerCase()}"`;
    
    // Convert IDs to integers if they are strings (Vertex AI returns strings)
    const intIds = ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    
    if (intIds.length === 0) return [];

    const query = `
      SELECT id, content, department, document_name, summary
      FROM ${fullTable}
      WHERE id = ANY($1::int[])
      ORDER BY array_position($1::int[], id);
    `;
    
    const res = await this.pool.query(query, [intIds]);
    return res.rows;
  }
}

module.exports = new VectorStoreService();
