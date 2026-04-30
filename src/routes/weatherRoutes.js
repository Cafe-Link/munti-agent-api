const express = require('express');
const router = express.Router();
const weatherController = require('../controllers/weatherController');

// Define meaningful endpoint for the weather agent
router.post('/quest', weatherController.handleWeatherQuest);

module.exports = router;
