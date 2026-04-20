const express = require('express');
const router = express.Router();
const {
  createBooking,
  getPatientBookings,
  createAppointment
} = require('../controllers/bookingController');
const auth = require('../middleware/auth');

// Patient booking — no auth needed
router.post('/', createBooking);
router.get('/patient/:patient_id', getPatientBookings);

// A series — nurse keys in, auth required
router.post('/appointment', auth, createAppointment);

module.exports = router;