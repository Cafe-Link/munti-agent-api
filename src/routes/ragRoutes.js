const express = require('express');
const router = express.Router();
const multer = require('multer');
const ragController = require('../controllers/ragController');

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.post('/upload', upload.single('file'), ragController.handleUpload);
router.post('/chat', ragController.handleRagChat);
router.post('/company-chat', ragController.handleCompanyChat);
router.post('/company-chat-v2', ragController.handleCompanyChatV2);
router.post('/clear', ragController.handleClearKnowledgeBase);

module.exports = router;
