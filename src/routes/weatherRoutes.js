const express = require('express');
const router = express.Router();
const multer = require('multer');
const weatherController = require('../controllers/weatherController');
const { isAuthenticated } = require('../middlewares/authMiddleware');

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Secure weather routes
router.use(isAuthenticated);

// Define meaningful endpoint for the weather agent
router.post('/quest', upload.single('audio'), weatherController.handleWeatherQuest);

module.exports = router;
