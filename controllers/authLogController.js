const authLogService = require('../services/authLogService');
const logger = require('../utils/logger');

/**
 * Normalize IP addresses:
 *  - ::1              → 127.0.0.1  (IPv6 loopback)
 *  - ::ffff:1.2.3.4   → 1.2.3.4   (IPv4-mapped IPv6)
 */
function normalizeIP(raw) {
  if (!raw || raw === 'unknown') return 'unknown';
  if (raw === '::1') return '127.0.0.1';
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  return raw;
}

/**
 * Parse User-Agent string server-side into browser / OS / deviceType.
 * Simple but effective for security forensics — covers the vast majority of real browsers.
 */
function parseUA(ua) {
  if (!ua) return { browser: 'unknown', os: 'unknown', deviceType: 'desktop' };

  const isTablet = /ipad|tablet|(android(?!.*mobile))/i.test(ua);
  const isMobile = !isTablet && /mobile|android|iphone|ipod|blackberry|windows phone/i.test(ua);

  let browser = 'unknown';
  if (/edg\//i.test(ua))            browser = 'Edge';
  else if (/opr\//i.test(ua))       browser = 'Opera';
  else if (/chrome\//i.test(ua))    browser = 'Chrome';
  else if (/firefox\//i.test(ua))   browser = 'Firefox';
  else if (/safari\//i.test(ua))    browser = 'Safari';
  else if (/msie|trident/i.test(ua)) browser = 'IE';
  else if (/curl/i.test(ua))        browser = 'curl';       // common tool used by hackers
  else if (/python/i.test(ua))      browser = 'python-bot'; // scripted attack signal
  else if (/go-http/i.test(ua))     browser = 'go-bot';
  else if (/java\//i.test(ua))      browser = 'java-bot';

  let os = 'unknown';
  if (/windows nt 10/i.test(ua))    os = 'Windows 10/11';
  else if (/windows/i.test(ua))     os = 'Windows';
  else if (/mac os x/i.test(ua))    os = 'macOS';
  else if (/android/i.test(ua))     os = 'Android';
  else if (/iphone|ipad/i.test(ua)) os = 'iOS';
  else if (/linux/i.test(ua))       os = 'Linux';

  return {
    browser,
    os,
    deviceType: isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop',
  };
}

/**
 * POST /api/auth-logs
 * Receive an auth event from the frontend and persist it with enriched server-side data.
 */
exports.logAuthEvent = async (req, res, next) => {
  try {
    const {
      action,
      success,
      failReason,
      failStage,
      email,
      role,
      userId,
      sessionId,
      userAgent: clientUA,
      browser,
      os,
      deviceType,
      metadata,
    } = req.body;

    if (!action) {
      return res.status(400).json({ success: false, message: 'action is required' });
    }

    // IP is resolved server-side (trust proxy is set in app.js).
    // Never trust the client — normalize IPv6 loopback and IPv4-mapped addresses.
    const rawIP = req.ip || req.connection?.remoteAddress || 'unknown';
    const ip = normalizeIP(rawIP);

    // Parse UA server-side — frontend may omit parsed fields, this is the authoritative source
    const rawUA = clientUA || req.get('user-agent') || null;
    const uaParsed = parseUA(rawUA);

    // For attempt events success is intentionally undefined (outcome not yet known).
    // Only force Boolean when server explicitly receives true/false.
    const successValue = (success === true || success === 'true')
      ? true
      : (success === false || success === 'false')
        ? false
        : null;

    const savedLog = await authLogService.saveLog({
      action,
      success: successValue,
      failReason: failReason || null,
      failStage: failStage || null,
      email: email ? email.toLowerCase().trim() : null,
      role: role || null,
      userId: userId ? String(userId) : null,
      sessionId: sessionId || null,
      ip,
      userAgent: rawUA,
      // Use client-parsed values if present, otherwise fall back to server-side parsing
      browser: browser || uaParsed.browser,
      os: os || uaParsed.os,
      deviceType: deviceType || uaParsed.deviceType,
      metadata: metadata || {},
    });

    // Log suspicious patterns immediately in server logs
    if (successValue === false && action === 'login_failed') {
      const recentFails = await authLogService.getFailedAttemptsByEmail(email, 15);
      if (recentFails >= 5) {
        logger.warn(`[AuthLog] ⚠️  ${recentFails} failed login attempts for email "${email}" from IP ${ip} in last 15min`);
      }
    }

    return res.status(201).json({ success: true, id: savedLog?._id || null });
  } catch (err) {
    logger.error('[AuthLog] Controller error:', err.message);
    next(err);
  }
};

/**
 * GET /api/auth-logs
 * List recent auth logs (admin use).
 */
exports.getRecentLogs = async (req, res, next) => {
  try {
    const { action, success, ip, email, limit = 100, skip = 0 } = req.query;
    const logs = await authLogService.getRecentLogs({
      action,
      success: success === undefined ? undefined : success === 'true',
      ip,
      email,
      limit: Math.min(Number(limit), 500),
      skip: Number(skip),
    });
    return res.json({ success: true, count: logs.length, data: logs });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth-logs/suspicious
 * Return IPs that exceeded the brute-force threshold.
 * Query params: minutes (default 15), threshold (default 10)
 */
exports.getSuspiciousIPs = async (req, res, next) => {
  try {
    const minutes = Number(req.query.minutes) || 15;
    const threshold = Number(req.query.threshold) || 10;
    const results = await authLogService.getSuspiciousIPs(minutes, threshold);
    return res.json({ success: true, count: results.length, data: results });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth-logs/summary
 * Activity breakdown for the last N hours.
 */
exports.getActivitySummary = async (req, res, next) => {
  try {
    const hours = Number(req.query.hours) || 24;
    const summary = await authLogService.getActivitySummary(hours);
    return res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
};
