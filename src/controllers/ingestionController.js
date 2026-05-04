const { Pool } = require('pg');
const { DB } = require('../config/constants');
const extractorService = require('../services/ingestion/extractorService');
const chunkerService = require('../services/ingestion/chunkerService');
const embedderService = require('../services/ingestion/embedderService');
const vectorStoreService = require('../services/ingestion/vectorStoreService');
const gcsService = require('../services/ingestion/gcsService');

const pool = new Pool({
  host: DB.host,
  user: DB.user,
  password: DB.password,
  database: DB.database,
  port: DB.port,
  ssl: { rejectUnauthorized: false }
});

const handleIngestion = async (req, res) => {
  const files = req.files;
  const { department, documentName, userName } = req.body;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  if (!department || !documentName || !userName) {
    return res.status(400).json({ error: 'Department, Document Name, and UserName are required' });
  }

  try {
    console.log(`[Ingestion] Creating dynamic agent for: ${documentName} by ${userName}`);

    // 1. Upload Files to GCS
    const uploadedFiles = [];
    for (const file of files) {
        const result = await gcsService.uploadFile(file);
        uploadedFiles.push({
            ...file,
            gcsFileName: result.fileName,
            gcsUrl: result.url
        });
    }

    // 2. Generate Unique Table Name
    const sanitizedName = documentName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const tableName = `idx_${sanitizedName}_${Date.now()}`;

    // 3. Create the Table
    await vectorStoreService.createTable(tableName);

    // 4. Extraction
    const document = await extractorService.extractDocument(uploadedFiles, department, documentName);
    
    // 5. Semantic Chunking
    const chunks = await chunkerService.generateChunks(document);
    if (!chunks.length) throw new Error('Failed to generate semantic chunks');

    // 6. Neural Embedding
    const embeddedChunks = await embedderService.embedChunks(chunks);

    // 7. Vector Storage (Into the NEW table)
    const storageResult = await vectorStoreService.saveChunks(embeddedChunks, tableName);

    // 8. Update User Config
    const schema = DB.schema.toLowerCase();
    const userResult = await pool.query(`SELECT allowed_agents FROM ${schema}.user_details WHERE name = $1`, [userName]);
    
    if (userResult.rows.length > 0) {
        const currentAgents = userResult.rows[0].allowed_agents;
        const newAgent = {
            id: tableName,
            type: 'DOCUMENTATION_MODEL',
            name: documentName,
            table: tableName
        };
        const updatedAgents = [...currentAgents, newAgent];
        
        await pool.query(`UPDATE ${schema}.user_details SET allowed_agents = $1 WHERE name = $2`, [JSON.stringify(updatedAgents), userName]);
        console.log(`[Ingestion] Updated config for user ${userName}`);
    }

    res.status(200).json({
      success: true,
      message: `Agent '${documentName}' created successfully.`,
      agentId: tableName
    });

  } catch (err) {
    console.error('[Ingestion Controller] Pipeline failed:', err);
    res.status(500).json({ error: 'Agent creation failed', details: err.message });
  }
};

const handleClearUploadedDocs = async (req, res) => {
  try {
    const result = await gcsService.clearUploadedDocs();
    res.status(200).json(result);
  } catch (err) {
    console.error('[Ingestion Controller] Clear failed:', err);
    res.status(500).json({ error: 'Failed to clear uploaded documents', details: err.message });
  }
};

module.exports = { handleIngestion, handleClearUploadedDocs };
