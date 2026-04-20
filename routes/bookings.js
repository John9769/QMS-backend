const express = require('express');
const router = express.Router();
const {
  createBooking,
  getPatientBookings
} = require('../controllers/bookingController');
const auth = require('../middleware/auth');

// Patient booking — no auth needed
router.post('/', createBooking);
router.get('/patient/:patient_id', getPatientBookings);

module.exports = router;