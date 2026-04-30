const express = require('express');
const router = express.Router();
const multer = require('multer');
const ingestionController = require('../controllers/ingestionController');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Use .any() to allow multiple files from a folder upload
router.post('/upload-batch', upload.any(), ingestionController.handleIngestion);

module.exports = router;
