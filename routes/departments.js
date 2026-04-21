const express = require('express');
const router = express.Router();
const {
  createDepartment,
  getDepartmentsByTenant,
  getDepartment,
  setOperationHours,
  updateDepartment
} = require('../controllers/departmentController');
const auth = require('../middleware/auth');

router.post('/', auth, createDepartment);
router.get('/tenant/:tenant_id', getDepartmentsByTenant);
router.get('/:id', getDepartment);
router.post('/:id/hours', auth, setOperationHours);
router.put('/:id', auth, updateDepartment);

module.exports = router;