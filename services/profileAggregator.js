/**
 * profileAggregator.js
 *
 * Builds / refreshes the userBehaviorProfiles collection from raw events + sessions.
 * Called by profileAggregationJob on a schedule (every hour in prod, every 5 min in dev).
 *
 * Each aggregation uses $facet to compute all sub-metrics in a single MongoDB pass
 * over the source collection, then writes the result with findOneAndUpdate (upsert).
 *
 * New fields computed vs. v1:
 *  - totalSessionDuration   (sum of all session durations)
 *  - avgEventsPerSession    (totalEvents / totalSessions)
 *  - browserTypes           (browser → count Map)
 *  - countriesUsed          (country → count Map)
 *  - firstSeenAt            (earliest event timestamp)
 *  - lastKnownIp            (IP from most recent event)
 */

const Event = require('../models/event');
const Session = require('../models/session');
const UserBehaviorProfile = require('../models/userBehaviorProfile');
const logger = require('../utils/logger');

// ── Top-level orchestration ────────────────────────────────────────────────────

/**
 * Aggregate profiles for ALL users (authenticated + anonymous).
 * Called by the CRON job.
 */
exports.aggregateProfiles = async () => {
  logger.info('[profileAggregator] Starting full aggregation run...');

  const [userIds, anonymousIds] = await Promise.all([
    Session.distinct('userId', { userId: { $ne: null } }),
    Session.distinct('anonymousId', { anonymousId: { $ne: null } }),
  ]);

  logger.info(
    `[profileAggregator] ${userIds.length} authenticated + ${anonymousIds.length} anonymous users`
  );

  let successCount = 0;
  let errorCount = 0;

  for (const userId of userIds) {
    try {
      await exports.aggregateUserProfile(userId);
      successCount++;
    } catch (err) {
      logger.error(`[profileAggregator] user=${userId}`, err.message);
      errorCount++;
    }
  }

  for (const anonymousId of anonymousIds) {
    try {
      await exports.aggregateAnonymousProfile(anonymousId);
      successCount++;
    } catch (err) {
      logger.error(`[profileAggregator] anon=${anonymousId}`, err.message);
      errorCount++;
    }
  }

  logger.info(`[profileAggregator] Done. success=${successCount} errors=${errorCount}`);
  return { successCount, errorCount };
};

// ── Per-user aggregation ───────────────────────────────────────────────────────

/**
 * Rebuild the behavior profile for a single authenticated user.
 * Uses two parallel aggregation pipelines (sessions + events) joined in JS.
 */
exports.aggregateUserProfile = async (userId) => {
  const [sessionStats, eventStats, deviceStats, browserStats, countryStats] = await Promise.all([
    _sessionStats({ userId }),
    _eventStats({ userId }),
    _deviceStats({ userId }),
    _browserStats({ userId }),
    _countryStats({ userId }),
  ]);

  if (!sessionStats.totalSessions) {
    logger.debug(`[profileAggregator] no completed sessions for user=${userId} — skipping`);
    return null;
  }

  const avgEventsPerSession =
    sessionStats.totalSessions > 0
      ? Math.round(eventStats.totalEvents / sessionStats.totalSessions)
      : 0;

  const updates = {
    userId,
    totalEvents: eventStats.totalEvents,
    totalSessions: sessionStats.totalSessions,
    totalSessionDuration: sessionStats.totalDuration,
    avgSessionDuration: Math.round(sessionStats.avgDuration),
    avgEventsPerSession,
    favoritePages: eventStats.favoritePages,
    topEventTypes: new Map(eventStats.eventTypes),
    deviceTypes: new Map(deviceStats),
    browserTypes: new Map(browserStats),
    countriesUsed: new Map(countryStats),
    firstSeenAt: eventStats.firstSeen,
    lastActive: eventStats.lastActive,
    lastKnownIp: eventStats.lastKnownIp,
    lastAggregatedAt: new Date(),
    ...(eventStats.lastBusinessId
      ? { lastSeenBusiness: eventStats.lastBusinessId, lastSeenBusinessAt: eventStats.lastBusinessAt }
      : {}),
  };

  const profile = await UserBehaviorProfile.findOneAndUpdate(
    { userId },
    { $set: updates, $unset: { anonymousId: '' } },
    { upsert: true, new: true }
  );

  logger.info(
    `[profileAggregator] user=${userId} events=${eventStats.totalEvents} sessions=${sessionStats.totalSessions}`
  );
  return profile;
};

/**
 * Rebuild the behavior profile for a single anonymous visitor.
 */
