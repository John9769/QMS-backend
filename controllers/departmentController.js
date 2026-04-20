const pool = require('../config/db');

// CREATE DEPARTMENT
const createDepartment = async (req, res) => {
  try {
    const {
      tenant_id, name, description,
      s_quota_per_day, avg_minutes_per_patient
    } = req.body;

    if (!tenant_id || !name) {
      return res.status(400).json({ error: 'tenant_id and name required' });
    }

    const result = await pool.query(
      `INSERT INTO departments
        (tenant_id, name, description, s_quota_per_day, avg_minutes_per_patient)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        tenant_id, name, description,
        s_quota_per_day || 20,
        avg_minutes_per_patient || 20
      ]
    );

    res.status(201).json({
      message: 'Department created successfully',
      department: result.rows[0]
    });

  } catch (err) {
    console.error('Create department error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET ALL DEPARTMENTS BY TENANT
const getDepartmentsByTenant = async (req, res) => {
  try {
    const { tenant_id } = req.params;

    const result = await pool.query(
      `SELECT d.*,
        t.name as tenant_name,
        t.type as tenant_type
       FROM departments d
       JOIN tenants t ON t.id = d.tenant_id
       WHERE d.tenant_id = $1
       ORDER BY d.name ASC`,
      [tenant_id]
    );

    res.json({
      count: result.rows.length,
      departments: result.rows
    });

  } catch (err) {
    console.error('Get departments error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET ONE DEPARTMENT
const getDepartment = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT d.*,
        t.name as tenant_name,
        t.type as tenant_type,
        t.lat as hospital_lat,
        t.lng as hospital_lng
       FROM departments d
       JOIN tenants t ON t.id = d.tenant_id
       WHERE d.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    // Get operation hours
    const hours = await pool.query(
      `SELECT * FROM operation_hours
       WHERE department_id = $1
       ORDER BY CASE day_of_week
         WHEN 'MON' THEN 1 WHEN 'TUE' THEN 2
         WHEN 'WED' THEN 3 WHEN 'THU' THEN 4
         WHEN 'FRI' THEN 5 WHEN 'SAT' THEN 6
         WHEN 'SUN' THEN 7 END`,
      [id]
    );

    res.json({
      department: result.rows[0],
      operation_hours: hours.rows
    });

  } catch (err) {
    console.error('Get department error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// SET OPERATION HOURS
const setOperationHours = async (req, res) => {
  try {
    const { id } = req.params;
    const { hours } = req.body;

    // hours = array of { day_of_week, open_time, close_time, lunch_start, lunch_end, is_closed }
    if (!hours || !Array.isArray(hours)) {
      return res.status(400).json({ error: 'hours array required' });
    }

    // Delete existing and reinsert
    await pool.query(
      'DELETE FROM operation_hours WHERE department_id = $1', [id]
    );

    for (const h of hours) {
      await pool.query(
        `INSERT INTO operation_hours
          (department_id, day_of_week, open_time, close_time,
           lunch_start, lunch_end, is_closed)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id, h.day_of_week, h.open_time, h.close_time,
          h.lunch_start || null, h.lunch_end || null,
          h.is_closed || false
        ]
      );
    }

    res.json({ message: 'Operation hours set successfully' });

  } catch (err) {
    console.error('Set hours error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// UPDATE DEPARTMENT
const updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, description,
      s_quota_per_day, avg_minutes_per_patient, is_active
    } = req.body;

    const result = await pool.query(
      `UPDATE departments SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        s_quota_per_day = COALESCE($3, s_quota_per_day),
        avg_minutes_per_patient = COALESCE($4, avg_minutes_per_patient),
        is_active = COALESCE($5, is_active)
       WHERE id = $6
       RETURNING *`,
      [name, description, s_quota_per_day, avg_minutes_per_patient, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    res.json({
      message: 'Department updated successfully',
      department: result.rows[0]
    });

  } catch (err) {
    console.error('Update department error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  createDepartment,
  getDepartmentsByTenant,
  getDepartment,
  setOperationHours,
  updateDepartment
};