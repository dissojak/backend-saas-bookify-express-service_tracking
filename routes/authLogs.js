// authLogs.js
// Routes for dedicated auth security logging

const express = require('express');
const router = express.Router();
const authLogController = require('../controllers/authLogController');
const authMiddleware = require('../middleware/authMiddleware');

// POST /api/auth-logs — save a single auth event (called from frontend)
router.post('/', authMiddleware, authLogController.logAuthEvent);

// GET /api/auth-logs — list recent logs (admin)
router.get('/', authMiddleware, authLogController.getRecentLogs);

// GET /api/auth-logs/suspicious — IPs exceeding brute-force threshold
router.get('/suspicious', authMiddleware, authLogController.getSuspiciousIPs);

// GET /api/auth-logs/summary — aggregate stats for last N hours
router.get('/summary', authMiddleware, authLogController.getActivitySummary);

module.exports = router;
