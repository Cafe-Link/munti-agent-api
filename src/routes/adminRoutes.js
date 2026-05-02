const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { isAdmin } = require('../middlewares/authMiddleware');

// Apply admin guard to all routes
router.use(isAdmin);

router.get('/users', adminController.getUsers);
router.get('/agents', adminController.getAgents);
router.put('/users/allowed-agents', adminController.updateUserAgents);
router.post('/agents', adminController.addAgent);

module.exports = router;
