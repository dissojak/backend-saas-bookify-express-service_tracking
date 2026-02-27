const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const errorMiddleware = require('./middleware/errorMiddleware');
const authMiddleware = require('./middleware/authMiddleware');
const rateLimiter = require('./middleware/rateLimiter');

const app = express();

// Trust proxy for correct req.ip behind reverse proxies (Vercel, Nginx, etc.)
app.set('trust proxy', true);

// CORS: explicit origin required for sendBeacon (which sends credentials: 'include')
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
}));

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(express.json());

// Parse text/plain bodies (sendBeacon sends text/plain to avoid CORS preflight)
app.use(express.text({ type: 'text/plain' }));

// Middleware: if body is a string (from text/plain), try to parse it as JSON
app.use((req, res, next) => {
  if (typeof req.body === 'string' && req.body.length > 0) {
    try {
      req.body = JSON.parse(req.body);
    } catch {
      // Not JSON, leave as-is
    }
  }
  next();
});

app.use(morgan('dev'));

// Apply rate limiter to tracking endpoints
app.use('/api/track', rateLimiter);
app.use('/api/session', rateLimiter);
app.use('/api/auth-logs', rateLimiter);

// Route mounting
app.use('/api/track', require('./routes/tracking'));
app.use('/api/session', require('./routes/session'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/auth-logs', require('./routes/authLogs'));

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Error handler
app.use(errorMiddleware);

module.exports = app;
