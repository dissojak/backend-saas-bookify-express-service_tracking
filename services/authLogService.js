const AuthLog = require('../models/authLog');
const logger = require('../utils/logger');

/**
 * Extract email domain safely
 */
function extractDomain(email) {
  if (!email || !email.includes('@')) return null;
  return email.split('@')[1].toLowerCase();
}

/**
 * Save a single auth log entry.
 * Never throws — auth logging must never break the main flow.
 */
exports.saveLog = async (data) => {
  try {
    const doc = new AuthLog({
      ...data,
      emailDomain: data.email ? extractDomain(data.email) : null,
    });
    await doc.save();
    return doc;
  } catch (err) {
    logger.error('[AuthLog] Failed to save auth log:', err.message);
    return null; // never throw
  }
};

/**
 * Get IPs that exceeded the failed-login threshold within the last N minutes.
 * Used to detect brute-force attacks.
 *
 * @param {number} minutes   - Look-back window (default 15)
 * @param {number} threshold - Min failures to flag (default 10)
 */
exports.getSuspiciousIPs = async (minutes = 15, threshold = 10) => {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  return AuthLog.aggregate([
    {
      $match: {
        success: false,
        action: { $in: ['login_failed', 'login_attempt'] },
        timestamp: { $gte: since },
      },
    },
    {
      $group: {
        _id: '$ip',
        failCount: { $sum: 1 },
        emails: { $addToSet: '$email' },
        userAgents: { $addToSet: '$userAgent' },
        firstSeen: { $min: '$timestamp' },
        lastSeen: { $max: '$timestamp' },
      },
    },
    { $match: { failCount: { $gte: threshold } } },
    { $sort: { failCount: -1 } },
  ]);
};

/**
 * Get failed attempts for a specific email in the last N minutes.
 * Useful for per-account lockout decisions.
 */
exports.getFailedAttemptsByEmail = async (email, minutes = 15) => {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  return AuthLog.countDocuments({
    email,
    success: false,
    action: 'login_failed',
    timestamp: { $gte: since },
  });
};

/**
 * Get recent auth logs with optional filters.
 */
exports.getRecentLogs = async ({
  action,
  success,
  ip,
  email,
  limit = 100,
  skip = 0,
} = {}) => {
  const filter = {};
  if (action) filter.action = action;
  if (success !== undefined) filter.success = success;
  if (ip) filter.ip = ip;
  if (email) filter.email = email;

  return AuthLog.find(filter)
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

/**
 * Get a summary of auth activity in the last N hours.
 * Useful for dashboards.
 */
exports.getActivitySummary = async (hours = 24) => {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return AuthLog.aggregate([
    { $match: { timestamp: { $gte: since } } },
    {
      $group: {
        _id: { action: '$action', success: '$success' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.action': 1 } },
  ]);
};
