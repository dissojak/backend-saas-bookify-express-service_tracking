/**
 * trackingService.js
 *
 * Centralized service for all event tracking operations.
 *
 * Design principles:
 *  - Controllers call this service — they never write to MongoDB directly.
 *  - `trackEvent()` is the primary write path. It merges request context
 *    (from fingerprintMiddleware) with the event payload and persists to MongoDB.
 *  - Session `lastActivityAt` and `eventCount` are updated atomically after
 *    every successful event write (single $inc + $set update, no extra round-trip
 *    for reads).
 *  - `trackBatch()` uses insertMany for high-throughput scenarios (e.g. sendBeacon
 *    bulk flush) and fires a single bulk update to keep session metadata current.
 */

const Event = require('../models/event');
const Session = require('../models/session');
const logger = require('../utils/logger');

// ── Core write path ────────────────────────────────────────────────────────────

/**
 * Track a single event and update the parent session atomically.
 *
 * @param {Object} ctx        req.context from fingerprintMiddleware
 * @param {Object} eventData  { userId, anonymousId, sessionId, eventType, page, properties }
 * @returns {Promise<import('../models/event')>}
 */
exports.trackEvent = async (ctx, eventData) => {
  const doc = new Event({
    // Identity
    userId: eventData.userId || null,
    anonymousId: eventData.anonymousId || null,
    sessionId: eventData.sessionId,

    // Payload
    eventType: eventData.eventType,
    page: eventData.page || '',
    properties: eventData.properties || {},

    // Device metadata — always from server-side context
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    browser: ctx.browser,
    browserVersion: ctx.browserVersion,
    os: ctx.os,
    osVersion: ctx.osVersion,
    deviceType: ctx.deviceType,
    country: ctx.country,
    city: ctx.city,

    timestamp: ctx.timestamp || new Date(),
  });

  await doc.save();

  // Keep session metadata current — one atomic write, no extra read
  await _bumpSession(eventData.sessionId, ctx.timestamp);

  logger.info(`[tracking] ${eventData.eventType} | session=${eventData.sessionId} | user=${eventData.userId || 'anon'}`);
  return doc;
};

/**
 * Track multiple events in a single insertMany call.
 * All events in the batch inherit the same request context.
 *
 * @param {Object}   ctx     req.context from fingerprintMiddleware
 * @param {Object[]} events  Array of event payloads
 * @returns {Promise<Object[]>}
 */
exports.trackBatch = async (ctx, events) => {
  const enriched = events.map((e) => ({
    userId: e.userId || null,
    anonymousId: e.anonymousId || null,
    sessionId: e.sessionId,
    eventType: e.eventType,
    page: e.page || '',
    properties: e.properties || {},

    // Server-injected metadata
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    browser: ctx.browser,
    browserVersion: ctx.browserVersion,
    os: ctx.os,
    osVersion: ctx.osVersion,
    deviceType: ctx.deviceType,
    country: ctx.country,
    city: ctx.city,

    timestamp: e.timestamp ? new Date(e.timestamp) : ctx.timestamp,
  }));

  const saved = await Event.insertMany(enriched, { ordered: false });

  // Deduplicate session IDs and bump all sessions in parallel
  const sessionIds = [...new Set(enriched.map((e) => e.sessionId).filter(Boolean))];
  await Promise.all(sessionIds.map((sid) => _bumpSession(sid, ctx.timestamp)));

  logger.info(`[tracking] batch=${saved.length} events saved`);
  return saved;
};

// ── Legacy aliases (keep backward compat for any direct callers) ───────────────

/**
 * @deprecated Use trackEvent(ctx, eventData) instead.
 */
exports.saveEvent = async (eventData) => {
  const event = new Event(eventData);
  await event.save();
  logger.info(`[tracking] saveEvent: ${eventData.eventType} | user=${eventData.userId}`);
  return event;
};

/**
 * @deprecated Use trackBatch(ctx, events) instead.
 */
exports.saveBatch = async (events) => {
  try {
    const saved = await Event.insertMany(events, { ordered: false });
    logger.info(`[tracking] saveBatch: ${saved.length} events`);
    return saved;
  } catch (err) {
    logger.warn('[tracking] saveBatch partial failure:', err.message);
    throw err;
  }
};

// ── Session helpers ────────────────────────────────────────────────────────────

/**
 * Atomically increment session.eventCount and update session.lastActivityAt.
 * Uses findOneAndUpdate so there is no separate read round-trip.
 *
 * @param {string} sessionId
 * @param {Date}   [at]       Timestamp to record (defaults to now)
 */
exports.updateSessionActivity = async (sessionId, at) => {
  await _bumpSession(sessionId, at);
};

/** Internal helper shared by trackEvent and trackBatch. */
async function _bumpSession(sessionId, at) {
  if (!sessionId) return;
  try {
    await Session.findOneAndUpdate(
      { sessionId, isActive: true },
      {
        $inc: { eventCount: 1 },
        $set: { lastActivityAt: at || new Date() },
      }
    );
  } catch (err) {
    // Non-fatal — a missing session doesn't break event tracking
    logger.warn(`[tracking] Could not bump session ${sessionId}: ${err.message}`);
  }
}

// ── Query helpers ──────────────────────────────────────────────────────────────

/**
 * Get events for a user within a date range.
 */
exports.getEventsByUser = async (userId, startDate, endDate) => {
  return Event.find({
    userId,
    timestamp: { $gte: startDate, $lte: endDate },
  }).sort({ timestamp: -1 });
};

/**
 * Get events by session ID.
 */
exports.getEventsBySession = async (sessionId) => {
  return Event.find({ sessionId }).sort({ timestamp: -1 });
};
