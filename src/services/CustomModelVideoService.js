const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const pLimit = require('p-limit');
const ffmpeg = require('ffmpeg-static');

const CONCURRENCY = 2;
const REQUEST_TIMEOUT = 60000;

const { AI_API_BASE } = require('../config/constants');

const ANALYZE_FRAME_API = `${AI_API_BASE}/analyze-frame`;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeVector(input) {
  if (!Array.isArray(input)) return [];

  const flat = input.flat(Infinity);

  return flat
    .map(Number)
    .filter(v => Number.isFinite(v));
}

async function retry(fn, attempts = 3, delay = 1000) {
  let lastError;

  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.log(`[Retry ${i}/${attempts}] ${error.message}`);

      if (i < attempts) {
        await sleep(delay * i);
      }
    }
  }

  throw lastError;
}

async function runCommand(command, args) {
  const cmd = command === 'ffmpeg' ? ffmpeg : command;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);

    child.stdout.on('data', data => process.stdout.write(data));
    child.stderr.on('data', data => process.stderr.write(data));

    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with code ${code}`));
    });

    child.on('error', reject);
  });
}

async function callAnalyzeFrameAPI(imagePath) {
  const form = new FormData();
  form.append('file', fsSync.createReadStream(imagePath));

  const response = await axios.post(ANALYZE_FRAME_API, form, {
    timeout: REQUEST_TIMEOUT,
    headers: form.getHeaders()
  });

  return response.data || {};
}

/**
 * Manually stream the JSON output to file to avoid "Invalid string length" errors
 * for large video metadata files.
 */
async function streamWriteJson(outputPath, data) {
  const writeStream = fsSync.createWriteStream(outputPath, { encoding: 'utf8' });

  return new Promise((resolve, reject) => {
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);

    writeStream.write('{\n');
    writeStream.write(`  "id": ${JSON.stringify(data.id)},\n`);
    writeStream.write(`  "videoId": ${JSON.stringify(data.videoId)},\n`);
    writeStream.write(`  "transcript": ${JSON.stringify(data.transcript)},\n`);
    writeStream.write(`  "totalFrames": ${data.totalFrames},\n`);
    writeStream.write(`  "processedAt": ${JSON.stringify(data.processedAt)},\n`);
    writeStream.write('  "frames": [\n');

    for (let i = 0; i < data.frames.length; i++) {
      const frame = data.frames[i];
      const frameString = JSON.stringify(frame, null, 2);
      // Indent frame string
      const indented = frameString.split('\n').map(line => '    ' + line).join('\n');
      
      writeStream.write(indented.trimStart());
      
      if (i < data.frames.length - 1) {
        writeStream.write(',\n');
      } else {
        writeStream.write('\n');
      }
    }

    writeStream.write('  ]\n');
    writeStream.write('}\n');
    writeStream.end();
  });
}

class CustomModelVideoService {
  constructor() {
    this.baseDir = path.join(__dirname, '../../uploads');
    this.framesDir = path.join(this.baseDir, 'frames');
    this.audioDir = path.join(this.baseDir, 'audio');
    this.outputDir = path.join(__dirname, '../../vector_embeddings');

    this.limit = pLimit(CONCURRENCY);
  }

  async init() {
    await fs.mkdir(this.framesDir, { recursive: true });
    await fs.mkdir(this.audioDir, { recursive: true });
    await fs.mkdir(this.outputDir, { recursive: true });
  }

  async cleanOldFrames(videoName) {
    const files = await fs.readdir(this.framesDir);

    await Promise.all(
      files
        .filter(file => file.startsWith(videoName))
        .map(file =>
          fs.unlink(path.join(this.framesDir, file)).catch(() => {})
        )
    );
  }

  async processVideo(videoPath, videoId) {
    await this.init();

    const startedAt = Date.now();

    const videoName = path.basename(videoPath, path.extname(videoPath));
    const framePattern = path.join(
      this.framesDir,
      `${videoName}_%04d.jpg`
    );

    const audioPath = path.join(
      this.audioDir,
      `${videoName}.mp3`
    );

    await this.cleanOldFrames(videoName);

    console.log('==================================================');
    console.log('[START] Video Processing (Local AI Pipeline)');
    console.log(`[VIDEO] ${videoPath}`);
    console.log(`[VIDEO ID] ${videoId}`);
    console.log('==================================================');

    /*
      STEP 1 - FRAMES
    */
    console.log('[STEP 1/5] Extracting Frames (1 FPS)...');

    await runCommand('ffmpeg', [
      '-y',
      '-i',
      videoPath,
      '-vf',
      'fps=1',
      framePattern
    ]);

    console.log('[DONE] Frames Extracted');

    /*
      STEP 2 - AUDIO
    */
    console.log('[STEP 2/5] Extracting Audio...');

    await runCommand('ffmpeg', [
      '-y',
      '-i',
      videoPath,
      '-q:a',
      '0',
      '-map',
      'a?',
      audioPath
    ]);

    console.log('[DONE] Audio Extracted');

    /*
      STEP 3 - TRANSCRIPT
    */
    console.log('[STEP 3/5] Audio Transcription...');
    const transcript = 'Transcript not enabled for local pipeline yet.';
    console.log('[DONE] Transcript Placeholder Ready');

    /*
      STEP 4 - FRAME PROCESSING
    */
    const files = (await fs.readdir(this.framesDir))
      .filter(file =>
        file.startsWith(videoName) &&
        file.endsWith('.jpg')
      )
      .sort();

    console.log(`[STEP 4/5] Found ${files.length} frames`);
    console.log(`[INFO] Concurrency = ${CONCURRENCY}`);

    const frames = [];

    await Promise.all(
      files.map((file, index) =>
        this.limit(async () => {
          const frameStart = Date.now();

          const framePath = path.join(
            this.framesDir,
            file
          );

          const timestamp = index;

          console.log(`\n[FRAME START] ${file} @ ${timestamp}s`);

          try {
            const analysis = await retry(() =>
              callAnalyzeFrameAPI(framePath)
            );

            const visualEmbedding = normalizeVector(analysis.image_embedding || []);
            const textualEmbedding = normalizeVector(analysis.text_embedding || []);

            if (!visualEmbedding.length) {
              throw new Error(
                'Invalid visual embedding received'
              );
            }

            if (!textualEmbedding.length) {
              throw new Error(
                'Invalid textual embedding received'
              );
            }

            frames.push({
              id: `${videoId}_f${index}`,
              timestamp,
              frameFile: file,

              caption: analysis.caption || '',
              ocrText: analysis.ocr || '',

              visualEmbedding,
              textualEmbedding
            });

            const sec = (
              (Date.now() - frameStart) /
              1000
            ).toFixed(1);

            console.log(
              `[FRAME DONE] ${file} (${sec}s)`
            );
          } catch (error) {
            console.log(
              `[FRAME FAILED] ${file}`
            );
            console.log(error.message);
          }
        })
      )
    );

    frames.sort((a, b) => a.timestamp - b.timestamp);

    /*
      STEP 5 - SAVE
    */
    console.log('\n[STEP 5/5] Saving JSON (Streaming)...');

    const output = {
      id: `${videoId}_meta`,
      videoId,
      transcript,
      totalFrames: frames.length,
      processedAt: new Date().toISOString(),
      frames
    };

    const outputPath = path.join(
      this.outputDir,
      `${videoName}.json`
    );

    // Use streaming write to avoid "Invalid string length" error
    await streamWriteJson(outputPath, output);

    const totalTime = (
      (Date.now() - startedAt) /
      1000
    ).toFixed(1);

    console.log('==================================================');
    console.log('[COMPLETE]');
    console.log(`[FRAMES SAVED] ${frames.length}`);
    console.log(`[OUTPUT] ${outputPath}`);
    console.log(`[TOTAL TIME] ${totalTime}s`);
    console.log('==================================================');

    return output;
  }
}

module.exports = new CustomModelVideoService();
