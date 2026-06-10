const { GoogleGenAI } = require('@google/genai');
const { GOOGLE_CLOUD_PROJECT, GEMINI_MODEL } = require('../config/constants');

// Initialize Google Gen AI with Vertex AI capabilities
const ai = new GoogleGenAI({ vertexai: { project: GOOGLE_CLOUD_PROJECT, location: 'us-central1' } });

const systemInstruction = `
You are a Text-to-Speech (TTS) optimization assistant. Your task is to convert written text (which may contain markdown, special symbols, mathematical equations, tables, code blocks, or nested bullet points) into clear, natural, human-friendly, and highly conversational spoken English.

Instructions:
1. Strip all markdown syntax:
   - Remove asterisks, underscores, hashes, backticks, brackets, etc.
   - For bold phrases, do not speak "bold", just integrate them smoothly.
   - For inline code or block code, do not speak backticks.
2. Transform tables, bullet lists, and structured data into a flowing spoken format:
   - Instead of reading dashes, vertical bars, or brackets, explain the rows/columns or bullets naturally (e.g., "First, ...", "Second, ...", or "This includes...").
   - Maintain the logical structure but present it as a continuous spoken narrative.
3. Clean special characters:
   - Convert symbols to spoken equivalents when appropriate (e.g., "%" to "percent", "$" to "dollars", "⚠️" to "warning", "+" to "plus").
   - Ensure the output reads beautifully when spoken by a standard voice synthesis tool.
4. Keep the original semantic meaning, depth, and information complete. Do not summarize or omit important details, unless they are purely presentation-based (like formatting tables).
5. Output ONLY the finalized spoken text. Do not include any meta-commentary, introduction, or explanations (e.g., do not say "Here is the spoken-friendly text:").
`;

/**
 * Endpoint to convert display-optimized text into natural conversational spoken text.
 */
const handleGenerateSpeechText = async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({
      status: 'error',
      message: 'Text is required'
    });
  }

  try {
    console.log("[TTS Controller] Converting text to speech-friendly format via Gemini...");
    
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: systemInstruction },
            { text: `Convert this text:\n\n${text}` }
          ]
        }
      ]
    });

    const speechText = response.text || text;
    console.log("[TTS Controller] Successfully generated speech-friendly text.");

    res.status(200).json({
      status: 'success',
      speechText: speechText.trim()
    });
  } catch (error) {
    console.error("ERROR in TTS Controller:", error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to generate speech-friendly text',
      error: error.message
    });
  }
};

/**
 * Endpoint to transcribe audio using Gemini 2.5 Flash
 */
const handleTranscribeAudio = async (req, res) => {
  const audioFile = req.file;

  if (!audioFile) {
    return res.status(400).json({
      status: 'error',
      message: 'Audio file is required'
    });
  }

  try {
    console.log("[TTS Controller] Transcribing audio file via Gemini...");
    const result = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: "Transcribe the following audio. Respond only with the transcribed text, without any additional commentary or preamble." },
            { inlineData: { mimeType: audioFile.mimetype, data: audioFile.buffer.toString("base64") } }
          ]
        }
      ]
    });

    const transcribedText = result.text || '';
    console.log("[TTS Controller] Transcription result:", transcribedText.trim());

    res.status(200).json({
      status: 'success',
      text: transcribedText.trim()
    });
  } catch (error) {
    console.error("ERROR in Audio Transcription:", error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to transcribe audio',
      error: error.message
    });
  }
};

module.exports = {
  handleGenerateSpeechText,
  handleTranscribeAudio
};
