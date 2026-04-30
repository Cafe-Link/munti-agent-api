const { getWeatherResponseV2 } = require('../services/weatherAgentV2');

const handleChatV2 = async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    const result = await getWeatherResponseV2(message);

    for await (const chunk of result.stream) {
      const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        res.write(text);
      }
    }

    res.end();
  } catch (err) {
    console.error('Error in V2 Controller:', err);
    if (!res.headersSent) {
      res.status(500).send('Error generating response');
    } else {
      res.write('\n[Error generating response]');
      res.end();
    }
  }
};

module.exports = { handleChatV2 };
