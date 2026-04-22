const pool = require('../config/db');
const { calculateETA, nowMY } = require('../utils/eta');

// CREATE S SERIES BOOKING
const createBooking = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      patient_id, department_id,
      origin_lat, origin_lng,
      booking_date, is_first_visit
    } = req.body;

    if (!patient_id || !department_id || !origin_lat || !origin_lng || !booking_date) {
      return res.status(400).json({ error: 'All fields required' });
    }

    // Advance booking validation — max 3 days
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 3);
    const maxDateStr = maxDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });

    if (booking_date < todayStr) {
      return res.status(400).json({ error: 'Cannot book for a past date' });
    }
    if (booking_date > maxDateStr) {
      return res.status(400).json({ error: 'Advance booking only allowed up to 3 days' });
    }

    await client.query('BEGIN');

    const deptResult = await client.query(
      `SELECT d.*, t.lat as hospital_lat, t.lng as hospital_lng,
              t.s_series_fee, t.hospital_rebate, t.name as tenant_name
       FROM departments d
       JOIN tenants t ON t.id = d.tenant_id
       WHERE d.id = $1 AND d.is_active = true`,
      [department_id]
    );

    if (deptResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Department not found' });
    }

    const dept = deptResult.rows[0];

    const hoursResult = await client.query(
      `SELECT * FROM operation_hours WHERE department_id = $1`,
      [department_id]
    );

    if (hoursResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Operation hours not set for this department' });
    }

    let sessionResult = await client.query(
      `SELECT * FROM queue_sessions 
       WHERE department_id = $1 AND session_date = $2`,
      [department_id, booking_date]
    );

    if (sessionResult.rows.length === 0) {
      sessionResult = await client.query(
        `INSERT INTO queue_sessions 
          (department_id, tenant_id, session_date, is_open)
         VALUES ($1, $2, $3, true)
         RETURNING *`,
        [department_id, dept.tenant_id, booking_date]
      );
    }

    const session = sessionResult.rows[0];

    if (session.s_total_booked >= dept.s_quota_per_day) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'S series quota full for this day' });
    }

    const currentQueueMinutes = session.s_total_booked * dept.avg_minutes_per_patient;

    const scheduleResult = calculateETA(
      parseFloat(origin_lat),
      parseFloat(origin_lng),
      parseFloat(dept.hospital_lat),
      parseFloat(dept.hospital_lng),
      hoursResult.rows,
      booking_date,
      currentQueueMinutes
    );

    if (scheduleResult.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: scheduleResult.error });
    }

    const ticketNumber = session.s_last_ticket_number + 1;
    const ticketCode = `S${String(ticketNumber).padStart(4, '0')}`;

    const ticketResult = await client.query(
      `INSERT INTO queue_tickets
        (session_id, patient_id, department_id, tenant_id,
         series, ticket_number, ticket_code,
         is_first_visit, verification_status,
         origin_lat, origin_lng,
         driving_minutes, eta, eta_deadline, status)
       VALUES ($1,$2,$3,$4,'S',$5,$6,$7,$8,$9,$10,$11,$12,$13,'PENDING')
       RETURNING *`,
      [
        session.id, patient_id, department_id, dept.tenant_id,
        ticketNumber, ticketCode,
        is_first_visit || false,
        is_first_visit ? 'PENDING' : 'NA',
        origin_lat, origin_lng,
        scheduleResult.driveMinutes,
        scheduleResult.eta,
        scheduleResult.etaDeadline
      ]
    );

    await client.query(
      `INSERT INTO bookings
        (ticket_id, patient_id, department_id, tenant_id,
         booking_date, origin_lat, origin_lng,
         hospital_lat, hospital_lng,
         distance_km, driving_minutes,
         eta, eta_deadline, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ACTIVE')`,
      [
        ticketResult.rows[0].id, patient_id, department_id, dept.tenant_id,
        booking_date, origin_lat, origin_lng,
        dept.hospital_lat, dept.hospital_lng,
        scheduleResult.distanceKm, scheduleResult.driveMinutes,
        scheduleResult.eta, scheduleResult.etaDeadline
      ]
    );

    const platformFee = dept.s_series_fee - dept.hospital_rebate;
    await client.query(
      `INSERT INTO payments
        (ticket_id, patient_id, tenant_id, series,
         gross_amount, platform_fee, hospital_rebate,
         payment_method, status)
       VALUES ($1,$2,$3,'S',$4,$5,$6,'SIMULATED','SUCCESS')`,
      [
        ticketResult.rows[0].id, patient_id, dept.tenant_id,
        dept.s_series_fee, platformFee, dept.hospital_rebate
      ]
    );

    await client.query(
      `UPDATE queue_sessions SET
        s_last_ticket_number = $1,
        s_total_booked = s_total_booked + 1
       WHERE id = $2`,
      [ticketNumber, session.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Booking confirmed',
      ticket: {
        ...ticketResult.rows[0],
        tenant_name: dept.tenant_name,
        department_name: dept.name,
        hospital_lat: dept.hospital_lat,
        hospital_lng: dept.hospital_lng,
        booking_date: booking_date,
        distance_km: scheduleResult.distanceKm,
        drive_minutes: scheduleResult.driveMinutes,
        appointment_time: scheduleResult.eta,
        latest_arrival: scheduleResult.etaDeadline,
        patients_ahead: session.s_total_booked,
        avg_minutes_per_patient: dept.avg_minutes_per_patient
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create booking error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
};

// GET BOOKINGS BY PATIENT
const getPatientBookings = async (req, res) => {
  try {
    const { patient_id } = req.params;

    const result = await pool.query(
      `SELECT qt.*, 
              d.name as department_name,
              t.name as tenant_name,
              t.address as tenant_address
       FROM queue_tickets qt
       JOIN departments d ON d.id = qt.department_id
       JOIN tenants t ON t.id = qt.tenant_id
       WHERE qt.patient_id = $1
       ORDER BY qt.created_at DESC`,
      [patient_id]
    );

    res.json({
      count: result.rows.length,
      bookings: result.rows
    });

  } catch (err) {
    console.error('Get bookings error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// CREATE A SERIES
const createAppointment = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      ic_last4, phone, full_name,
      department_id, appointment_date
    } = req.body;

    if (!ic_last4 || !phone || !department_id || !appointment_date) {
      return res.status(400).json({ error: 'ic_last4, phone, department_id, appointment_date required' });
    }

    await client.query('BEGIN');

    let patientResult = await client.query(
      `SELECT * FROM patient_profiles
       WHERE ic_last4 = $1 AND phone = $2 AND deleted_at IS NULL`,
      [ic_last4, phone]
    );

    let patient;
    if (patientResult.rows.length === 0) {
      if (!full_name) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Patient not found — full_name required to create profile' });
      }
      const newPatient = await client.query(
        `INSERT INTO patient_profiles (full_name, ic_last4, phone)
         VALUES ($1,$2,$3) RETURNING *`,
        [full_name, ic_last4, phone]
      );
      patient = newPatient.rows[0];
    } else {
      patient = patientResult.rows[0];
    }

    const deptResult = await client.query(
      `SELECT d.*, t.lat as hospital_lat, t.lng as hospital_lng,
              t.a_series_fee, t.hospital_rebate, t.name as tenant_name
       FROM departments d
       JOIN tenants t ON t.id = d.tenant_id
       WHERE d.id = $1 AND d.is_active = true`,
      [department_id]
    );

    if (deptResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Department not found' });
    }

    const dept = deptResult.rows[0];

    let sessionResult = await client.query(
      `SELECT * FROM queue_sessions
       WHERE department_id = $1 AND session_date = $2`,
      [department_id, appointment_date]
    );

    if (sessionResult.rows.length === 0) {
      sessionResult = await client.query(
        `INSERT INTO queue_sessions
          (department_id, tenant_id, session_date, is_open)
         VALUES ($1,$2,$3,true) RETURNING *`,
        [department_id, dept.tenant_id, appointment_date]
      );
    }

    const session = sessionResult.rows[0];

    const ticketNumber = session.a_last_ticket_number + 1;
    const ticketCode = `A${String(ticketNumber).padStart(4, '0')}`;

    const ticketResult = await client.query(
      `INSERT INTO queue_tickets
        (session_id, patient_id, department_id, tenant_id,
         series, ticket_number, ticket_code,
         is_first_visit, verification_status,
         is_appointment, appointment_date,
         appointment_keyed_by, status)
       VALUES ($1,$2,$3,$4,'A',$5,$6,false,'NA',true,$7,$8,'PENDING')
       RETURNING *`,
      [
        session.id, patient.id, department_id, dept.tenant_id,
        ticketNumber, ticketCode,
        appointment_date, req.user.id
      ]
    );

    const platformFee = dept.a_series_fee - dept.hospital_rebate;
    await client.query(
      `INSERT INTO payments
        (ticket_id, patient_id, tenant_id, series,
         gross_amount, platform_fee, hospital_rebate,
         payment_method, status)
       VALUES ($1,$2,$3,'A',$4,$5,$6,'SIMULATED','PENDING')`,
      [
        ticketResult.rows[0].id, patient.id, dept.tenant_id,
        dept.a_series_fee, platformFee, dept.hospital_rebate
      ]
    );

    await client.query(
      `UPDATE queue_sessions SET
        a_last_ticket_number = $1,
        a_total_booked = a_total_booked + 1
       WHERE id = $2`,
      [ticketNumber, session.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Appointment booked successfully',
      ticket: {
        ...ticketResult.rows[0],
        patient_name: patient.full_name,
        tenant_name: dept.tenant_name,
        department_name: dept.name,
        appointment_date
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create appointment error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
};

module.exports = { createBooking, getPatientBookings, createAppointment };