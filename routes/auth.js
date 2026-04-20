const express = require('express');
const router = express.Router();
const { registerStaff, login, getMe } = require('../controllers/authController');
const auth = require('../middleware/auth');

router.post('/register', registerStaff);
router.post('/login', login);
router.get('/me', auth, getMe);

module.exports = router;