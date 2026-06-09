const { Storage } = require('@google-cloud/storage');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const Tesseract = require('tesseract.js');
const axios = require('axios');
const pLimit = require('p-limit');
const { GoogleAuth } = require('google-auth-library');
const { GoogleGenAI } = require('@google/genai');
const crypto = require('crypto');
const ffmpeg = require('ffmpeg-static');

const {
  GOOGLE_CLOUD_PROJECT,
  GEMINI_MODEL,
  GCS_BUCKET
} = require('../config/constants');

const videoV2VectorStore = require('./videoV2VectorStore');

const CONCURRENCY = 3;
const REQUEST_TIMEOUT = 30000;

const ai = new GoogleGenAI({ vertexai: { project: GOOGLE_CLOUD_PROJECT, location: 'us-central1' } });

const auth = new GoogleAuth({
  scopes: 'https://www.googleapis.com/auth/cloud-platform',
});

let tokenCache = {
  token: null,
  expiresAt: 0,
};

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

async function retry(fn, attempts = 3, delay = 1000) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, delay * i));
      }
    }
  }
  throw lastError;
}

async function runCommand(command, args) {
  const cmd = command === 'ffmpeg' ? ffmpeg : command;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore' });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function getMultimodalEmbedding({ text = null, imagePath = null, imageBuffer = null }) {
  const token = await getAccessToken();
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/locations/us-central1/publishers/google/models/multimodalembedding:predict`;

  const instance = {};
  if (text) instance.text = text;
  if (imagePath || imageBuffer) {
    const dataBuffer = imageBuffer || await fs.readFile(imagePath);
    instance.image = { bytesBase64Encoded: dataBuffer.toString('base64') };
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

  return response.data.predictions?.[0] || {};
}

class VideoV2Service {
  constructor() {
    this.storage = new Storage({ project: GOOGLE_CLOUD_PROJECT });
    this.bucketName = GCS_BUCKET;
    this.baseTempDir = path.join(__dirname, '../../uploads/v2_sessions');
    this.limit = pLimit(CONCURRENCY);
    this.worker = null;
    
    // Auto cleanup worker
    setInterval(() => this.cleanupExpiredSessions(), 5 * 60 * 1000);
  }

  getSessionDir(sessionId) {
    return path.join(this.baseTempDir, sessionId);
  }

  async initWorker() {
    if (!this.worker) {
      this.worker = await Tesseract.createWorker('eng');
    }
  }

  async checkSession(sessionId) {
    const session = await videoV2VectorStore.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.is_expired) {
      await this.deleteSession(sessionId);
      throw new Error('Session expired');
    }
    return session;
  }

  // API 1: CREATE SESSION
  async createSession() {
    const sessionId = crypto.randomUUID();
    const sessionDir = this.getSessionDir(sessionId);
    await fs.mkdir(path.join(sessionDir, 'frames'), { recursive: true });
    await fs.mkdir(path.join(sessionDir, 'audio'), { recursive: true });
    
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const session = await videoV2VectorStore.createSession(sessionId, expiresAt);
    return { sessionId: session.session_id, expiresAt: session.expires_at };
  }

  // API 2: UPLOAD VIDEO
  async uploadVideo(sessionId, file) {
    await this.checkSession(sessionId);

    const bucket = this.storage.bucket(this.bucketName);
    const gcsFileName = `uploaded-video/${sessionId}/${file.originalname}`;
    const gcsFile = bucket.file(gcsFileName);

    await gcsFile.save(file.buffer, {
      metadata: { contentType: file.mimetype },
    });

    const s3Path = `gs://${this.bucketName}/${gcsFileName}`;
    await videoV2VectorStore.updateSession(sessionId, { s3_path: s3Path, status: 'uploaded' });

    // Also save locally for processing since sequential APIs require local files.
    const sessionDir = this.getSessionDir(sessionId);
    const localVideoPath = path.join(sessionDir, 'video.mp4');
    await fs.writeFile(localVideoPath, file.buffer);

    return { uploaded: true, s3Path };
  }

  // API 3: EXTRACT FRAMES
  async extractFrames(sessionId) {
    await this.checkSession(sessionId);
    const sessionDir = this.getSessionDir(sessionId);
    const localVideoPath = path.join(sessionDir, 'video.mp4');
    const framesDir = path.join(sessionDir, 'frames');
    const framePattern = path.join(framesDir, `frame_%04d.jpg`);

    await videoV2VectorStore.updateSession(sessionId, { status: 'extracting_frames' });

    try {
      await runCommand(ffmpeg, ['-i', localVideoPath, '-vf', 'fps=1', framePattern]);
    } catch (error) {
      console.error('[VideoV2Service] Frame extraction failed:', error);
      throw new Error('Failed to extract frames.');
    }

    const files = await fs.readdir(framesDir);
    const jpgFiles = files.filter(f => f.endsWith('.jpg'));
    const totalFrames = jpgFiles.length;

    await videoV2VectorStore.updateSession(sessionId, { total_frames: totalFrames, status: 'frames_extracted' });

    return { totalFrames };
  }

  // API 4: TRANSCRIBE VIDEO
  async transcribeVideo(sessionId) {
    await this.checkSession(sessionId);
    const sessionDir = this.getSessionDir(sessionId);
    const localVideoPath = path.join(sessionDir, 'video.mp4');
    const audioPath = path.join(sessionDir, 'audio', 'audio.mp3');

    await videoV2VectorStore.updateSession(sessionId, { status: 'transcribing' });

    try {
      await runCommand('ffmpeg', ['-i', localVideoPath, '-q:a', '0', '-map', 'a?', audioPath]);
    } catch (error) {
      // Audio extraction failed (maybe no audio track). Continue without it.
      await videoV2VectorStore.updateSession(sessionId, { status: 'transcribed', transcript: 'No audio track found.' });
      return { transcriptCreated: false, reason: 'No audio' };
    }

    let transcript = 'No transcript available.';
    try {
      const buffer = await fs.readFile(audioPath);
      const result = await retry(() =>
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: [
            { inlineData: { data: buffer.toString('base64'), mimeType: 'audio/mp3' } },
            'Transcribe this audio accurately.',
          ],
        })
      );
      transcript = result.text || 'No transcript available.';
    } catch (error) {
      console.error('[VideoV2Service] Transcription failed:', error);
    }

    await videoV2VectorStore.updateSession(sessionId, { status: 'transcribed', transcript });
    return { transcriptCreated: true };
  }

  // API 5: CREATE EMBEDDINGS
  async createEmbeddings(sessionId) {
    await this.checkSession(sessionId);
    await this.initWorker();
    const sessionDir = this.getSessionDir(sessionId);
    const framesDir = path.join(sessionDir, 'frames');

    await videoV2VectorStore.updateSession(sessionId, { status: 'creating_embeddings' });

    let files;
    try {
      files = (await fs.readdir(framesDir)).filter(f => f.endsWith('.jpg')).sort();
    } catch (e) {
      throw new Error('Frames directory not found. Did you run extractFrames?');
    }

    const framesData = [];

    await Promise.all(
      files.map((file, index) =>
        this.limit(async () => {
          const framePath = path.join(framesDir, file);
          const timestamp = index;
          try {
            const { data } = await this.worker.recognize(framePath);
            const ocrText = data.text.replace(/\s+/g, ' ').replace(/[^\w\s.,:-]/g, '').trim();

            const buffer = await fs.readFile(framePath);
            const captionResult = await retry(() =>
              ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: [
                  { inlineData: { data: buffer.toString('base64'), mimeType: 'image/jpeg' } },
                  'Describe people, objects, actions, colors and scene in one sentence.',
                ]
              })
            );
            const caption = captionResult.text || 'No caption.';

            const [visual, textual] = await Promise.all([
              retry(() => getMultimodalEmbedding({ imagePath: framePath })),
              retry(() => getMultimodalEmbedding({ text: `${caption} ${ocrText}` })),
            ]);

            framesData.push({
              timestamp,
              frameFile: file,
              caption,
              ocrText,
              visualEmbedding: visual.imageEmbedding || [],
              textualEmbedding: textual.textEmbedding || [],
            });
          } catch (err) {
            console.error(`[VideoV2Service] Failed to process frame ${file}:`, err);
          }
        })
      )
    );

    framesData.sort((a, b) => a.timestamp - b.timestamp);

    // Save to Postgres
    await videoV2VectorStore.saveFrameEmbeddings(sessionId, framesData);
    await videoV2VectorStore.updateSession(sessionId, { status: 'embeddings_created' });

    return { embeddingsCreated: true, chunks: framesData.length };
  }

  // API 6: INIT VECTOR STORAGE
  async initVectorStorage(sessionId) {
    await this.checkSession(sessionId);
    await videoV2VectorStore.updateSession(sessionId, { status: 'ready' });
    return { initialized: true, namespace: sessionId };
  }

  // API 7: PROCESS STATUS
  async getProcessStatus(sessionId) {
    const session = await videoV2VectorStore.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.is_expired) {
      await this.deleteSession(sessionId);
      throw new Error('Session expired');
    }

    const statusMap = {
      'created': 0,
      'uploaded': 10,
      'extracting_frames': 25,
      'frames_extracted': 40,
      'transcribing': 50,
      'transcribed': 60,
      'creating_embeddings': 75,
      'embeddings_created': 90,
      'ready': 100
    };

    return {
      stage: session.status,
      percent: statusMap[session.status] || 0,
      ready: session.status === 'ready',
      expiresAt: session.expires_at
    };
  }

  // API 8: ASK QUESTION
  async askQuestion(sessionId, message) {
    const session = await this.checkSession(sessionId);

    // 1. Embed question text
    const queryEmbeddingResponse = await retry(() => getMultimodalEmbedding({ text: message }));
    const queryEmbedding = queryEmbeddingResponse.textEmbedding;

    // 2. Retrieve relevant frames
    const relevantFrames = await videoV2VectorStore.searchSimilarFrames(sessionId, queryEmbedding, 3);

    // 3. Create context for LLM
    const contextText = relevantFrames.map(f => 
      `[Time: ${f.timestamp}s] Caption: ${f.caption}. OCR: ${f.ocrText}`
    ).join('\n');

    const prompt = `
You are an expert video analyst answering questions about a specifically uploaded video.
Use ONLY the provided context from the video.

Video Transcript Context:
${session.transcript || 'None available.'}

Relevant Visual Frame Context:
${contextText}

Question: ${message}
Answer grounded in the context. Include timestamp references (e.g. at 5s) if possible.
`;

    const chatSession = ai.chats.create({
      model: GEMINI_MODEL,
      config: {
        systemInstruction: prompt
      }
    });

    const result = await retry(() => chatSession.sendMessage({ message }));
    const answer = result.text;

    return {
      answer,
      sources: relevantFrames.map(f => f.caption),
      timestamps: relevantFrames.map(f => f.timestamp)
    };
  }

  // API 10: ANALYZE IMAGE
  async analyzeImage(sessionId, message, imageFile) {
    const session = await this.checkSession(sessionId);

    // 1. Generate multimodal embeddings for image and text
    const [visualEmbeddingRes, textualEmbeddingRes] = await Promise.all([
      retry(() => getMultimodalEmbedding({ imageBuffer: imageFile.buffer })),
      message ? retry(() => getMultimodalEmbedding({ text: message })) : Promise.resolve(null)
    ]);

    const visualEmbedding = visualEmbeddingRes.imageEmbedding;
    const textualEmbedding = textualEmbeddingRes?.textEmbedding || null;

    // 2. Retrieve relevant frames visually and textually
    const relevantFrames = await videoV2VectorStore.searchSimilarFramesVisual(sessionId, visualEmbedding, textualEmbedding, 3);

    // 3. Prompt LLM
    const contextText = relevantFrames.map(f => 
      `[Time: ${f.timestamp}s] Caption: ${f.caption}. OCR: ${f.ocrText}`
    ).join('\n');

    const prompt = `
You are an expert video analyst answering questions about a specific uploaded video.
The user provided an image and potentially a question: "${message || 'Explain this image according to the video.'}"
We matched the user's image to the following video frames based on visual similarity:

Relevant Visual Frame Context:
${contextText}

Video Transcript Context:
${session.transcript || 'None available.'}

Answer the user's question grounded ONLY in this context. Include the timestamps (e.g. at 5s) of the most likely matches.
`;

    const chatSession = ai.chats.create({
      model: GEMINI_MODEL,
      config: {
        systemInstruction: prompt
      }
    });

    const result = await retry(() => chatSession.sendMessage({ message: prompt }));
    const answer = result.text;

    return {
      answer,
      matches: relevantFrames.map(f => ({
        timestamp: f.timestamp,
        score: f.score,
        caption: f.caption
      })),
      timestamps: relevantFrames.map(f => f.timestamp)
    };
  }

  // API 9: DELETE SESSION
  async deleteSession(sessionId) {
    console.log(`[VideoV2Service] Starting full cleanup for session: ${sessionId}`);
    
    // 1. Clear Database Rows
    try {
      await videoV2VectorStore.deleteSession(sessionId);
      console.log(`[VideoV2Service] Database rows cleared for ${sessionId}`);
    } catch (e) {
      console.error(`[VideoV2Service] Failed to clear DB rows for ${sessionId}:`, e);
    }
    
    // 2. Clear Local Temporary Files
    const sessionDir = this.getSessionDir(sessionId);
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
      console.log(`[VideoV2Service] Local temp files cleared for ${sessionId}`);
    } catch (e) {
      console.error(`[VideoV2Service] Failed to delete temp dir for session ${sessionId}:`, e);
    }
    
    // 3. Clear Cloud Storage (GCS/S3)
    const bucket = this.storage.bucket(this.bucketName);
    try {
      // Deletes the folder and all its contents (the video, etc.)
      await bucket.deleteFiles({ prefix: `uploaded-video/${sessionId}/` });
      console.log(`[VideoV2Service] Cloud storage cleared for ${sessionId}`);
    } catch(e) {
      console.error(`[VideoV2Service] Failed to clean cloud storage for session ${sessionId}:`, e);
    }

    return { deleted: true };
  }

  async cleanupExpiredSessions() {
    try {
      const expired = await videoV2VectorStore.getExpiredSessions();
      for (const session of expired) {
        console.log(`[VideoV2Service] Auto-cleaning expired session: ${session.session_id}`);
        await this.deleteSession(session.session_id);
      }
    } catch (error) {
      console.error('[VideoV2Service] Error cleaning expired sessions:', error);
    }
  }
}

module.exports = new VideoV2Service();
