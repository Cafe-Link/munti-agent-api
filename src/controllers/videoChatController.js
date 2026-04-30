const videoChatService = require('../services/videoChatService');
const customModelVideoChatService = require('../services/CustomModelVideoChatService');

const chat = async (req, res) => {
  try {
    const { text } = req.body;
    const imagePath = req.file ? req.file.path : null;

    if (!text && !imagePath) {
      return res.status(400).json({ error: 'Please provide either a question or an image.' });
    }

    console.log(`[VideoChatController] Received standard chat request. Text: ${text || 'None'}, Image: ${imagePath ? 'Yes' : 'No'}`);
    
    const result = await videoChatService.chat(text, imagePath);

    res.status(200).json(result);
  } catch (error) {
    console.error('[VideoChatController] Error in standard chat:', error);
    res.status(500).json({ error: 'Failed to process video chat request.', details: error.message });
  }
};

const customChat = async (req, res) => {
  try {
    const { text } = req.body;
    const imagePath = req.file ? req.file.path : null;

    if (!text && !imagePath) {
      return res.status(400).json({ error: 'Please provide either a question or an image.' });
    }

    console.log(`[VideoChatController] Received custom model chat request. Text: ${text || 'None'}, Image: ${imagePath ? 'Yes' : 'No'}`);
    
    const result = await customModelVideoChatService.chat(text, imagePath);

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
