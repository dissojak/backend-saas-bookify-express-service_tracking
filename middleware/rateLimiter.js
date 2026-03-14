/**
 * rateLimiter.js
 *
 * Rate limiting for tracking endpoints.
 *
 * We use trustProxy: false because:
 *  1. We handle IP extraction securely in fingerprintMiddleware (proxy-aware)
 *  2. Rate limiting uses a composite key (ip + api-key) that's harder to spoof
 *  3. This prevents express-rate-limit from trusting headers blindly
 */

const rateLimit = require('express-rate-limit');

const trackingLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { success: false, message: 'Too many requests, slow down' },
  
  // trustProxy: false tells rate-limit not to trust X-Forwarded-For headers
  // (prevents spoofing). We handle proxy-aware IP extraction in fingerprintMiddleware.
  trustProxy: false,
  
  // keyGenerator combines IP + API key for a harder-to-spoof rate limit key
  keyGenerator: (req) => {
    const apiKey = req.headers['x-api-key'] || 'anonymous';
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    return `${ip}::${apiKey}`;
  },
});

module.exports = trackingLimiter;
