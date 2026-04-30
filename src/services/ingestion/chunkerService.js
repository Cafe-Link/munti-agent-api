const { VertexAI } = require('@google-cloud/vertexai');
const { GOOGLE_CLOUD_PROJECT, GEMINI_MODEL } = require('../../config/constants');

class ChunkerService {
  constructor() {
    this.vertexAI = new VertexAI({ project: GOOGLE_CLOUD_PROJECT, location: 'us-central1' });
    this.model = this.vertexAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: 'application/json' }
    });
  }

  /**
   * Splits document content into semantic chunks using Gemini.
   */
  async generateChunks(document) {
    const prompt = `
        Split the following document into semantically coherent chunks (~500-1000 chars).
        RULES: 
        1. NEVER split a table. 
        2. Each chunk must be standalone. 
        3. Include metadata exactly as provided.
        
        DOCUMENT CONTENT:
        ${document.full_text}

        METADATA:
        Department: ${document.department}
        Document Name: ${document.document_name}

        Return JSON: { "chunks": [ { "content": "...", "metadata": { "department": "...", "document_name": "...", "summary": "..." } } ] }
    `;

    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      const responseText = result.response.candidates[0].content.parts[0].text;
      const parsed = JSON.parse(responseText);
      
      return parsed.chunks || [];
    } catch (err) {
      console.error(`[Chunker] Failed to chunk ${document.document_name}`, err);
      return [];
    }
  }
}

module.exports = new ChunkerService();
