const { logger } = require('../shared/utils/logger');

class HealthController {
  static async checkHealth(req, res) {
    try {
      const startTime = process.hrtime();

      const healthData = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        memory: process.memoryUsage(),
        responseTime: null
      };

      // Calculate response time
      const [seconds, nanoseconds] = process.hrtime(startTime);
      healthData.responseTime = `${(seconds * 1000 + nanoseconds / 1e6).toFixed(2)}ms`;

      logger.info('Health check accessed', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        responseTime: healthData.responseTime
      });

      res.status(200).json({
        success: true,
        data: healthData,
        message: 'Service is healthy',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Health check failed', { error: error?.message || 'Unknown error' });
      res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNHEALTHY',
          message: 'Service is currently unhealthy'
        },
        timestamp: new Date().toISOString()
      });
    }
  }

  static async checkReadiness(req, res) {
    // Check if all dependencies are ready
    const isReady = true; // In a real app, check database, external services, etc.

    if (isReady) {
      res.status(200).json({
        success: true,
        data: {
          status: 'READY',
          timestamp: new Date().toISOString()
        },
        message: 'Service is ready to accept traffic'
      });
    } else {
      res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_NOT_READY',
          message: 'Service is not ready to accept traffic'
        }
      });
    }
  }

  static async checkLiveness(req, res) {
    // Check if the service is alive
    const isAlive = true; // In a real app, check critical components

    if (isAlive) {
      res.status(200).json({
        success: true,
        data: {
          status: 'ALIVE',
          timestamp: new Date().toISOString()
        },
        message: 'Service is alive'
      });
    } else {
      res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_NOT_ALIVE',
          message: 'Service is not alive'
        }
      });
    }
  }

  static async checkWebSocket(req, res) {
    try {
      const wsServer = global.wsServer;

      if (!wsServer) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'WEBSOCKET_SERVER_UNAVAILABLE',
            message: 'WebSocket server is not available'
          },
          timestamp: new Date().toISOString()
        });
      }

      const wsStats = wsServer.getStats();

      res.status(200).json({
        success: true,
        data: {
          status: 'HEALTHY',
          websocket: wsStats,
          timestamp: new Date().toISOString()
        },
        message: 'WebSocket server is healthy'
      });
    } catch (error) {
      logger.error('WebSocket health check failed', { error: error.message });
      res.status(503).json({
        success: false,
        error: {
          code: 'WEBSOCKET_UNHEALTHY',
          message: 'WebSocket server is currently unhealthy'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
}

module.exports = HealthController;