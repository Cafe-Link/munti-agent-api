const express = require('express');
const router = express.Router();
const weatherV2Controller = require('../controllers/weatherV2Controller');

router.post('/chat', weatherV2Controller.handleChatV2);

module.exports = router;
