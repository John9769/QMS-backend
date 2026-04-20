const pool = require('../config/db');
const bcrypt = require('bcryptjs');

// CREATE STAFF + ASSIGN TO DEPARTMENT
const createStaff = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      full_name, email, phone, password,
      tenant_id, department_id, sub_role
    } = req.body;

    if (!full_name || !email || !phone || !password || !tenant_id || !sub_role) {
      return res.status(400).json({ error: 'All fields required' });
    }

    await client.query('BEGIN');

    // Check duplicate
    const exists = await client.query(
      'SELECT id FROM users WHERE email = $1 OR phone = $2',
      [email, phone]
    );

    if (exists.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Email or phone already registered' });
    }

    const hashed = await bcrypt.hash(password, 12);

    // Create user
    const userResult = await client.query(
      `INSERT INTO users
        (full_name, email, phone, password, role)
       VALUES ($1,$2,$3,$4,'STAFF')
       RETURNING id, full_name, email, phone, role`,
      [full_name, email, phone, hashed]
    );

    const user = userResult.rows[0];

    // Assign to department
    await client.query(
      `INSERT INTO staff_assignments
        (user_id, tenant_id, department_id, sub_role)
       VALUES ($1,$2,$3,$4)`,
      [user.id, tenant_id, department_id, sub_role]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Staff created and assigned successfully',
      user: {
        ...user,
        tenant_id,
        department_id,
        sub_role
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create staff error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
};

// GET STAFF BY DEPARTMENT
const getStaffByDepartment = async (req, res) => {
  try {
    const { department_id } = req.params;

    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone,
              sa.sub_role, sa.is_active, sa.assigned_at,
              t.name as tenant_name,
              d.name as department_name
       FROM staff_assignments sa
       JOIN users u ON u.id = sa.user_id
       JOIN tenants t ON t.id = sa.tenant_id
       JOIN departments d ON d.id = sa.department_id
       WHERE sa.department_id = $1 AND sa.is_active = true
       ORDER BY sa.sub_role, u.full_name`,
      [department_id]
    );

    res.json({
      count: result.rows.length,
      staff: result.rows
    });

  } catch (err) {
    console.error('Get staff error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET STAFF BY TENANT
const getStaffByTenant = async (req, res) => {
  try {
    const { tenant_id } = req.params;

    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone,
              sa.sub_role, sa.is_active, sa.assigned_at,
              d.name as department_name
       FROM staff_assignments sa
       JOIN users u ON u.id = sa.user_id
       JOIN departments d ON d.id = sa.department_id
       WHERE sa.tenant_id = $1 AND sa.is_active = true
       ORDER BY d.name, sa.sub_role, u.full_name`,
      [tenant_id]
    );

    res.json({
      count: result.rows.length,
      staff: result.rows
    });

  } catch (err) {
    console.error('Get staff by tenant error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { createStaff, getStaffByDepartment, getStaffByTenant };