exports.aggregateAnonymousProfile = async (anonymousId) => {
  const [sessionStats, eventStats, deviceStats, browserStats, countryStats] = await Promise.all([
    _sessionStats({ anonymousId }),
    _eventStats({ anonymousId }),
    _deviceStats({ anonymousId }),
    _browserStats({ anonymousId }),
    _countryStats({ anonymousId }),
  ]);

  if (!sessionStats.totalSessions) {
    logger.debug(`[profileAggregator] no completed sessions for anon=${anonymousId} — skipping`);
    return null;
  }

  const avgEventsPerSession =
    sessionStats.totalSessions > 0
      ? Math.round(eventStats.totalEvents / sessionStats.totalSessions)
      : 0;

  const updates = {
    anonymousId,
    totalEvents: eventStats.totalEvents,
    totalSessions: sessionStats.totalSessions,
    totalSessionDuration: sessionStats.totalDuration,
    avgSessionDuration: Math.round(sessionStats.avgDuration),
    avgEventsPerSession,
    favoritePages: eventStats.favoritePages,
    topEventTypes: new Map(eventStats.eventTypes),
    deviceTypes: new Map(deviceStats),
    browserTypes: new Map(browserStats),
    countriesUsed: new Map(countryStats),
    firstSeenAt: eventStats.firstSeen,
    lastActive: eventStats.lastActive,
    lastKnownIp: eventStats.lastKnownIp,
    lastAggregatedAt: new Date(),
  };

  const profile = await UserBehaviorProfile.findOneAndUpdate(
    { anonymousId },
    { $set: updates, $unset: { userId: '' } },
    { upsert: true, new: true }
  );

  logger.info(
    `[profileAggregator] anon=${anonymousId} events=${eventStats.totalEvents} sessions=${sessionStats.totalSessions}`
  );
  return profile;
};

/**
 * Fetch the current profile for a user or anonymous visitor.
 */
exports.getUserProfile = async (userId = null, anonymousId = null) => {
  const query = {};
  if (userId) query.userId = userId;
  if (anonymousId) query.anonymousId = anonymousId;
  return UserBehaviorProfile.findOne(query);
};

// ── Private aggregation helpers ───────────────────────────────────────────────

async function _sessionStats(match) {
  const result = await Session.aggregate([
    { $match: { ...match, isActive: false } },
    {
      $group: {
        _id: null,
        totalSessions: { $sum: 1 },
        totalDuration: { $sum: '$duration' },
        avgDuration: { $avg: '$duration' },
      },
    },
  ]);
  return {
    totalSessions: result[0]?.totalSessions || 0,
    totalDuration: result[0]?.totalDuration || 0,
    avgDuration: result[0]?.avgDuration || 0,
  };
}

async function _eventStats(match) {
  const result = await Event.aggregate([
    { $match: match },
    {
      $facet: {
        totalCount: [{ $count: 'n' }],
        topPages: [
          { $group: { _id: '$page', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 },
        ],
        eventTypes: [{ $group: { _id: '$eventType', count: { $sum: 1 } } }],
        firstActivity: [
          { $sort: { timestamp: 1 } },
          { $limit: 1 },
          { $project: { timestamp: 1 } },
        ],
        lastActivity: [
          { $sort: { timestamp: -1 } },
          { $limit: 1 },
          { $project: { timestamp: 1, ipAddress: 1 } },
        ],
        lastBusinessView: [
          { $match: { eventType: 'business_view' } },
          { $sort: { timestamp: -1 } },
          { $limit: 1 },
          { $project: { 'properties.businessId': 1, timestamp: 1 } },
        ],
      },
    },
  ]);

  const r = result[0];
  const lastDoc = r.lastActivity[0];
  const lastBiz = r.lastBusinessView[0];

  return {
    totalEvents: r.totalCount[0]?.n || 0,
    favoritePages: r.topPages.map((p) => p._id).filter(Boolean),
    eventTypes: r.eventTypes.map((t) => [t._id, t.count]),
    firstSeen: r.firstActivity[0]?.timestamp || null,
    lastActive: lastDoc?.timestamp || null,
    lastKnownIp: lastDoc?.ipAddress || null,
    lastBusinessId: lastBiz?.properties?.businessId || null,
    lastBusinessAt: lastBiz?.timestamp || null,
  };
}

async function _deviceStats(match) {
  const result = await Session.aggregate([
    { $match: match },
    { $group: { _id: '$deviceType', count: { $sum: 1 } } },
  ]);
  return result.map((d) => [d._id || 'unknown', d.count]);
}

async function _browserStats(match) {
  const result = await Event.aggregate([
    { $match: match },
    { $group: { _id: '$browser', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);
  return result.map((b) => [b._id || 'Unknown', b.count]);
}

async function _countryStats(match) {
  const result = await Session.aggregate([
    { $match: { ...match, country: { $ne: '' } } },
    { $group: { _id: '$country', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]);
  return result.map((c) => [c._id, c.count]);
}
