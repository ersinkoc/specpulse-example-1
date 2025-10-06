/**
 * Security API Routes
 * Main entry point for all security-related API endpoints
 */

const express = require('express');
const winston = require('winston');

const DashboardController = require('./DashboardController');
const MetricsController = require('./MetricsController');
const IncidentsController = require('./IncidentsController');
const ComplianceController = require('./ComplianceController');

/**
 * Security API Router
 */
class SecurityAPI {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== false,
      apiVersion: config.apiVersion || 'v1',
      corsEnabled: config.corsEnabled !== false,
      rateLimiting: config.rateLimiting !== false,
      authentication: config.authentication !== false,
      logging: config.logging !== false,
      ...config
    };

    // Initialize controllers
    this.dashboardController = new DashboardController(config.dashboard || {});
    this.metricsController = new MetricsController(config.metrics || {});
    this.incidentsController = new IncidentsController(config.incidents || {});
    this.complianceController = new ComplianceController(config.compliance || {});

    // Initialize logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({ format: winston.format.simple() }),
        new winston.transports.File({
          filename: 'logs/security-api.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize security API
   */
  async initialize() {
    try {
      this.logger.info('Security API initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize security API:', error);
      throw error;
    }
  }

  /**
   * Create Express router
   */
  createRouter() {
    const router = express.Router();

    // API version prefix
    const versionPrefix = `/${this.config.apiVersion}`;

    // Health check endpoint
    router.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date(),
        version: this.config.apiVersion,
        components: {
          dashboard: this.dashboardController.getStatistics(),
          metrics: this.metricsController.getStatistics(),
          incidents: this.incidentsController.getStatistics(),
          compliance: this.complianceController.getStatistics()
        }
      });
    });

    // Route to controller routers
    router.use('/dashboard', this.dashboardController.createRouter());
    router.use('/metrics', this.metricsController.createRouter());
    router.use('/incidents', this.incidentsController.createRouter());
    router.use('/compliance', this.complianceController.createRouter());

    return router;
  }

  /**
   * Apply middleware to router
   */
  applyMiddleware(router) {
    // CORS middleware
    if (this.config.corsEnabled) {
      const cors = require('cors');
      router.use(cors());
    }

    // Rate limiting
    if (this.config.rateLimiting) {
      const rateLimit = require('express-rate-limit');
      const limiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100 // limit each IP to 100 requests per windowMs
      });
      router.use(liter);
    }

    // Request logging
    if (this.config.logging) {
      router.use((req, res, next) => {
        this.logger.info('Security API Request', {
          method: req.method,
          url: req.url,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          timestamp: new Date()
        });
        next();
      });
    }

    // Authentication middleware
    if (this.config.authentication) {
      router.use(this.authenticationMiddleware.bind(this));
    }

    // Error handling middleware
    router.use((error, req, res, next) => {
      this.logger.error('Security API Error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: this.config.enabled ? 'An error occurred while processing your request' : 'Security API is temporarily unavailable',
        timestamp: new Date()
      });
    });

    // 404 handler
    router.use((req, res) => {
      res.status(404).json({
        error: 'Not found',
        message: `Endpoint ${req.method} ${req.url} not found`,
        timestamp: new Date()
      });
    });

    return router;
  }

  /**
   * Authentication middleware
   */
  authenticationMiddleware(req, res, next) {
    try {
      // In a real implementation, this would validate JWT tokens or other authentication
      // For now, we'll pass through all requests with a user object if available

      // Mock user data for development
      if (!req.user) {
        req.user = {
          id: 'system',
          roles: ['admin'],
          permissions: ['read', 'write', 'admin']
        };
      }

      next();
    } catch (error) {
      this.logger.error('Authentication middleware error:', error);
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }
  }

  /**
   * Get API statistics
   */
  getStatistics() {
    return {
      enabled: this.config.enabled,
      apiVersion: this.config.apiVersion,
      corsEnabled: this.config.corsEnabled,
      rateLimiting: this.config.rateLimiting,
      authentication: this.config.authentication,
      logging: this.config.logging,
      controllers: {
        dashboard: this.dashboardController.getStatistics(),
        metrics: this.metricsController.getStatistics(),
        incidents: this.incidentsController.getStatistics(),
        compliance: this.complianceController.getStatistics()
      }
    };
  }
}

module.exports = SecurityAPI;