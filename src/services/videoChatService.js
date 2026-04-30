const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const { VertexAI } = require('@google-cloud/vertexai');
const { GOOGLE_CLOUD_PROJECT, GEMINI_MODEL } = require('../config/constants');
const videoVectorStoreService = require('./videoVectorStoreService');

const vertexAI = new VertexAI({
  project: GOOGLE_CLOUD_PROJECT,
  location: 'us-central1',
});

const model = vertexAI.getGenerativeModel({ model: GEMINI_MODEL });
const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

const REQUEST_TIMEOUT = 30000;
let tokenCache = { token: null, expiresAt: 0 };

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

async function getMultimodalEmbedding({ text = null, imagePath = null }) {
  const token = await getAccessToken();

  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/us-central1/publishers/google/models/multimodalembedding:predict`;

  const instance = {};
  if (text) instance.text = text;

  if (imagePath) {
    const imageBuffer = await fs.readFile(imagePath);
    instance.image = {
      bytesBase64Encoded: imageBuffer.toString('base64'),
    };
  }

  const response = await axios.post(
    url,
    { instances: [instance] },
    {
      timeout: REQUEST_TIMEOUT,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const prediction = response.data.predictions?.[0] || {};
  return text ? prediction.textEmbedding : prediction.imageEmbedding;
}

function extractText(result) {
  return result?.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

class VideoChatService {
  constructor() {
    this.metadataDir = path.join(__dirname, '../../vector_embeddings');
    // We don't really need a default file anymore if we use DB, 
    // but we might need a default videoId.
    this.defaultVideoId = '1777360029752'; 
  }

  async chat(queryText = '', imagePath = null) {
    const startedAt = Date.now();

    console.log('================================================');
    console.log('[CHAT REQUEST STARTED - POSTGRES]');
    console.log(`[QUERY] ${queryText || 'Image Search Query'}`);
    console.log(`[TYPE] ${imagePath ? 'Image + Text' : 'Text Only'}`);
    console.log('================================================');

    try {
      console.log('[STEP 1/5] Generating query embedding...');
      const queryEmbedding = await getMultimodalEmbedding({
        text: queryText || null,
        imagePath,
      });
      console.log('[DONE] Query embedding generated.');

      console.log('[STEP 2/5] Searching PostgreSQL Vector Database...');
      const matchedFrames = await videoVectorStoreService.findSimilarFrames(queryEmbedding, 5);
      console.log(`[DONE] Retrieved ${matchedFrames?.length || 0} nearest matches from DB.`);

      if (!matchedFrames || matchedFrames.length === 0) {
        return { response: "I couldn't find any relevant moments in the video." };
      }

      // Get video metadata (transcript) from DB for the first matched frame's video
      const videoId = matchedFrames[0].video_id;
      console.log(`[STEP 3/5] Loading metadata for video: ${videoId}...`);
      const videoMetadata = await videoVectorStoreService.getVideoMetadata(videoId);
      console.log(`[DONE] Metadata loaded.`);

      console.log('[STEP 4/5] Preparing AI context...');
      const context = matchedFrames.map((frame, i) => {
        return `${i + 1}. Timestamp: ${frame.timestamp}s\nCaption: ${frame.caption || 'N/A'}\nOCR Text: ${frame.ocr_text || 'None'}\nSimilarity Score: ${frame.distance.toFixed(4)}`;
      }).join('\n\n');

      const transcript = (videoMetadata?.transcript || '').slice(0, 4000);

      const prompt = `
You are an intelligent AI video assistant.
Your job is to answer the user's question using ONLY the retrieved video context below.

IMPORTANT RULES:
1. Use only provided context.
2. Mention timestamps whenever possible.
3. If confidence is low, say so clearly.
4. If user uploaded an image, explain the closest matching moment in the video.
5. Be concise, accurate, and helpful.

RETRIEVED VIDEO MATCHES:
${context}

VIDEO TRANSCRIPT (partial):
${transcript}

USER QUERY:
${queryText || 'Analyze the uploaded image and find matching scene in the video.'}

FINAL RESPONSE:
`;

      console.log('[STEP 5/5] Generating final answer with Gemini...');
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      const answer = extractText(result) || 'I could not generate a useful answer.';

      console.log('[DONE] Response generated successfully.');
      console.log(`[TOTAL TIME] ${((Date.now() - startedAt) / 1000).toFixed(1)} sec`);
      console.log('================================================');

      return {
        response: answer,
        matches: matchedFrames.map(frame => ({
          timestamp: frame.timestamp,
          caption: frame.caption,
          confidence: (1 - frame.distance).toFixed(4), // Approximate confidence
        })),
      };
    } catch (error) {
      console.error('[CHAT ERROR]', error.message);
      return {
        response: 'An internal error occurred while processing your request.',
      };
    }
  }
}

module.exports = new VideoChatService();
