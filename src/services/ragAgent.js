const fs = require('fs/promises');
const pdfParseModule = require('pdf-parse');
const pdfParse = typeof pdfParseModule === 'function' ? pdfParseModule : pdfParseModule?.default;
const csv = require('csvtojson');
const XLSX = require('xlsx');
const Tesseract = require('tesseract.js');
const { VertexAI } = require('@google-cloud/vertexai');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const { GOOGLE_CLOUD_PROJECT, DB, GEMINI_MODEL, EMBEDDING_MODEL } = require('../config/constants');
const vectorStoreService = require('./ingestion/vectorStoreService');
const vertexVectorSearchService = require('./vertexVectorSearchService');

const vertex_ai = new VertexAI({
  project: GOOGLE_CLOUD_PROJECT,
  location: 'us-central1',
});

const model = vertex_ai.getGenerativeModel({
  model: GEMINI_MODEL,
});

const auth = new GoogleAuth({
  scopes: 'https://www.googleapis.com/auth/cloud-platform',
});

async function getAccessToken() {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

/**
 * Generates embedding for a query.
 */
async function getQueryEmbedding(text) {
  const accessToken = await getAccessToken();
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/us-central1/publishers/google/models/${EMBEDDING_MODEL}:predict`;
  
  const response = await axios.post(url, {
    instances: [{
      task_type: "RETRIEVAL_QUERY",
      content: text
    }],
    parameters: {
      outputDimensionality: 3072
    }
  }, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }
  });

  
  return response.data.predictions[0].embeddings.values;
}

// In-memory knowledge base for temporary uploads
let temporaryKnowledgeBase = [];

/**
 * Normalizes all extracted data into a searchable knowledge base.
 */
async function processFile(file) {
  let content = '';
  const mime = file.mimetype || '';
  const filePath = file.path;
  const originalName = (file.originalname || '').toLowerCase();

  try {
    if (!filePath) throw new Error('Invalid file: missing path');

    const readTextFile = () => fs.readFile(filePath, 'utf8');

    if (mime === 'application/pdf' || originalName.endsWith('.pdf')) {
      const dataBuffer = await fs.readFile(filePath);
      const pdfData = await pdfParse(dataBuffer);
      content = `[PDF Content: ${originalName}]\n${pdfData.text || ''}`;
    } else if (mime === 'application/json' || originalName.endsWith('.json')) {
      const raw = await readTextFile();
      try {
        const parsed = JSON.parse(raw);
        content = `[JSON Data: ${originalName}]\n${JSON.stringify(parsed, null, 2)}`;
      } catch {
        content = `[Raw JSON String: ${originalName}]\n${raw}`;
      }
    } else if (mime.includes('csv') || originalName.endsWith('.csv')) {
      const jsonArray = await csv().fromFile(filePath);
      content = `[CSV Tabular Data: ${originalName}]\n${JSON.stringify(jsonArray, null, 2)}`;
    } else if (mime.includes('spreadsheet') || mime.includes('excel') || originalName.endsWith('.xlsx')) {
      const workbook = XLSX.readFile(filePath);
      const sheetData = {};
      workbook.SheetNames.forEach(sheetName => {
        sheetData[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
      });
      content = `[Excel Spreadsheet: ${originalName}]\n${JSON.stringify(sheetData, null, 2)}`;
    } else if (mime.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(originalName)) {
      const { data: { text } } = await Tesseract.recognize(filePath, 'eng');
      content = `[Image OCR Result: ${originalName}]\n${text || ''}`;
    } else {
      content = `[Document: ${originalName}]\n${await readTextFile()}`;
    }

    temporaryKnowledgeBase.push(content);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function getRagResponse(message, history = []) {
  const sessionContext = temporaryKnowledgeBase.join('\n\n---\n\n');
  if (!sessionContext) throw new Error('The knowledge base is empty.');

  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.content }]
  }));

  const systemPrompt = `You are a RAG assistant. Use ONLY this session context to answer: ${sessionContext}`;
  contents.push({ role: 'user', parts: [{ text: `${systemPrompt}\n\nQUESTION: ${message}` }] });

  return await model.generateContentStream({ contents });
}

async function getCompanyRagResponse(message, history = [], tableName = null) {
  let searchMessage = message;
  
  // 1. Query Re-writing with Error Handling
  if (history.length > 0) {
    try {
        const historySummary = history.map(h => `${h.role}: ${h.content}`).join('\n');
        const rewritePrompt = `Given the following conversation history and a follow-up question, rephrase the follow-up question to be a standalone search query that captures the specific subject matter.
        
        History:
        ${historySummary}
        
        Follow-up: ${message}
        
        Standalone Query (Be specific, do not explain, just return the query):`;
        
        const rewriteResult = await model.generateContent(rewritePrompt);
        // Robust text extraction from Vertex AI response
        const rewrittenText = rewriteResult.response.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (rewrittenText) {
            searchMessage = rewrittenText.trim();
            console.log(`[RAG] Query rewritten to: "${searchMessage}"`);
        }
    } catch (err) {
        console.warn("[RAG] Query rewrite failed, using original message:", err.message);
    }
  }
  
  // 2. Semantic Search
  const queryVector = await getQueryEmbedding(searchMessage);
  const relevantChunks = await vectorStoreService.semanticSearch(queryVector, tableName);
  
  if (!relevantChunks.length) throw new Error('I searched our archives but couldn\'t find any documents matching your request.');

  const context = relevantChunks.map(c => `[Source: ${c.document_name}] ${c.content}`).join('\n\n');
  
  // 3. Conversational Response Generation
  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.content }]
  }));

  const systemPrompt = `
You are the Company Document Oracle, but you should speak and interact like a helpful, senior colleague who knows these archives out. 
Your goal is to make the user feel like they are having a natural conversation with an expert, not a rigid database.

-----------------------------------
INTERNAL KNOWLEDGE ARCHIVES:
-----------------------------------
${context}

-----------------------------------
GUIDELINES:
1. PERSONALITY: Be warm, professional, and helpful. Use natural transitions like "I'd be happy to look that up for you," or "Regarding your question about..."
2. CONVERSATIONAL FLOW: Don't just dump data. If you are continuing a thread, maintain that flow.
3. NO BOT TALK: Avoid phrases like "Based on the provided context." Just speak directly from your knowledge.
4. SURGICAL BUT NATURAL: Stay grounded in the archives. If they ask for something specific, give them that specific info, but wrap it in a natural sentence. 
5. HANDLING THE UNKNOWN: If the info isn't there, be human: "I've checked the records, but I couldn't find specific details on that."
6. FORMATTING: Use Markdown (tables/bullets) for clarity.
`;

  contents.push({ role: 'user', parts: [{ text: `${systemPrompt}\n\nUSER QUESTION: ${message}` }] });

  return await model.generateContentStream({ contents });
}

async function getCompanyRagResponseV2(message, history = [], tableName = null) {
  let searchMessage = message;
  
  // 1. Query Re-writing
  if (history.length > 0) {
    try {
        const historySummary = history.map(h => `${h.role}: ${h.content}`).join('\n');
        const rewritePrompt = `Given conversation history and follow-up question, rephrase it as a standalone search query.
        History: ${historySummary}
        Follow-up: ${message}
        Standalone Query:`;
        
        const rewriteResult = await model.generateContent(rewritePrompt);
        const rewrittenText = rewriteResult.response.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rewrittenText) searchMessage = rewrittenText.trim();
    } catch (err) {
        console.warn("[RAG V2] Query rewrite failed:", err.message);
    }
  }
  
  // 2. Vector Search (Vertex AI Matching Engine)
  const queryVector = await getQueryEmbedding(searchMessage);
  console.log('[RAG V2] Query embedding generated, performing vector search...', queryVector);
  const neighbors = await vertexVectorSearchService.findNeighbors(queryVector);
  
  if (!neighbors || neighbors.length === 0) {
    throw new Error('I searched our high-performance archives but couldn\'t find any matching documents.');
  }

  // 3. Retrieve Content from Database
  const neighborIds = neighbors.map(n => n.datapoint.datapointId);
  const relevantChunks = await vectorStoreService.getChunksByIds(neighborIds, tableName);
  
  if (!relevantChunks.length) throw new Error('I found matches in the index, but the corresponding documents seem to be missing from the database.');

  const context = relevantChunks.map(c => `[Source: ${c.document_name}] ${c.content}`).join('\n\n');
  
  // 4. Response Generation
  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.content }]
  }));

  const systemPrompt = `You are the Company Document Oracle. Use the following context to answer the user question naturally.
-----------------------------------
INTERNAL KNOWLEDGE ARCHIVES:
${context}
-----------------------------------
GUIDELINES:
- Be warm and professional.
- Stay grounded in the provided context.
- Use Markdown for clarity.`;

  contents.push({ role: 'user', parts: [{ text: `${systemPrompt}\n\nUSER QUESTION: ${message}` }] });

  return await model.generateContentStream({ contents });
}

function clearKnowledgeBase() {
  temporaryKnowledgeBase = [];
  return { message: 'Cleared' };
}

module.exports = { 
  processFile, 
  getRagResponse, 
  getCompanyRagResponse, 
  getCompanyRagResponseV2,
  clearKnowledgeBase 
};
