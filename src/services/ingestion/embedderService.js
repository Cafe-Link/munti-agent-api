const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const { GOOGLE_CLOUD_PROJECT } = require('../../config/constants');

class EmbedderService {
  constructor() {
    this.region = 'us-central1';
    this.modelId = 'text-embedding-004';
    this.url = `https://${this.region}-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/${this.region}/publishers/google/models/${this.modelId}:predict`;
    this.auth = new GoogleAuth({
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
  }

  async getAccessToken() {
    const client = await this.auth.getClient();
    const token = await client.getAccessToken();
    return token.token;
  }

  /**
   * Generates embedding for a single text (Query).
   */
  async embedQuery(text) {
    const accessToken = await getAccessToken();
    const response = await axios.post(this.url, {
      instances: [{
        task_type: "RETRIEVAL_QUERY",
        content: text
      }]
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      }
    });

    return response.data.predictions[0].embeddings.values;
  }

  /**
   * Generates embeddings for a batch of chunks (Document).
   */
  async embedChunks(chunks) {
    const accessToken = await getAccessToken();
    const batchSize = 10;
    const embeddedChunks = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      
      const response = await axios.post(this.url, {
        instances: batch.map(chunk => ({
          task_type: "RETRIEVAL_DOCUMENT",
          content: chunk.content,
          title: chunk.metadata.document_name
        }))
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        }
      });

      const predictions = response.data.predictions;
      batch.forEach((chunk, index) => {
        embeddedChunks.push({
          ...chunk,
          embedding: predictions[index].embeddings.values
        });
      });
    }

    return embeddedChunks;
  }
}

module.exports = new EmbedderService();
