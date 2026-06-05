const videoV2Service = require('../services/videoV2Service');
const sessionManager = require('../services/sessionManager');

exports.createSession = async (req, res) => {
  try {
    const result = await videoV2Service.createSession();
    
    // Link to main auth session
    if (req.authSessionId) {
      await sessionManager.startFeatureSession(
        req.authSessionId, 
        'video_oracle_v2', 
        result.sessionId
      );
    }
    
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.uploadVideo = async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!req.file || !sessionId) {
      return res.status(400).json({ error: 'File and sessionId are required.' });
    }
    const result = await videoV2Service.uploadVideo(sessionId, req.file);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.extractFrames = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const result = await videoV2Service.extractFrames(sessionId);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.transcribeVideo = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const result = await videoV2Service.transcribeVideo(sessionId);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createEmbeddings = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const result = await videoV2Service.createEmbeddings(sessionId);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.initVectorStorage = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const result = await videoV2Service.initVectorStorage(sessionId);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProcessStatus = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await videoV2Service.getProcessStatus(sessionId);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.askQuestion = async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message are required.' });
    }
    const result = await videoV2Service.askQuestion(sessionId, message);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.analyzeImage = async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required.' });
    }
    const result = await videoV2Service.analyzeImage(sessionId, message, req.file);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await videoV2Service.deleteSession(sessionId);
    
    // Close in feature sessions tracker
    await sessionManager.endFeatureSession(sessionId);
    
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
