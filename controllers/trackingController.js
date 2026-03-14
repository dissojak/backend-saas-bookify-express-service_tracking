/**
 * trackingController.js
 *
 * HTTP handlers for event tracking endpoints.
 * All device / network metadata is read from req.context (set by fingerprintMiddleware)
 * — controllers never access req.ip or req.headers directly for tracking purposes.
 */

const trackingService = require('../services/trackingService');
const logger = require('../utils/logger');
const HttpError = require('../utils/httpError');

/**
 * POST /api/track
 * Track a single event.
 */
exports.trackEvent = async (req, res, next) => {
  try {
    const ctx = req.context; // populated by fingerprintMiddleware
    const { userId, anonymousId, sessionId, eventType, page, properties } = req.body;

    if (!sessionId) throw new HttpError('sessionId is required', 400);
    if (!eventType) throw new HttpError('eventType is required', 400);

    const event = await trackingService.trackEvent(ctx, {
      userId: userId || null,
      anonymousId: anonymousId || null,
      sessionId,
      eventType,
      page: page || '',
      properties: properties || {},
    });

    res.status(201).json({ success: true, message: 'Event tracked', data: event });
  } catch (err) {
    logger.error('[track] trackEvent error:', err.message);
    next(err);
  }
};

/**
 * POST /api/track/batch
 * Track multiple events in a single request (used by sendBeacon flush).
 */
exports.trackBatch = async (req, res, next) => {
  try {
    const ctx = req.context;
    const { events } = req.body;

    if (!Array.isArray(events) || events.length === 0) {
      throw new HttpError('events must be a non-empty array', 400);
    }

    const saved = await trackingService.trackBatch(ctx, events);

    res.status(201).json({
      success: true,
      message: `${saved.length} events tracked`,
      data: { count: saved.length },
    });
  } catch (err) {
    logger.error('[track] trackBatch error:', err.message);
    next(err);
  }
};
