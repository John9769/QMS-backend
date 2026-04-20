const pool = require('../config/db');

// FIND OR CREATE PATIENT PROFILE
// No login needed — identified by ic_last4 + phone
const findOrCreatePatient = async (req, res) => {
  try {
    const { full_name, ic_last4, phone } = req.body;

    if (!full_name || !ic_last4 || !phone) {
      return res.status(400).json({ error: 'full_name, ic_last4 and phone required' });
    }

    if (ic_last4.length !== 4 || !/^\d+$/.test(ic_last4)) {
      return res.status(400).json({ error: 'ic_last4 must be exactly 4 digits' });
    }

    // Check if patient exists
    const existing = await pool.query(
      `SELECT * FROM patient_profiles 
       WHERE ic_last4 = $1 AND phone = $2 AND deleted_at IS NULL`,
      [ic_last4, phone]
    );

    if (existing.rows.length > 0) {
      return res.json({
        message: 'Patient found',
        is_new: false,
        patient: existing.rows[0]
      });
    }

    // Create new patient
    const result = await pool.query(
      `INSERT INTO patient_profiles (full_name, ic_last4, phone)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [full_name, ic_last4, phone]
    );

    res.status(201).json({
      message: 'Patient profile created',
      is_new: true,
      patient: result.rows[0]
    });

  } catch (err) {
    console.error('Find/create patient error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// VERIFY PATIENT (Counter staff — Cik Ida)
const verifyPatient = async (req, res) => {
  try {
    const { id } = req.params;
    const { tenant_id } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id required' });
    }

    const result = await pool.query(
      `UPDATE patient_profiles SET
        is_verified = true,
        verified_at = NOW(),
        verified_at_tenant_id = $1,
        verified_by = $2
       WHERE id = $3
       RETURNING *`,
      [tenant_id, req.user.id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json({
      message: 'Patient verified successfully',
      patient: result.rows[0]
    });

  } catch (err) {
    console.error('Verify patient error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET PATIENT BY IC + PHONE (lookup)
const getPatient = async (req, res) => {
  try {
    const { ic_last4, phone } = req.query;

    if (!ic_last4 || !phone) {
      return res.status(400).json({ error: 'ic_last4 and phone required' });
    }

    const result = await pool.query(
      `SELECT * FROM patient_profiles
       WHERE ic_last4 = $1 AND phone = $2 AND deleted_at IS NULL`,
      [ic_last4, phone]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json({ patient: result.rows[0] });

  } catch (err) {
    console.error('Get patient error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { findOrCreatePatient, verifyPatient, getPatient };