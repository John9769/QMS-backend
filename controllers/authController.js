const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// REGISTER STAFF (Super Admin creates staff)
const registerStaff = async (req, res) => {
  try {
    const { full_name, email, phone, password, role } = req.body;

    if (!full_name || !email || !phone || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }

    // Check duplicate
    const exists = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR phone = $2',
      [email, phone]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Email or phone already registered' });
    }

    const hashed = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users 
        (full_name, email, phone, password, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, full_name, email, phone, role, created_at`,
      [full_name, email, phone, hashed, role || 'STAFF']
    );

    res.status(201).json({
      message: 'Staff registered successfully',
      user: result.rows[0]
    });

  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// LOGIN (All staff)
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query(
      `SELECT u.*, sa.tenant_id, sa.department_id, sa.sub_role
       FROM users u
       LEFT JOIN staff_assignments sa ON sa.user_id = u.id AND sa.is_active = true
       WHERE u.email = $1 AND u.is_active = true`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        sub_role: user.sub_role,
        tenant_id: user.tenant_id,
        department_id: user.department_id
      },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        sub_role: user.sub_role,
        tenant_id: user.tenant_id,
        department_id: user.department_id
      }
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET ME (Current logged in user)
const getMe = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role,
              sa.tenant_id, sa.department_id, sa.sub_role,
              t.name as tenant_name,
              d.name as department_name
       FROM users u
       LEFT JOIN staff_assignments sa ON sa.user_id = u.id AND sa.is_active = true
       LEFT JOIN tenants t ON t.id = sa.tenant_id
       LEFT JOIN departments d ON d.id = sa.department_id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });

  } catch (err) {
    console.error('GetMe error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { registerStaff, login, getMe };