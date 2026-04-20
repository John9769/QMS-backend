const pool = require('../config/db');
const cron = require('node-cron');
const { nowMY } = require('./eta');

const runJudge = () => {
  // Every 3 minutes
  cron.schedule('*/3 * * * *', async () => {
    const client = await pool.connect();
    try {
      const now = nowMY();
      console.log(`[JUDGE] Running at ${now.toISOString()}`);

      // Find all PENDING S+A tickets where ETA deadline has passed
      const expired = await client.query(
        `SELECT qt.*, qs.id as session_id
         FROM queue_tickets qt
         JOIN queue_sessions qs ON qs.id = qt.session_id
         WHERE qt.status = 'PENDING'
         AND qt.series IN ('S', 'A')
         AND qt.eta_deadline < $1`,
        [now]
      );

      if (expired.rows.length === 0) {
        console.log('[JUDGE] No expired tickets found');
        return;
      }

      console.log(`[JUDGE] Found ${expired.rows.length} expired tickets`);

      for (const ticket of expired.rows) {
        await client.query('BEGIN');

        // Forfeit the ticket
        await client.query(
          `UPDATE queue_tickets SET
            status = 'FORFEITED',
            forfeited_at = $1,
            forfeited_reason = 'JUDGE_TIMEOUT'
           WHERE id = $2`,
          [now, ticket.id]
        );

        // Update session forfeited counter
        await client.query(
          `UPDATE queue_sessions SET
            s_total_forfeited = s_total_forfeited + 1
           WHERE id = $1`,
          [ticket.session_id]
        );

        // Log the forfeit
        await client.query(
          `INSERT INTO judge_log
            (session_id, ticket_id, tenant_id, action, reason, eta_deadline, executed_at)
           VALUES ($1,$2,$3,'FORFEITED','ETA deadline exceeded',$4,$5)`,
          [ticket.session_id, ticket.id, ticket.tenant_id, ticket.eta_deadline, now]
        );

        await client.query('COMMIT');

        console.log(`[JUDGE] Forfeited ticket ${ticket.ticket_code} — patient ${ticket.patient_id}`);
      }

    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[JUDGE] Error:', err.message);
    } finally {
      client.release();
    }
  });

  console.log('[JUDGE] Scheduled — running every 3 minutes');
};

module.exports = { runJudge };