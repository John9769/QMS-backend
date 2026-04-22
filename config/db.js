const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err.message);
});

// Test connection without holding it open
pool.query('SELECT 1')
  .then(() => console.log('Database connected to Neon successfully'))
  .catch(err => console.error('Database connection failed:', err.message));

module.exports = pool;