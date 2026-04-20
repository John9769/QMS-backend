const express = require('express');
const router = express.Router();
const {
  createStaff,
  getStaffByDepartment,
  getStaffByTenant
} = require('../controllers/staffController');
const auth = require('../middleware/auth');

router.post('/', auth, createStaff);
router.get('/department/:department_id', auth, getStaffByDepartment);
router.get('/tenant/:tenant_id', auth, getStaffByTenant);

module.exports = router;