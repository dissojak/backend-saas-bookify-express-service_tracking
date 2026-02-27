const Event = require('../models/event');
const Session = require('../models/session');
const UserBehaviorProfile = require('../models/userBehaviorProfile');
const logger = require('../utils/logger');

/**
 * Aggregate profiles for all users
 * Called hourly by CRON job
 */
exports.aggregateProfiles = async () => {
  try {
    logger.info('Starting profile aggregation...');

    // Get all unique users from sessions (both userId and anonymousId)
    const userIds = await Session.distinct('userId', { userId: { $ne: null } });
    const anonymousIds = await Session.distinct('anonymousId', { anonymousId: { $ne: null } });

    logger.info(`Aggregating profiles for ${userIds.length} users + ${anonymousIds.length} anonymous users`);

    let successCount = 0;
    let errorCount = 0;

    // Aggregate authenticated users
    for (const userId of userIds) {
      try {
        await exports.aggregateUserProfile(userId);
        successCount++;
      } catch (err) {
        logger.error(`Error aggregating profile for user ${userId}:`, err.message);
        errorCount++;
      }
    }

    // Aggregate anonymous users
    for (const anonymousId of anonymousIds) {
      try {
        await exports.aggregateAnonymousProfile(anonymousId);
        successCount++;
      } catch (err) {
        logger.error(`Error aggregating profile for anonymous user ${anonymousId}:`, err.message);
        errorCount++;
      }
    }

    logger.info(
      `Profile aggregation completed. Success: ${successCount}, Errors: ${errorCount}`
    );
    return { successCount, errorCount };
  } catch (err) {
    logger.error('Error in aggregateProfiles:', err);
    throw err;
  }
};

/**
 * Aggregate profile for a single authenticated user using MongoDB aggregation
 * @param {String} userId - User ID
 */
