const videoChatService = require('../services/videoChatService');
const customModelVideoChatService = require('../services/CustomModelVideoChatService');
const gcsService = require('../services/ingestion/gcsService');

const chat = async (req, res) => {
  try {
    const { text } = req.body;
    let imageInfo = null;

    if (req.file) {
      console.log(`[VideoChatController] Uploading query image to GCS: ${req.file.originalname}`);
      const gcsResult = await gcsService.uploadFile(req.file);
      imageInfo = {
        ...req.file,
        gcsUrl: gcsResult.url,
        gcsFileName: gcsResult.fileName
      };
    }

    if (!text && !imageInfo) {
      return res.status(400).json({ error: 'Please provide either a question or an image.' });
    }

    console.log(`[VideoChatController] Received standard chat request. Text: ${text || 'None'}, Image: ${imageInfo ? 'Yes' : 'No'}`);
    
    const result = await videoChatService.chat(text, imageInfo);

    res.status(200).json(result);
  } catch (error) {
    console.error('[VideoChatController] Error in standard chat:', error);
    res.status(500).json({ error: 'Failed to process video chat request.', details: error.message });
  }
};

const customChat = async (req, res) => {
  try {
    const { text } = req.body;
    let imageInfo = null;

    if (req.file) {
      console.log(`[VideoChatController] Uploading custom model query image to GCS: ${req.file.originalname}`);
      const gcsResult = await gcsService.uploadFile(req.file);
      imageInfo = {
        ...req.file,
        gcsUrl: gcsResult.url,
        gcsFileName: gcsResult.fileName
      };
    }

    if (!text && !imageInfo) {
      return res.status(400).json({ error: 'Please provide either a question or an image.' });
    }

    console.log(`[VideoChatController] Received custom model chat request. Text: ${text || 'None'}, Image: ${imageInfo ? 'Yes' : 'No'}`);
    
    const result = await customModelVideoChatService.chat(text, imageInfo);

    res.status(200).json(result);
  } catch (error) {
    console.error('[VideoChatController] Error in custom chat:', error);
    res.status(500).json({ error: 'Failed to process custom video chat request.', details: error.message });
  }
};

module.exports = {
  chat,
  customChat
};
