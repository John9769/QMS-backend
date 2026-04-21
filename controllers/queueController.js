const pool = require('../config/db');
const { nowMY } = require('../utils/eta');

const getMYToday = () => {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
};

// GET NURSE DASHBOARD
const getNurseDashboard = async (req, res) => {
  try {
    const { session_id } = req.params;

    const sessionResult = await pool.query(
      `SELECT qs.*, d.name as department_name, t.name as tenant_name
       FROM queue_sessions qs
       JOIN departments d ON d.id = qs.department_id
       JOIN tenants t ON t.id = qs.tenant_id
       WHERE qs.id = $1`,
      [session_id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    const tickets = await pool.query(
      `SELECT qt.*,
              pp.full_name as patient_name,
              pp.phone as patient_phone,
              pp.is_verified as patient_verified
       FROM queue_tickets qt
       LEFT JOIN patient_profiles pp ON pp.id = qt.patient_id
       WHERE qt.session_id = $1
       AND qt.status NOT IN ('SERVED', 'FORFEITED')
       ORDER BY
         CASE qt.status
           WHEN 'ARRIVED' THEN 1
           WHEN 'CALLED' THEN 2
           WHEN 'PENDING' THEN 3
         END,
         qt.ticket_number ASC`,
      [session_id]
    );

    const arrived = tickets.rows.filter(t => t.status === 'ARRIVED');
    const pending = tickets.rows.filter(t => t.status === 'PENDING');
    const called = tickets.rows.filter(t => t.status === 'CALLED');

    const clinicVacant = called.length === 0;
    let nextToCall = null;

    if (clinicVacant) {
      const eligible = arrived.filter(t => {
        if (t.is_first_visit) {
          return t.verification_status === 'EMR_READY';
        }
        return true;
      });

      if (eligible.length > 0) {
        eligible.sort((a, b) => a.ticket_number - b.ticket_number);
        nextToCall = eligible[0];
      }
    }

    res.json({
      session,
      stats: {
        total_arrived: arrived.length,
        total_pending: pending.length,
        total_called: called.length,
        clinic_vacant: clinicVacant
      },
      next_to_call: nextToCall,
      arrived,
      pending,
      called
    });

  } catch (err) {
    console.error('Nurse dashboard error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GEOFENCE TRIGGER
const triggerGeofence = async (req, res) => {
  const client = await pool.connect();
  try {
    const { ticket_id, lat, lng, distance_meters } = req.body;

    if (!ticket_id || !lat || !lng) {
      return res.status(400).json({ error: 'ticket_id, lat, lng required' });
    }

    await client.query('BEGIN');

    const ticketResult = await client.query(
      `SELECT qt.*, pp.full_name as patient_name,
              pp.is_verified, qt.is_first_visit
       FROM queue_tickets qt
       LEFT JOIN patient_profiles pp ON pp.id = qt.patient_id
       WHERE qt.id = $1`,
      [ticket_id]
    );

    if (ticketResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticket = ticketResult.rows[0];

    if (ticket.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Ticket already ${ticket.status}` });
    }

    const now = nowMY();

    await client.query(
      `UPDATE queue_tickets SET
        status = 'ARRIVED',
        geofence_triggered_at = $1,
        geofence_lat = $2,
        geofence_lng = $3,
        geofence_distance_meters = $4
       WHERE id = $5`,
      [now, lat, lng, distance_meters || 50, ticket_id]
    );

    await client.query(
      `INSERT INTO geofence_events
        (ticket_id, patient_id, tenant_id, triggered_at, lat, lng, distance_meters)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ticket_id, ticket.patient_id, ticket.tenant_id, now, lat, lng, distance_meters || 50]
    );

    if (!ticket.is_first_visit) {
      await client.query(
        `UPDATE queue_tickets SET verification_status = 'EMR_READY'
         WHERE id = $1`,
        [ticket_id]
      );
    }

    await client.query('COMMIT');

    res.json({
      message: 'Geofence triggered — patient marked ARRIVED',
      ticket_code: ticket.ticket_code,
      is_first_visit: ticket.is_first_visit,
      instruction: ticket.is_first_visit
        ? 'Please proceed to registration counter first'
        : 'Please proceed directly to clinic'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Geofence error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
};

// CALL PATIENT
const callPatient = async (req, res) => {
  const client = await pool.connect();
  try {
    const { ticket_id } = req.params;
    const now = nowMY();

    await client.query('BEGIN');

    const ticketResult = await client.query(
      `SELECT qt.*, pp.full_name as patient_name
       FROM queue_tickets qt
       LEFT JOIN patient_profiles pp ON pp.id = qt.patient_id
       WHERE qt.id = $1`,
      [ticket_id]
    );

    if (ticketResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticket = ticketResult.rows[0];

    if (ticket.status !== 'ARRIVED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Patient must be ARRIVED before calling' });
    }

    await client.query(
      `UPDATE queue_tickets SET status = 'CALLED', called_at = $1 WHERE id = $2`,
      [now, ticket_id]
    );

    await client.query('COMMIT');

    res.json({
      message: `${ticket.ticket_code} — ${ticket.patient_name} called`,
      ticket_code: ticket.ticket_code,
      patient_name: ticket.patient_name,
      called_at: now
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Call patient error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
};

// SERVE PATIENT
const servePatient = async (req, res) => {
  const client = await pool.connect();
  try {
    const { ticket_id } = req.params;
    const now = nowMY();

    await client.query('BEGIN');

    const ticketResult = await client.query(
      `SELECT * FROM queue_tickets WHERE id = $1`,
      [ticket_id]
    );

    if (ticketResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticket = ticketResult.rows[0];

    await client.query(
      `UPDATE queue_tickets SET status = 'SERVED', served_at = $1 WHERE id = $2`,
      [now, ticket_id]
    );

    await client.query(
      `UPDATE queue_sessions SET s_total_served = s_total_served + 1 WHERE id = $1`,
      [ticket.session_id]
    );

    await client.query(
      `UPDATE bookings SET status = 'COMPLETED' WHERE ticket_id = $1`,
      [ticket_id]
    );

    await client.query('COMMIT');

    res.json({
      message: `${ticket.ticket_code} — served successfully`,
      ticket_code: ticket.ticket_code,
      served_at: now
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Serve patient error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
};

// MARK EMR READY
const markEMRReady = async (req, res) => {
  const client = await pool.connect();
  try {
    const { ticket_id } = req.params;
    const now = nowMY();

    await client.query('BEGIN');

    await client.query(
      `UPDATE queue_tickets SET
        verification_status = 'EMR_READY',
        emr_ready_by = $1,
        emr_ready_at = $2
       WHERE id = $3`,
      [req.user.id, now, ticket_id]
    );

    await client.query('COMMIT');

    res.json({ message: 'EMR ready — nurse can now call patient' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('EMR ready error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
};

// GET TODAY SESSION
const getTodaySession = async (req, res) => {
  try {
    const { department_id } = req.params;
    const today = getMYToday();

    const result = await pool.query(
      `SELECT qs.*, d.name as department_name, t.name as tenant_name
       FROM queue_sessions qs
       JOIN departments d ON d.id = qs.department_id
       JOIN tenants t ON t.id = qs.tenant_id
       WHERE qs.department_id = $1 AND qs.session_date = $2`,
      [department_id, today]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No session today for this department' });
    }

    res.json({ session: result.rows[0] });

  } catch (err) {
    console.error('Get today session error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// DIRECTOR BIRD EYE
const getDirectorView = async (req, res) => {
  try {
    const { tenant_id } = req.params;
    const today = getMYToday();

    const result = await pool.query(
      `SELECT 
        d.id as department_id,
        d.name as department_name,
        qs.id as session_id,
        qs.session_date,
        qs.is_open,
        qs.s_total_booked,
        qs.s_total_served,
        qs.s_total_forfeited,
        qs.w_total_served,
        COUNT(CASE WHEN qt.status = 'PENDING' THEN 1 END) as pending_count,
        COUNT(CASE WHEN qt.status = 'ARRIVED' THEN 1 END) as arrived_count,
        COUNT(CASE WHEN qt.status = 'CALLED' THEN 1 END) as called_count
       FROM departments d
       LEFT JOIN queue_sessions qs ON qs.department_id = d.id 
         AND qs.session_date = $2
       LEFT JOIN queue_tickets qt ON qt.session_id = qs.id
         AND qt.status NOT IN ('SERVED','FORFEITED')
       WHERE d.tenant_id = $1 AND d.is_active = true
       GROUP BY d.id, d.name, qs.id, qs.session_date,
                qs.is_open, qs.s_total_booked, qs.s_total_served,
                qs.s_total_forfeited, qs.w_total_served
       ORDER BY d.name ASC`,
      [tenant_id, today]
    );

    res.json({
      tenant_id,
      date: today,
      departments: result.rows
    });

  } catch (err) {
    console.error('Director view error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getNurseDashboard,
  triggerGeofence,
  callPatient,
  servePatient,
  markEMRReady,
  getTodaySession,
  getDirectorView
};