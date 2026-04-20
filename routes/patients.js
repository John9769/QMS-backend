const express = require('express');
const router = express.Router();
const {
  findOrCreatePatient,
  verifyPatient,
  getPatient
} = require('../controllers/patientController');
const auth = require('../middleware/auth');

// Patient self-identify — no auth needed
router.post('/identify', findOrCreatePatient);
router.get('/lookup', getPatient);

// Staff only
router.put('/:id/verify', auth, verifyPatient);

module.exports = router;