exports.aggregateUserProfile = async (userId) => {
  try {
    // Get session stats using aggregation pipeline
    const sessionStats = await Session.aggregate([
      { $match: { userId, isActive: false } },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          totalDuration: { $sum: '$duration' },
          avgSessionDuration: { $avg: '$duration' },
        },
      },
    ]);

    const totalSessions = sessionStats[0]?.totalSessions || 0;
    const avgSessionDuration = sessionStats[0]?.avgSessionDuration || 0;

    if (totalSessions === 0) {
      logger.warn(`No completed sessions found for user ${userId}`);
      return null;
    }

    // Get event stats using aggregation pipeline
    const eventStats = await Event.aggregate([
      { $match: { userId } },
      {
        $facet: {
          totalCount: [{ $count: 'count' }],
          topPages: [
            { $group: { _id: '$page', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
          ],
          eventTypes: [
            { $group: { _id: '$eventType', count: { $sum: 1 } } },
          ],
          lastActivity: [
            { $sort: { timestamp: -1 } },
            { $limit: 1 },
            { $project: { timestamp: 1 } },
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

    const totalEvents = eventStats[0].totalCount[0]?.count || 0;
    const favoritePages = eventStats[0].topPages.map((p) => p._id);
    const topEventTypes = new Map(eventStats[0].eventTypes.map((t) => [t._id, t.count]));
    const lastActive = eventStats[0].lastActivity[0]?.timestamp || new Date();
    const lastBusinessEvent = eventStats[0].lastBusinessView[0];

    // Get device type distribution
    const deviceStats = await Session.aggregate([
      { $match: { userId } },
      { $group: { _id: '$deviceType', count: { $sum: 1 } } },
    ]);

    const deviceTypes = new Map(deviceStats.map((d) => [d._id || 'unknown', d.count]));

    // Update or create profile — use $set/$unset so anonymousId is never stored as null
    const profile = await UserBehaviorProfile.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          totalEvents,
          totalSessions,
          avgSessionDuration,
          favoritePages,
          topEventTypes,
          ...(lastBusinessEvent?.properties?.businessId
            ? { lastSeenBusiness: lastBusinessEvent.properties.businessId, lastSeenBusinessAt: lastBusinessEvent.timestamp }
            : {}),
          deviceTypes,
          lastActive,
          lastAggregatedAt: new Date(),
        },
        // Explicitly remove anonymousId — authenticated profiles must not have it
        $unset: { anonymousId: '' },
      },
      { upsert: true, new: true }
    );

    logger.info(
      `Profile aggregated for user ${userId}: ${totalEvents} events, ${totalSessions} sessions`
    );
    return profile;
  } catch (err) {
    logger.error(`Error aggregating profile for user ${userId}:`, err);
    throw err;
  }
};

/**
 * Aggregate profile for an anonymous user using MongoDB aggregation
 * @param {String} anonymousId - Anonymous user ID (UUID)
 */
exports.aggregateAnonymousProfile = async (anonymousId) => {
  try {
    // Get session stats
    const sessionStats = await Session.aggregate([
      { $match: { anonymousId, isActive: false } },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          avgSessionDuration: { $avg: '$duration' },
        },
      },
    ]);

    const totalSessions = sessionStats[0]?.totalSessions || 0;
    const avgSessionDuration = sessionStats[0]?.avgSessionDuration || 0;

    if (totalSessions === 0) {
      logger.warn(`No completed sessions found for anonymous user ${anonymousId}`);
      return null;
    }

    // Get event stats
    const eventStats = await Event.aggregate([
      { $match: { anonymousId } },
      {
        $facet: {
          totalCount: [{ $count: 'count' }],
          topPages: [
            { $group: { _id: '$page', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
          ],
          eventTypes: [
            { $group: { _id: '$eventType', count: { $sum: 1 } } },
          ],
          lastActivity: [
            { $sort: { timestamp: -1 } },
            { $limit: 1 },
            { $project: { timestamp: 1 } },
          ],
        },
      },
    ]);

    const totalEvents = eventStats[0].totalCount[0]?.count || 0;
    const favoritePages = eventStats[0].topPages.map((p) => p._id);
    const topEventTypes = new Map(eventStats[0].eventTypes.map((t) => [t._id, t.count]));
    const lastActive = eventStats[0].lastActivity[0]?.timestamp || new Date();

    // Get device types
    const deviceStats = await Session.aggregate([
      { $match: { anonymousId } },
      { $group: { _id: '$deviceType', count: { $sum: 1 } } },
    ]);

    const deviceTypes = new Map(deviceStats.map((d) => [d._id || 'unknown', d.count]));

    // Update or create profile — use $set/$unset so userId is never stored as null
    const profile = await UserBehaviorProfile.findOneAndUpdate(
      { anonymousId },
      {
        $set: {
          anonymousId,
          totalEvents,
          totalSessions,
          avgSessionDuration,
          favoritePages,
          topEventTypes,
          deviceTypes,
          lastActive,
          lastAggregatedAt: new Date(),
        },
        // Explicitly remove userId — anonymous profiles must not have it
        $unset: { userId: '' },
      },
      { upsert: true, new: true }
    );

    logger.info(
      `Profile aggregated for anonymous user ${anonymousId}: ${totalEvents} events, ${totalSessions} sessions`
    );
    return profile;
  } catch (err) {
    logger.error(`Error aggregating profile for anonymous user ${anonymousId}:`, err);
    throw err;
  }
};

/**
 * Get aggregated profile for a user
 * @param {String} userId - User ID (can be null for anonymous)
 * @param {String} anonymousId - Anonymous ID
 * @returns {Promise<Object>} - User behavior profile
 */
exports.getUserProfile = async (userId = null, anonymousId = null) => {
  try {
    const query = {};
    if (userId) query.userId = userId;
    if (anonymousId) query.anonymousId = anonymousId;

    const profile = await UserBehaviorProfile.findOne(query);
    return profile;
  } catch (err) {
    logger.error('Error fetching user profile:', err);
    throw err;
  }
};
