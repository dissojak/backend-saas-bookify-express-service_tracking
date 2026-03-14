const cron = require('node-cron');
const profileAggregator = require('../services/profileAggregator');
const logger = require('../utils/logger');

/**
 * Profile Aggregation CRON Job
 * Runs every hour at the top of the hour (0 * * * *) in production
 * Runs every 5 minutes (*./5 * * * * ) in development
 * Aggregates user behavior profiles from events and sessions
 **/
const scheduleProfileAggregation = () => {
  const isDev = process.env.NODE_ENV === 'development';
  const schedule = isDev ? '*/5 * * * *' : '0 * * * *';
  
  const job = cron.schedule(schedule, async () => {
    try {
      logger.info('Profile aggregation job started');
      const result = await profileAggregator.aggregateProfiles();
      logger.info(`Profile aggregation job completed: ${JSON.stringify(result)}`);
    } catch (err) {
      logger.error('Profile aggregation job failed:', err);
    }
  });

  logger.info(`Profile aggregation CRON job initialized (runs ${isDev ? 'every 5 minutes' : 'every hour'})`);
  return job;
};

module.exports = { scheduleProfileAggregation };