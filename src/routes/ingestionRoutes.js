const express = require('express');
const router = express.Router();
const multer = require('multer');
const ingestionController = require('../controllers/ingestionController');
const { isAuthenticated } = require('../middlewares/authMiddleware');

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Secure ingestion routes
router.use(isAuthenticated);

// Use .any() to allow multiple files from a folder upload
router.post('/upload-batch', upload.any(), ingestionController.handleIngestion);

// New API to clear all documents in the uploaded-doc folder
router.delete('/clear-uploads', ingestionController.handleClearUploadedDocs);

module.exports = router;
