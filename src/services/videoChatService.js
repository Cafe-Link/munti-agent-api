const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const { VertexAI } = require('@google-cloud/vertexai');

const {
  GOOGLE_CLOUD_PROJECT,
  GEMINI_MODEL,
} = require('../config/constants');

const REQUEST_TIMEOUT = 30000;

/* ---------------------------------------------------
   Vertex AI Setup
--------------------------------------------------- */
const vertexAI = new VertexAI({
  project: GOOGLE_CLOUD_PROJECT,
  location: 'us-central1',
});

const model = vertexAI.getGenerativeModel({
  model: GEMINI_MODEL,
});

const auth = new GoogleAuth({
  scopes: 'https://www.googleapis.com/auth/cloud-platform',
});

let tokenCache = {
  token: null,
  expiresAt: 0,
};

/* ---------------------------------------------------
   Helpers
--------------------------------------------------- */
async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  tokenCache = {
    token: tokenResponse.token,
    expiresAt: Date.now() + 50 * 60 * 1000,
  };

  return tokenCache.token;
}

async function getMultimodalEmbedding({ text = null, imageBuffer = null }) {
  const token = await getAccessToken();

  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/us-central1/publishers/google/models/multimodalembedding:predict`;

  const instance = {};

  if (text) instance.text = text;

  if (imageBuffer) {
    instance.image = {
      bytesBase64Encoded: imageBuffer.toString('base64'),
    };
  }

  const response = await axios.post(
    url,
    {
      instances: [instance],
    },
    {
      timeout: REQUEST_TIMEOUT,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data.predictions?.[0] || {};
}

const videoVectorStoreService = require('./videoVectorStoreService');

/* ---------------------------------------------------
   Video Chat Service
--------------------------------------------------- */
class VideoChatService {
  async chat(text, imageInfo) {
    try {
      console.log(`[VideoChatService] Processing chat request. Text: ${text ? 'Yes' : 'No'}, Image: ${imageInfo ? 'Yes' : 'No'}`);

      // 1. Generate Query Embedding
      const queryEmbedding = await getMultimodalEmbedding({
        text,
        imageBuffer: imageInfo?.buffer
      });

      const visualVector = queryEmbedding.imageEmbedding || [];
      const textualVector = queryEmbedding.textEmbedding || [];

      // 2. Perform Vector Search in PostgreSQL
      console.log('[VideoChatService] Performing vector search...');
      const matches = await videoVectorStoreService.searchSimilarFrames(
        visualVector.length > 0 ? visualVector : null,
        textualVector.length > 0 ? textualVector : null,
        text || '',
        10
      );

      if (!matches || matches.length === 0) {
        return {
          answer: "I couldn't find any relevant frames in the video library matching your query.",
          matches: []
        };
      }

      // 3. Generate Conversational Answer using Gemini
      console.log('[VideoChatService] Generating conversational response...');
      const context = matches
        .map((m, i) => `Match ${i+1} (at ${m.timestamp}s): ${m.caption}. OCR: ${m.ocr_text}\nSimilarity Score: ${m.score.toFixed(4)}`)
        .join('\n');

      const prompt = `
        You are the Video Oracle. Use the following context from video frame analysis to answer the user's question.
        
        CONTEXT FROM VIDEO:
        ${context}
        
        USER QUESTION:
        ${text || 'Describe the visual contents matching my image upload.'}
        
        INSTRUCTIONS:
        - Be accurate and descriptive.
        - Reference specific timestamps if available.
        - If the user provided an image, focus on visually similar events.
        - Use a helpful, professional tone.
      `;

      // Use streaming response
      const streamingResp = await model.generateContentStream(prompt);
      
      return {
        stream: streamingResp,
        matches: matches.map(m => ({
          timestamp: m.timestamp,
          caption: m.caption,
          confidence: m.score.toFixed(4), // Correctly use the rounded similarity score
          ocrText: m.ocr_text
        }))
      };

    } catch (error) {
      console.error('[VideoChatService] Error in chat:', error);
      throw error;
    }
  }
}

module.exports = new VideoChatService();
