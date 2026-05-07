const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const videoV2Controller = require('../controllers/videoV2Controller');
const { isAuthenticated } = require('../middlewares/authMiddleware');

// Use memory storage for cloud uploads
const storage = multer.memoryStorage();

const videoUpload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /mp4|mov|avi|mkv/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only video files are allowed!'));
  }
});

const imageUpload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only images are allowed for visual search!'));
  }
});

// Apply authentication to all V2 routes
router.use(isAuthenticated);

// API 1: CREATE SESSION
router.post('/session', videoV2Controller.createSession);

// API 2: UPLOAD VIDEO
router.post('/upload', videoUpload.single('file'), videoV2Controller.uploadVideo);

// API 3: EXTRACT FRAMES
router.post('/process/frames', videoV2Controller.extractFrames);

// API 4: TRANSCRIBE VIDEO
router.post('/process/transcribe', videoV2Controller.transcribeVideo);

// API 5: CREATE EMBEDDINGS
router.post('/process/embeddings', videoV2Controller.createEmbeddings);

// API 6: INIT VECTOR STORAGE
router.post('/process/index', videoV2Controller.initVectorStorage);

// API 7: PROCESS STATUS
router.get('/status/:sessionId', videoV2Controller.getProcessStatus);

// API 8: ASK QUESTION
router.post('/chat', videoV2Controller.askQuestion);

// API 10: ANALYZE IMAGE
router.post('/analyze-image', imageUpload.single('image'), videoV2Controller.analyzeImage);

// API 9: DELETE SESSION
router.delete('/session/:sessionId', videoV2Controller.deleteSession);

module.exports = router;
