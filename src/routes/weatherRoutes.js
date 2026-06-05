const express = require('express');
const router = express.Router();
const weatherController = require('../controllers/weatherController');
const { isAuthenticated } = require('../middlewares/authMiddleware');

// Secure weather routes
router.use(isAuthenticated);

// Define meaningful endpoint for the weather agent
router.post('/quest', weatherController.handleWeatherQuest);

module.exports = router;
