const { VertexAI } = require('@google-cloud/vertexai');
const { GOOGLE_CLOUD_PROJECT, GEMINI_MODEL } = require('../config/constants');

const vertex_ai = new VertexAI({
  project: GOOGLE_CLOUD_PROJECT,
  location: 'us-central1',
});

const model = vertex_ai.getGenerativeModel({
  model: GEMINI_MODEL,
});

async function getWeatherResponseV2(query) {
  const prompt = `
You are a weather assistant.

Task:
1. Get 7-day weather forecast for the given city.
2. Suggest what user should wear or carry.

User input: ${query}
`;

  const result = await model.generateContentStream({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  return result;
}

module.exports = { getWeatherResponseV2 };
