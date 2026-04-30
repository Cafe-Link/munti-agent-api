const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const videoController = require('../controllers/videoController');
const videoChatController = require('../controllers/videoChatController');

// Configure multer for video uploads
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `video_${Date.now()}${path.extname(file.originalname)}`);
  }
});

const videoUpload = multer({ 
  storage: videoStorage,
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

// Configure multer for image queries
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/queries/');
  },
  filename: (req, file, cb) => {
    cb(null, `query_${Date.now()}${path.extname(file.originalname)}`);
  }
});

const imageUpload = multer({ 
  storage: imageStorage,
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

// Video processing route
router.post('/process', videoUpload.single('video'), videoController.processVideo);

// New Custom Model Video Processing route
router.post('/process-custom', videoUpload.single('video'), videoController.processVideoWithCustomModel);

// Video chat/search route (Handles text and/or image)
router.post('/chat', imageUpload.single('image'), videoChatController.chat);

// New Custom Model Video Chat route
router.post('/chat-custom', imageUpload.single('image'), videoChatController.customChat);

module.exports = router;
