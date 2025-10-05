const config = require('../config/environment');

// Simple logger implementation (can be replaced with winston in production)
const logger = {
  debug: (message, meta = {}) => {
    if (config.server.nodeEnv === 'development') {
      console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, meta);
    }
  },

  info: (message, meta = {}) => {
    console.info(`[INFO] ${new Date().toISOString()} - ${message}`, meta);
  },

  warn: (message, meta = {}) => {
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, meta);
  },

  error: (message, meta = {}) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, meta);
  }
};

module.exports = logger;