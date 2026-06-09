const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const { GoogleGenAI } = require('@google/genai');
const { GOOGLE_CLOUD_PROJECT, GEMINI_MODEL, AI_API_BASE } = require('../config/constants');
const vertexVectorSearchService = require('./vertexVectorSearchService');

const ai = new GoogleGenAI({ vertexai: { project: GOOGLE_CLOUD_PROJECT, location: 'us-central1' } });

const REQUEST_TIMEOUT = 60000;

/*
|--------------------------------------------------------------------------
| AI API CONFIGURATION
|--------------------------------------------------------------------------
*/
const EMBED_TEXT_API = `${AI_API_BASE}/embed-text`;
const EMBED_IMAGE_API = `${AI_API_BASE}/embed-image`;

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/
async function callTextEmbeddingAPI(text) {
  const response = await axios.post(
    EMBED_TEXT_API,
    { text },
    { timeout: REQUEST_TIMEOUT }
  );

  return response.data.embedding || [];
}

async function callImageEmbeddingAPI(imagePath) {
  const form = new FormData();
  form.append('file', fsSync.createReadStream(imagePath));

  const response = await axios.post(
    EMBED_IMAGE_API,
    form,
    {
      timeout: REQUEST_TIMEOUT,
      headers: form.getHeaders(),
    }
  );

  return response.data.embedding || [];
}

async function getQueryEmbedding({ text = '', imagePath = null }) {
  /*
    IMAGE QUERY = use image embedding
    TEXT QUERY = use text embedding
    IMAGE + TEXT = prefer image embedding
  */

  if (imagePath) {
    return await callImageEmbeddingAPI(imagePath);
  }

  return await callTextEmbeddingAPI(text);
}

class CustomModelVideoChatService {
  constructor() {
    this.metadataDir = path.join(__dirname, '../../vector_embeddings');
    this.defaultFile = 'video_1777360029571.json';
  }

  async getMetadata(fileName = this.defaultFile) {
    const filePath = path.join(this.metadataDir, fileName);
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  }

  async chat(queryText = '', imagePath = null) {
    const startedAt = Date.now();

    console.log('================================================');
    console.log('[CUSTOM CHAT REQUEST STARTED]');
    console.log(`[QUERY] ${queryText || 'Image Search Query'}`);
    console.log(`[TYPE] ${imagePath ? 'Image Search' : 'Text Search'}`);
    console.log('================================================');

    try {
      /*
      ------------------------------------------------------------------
      STEP 1 - EMBEDDING
      ------------------------------------------------------------------
      */
      console.log('[STEP 1/5] Generating query embedding via Custom Model API...');

      const queryEmbedding = await getQueryEmbedding({
        text: queryText,
        imagePath,
      });

      console.log(
        `[DONE] Query embedding generated. Dimensions: ${queryEmbedding.length}`
      );

      /*
      ------------------------------------------------------------------
      STEP 2 - VECTOR SEARCH
      ------------------------------------------------------------------
      */
      console.log('[STEP 2/5] Searching Vector Database...');

      const neighbors =
        await vertexVectorSearchService.findNeighbors(
          queryEmbedding,
          5
        );

      console.log(
        `[DONE] Retrieved ${neighbors?.length || 0} nearest matches.`
      );

      if (!neighbors || neighbors.length === 0) {
        return {
          response:
            "I couldn't find any relevant moments in the video.",
        };
      }

      /*
      ------------------------------------------------------------------
      STEP 3 - LOAD JSON METADATA
      ------------------------------------------------------------------
      */
      console.log('[STEP 3/5] Loading metadata...');

      // Note: We might want to pass the specific videoId/filename here
      const metadata = await this.getMetadata();
      const frames = metadata.frames || [];

      console.log(
        `[DONE] Metadata loaded. Total frames: ${frames.length}`
      );

      /*
      ------------------------------------------------------------------
      STEP 4 - MATCH FRAME DATA
      ------------------------------------------------------------------
      */
      console.log('[STEP 4/5] Resolving matched frames...');

      const matchedFrames = neighbors
        .map(item => {
          const id = item.datapoint?.datapointId;

          const frame = frames.find(
            f =>
              f.id === id ||
              f.frameFile === id
          );

          if (!frame) return null;

          return {
            ...frame,
            distance: item.distance,
          };
        })
        .filter(Boolean);

      /*
        IMPORTANT:
        Higher distance = better similarity
      */
      matchedFrames.sort(
        (a, b) => b.distance - a.distance
      );

      if (!matchedFrames.length) {
        return {
          response:
            'Vectors matched, but metadata frames were missing.',
        };
      }

      console.log(
        `[DONE] ${matchedFrames.length} frames resolved.`
      );

      /*
      ------------------------------------------------------------------
      STEP 5 - KEEP GEMINI PART SAME
      ------------------------------------------------------------------
      */
      const context = matchedFrames
        .map((frame, i) => {
          return `${i + 1}. Timestamp: ${frame.timestamp}s
Caption: ${frame.caption || 'N/A'}
OCR Text: ${frame.ocrText || 'None'}
Scene Summary: ${frame.sceneSummary || 'N/A'}
Similarity Score: ${frame.distance.toFixed(4)}`;
        })
        .join('\n\n');

      const transcript = (
        metadata.transcript || ''
      ).slice(0, 4000);

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

      console.log(
        '[STEP 5/5] Generating final answer with Gemini...'
      );

      const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt
      });

      const answer =
        result.text ||
        'I could not generate a useful answer.';

      console.log('[DONE] Response generated.');
      console.log(
        `[TOTAL TIME] ${(
          (Date.now() - startedAt) /
          1000
        ).toFixed(1)} sec`
      );
      console.log('================================================');

      return {
        response: answer,
        matches: matchedFrames.map(frame => ({
          timestamp: frame.timestamp,
          caption: frame.caption,
          confidence: frame.distance.toFixed(4),
        })),
      };
    } catch (error) {
      console.error('[CHAT ERROR]', error.message);

      return {
        response:
          'An internal error occurred while processing your request.',
      };
    }
  }
}

module.exports = new CustomModelVideoChatService();
