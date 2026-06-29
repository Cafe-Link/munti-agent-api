const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const Tesseract = require('tesseract.js');
const axios = require('axios');
const pLimit = require('p-limit');
const { GoogleAuth } = require('google-auth-library');
const { GoogleGenAI } = require('@google/genai');
const gcsService = require('./ingestion/gcsService');
const ffmpeg = require('ffmpeg-static');

const {
  GOOGLE_CLOUD_PROJECT,
  GEMINI_MODEL,
  GOOGLE_CLOUD_LOCATION,
  getVertexPredictUrl,
} = require('../config/constants');

const CONCURRENCY = 3;
const REQUEST_TIMEOUT = 30000;

/* ---------------------------------------------------
   Vertex AI Setup
--------------------------------------------------- */
const ai = new GoogleGenAI({ vertexai: { project: GOOGLE_CLOUD_PROJECT, location: GOOGLE_CLOUD_LOCATION } });

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
    const child = spawn(cmd, args, {
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });

    child.on('error', reject);
  });
}

async function getMultimodalEmbedding({ text = null, imagePath = null, imageBuffer = null }) {
  const token = await getAccessToken();

  const url = getVertexPredictUrl('multimodalembedding');

  const instance = {};

  if (text) instance.text = text;

  if (imagePath || imageBuffer) {
    const dataBuffer = imageBuffer || await fs.readFile(imagePath);

    instance.image = {
      bytesBase64Encoded: dataBuffer.toString('base64'),
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
   Video Processing Service
--------------------------------------------------- */
class VideoProcessingService {
  constructor() {
    this.baseDir = path.join(__dirname, '../../uploads');
    this.framesDir = path.join(this.baseDir, 'frames');
    this.audioDir = path.join(this.baseDir, 'audio');
    this.tempDir = path.join(this.baseDir, 'temp');
    this.outputDir = path.join(__dirname, '../../vector_embeddings');

    this.limit = pLimit(CONCURRENCY);
    this.worker = null;
  }

  async init() {
    await fs.mkdir(this.framesDir, { recursive: true });
    await fs.mkdir(this.audioDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });
    await fs.mkdir(this.outputDir, { recursive: true });

    if (!this.worker) {
      this.worker = await Tesseract.createWorker('eng');
    }
  }

  async processVideo(file, videoId) {
    await this.init();

    const start = Date.now();
    const gcsFileName = file.gcsFileName;
    const originalName = file.originalname;
    
    // 0. Download from GCS to local temp for ffmpeg processing
    console.log(`[GCS] Downloading video for processing: ${gcsFileName}`);
    const videoBuffer = await gcsService.downloadFile(gcsFileName);
    const localTempPath = path.join(this.tempDir, `${Date.now()}-${originalName}`);
    await fs.writeFile(localTempPath, videoBuffer);

    const videoName = path.basename(
      localTempPath,
      path.extname(localTempPath)
    );

    const framePattern = path.join(
      this.framesDir,
      `${videoName}_%04d.jpg`
    );

    const audioPath = path.join(
      this.audioDir,
      `${videoName}.mp3`
    );

    console.log('================================================');
    console.log(`[START] Processing Video: ${videoId}`);
    console.log(`[FILE] ${localTempPath}`);
    console.log(`[TIME] ${new Date().toLocaleString()}`);
    console.log('================================================');

    try {
      /* Step 1 */
      console.log('[STEP 1/5] Extracting frames (1 FPS)...');

      await runCommand('ffmpeg', [
        '-i',
        localTempPath,
        '-vf',
        'fps=1',
        framePattern,
      ]);

      console.log('[DONE] Frame extraction completed.');

      /* Step 2 */
      console.log('[STEP 2/5] Extracting audio...');

      await runCommand('ffmpeg', [
        '-i',
        localTempPath,
        '-q:a',
        '0',
        '-map',
        'a?',
        audioPath,
      ]);

      console.log('[DONE] Audio extraction completed.');

      /* Step 3 */
      console.log('[STEP 3/5] Transcribing audio...');

      const transcript = await this.transcribeAudio(audioPath);

      console.log(
        `[DONE] Audio transcription completed. Characters: ${transcript.length}`
      );

      /* Step 4 */
      console.log('[STEP 4/5] Processing frames...');

      const files = (await fs.readdir(this.framesDir))
        .filter(
          (file) =>
            file.startsWith(videoName) &&
            file.endsWith('.jpg')
        )
        .sort();

      console.log(`[INFO] Total frames found: ${files.length}`);
      console.log(
        `[INFO] Processing with concurrency: ${CONCURRENCY}`
      );

      const frames = [];

      await Promise.all(
        files.map((file, index) =>
          this.limit(async () => {
            console.log(
              `[FRAME START] ${file} | Timestamp: ${index}s`
            );

            const framePath = path.join(this.framesDir, file);
            const timestamp = index;

            const result = await this.processFrame(
              framePath,
              file,
              timestamp,
              videoId
            );

            frames.push(result);

            console.log(`[FRAME DONE] ${file}`);
          })
        )
      );

      frames.sort((a, b) => a.timestamp - b.timestamp);

      /* Step 5 */
      const output = {
        videoId,
        transcript,
        totalFrames: frames.length,
        processedAt: new Date().toISOString(),
        frames,
      };

      console.log('[STEP 5/5] Saving to Database...');
      try {
        await videoVectorStoreService.saveVideoMetadata(output);
        await videoVectorStoreService.saveFrameEmbeddings(videoId, frames);
        console.log('[DONE] Data saved to PostgreSQL.');
      } catch (err) {
        console.error('[ERROR] Failed to save to database:', err.message);
      }

      const outputPath = path.join(
        this.outputDir,
        `${videoName}.json`
      );

      console.log('[STEP 5/5 (Cont)] Writing JSON backup...');

      await fs.writeFile(
        outputPath,
        JSON.stringify(output, null, 2)
      );

      console.log('[DONE] Output saved successfully.');
      console.log('================================================');
      console.log(`[COMPLETE] ${videoId}`);
      console.log(`[OUTPUT] ${outputPath}`);
      console.log(
        `[TOTAL TIME] ${(
          (Date.now() - start) /
          1000
        ).toFixed(1)} seconds`
      );
      console.log('================================================');

      return output;
    } finally {
      // Cleanup temp local video file
      try {
        await fs.unlink(localTempPath);
      } catch (e) {}
    }
  }

  async processFrame(framePath, frameFile, timestamp, videoId) {
    try {
      const { data } = await this.worker.recognize(framePath);

      const ocrText = this.cleanText(data.text);
      const caption = await this.generateCaption(framePath);

      const [visual, textual] = await Promise.all([
        retry(() =>
          getMultimodalEmbedding({
            imagePath: framePath,
          })
        ),

        retry(() =>
          getMultimodalEmbedding({
            text: `${caption} ${ocrText}`,
          })
        ),
      ]);

      return {
        id: `${videoId}_f${timestamp}`,
        timestamp,
        frameFile,
        caption,
        ocrText,
        visualEmbedding:
          visual.imageEmbedding || [],
        textualEmbedding:
          textual.textEmbedding || [],
      };
    } catch (error) {
      console.error(
        `[FRAME FAILED] ${frameFile}`,
        error.message
      );

      return {
        timestamp,
        frameFile,
        error: error.message,
      };
    }
  }

  cleanText(text = '') {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s.,:-]/g, '')
      .trim();
  }

  async transcribeAudio(audioPath) {
    try {
      const buffer = await fs.readFile(audioPath);

      const result = await retry(() =>
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: [
            {
              inlineData: {
                data: buffer.toString('base64'),
                mimeType: 'audio/mp3',
              },
            },
            'Transcribe this audio accurately.',
          ],
        })
      );

      return result.text || 'No transcript available.';
    } catch (error) {
      return 'No transcript available.';
    }
  }

  async generateCaption(framePath) {
    const buffer = await fs.readFile(framePath);

    const result = await retry(() =>
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            inlineData: {
              data: buffer.toString('base64'),
              mimeType: 'image/jpeg',
            },
          },
          'Describe people, objects, actions, colors and scene in one sentence.',
        ],
      })
    );

    return (
      result.text ||
      'No caption available.'
    );
  }
}

module.exports = new VideoProcessingService();
