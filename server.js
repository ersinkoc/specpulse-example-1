const app = require('./src/app');
const config = require('./src/config');
// const WebSocketServer = require('./src/websocket/server'); // Temporarily disabled due to Redis dependency
// const notificationService = require('./src/services/notificationService'); // Temporarily disabled due to Redis dependency
// const notificationEmailService = require('./src/services/notificationEmailService'); // Temporarily disabled due to Redis dependency
const logger = require('./src/shared/utils/logger');

const PORT = config.port;

// Create HTTP server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📝 API endpoints: http://localhost:${PORT}/tasks`);
  console.log(`🔌 WebSocket server: ws://localhost:${PORT}`);
  console.log(`🌍 Environment: ${config.env}`);
});

// Initialize WebSocket server
// const wsServer = new WebSocketServer(server); // Temporarily disabled due to Redis dependency

// Make wsServer available globally for other modules
// global.wsServer = wsServer; // Temporarily disabled due to Redis dependency

// Initialize notification email service
// notificationEmailService.initialize().catch(error => {
//   logger.warn('Failed to initialize notification email service:', error);
// });

// Start scheduled notification processor
// notificationService.startScheduledNotificationProcessor();

// Start notification retry processor
// notificationService.startRetryProcessor();

// Graceful shutdown
const gracefulShutdown = () => {
  logger.info('Received shutdown signal, closing server...');

  // Close WebSocket server
  // wsServer.shutdown(); // Temporarily disabled due to Redis dependency

  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});