const express = require('express');
const router = express.Router();
const {
  createTenant,
  getAllTenants,
  getTenant,
  updateTenant
} = require('../controllers/tenantController');
const auth = require('../middleware/auth');

router.post('/', auth, createTenant);
router.get('/', getAllTenants);
router.get('/:id', getTenant);
router.put('/:id', auth, updateTenant);

module.exports = router;