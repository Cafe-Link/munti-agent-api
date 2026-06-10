const express = require('express');
const router = express.Router();
const multer = require('multer');
const ttsController = require('../controllers/ttsController');
const { isAuthenticated } = require('../middlewares/authMiddleware');

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Secure all TTS routes
router.use(isAuthenticated);

// Route to generate speech-friendly text
router.post('/generate', ttsController.handleGenerateSpeechText);

// Route to transcribe audio
router.post('/transcribe', upload.single('audio'), ttsController.handleTranscribeAudio);

module.exports = router;
