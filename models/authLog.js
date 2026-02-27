const mongoose = require('mongoose');

/**
 * AuthLog — dedicated collection for all auth-related events.
 * Separate from the generic events collection so security queries are fast
 * and isolated from analytics data.
 *
 * Used for:
 *  - Login funnel analysis (attempt → success / failure + reason)
 *  - Brute-force / credential-stuffing detection (IP + email indices)
 *  - Registration and password-reset forensics
 *  - IP reputation tracking
 */
const authLogSchema = new mongoose.Schema(
  {
    // What happened
    action: {
      type: String,
      required: true,
      enum: [
        'login_attempt',
        'login_success',
        'login_failed',
        'signup_attempt',
        'signup_success',
        'signup_failed',
        'signup_validation_error',
        'forgot_password_requested',
        'forgot_password_failed',
        'reset_password_success',
        'reset_password_failed',
        'logout',
      ],
      index: true,
    },

    // Auth result — null for attempt events (outcome not yet known when the log fires)
    success: {
      type: Boolean,
      default: null,
      index: true,
    },

    // Failure reason (null on success)
    failReason: {
      type: String,
      default: null,
    },

    // The stage where it failed: 'validation' | 'api' | 'network_error'
    failStage: {
      type: String,
      default: null,
    },

    // User identity
    email: {
      type: String,
      default: null,
      index: true,
    },
    // Store only the domain for privacy-safe aggregate queries (e.g. gmail.com attacks)
    emailDomain: {
      type: String,
      default: null,
      index: true,
    },
    role: {
      type: String,
      default: null,
    },
    // Resolved userId after successful login (null for anonymous/failed attempts)
    userId: {
      type: String,
      default: null,
      index: true,
    },

    // Network & device fingerprint — critical for hacker detection
    ip: {
      type: String,
      required: true,
      index: true,
    },
    userAgent: {
      type: String,
      default: null,
    },
    // Parsed UA breakdown
    browser: {
      type: String,
      default: null,
    },
    os: {
      type: String,
      default: null,
    },
    deviceType: {
      type: String,
      default: null,
    },

    // Correlation with analytics session
    sessionId: {
      type: String,
      default: null,
      index: true,
    },

    // Any extra context (field name for validation errors, etc.)
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true, collection: 'auth_logs' }
);

// ── Compound indices for brute-force / security queries ─────────────────────

// Failed logins from the same IP in a time window → brute force by IP
authLogSchema.index({ ip: 1, success: 1, timestamp: -1 });

// Failed logins against the same email in a time window → credential stuffing
authLogSchema.index({ email: 1, success: 1, timestamp: -1 });

// Failed logins per action+IP (e.g. how many login_failed from X IP)
authLogSchema.index({ action: 1, ip: 1, timestamp: -1 });

// Admin dashboard: all recent failures sorted by time
authLogSchema.index({ success: 1, timestamp: -1 });

module.exports = mongoose.model('AuthLog', authLogSchema);
