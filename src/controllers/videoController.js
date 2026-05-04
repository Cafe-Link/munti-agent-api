const videoProcessingService = require('../services/videoProcessingService');
const customModelVideoService = require('../services/CustomModelVideoService');
const gcsService = require('../services/ingestion/gcsService');
const path = require('path');

const processVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    console.log(`[VideoController] Uploading video to GCS: ${req.file.originalname}`);
    const gcsResult = await gcsService.uploadFile(req.file);
    
    const videoId = Date.now().toString();

    console.log(`[VideoController] Starting standard processing for video ID: ${videoId}`);
    
    // We pass the file with buffer and gcs metadata to the service
    // The service can decide to download it locally for ffmpeg or process directly
    const results = await videoProcessingService.processVideo({
      ...req.file,
      gcsUrl: gcsResult.url,
      gcsFileName: gcsResult.fileName
    }, videoId);

    res.status(200).json({
      message: 'Video processed successfully (Standard)',
      videoId,
      gcsUrl: gcsResult.url,
      summary: {
        totalFrames: results.frames.length,
        transcriptLength: results.transcript.length,
        ocrMatches: results.textualIndex?.length || 0
      }
    });
  } catch (error) {
    console.error('[VideoController] Error in standard processing:', error);
    res.status(500).json({ error: 'Failed to process video', details: error.message });
  }
};

const processVideoWithCustomModel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    console.log(`[VideoController] Uploading video to GCS (Custom Model): ${req.file.originalname}`);
    const gcsResult = await gcsService.uploadFile(req.file);
    
    const videoId = Date.now().toString();

    console.log(`[VideoController] Starting custom model processing for video ID: ${videoId}`);
    
    const results = await customModelVideoService.processVideo({
      ...req.file,
      gcsUrl: gcsResult.url,
      gcsFileName: gcsResult.fileName
    }, videoId);

    res.status(200).json({
      message: 'Video processed successfully (Custom Model)',
      videoId,
      gcsUrl: gcsResult.url,
      summary: {
        totalFrames: results.totalFrames,
        transcriptLength: results.transcript.length,
        ocrMatches: results.frames.filter(f => f.ocrText).length
      }
    });
  } catch (error) {
    console.error('[VideoController] Error in custom model processing:', error);
    res.status(500).json({ error: 'Failed to process video with custom model', details: error.message });
  }
};

module.exports = {
  processVideo,
  processVideoWithCustomModel
};
