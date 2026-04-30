const videoProcessingService = require('../services/videoProcessingService');
const customModelVideoService = require('../services/CustomModelVideoService');
const path = require('path');
const fs = require('fs/promises');

const processVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const videoPath = req.file.path;
    const videoId = Date.now().toString();

    console.log(`[VideoController] Starting standard processing for video: ${req.file.originalname}`);
    
    // Start processing (this might take a while, so in a real app you might want to return a job ID)
    const results = await videoProcessingService.processVideo(videoPath, videoId);

    res.status(200).json({
      message: 'Video processed successfully (Standard)',
      videoId,
      resultsPath: `vector_embeddings/${path.basename(videoPath, path.extname(videoPath))}_embeddings.json`,
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

    const videoPath = req.file.path;
    const videoId = Date.now().toString();

    console.log(`[VideoController] Starting custom model processing for video: ${req.file.originalname}`);
    
    const results = await customModelVideoService.processVideo(videoPath, videoId);

    res.status(200).json({
      message: 'Video processed successfully (Custom Model)',
      videoId,
      resultsPath: `vector_embeddings/${path.basename(videoPath, path.extname(videoPath))}.json`,
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
