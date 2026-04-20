const express = require('express');
const router = express.Router();
const {
  getNurseDashboard,
  triggerGeofence,
  callPatient,
  servePatient,
  markEMRReady,
  getTodaySession,
  getDirectorView
} = require('../controllers/queueController');
const auth = require('../middleware/auth');

// Patient facing — no auth
router.post('/geofence', triggerGeofence);

// Staff facing — auth required
router.get('/session/:session_id/nurse', auth, getNurseDashboard);
router.get('/session/today/:department_id', auth, getTodaySession);
router.put('/ticket/:ticket_id/call', auth, callPatient);
router.put('/ticket/:ticket_id/serve', auth, servePatient);
router.put('/ticket/:ticket_id/emr-ready', auth, markEMRReady);

// Director bird eye
router.get('/director/:tenant_id', auth, getDirectorView);

module.exports = router;