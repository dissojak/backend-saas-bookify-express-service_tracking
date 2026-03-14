const dotenv = require('dotenv');

// Load env vars
dotenv.config();

// Validate required environment variables
require('./config/env');

const app = require('./app');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const { scheduleProfileAggregation } = require('./jobs/profileAggregationJob');
const { scheduleSessionCleanup } = require('./jobs/sessionCleanupJob');

const PORT = process.env.PORT || 5000;

const startServer = (retries = 5, delay = 1000) => {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      resolve(server);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        if (retries > 0) {
          logger.warn(`Port ${PORT} in use. Retrying in ${delay}ms... (${retries} retries left)`);
          server.close();
          setTimeout(() => {
            startServer(retries - 1, delay)
              .then(resolve)
              .catch(reject);
          }, delay);
        } else {
          logger.error(`Port ${PORT} still in use after retries. Exiting for nodemon restart...`);
          process.exit(1);
        }
      } else {
        reject(err);
      }
    });
  });
};

const start = async () => {
  try {
    await connectDB();

    // Initialize CRON jobs
    scheduleProfileAggregation();
    scheduleSessionCleanup();

    const server = await startServer();

    // Graceful shutdown on SIGTERM (Kubernetes, Docker) or SIGINT (Ctrl+C)
    const gracefulShutdown = (signal) => {
      logger.info(`Received ${signal}, closing server gracefully...`);
      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
      // Force exit after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (err) {
    logger.error(`Fatal startup error: ${err.message}`);
    process.exit(1);
  }
};

start();