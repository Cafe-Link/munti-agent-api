const { runWeatherQuest } = require('../services/weatherAgent');

/**
 * Handle weather quest chat requests
 */
const handleWeatherQuest = async (req, res) => {
  const { input, history } = req.body;

  // These logs will appear in your terminal where you run 'node index.js'
  console.log("--- New Request Received ---");
  console.log("Input:", input);
  console.log("History Length:", history ? history.length : 0);

  if (!input) {
    return res.status(400).json({ 
      status: 'error',
      message: 'Input is required' 
    });
  }

  try {
    console.log("Calling weather agent service...");
    const content = await runWeatherQuest(input, history);
    
    console.log("Agent response generated successfully.");
    res.status(200).json({
      status: 'success',
      data: {
        content
      }
    });
  } catch (error) {
    console.error("CRITICAL ERROR in Weather Controller:", error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to process weather request',
      error: error.message
    });
  }
};

module.exports = {
  handleWeatherQuest
};
