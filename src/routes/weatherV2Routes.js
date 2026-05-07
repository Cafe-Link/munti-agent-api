const express = require('express');
const router = express.Router();
const weatherV2Controller = require('../controllers/weatherV2Controller');
const { isAuthenticated } = require('../middlewares/authMiddleware');

// Secure weather v2 routes
router.use(isAuthenticated);

router.post('/chat', weatherV2Controller.handleChatV2);

module.exports = router;
