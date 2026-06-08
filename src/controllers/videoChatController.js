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

    if (result.stream) {
      // Set headers for chunked streaming
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Connection', 'keep-alive');

      // If there are matches, we can optionally send them as a structured string first 
      // or append them later. The user wants the matches appended to the text.
      // We'll stream the AI response text first.
      
      try {
        for await (const chunk of result.stream.stream) {
          const chunkText = chunk.candidates[0]?.content?.parts[0]?.text || '';
          if (chunkText) {
            res.write(chunkText);
          }
        }
      } catch (streamErr) {
        console.error("Stream generation error:", streamErr);
      }

      // After streaming the text, append the matches at the end
      if (result.matches && result.matches.length > 0) {
        let matchesText = "\n\n**Matched Moments:**\n";
        result.matches.forEach(match => {
          matchesText += `- **${match.timestamp}s**: ${match.caption} (Confidence: ${match.confidence})\n`;
        });
        res.write(matchesText);
      }

      res.end();
    } else {
      res.status(200).json(result);
    }
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
