const { GoogleGenAI } = require('@google/genai');
const { GOOGLE_CLOUD_PROJECT, GEMINI_MODEL, GOOGLE_CLOUD_LOCATION } = require('../config/constants');

const ai = new GoogleGenAI({ vertexai: { project: GOOGLE_CLOUD_PROJECT, location: GOOGLE_CLOUD_LOCATION } });

async function getWeatherResponseV2(query) {
  const prompt = `
You are a weather assistant.

Task:
1. Get 7-day weather forecast for the given city.
2. Suggest what user should wear or carry.

User input: ${query}
`;

  const result = await ai.models.generateContentStream({
    model: GEMINI_MODEL,
    contents: prompt
  });

  return result;
}

module.exports = { getWeatherResponseV2 };
