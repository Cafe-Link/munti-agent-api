const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ragController = require('../controllers/ragController');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    // Save with original name to make it easy for user to see in the folder
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

router.post('/upload', upload.single('file'), ragController.handleUpload);
router.post('/chat', ragController.handleRagChat);
router.post('/company-chat', ragController.handleCompanyChat);
router.post('/company-chat-v2', ragController.handleCompanyChatV2);
router.post('/clear', ragController.handleClearKnowledgeBase);

module.exports = router;
