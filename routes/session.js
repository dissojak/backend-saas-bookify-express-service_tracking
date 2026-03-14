const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const sessionValidator = require('../validators/sessionValidator');
const authMiddleware = require('../middleware/authMiddleware');

// POST /api/session/start - start a new session
router.post('/start', authMiddleware, ...sessionValidator.startSession, sessionController.startSession);

// PATCH /api/session/:id/end - end a session
router.patch('/:id/end', authMiddleware, ...sessionValidator.endSession, sessionController.endSession);

// POST /api/session/:id/end — sendBeacon compat (sendBeacon always sends POST)
router.post('/:id/end', authMiddleware, ...sessionValidator.endSession, sessionController.endSession);

// PATCH /api/session/:id/activity — lightweight heartbeat (update lastActivityAt)
router.patch('/:id/activity', authMiddleware, sessionController.updateActivity);

module.exports = router;
