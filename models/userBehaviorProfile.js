const mongoose = require('mongoose');

const userBehaviorProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      // No default — field must be absent (not null) for sparse unique index to work
      unique: true,
      sparse: true,
      index: true,
      description: 'Numeric user ID from Spring Boot backend (null for anonymous)',
    },
    anonymousId: {
      type: String,
      // No default — field must be absent (not null) for sparse unique index to work
      unique: true,
      sparse: true,
      index: true,
      description: 'UUID for anonymous user profiles',
    },
    totalEvents: {
      type: Number,
      default: 0,
      description: 'Cumulative count of all tracked events',
    },
    totalSessions: {
      type: Number,
      default: 0,
      description: 'Count of completed sessions',
    },
    avgSessionDuration: {
      type: Number,
      default: 0,
      description: 'Average session duration in milliseconds',
    },
    favoritePages: {
      type: [String],
      default: [],
      description: 'Top 5 most-visited pages',
    },
    topEventTypes: {
      type: Map,
      of: Number,
      default: new Map(),
      description: 'Count of each event type {eventType: count}',
    },
    lastSeenBusiness: {
      type: String,
      description: 'ID of the last viewed business',
    },
    lastSeenBusinessAt: {
      type: Date,
      description: 'Timestamp of last business view',
    },
    deviceTypes: {
      type: Map,
      of: Number,
      default: new Map(),
      description: 'Device usage breakdown {deviceType: count}',
    },
    lastActive: {
      type: Date,
      index: true,
      description: 'Timestamp of last activity',
    },
    lastAggregatedAt: {
      type: Date,
      description: 'When this profile was last updated by the aggregation job',
    },
  },
  { timestamps: true, collection: 'userBehaviorProfiles' }
);

module.exports = mongoose.model('UserBehaviorProfile', userBehaviorProfileSchema);
