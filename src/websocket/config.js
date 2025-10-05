const config = require('../shared/config/environment');

/**
 * WebSocket Configuration
 * Centralized configuration for Socket.IO server
 */
const websocketConfig = {
  // Server configuration
  port: process.env.WEBSOCKET_PORT || config.server.port,

  // CORS configuration
  cors: {
    origin: config.security.corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  },

  // Connection limits
  connectionLimits: {
    maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS) || 10000,
    connectionTimeout: parseInt(process.env.WS_CONNECTION_TIMEOUT) || 30000, // 30 seconds
    heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 25000, // 25 seconds
    heartbeatTimeout: parseInt(process.env.WS_HEARTBEAT_TIMEOUT) || 60000 // 60 seconds
  },

  // Rate limiting for WebSocket events
  rateLimit: {
    windowMs: parseInt(process.env.WS_RATE_LIMIT_WINDOW) || 900000, // 15 minutes
    maxEvents: parseInt(process.env.WS_RATE_LIMIT_MAX) || 1000,
    skipSuccessfulRequests: false
  },

  // Notification settings
  notifications: {
    batchSize: parseInt(process.env.WS_NOTIFICATION_BATCH_SIZE) || 100,
    batchTimeout: parseInt(process.env.WS_NOTIFICATION_BATCH_TIMEOUT) || 1000, // 1 second
    maxRetries: parseInt(process.env.WS_NOTIFICATION_MAX_RETRIES) || 3,
    retryDelay: parseInt(process.env.WS_NOTIFICATION_RETRY_DELAY) || 5000 // 5 seconds
  },

  // Security settings
  security: {
    enableAuthentication: process.env.WS_ENABLE_AUTH !== 'false',
    tokenExpiry: parseInt(process.env.WS_TOKEN_EXPIRY) || 3600000, // 1 hour
    maxPayloadSize: parseInt(process.env.WS_MAX_PAYLOAD_SIZE) || 1024 * 1024, // 1MB
    enableCompression: process.env.WS_ENABLE_COMPRESSION !== 'false'
  },

  // Development/Debug settings
  debug: {
    enabled: config.server.nodeEnv === 'development',
    logLevel: process.env.WS_LOG_LEVEL || 'info',
    logConnections: process.env.WS_LOG_CONNECTIONS !== 'false',
    logEvents: process.env.WS_LOG_EVENTS !== 'false'
  }
};

module.exports = websocketConfig;