const pool = require('../config/db');
const cron = require('node-cron');

const runAppointmentReminder = () => {
  // Runs daily at 8am Malaysia time
  cron.schedule('0 8 * * *', async () => {
    const client = await pool.connect();
    try {
      console.log('[REMINDER] Running appointment reminder check...');

      // Find all A series tickets where appointment_date = tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toLocaleDateString('en-CA', {
        timeZone: 'Asia/Kuala_Lumpur'
      });

      const result = await client.query(
        `SELECT qt.*,
                pp.full_name as patient_name,
                pp.phone as patient_phone,
                d.name as department_name,
                t.name as tenant_name
         FROM queue_tickets qt
         JOIN patient_profiles pp ON pp.id = qt.patient_id
         JOIN departments d ON d.id = qt.department_id
         JOIN tenants t ON t.id = qt.tenant_id
         WHERE qt.series = 'A'
         AND qt.appointment_date = $1
         AND qt.status = 'PENDING'`,
        [tomorrowStr]
      );

      if (result.rows.length === 0) {
        console.log('[REMINDER] No appointments tomorrow');
        return;
      }

      console.log(`[REMINDER] Found ${result.rows.length} appointments tomorrow`);

      for (const ticket of result.rows) {
        // Insert notification record
        await client.query(
          `INSERT INTO notifications
            (patient_id, ticket_id, tenant_id, type, title, body)
           VALUES ($1, $2, $3, 'APPOINTMENT_CONFIRMED', $4, $5)`,
          [
            ticket.patient_id,
            ticket.id,
            ticket.tenant_id,
            `Appointment Reminder — ${ticket.department_name}`,
            `Dear ${ticket.patient_name}, you have a doctor appointment tomorrow at ${ticket.tenant_name} — ${ticket.department_name}. Please book your QMS slot at qms.my to skip the queue. Your ticket: ${ticket.ticket_code}`
          ]
        );

        // Log to console — replace with real SMS gateway post-demo
        console.log(`[REMINDER] Notified: ${ticket.patient_name} — ${ticket.patient_phone} — ${ticket.department_name} — ${tomorrowStr}`);
        console.log(`[REMINDER] SMS: Dear ${ticket.patient_name}, appointment tomorrow at ${ticket.tenant_name}. Book QMS slot to skip queue.`);
      }

      console.log(`[REMINDER] Done — ${result.rows.length} reminders sent`);

    } catch (err) {
      console.error('[REMINDER] Error:', err.message);
    } finally {
      client.release();
    }
  }, {
    timezone: 'Asia/Kuala_Lumpur'
  });

  console.log('[REMINDER] Scheduled — runs daily at 8am MYT');
};

module.exports = { runAppointmentReminder };