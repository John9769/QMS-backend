const pool = require('../config/db');

// CREATE TENANT (Super Admin only)
const createTenant = async (req, res) => {
  try {
    const {
      name, type, address, city, state, postcode,
      phone, email, lat, lng,
      s_series_fee, a_series_fee, hospital_rebate, emr_type
    } = req.body;

    if (!name || !type || !address) {
      return res.status(400).json({ error: 'Name, type and address required' });
    }

    const result = await pool.query(
      `INSERT INTO tenants 
        (name, type, address, city, state, postcode,
         phone, email, lat, lng,
         s_series_fee, a_series_fee, hospital_rebate, emr_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        name, type, address, city, state, postcode,
        phone, email, lat, lng,
        s_series_fee || (type === 'GOVT' ? 6.00 : 8.00),
        a_series_fee || 4.00,
        hospital_rebate || 1.00,
        emr_type || 'MANUAL'
      ]
    );

    res.status(201).json({
      message: 'Tenant created successfully',
      tenant: result.rows[0]
    });

  } catch (err) {
    console.error('Create tenant error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET ALL TENANTS
const getAllTenants = async (req, res) => {
  try {
    const { type, state, is_active } = req.query;

    let query = `
      SELECT t.*,
        COUNT(DISTINCT d.id) as department_count
      FROM tenants t
      LEFT JOIN departments d ON d.tenant_id = t.id AND d.is_active = true
      WHERE 1=1
    `;
    const params = [];

    if (type) {
      params.push(type);
      query += ` AND t.type = $${params.length}`;
    }
    if (state) {
      params.push(state);
      query += ` AND t.state = $${params.length}`;
    }
    if (is_active !== undefined) {
      params.push(is_active === 'true');
      query += ` AND t.is_active = $${params.length}`;
    }

    query += ` GROUP BY t.id ORDER BY t.name ASC`;

    const result = await pool.query(query, params);

    res.json({
      count: result.rows.length,
      tenants: result.rows
    });

  } catch (err) {
    console.error('Get tenants error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET ONE TENANT
const getTenant = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT t.*,
        COUNT(DISTINCT d.id) as department_count
       FROM tenants t
       LEFT JOIN departments d ON d.tenant_id = t.id AND d.is_active = true
       WHERE t.id = $1
       GROUP BY t.id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json({ tenant: result.rows[0] });

  } catch (err) {
    console.error('Get tenant error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// UPDATE TENANT
const updateTenant = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, address, city, state, postcode,
      phone, email, lat, lng,
      s_series_fee, a_series_fee, hospital_rebate,
      emr_type, is_active
    } = req.body;

    const result = await pool.query(
      `UPDATE tenants SET
        name = COALESCE($1, name),
        address = COALESCE($2, address),
        city = COALESCE($3, city),
        state = COALESCE($4, state),
        postcode = COALESCE($5, postcode),
        phone = COALESCE($6, phone),
        email = COALESCE($7, email),
        lat = COALESCE($8, lat),
        lng = COALESCE($9, lng),
        s_series_fee = COALESCE($10, s_series_fee),
        a_series_fee = COALESCE($11, a_series_fee),
        hospital_rebate = COALESCE($12, hospital_rebate),
        emr_type = COALESCE($13, emr_type),
        is_active = COALESCE($14, is_active)
       WHERE id = $15
       RETURNING *`,
      [
        name, address, city, state, postcode,
        phone, email, lat, lng,
        s_series_fee, a_series_fee, hospital_rebate,
        emr_type, is_active, id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json({
      message: 'Tenant updated successfully',
      tenant: result.rows[0]
    });

  } catch (err) {
    console.error('Update tenant error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { createTenant, getAllTenants, getTenant, updateTenant };