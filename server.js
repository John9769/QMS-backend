require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pool = require('./config/db');
const { runJudge } = require('./utils/judge');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Start The Judge
runJudge();

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'QMS Backend Running',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tenants', require('./routes/tenants'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/queue', require('./routes/queue'));
// app.use('/api/payments', require('./routes/payments'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`QMS Server running on port ${PORT}`);
});

module.exports = app;