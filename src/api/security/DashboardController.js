/**
 * Security Dashboard Controller
 * Comprehensive API endpoints for security dashboard functionality
 */

const express = require('express');
const winston = require('winston');
const { SecurityMetricsCalculator } = require('../../security/metrics/SecurityMetricsCalculator');
const { MetricsReporter } = require('../../security/metrics/MetricsReporter');
const { MetricsDashboard } = require('../../security/metrics/MetricsDashboard');
const { PolicyManager } = require('../../security/policy/PolicyManager');
const { PolicyEnforcer } = require('../../security/policy/PolicyEnforcer');
const { IncidentManager } = require('../../security/incident/IncidentManager');

class DashboardController {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== false,
      cachingEnabled: config.cachingEnabled !== false,
      cacheTimeout: config.cacheTimeout || 300000, // 5 minutes
      rateLimiting: config.rateLimiting !== false,
      rateLimitWindow: config.rateLimitWindow || 60000, // 1 minute
      rateLimitMax: config.rateLimitMax || 100,
      pagination: {
        defaultLimit: config.defaultLimit || 20,
        maxLimit: config.maxLimit || 100
      },
      ...config
    };

    // Initialize security components
    this.metricsCalculator = new SecurityMetricsCalculator();
    this.metricsReporter = new MetricsReporter();
    this.metricsDashboard = new MetricsDashboard();
    this.policyManager = new PolicyManager();
    this.policyEnforcer = new PolicyEnforcer();
    this.incidentManager = new IncidentManager();

    // Cache for dashboard data
    this.cache = new Map();
    this.rateLimitTracker = new Map();

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
          filename: 'logs/dashboard-controller.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize dashboard controller
   */
  async initialize() {
    try {
      this.logger.info('Security dashboard controller initialized');
    } catch (error) {
      this.logger.error('Failed to initialize dashboard controller:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive dashboard overview
   */
  async getOverview(req, res) {
    try {
      // Check rate limiting
      if (!this.checkRateLimit(req.ip, 'overview')) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Too many requests'
        });
      }

      // Check cache
      const cacheKey = 'overview';
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }

      // Get overview data
      const overview = await this.generateOverviewData();

      // Cache the result
      this.setCachedData(cacheKey, overview);

      res.json(overview);

    } catch (error) {
      this.logger.error('Failed to get dashboard overview:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve dashboard overview'
      });
    }
  }

  /**
   * Get security metrics
   */
  async getMetrics(req, res) {
    try {
      // Check rate limiting
      if (!this.checkRateLimit(req.ip, 'metrics')) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Too many requests'
        });
      }

      const { timeRange = 'daily', filters = {} } = req.query;

      // Validate time range
      const validTimeRanges = ['hourly', 'daily', 'weekly', 'monthly'];
      if (!validTimeRanges.includes(timeRange)) {
        return res.status(400).json({
          error: 'Invalid time range',
          message: 'Valid time ranges: hourly, daily, weekly, monthly'
        });
      }

      // Check cache
      const cacheKey = `metrics_${timeRange}_${JSON.stringify(filters)}`;
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }

      // Get metrics data
      const metrics = await this.metricsCalculator.calculateMetrics(timeRange, filters);

      // Cache the result
      this.setCachedData(cacheKey, metrics);

      res.json(metrics);

    } catch (error) {
      this.logger.error('Failed to get security metrics:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve security metrics'
      });
    }
  }

  /**
   * Get real-time dashboard data
   */
  async getRealTimeData(req, res) {
    try {
      // Check rate limiting (more strict for real-time data)
      if (!this.checkRateLimit(req.ip, 'realtime', 30, 10000)) { // 100 requests per 10 seconds
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Too many real-time requests'
        });
      }

      // Get real-time data from dashboard
      const realTimeData = await this.metricsDashboard.generateDashboardData();

      res.json(realTimeData);

    } catch (error) {
      this.logger.error('Failed to get real-time data:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve real-time data'
      });
    }
  }

  /**
   * Get incidents summary
   */
  async getIncidents(req, res) {
    try {
      const { status, severity, page = 1, limit = 20, timeframe = '7d' } = req.query;

      // Validate pagination
      const parsedLimit = parseInt(limit);
      const parsedPage = parseInt(page);

      if (parsedLimit > this.config.pagination.maxLimit) {
        return res.status(400).json({
          error: 'Invalid limit',
          message: `Maximum limit is ${this.config.pagination.maxLimit}`
        });
      }

      // Get incidents from incident manager
      const incidents = await this.incidentManager.getIncidents({
        status,
        severity,
        page: parsedPage,
        limit: parsedLimit,
        timeframe
      });

      res.json(incidents);

    } catch (error) {
      this.logger.error('Failed to get incidents:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve incidents'
      });
    }
  }

  /**
   * Get policy compliance status
   */
  async getPolicyCompliance(req, res) {
    try {
      const { category, status, timeframe = '30d' } = req.query;

      // Get policies from policy manager
      const policies = await this.policyManager.getPolicies({
        category,
        status,
        effective: true
      });

      // Get policy statistics
      const statistics = await this.policyManager.getPolicyStatistics();

      // Get violations
      const violations = await this.policyEnforcer.getPolicyViolations({
        since: new Date(Date.now() - this.parseTimeframe(timeframe))
      });

      const complianceData = {
        policies,
        statistics,
        violations,
        overallCompliance: this.calculateOverallCompliance(statistics, violations),
        timeframe
      };

      res.json(complianceData);

    } catch (error) {
      this.logger.error('Failed to get policy compliance:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve policy compliance data'
      });
    }
  }

  /**
   * Get threat intelligence
   */
  async getThreatIntelligence(req, res) {
    try {
      const { severity, type, timeframe = '24h' } = req.query;

      // Check cache
      const cacheKey = `threats_${timeframe}_${severity || 'all'}_${type || 'all'}`;
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }

      // Get threat intelligence data
      const threats = await this.getThreatData({
        severity,
        type,
        timeframe
      });

      // Cache the result
      this.setCachedData(cacheKey, threats);

      res.json(threats);

    } catch (error) {
      this.logger.error('Failed to get threat intelligence:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve threat intelligence'
      });
    }
  }

  /**
   * Generate and download reports
   */
  async generateReport(req, res) {
    try {
      const { type = 'comprehensive', format = 'pdf', timeframe = 'monthly', filters = {} } = req.body;

      // Validate report type
      const validTypes = ['comprehensive', 'executive', 'technical', 'compliance', 'incident'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          error: 'Invalid report type',
          message: `Valid types: ${validTypes.join(', ')}`
        });
      }

      // Validate format
      const validFormats = ['pdf', 'html', 'json', 'csv'];
      if (!validFormats.includes(format)) {
        return res.status(400).json({
          error: 'Invalid format',
          message: `Valid formats: ${validFormats.join(', ')}`
        });
      }

      // Generate report
      const report = await this.metricsReporter.generateReport({
        type,
        timeframe,
        formats: [format],
        filters
      });

      if (format === 'json') {
        return res.json(report);
      }

      // For other formats, return file download
      const file = report.files.find(f => f.format === format);
      if (!file) {
        return res.status(500).json({
          error: 'Report generation failed',
          message: `Unable to generate ${format} format`
        });
      }

      // Set appropriate headers for file download
      const fs = require('fs');
      if (fs.existsSync(file.path)) {
        const fileStream = fs.createReadStream(file.path);
        res.setHeader('Content-Type', this.getContentType(format));
        res.setHeader('Content-Disposition', `attachment; filename="${type}_report.${format}"`);
        fileStream.pipe(res);
      } else {
        res.status(404).json({
          error: 'File not found',
          message: 'Generated report file not found'
        });
      }

    } catch (error) {
      this.logger.error('Failed to generate report:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to generate report'
      });
    }
  }

  /**
   * Get security alerts
   */
  async getAlerts(req, res) {
    try {
      const { severity, status, page = 1, limit = 20, timeframe = '24h' } = req.query;

      // Validate pagination
      const parsedLimit = parseInt(limit);
      const parsedPage = parseInt(page);

      if (parsedLimit > this.config.pagination.maxLimit) {
        return res.status(400).json({
          error: 'Invalid limit',
          message: `Maximum limit is ${this.config.pagination.maxLimit}`
        });
      }

      // Get alerts
      const alerts = await this.getAlertsData({
        severity,
        status,
        page: parsedPage,
        limit: parsedLimit,
        timeframe
      });

      res.json(alerts);

    } catch (error) {
      this.logger.error('Failed to get alerts:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve alerts'
      });
    }
  }

  /**
   * Get asset security status
   */
  async getAssetSecurity(req, res) {
    try {
      const { category, criticality, status, timeframe = '30d' } = req.query;

      // Get asset security data
      const assets = await this.getAssetSecurityData({
        category,
        criticality,
        status,
        timeframe
      });

      res.json(assets);

    } catch (error) {
      this.logger.error('Failed to get asset security:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve asset security data'
      });
    }
  }

  /**
   * Get user security activity
   */
  async getUserActivity(req, res) {
    try {
      const { userId, activity, timeframe = '7d', page = 1, limit = 20 } = req.query;

      // Get user activity data
      const activityData = await this.getUserActivityData({
        userId,
        activity,
        timeframe,
        page: parseInt(page),
        limit: Math.min(parseInt(limit), this.config.pagination.maxLimit)
      });

      res.json(activityData);

    } catch (error) {
      this.logger.error('Failed to get user activity:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve user activity data'
      });
    }
  }

  /**
   * Get dashboard statistics
   */
  async getStatistics(req, res) {
    try {
      // Get statistics from all components
      const statistics = {
        overview: {
          totalPolicies: await this.policyManager.getStatistics().then(s => s.activePolicies),
          activeIncidents: await this.incidentManager.getStatistics().then(s => s.activeIncidents),
          totalViolations: await this.policyEnforcer.getStatistics().then(s => s.violationCounters.size),
          monitoringActive: await this.metricsDashboard.getStatistics().then(s => s.activeConnections)
        },
        metrics: await this.metricsCalculator.getStatistics(),
        dashboard: await this.metricsDashboard.getStatistics(),
        policies: await this.policyManager.getStatistics(),
        enforcement: await this.policyEnforcer.getStatistics(),
        incidents: await this.incidentManager.getStatistics()
      };

      res.json(statistics);

    } catch (error) {
      this.logger.error('Failed to get statistics:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve statistics'
      });
    }
  }

  /**
   * Generate comprehensive overview data
   */
  async generateOverviewData() {
    try {
      const now = new Date();
      const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Get metrics
      const dailyMetrics = await this.metricsCalculator.calculateMetrics('daily');
      const hourlyMetrics = await this.metricsCalculator.calculateMetrics('hourly');

      // Get incidents
      const incidents = await this.incidentManager.getIncidents({
        timeframe: '7d',
        limit: 10
      });

      // Get policies
      const policyStats = await this.policyManager.getPolicyStatistics();

      // Get violations
      const violations = await this.policyEnforcer.getPolicyViolations({
        since: last24Hours
      });

      const overview = {
        timestamp: now,
        summary: {
          overallScore: dailyMetrics.overallScore,
          riskLevel: this.calculateRiskLevel(dailyMetrics.overallScore),
          status: this.determineSystemStatus(dailyMetrics),
          uptime: dailyMetrics.performance.availability.percentage
        },
        metrics: {
          incidents: {
            total: incidents.total || 0,
            critical: incidents.bySeverity?.critical || 0,
            high: incidents.bySeverity?.high || 0,
            new: incidents.new || 0,
            resolved: incidents.resolved || 0
          },
          policies: {
            total: policyStats.total || 0,
            enforced: policyStats.compliance.enforced || 0,
            violations: violations.length,
            complianceRate: policyStats.compliance.compliant > 0 ?
              (policyStats.compliance.compliant / policyStats.total) * 100 : 0
          },
          securityEvents: {
            total: dailyMetrics.securityEvents.total,
            eventsPerMinute: hourlyMetrics.securityEvents.eventsPerMinute,
            blocked: hourlyMetrics.threatIntelligence.indicatorsBlocked || 0,
            alerts: dailyMetrics.thresholdBreaches.length
          },
          performance: {
            responseTime: dailyMetrics.performance.responseTime.average,
            availability: dailyMetrics.performance.availability.percentage,
            errorRate: dailyMetrics.performance.errorRate.percentage
          }
        },
        alerts: dailyMetrics.thresholdBreaches.slice(0, 5).map(breach => ({
          type: breach.metric,
          severity: breach.level,
          message: `${breach.metric} threshold exceeded`,
          value: breach.value,
          threshold: breach.threshold
        })),
        trends: {
          incidents: this.calculateTrend(incidents),
          violations: this.calculateTrend(violations),
          score: this.calculateTrend(dailyMetrics)
        },
        recommendations: this.generateQuickRecommendations(dailyMetrics, incidents, violations)
      };

      return overview;

    } catch (error) {
      this.logger.error('Failed to generate overview data:', error);
      throw error;
    }
  }

  /**
   * Helper methods
   */
  checkRateLimit(clientIp, endpoint, maxRequests = this.config.rateLimitMax, windowMs = this.config.rateLimitWindow) {
    const key = `${clientIp}:${endpoint}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean up old entries
    for (const [k, requests] of this.rateLimitTracker) {
      this.rateLimitTracker.set(k, requests.filter(time => time > windowStart));
      if (this.rateLimitTracker.get(k).length === 0) {
        this.rateLimitTracker.delete(k);
      }
    }

    // Check current requests
    const requests = this.rateLimitTracker.get(key) || [];
    requests.push(now);

    if (requests.length > maxRequests) {
      return false;
    }

    this.rateLimitTracker.set(key, requests);
    return true;
  }

  getCachedData(key) {
    if (!this.config.cachingEnabled) {
      return null;
    }

    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }

    // Check if cache is expired
    if (Date.now() - cached.timestamp > this.config.cacheTimeout) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  setCachedData(key, data) {
    if (!this.config.cachingEnabled) {
      return;
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  calculateRiskLevel(score) {
    if (score >= 90) return 'low';
    if (score >= 70) return 'medium';
    if (score >= 50) return 'high';
    return 'critical';
  }

  determineSystemStatus(metrics) {
    if (metrics.thresholdBreaches.some(b => b.level === 'critical')) {
      return 'critical';
    }
    if (metrics.overallScore < 70) {
      return 'degraded';
    }
    if (metrics.performance.availability.percentage < 99) {
      return 'warning';
    }
    return 'operational';
  }

  calculateTrend(data) {
    // Simplified trend calculation
    if (!data || data.length < 2) {
      return { direction: 'stable', percentage: 0 };
    }

    const recent = data.slice(-7); // Last 7 items
    const older = data.slice(-14, -7); // Previous 7 items

    const recentSum = recent.reduce((sum, item) => sum + (item.total || item.length || 0), 0);
    const olderSum = older.reduce((sum, item) => sum + (item.total || item.length || 0), 0);

    if (olderSum === 0) {
      return { direction: 'stable', percentage: 0 };
    }

    const change = ((recentSum - olderSum) / olderSum) * 100;

    return {
      direction: change > 10 ? 'increasing' : change < -10 ? 'decreasing' : 'stable',
      percentage: Math.abs(change)
    };
  }

  generateQuickRecommendations(metrics, incidents, violations) {
    const recommendations = [];

    if (metrics.overallScore < 80) {
      recommendations.push({
        priority: 'high',
        title: 'Improve Overall Security Score',
        description: `Current score is ${metrics.overallScore.toFixed(1)}%, improvement needed`
      });
    }

    if (incidents.total > 10) {
      recommendations.push({
        priority: 'medium',
        title: 'Review Incident Management',
        description: `${incidents.total} incidents in the last week`
      });
    }

    if (violations.length > 5) {
      recommendations.push({
        priority: 'medium',
        title: 'Address Policy Violations',
        description: `${violations.length} policy violations detected`
      });
    }

    return recommendations;
  }

  calculateOverallCompliance(statistics, violations) {
    const totalPolicies = statistics.total || 1;
    const compliantPolicies = statistics.compliance?.approved || 0;
    const violationCount = violations.length;

    const complianceScore = Math.max(0, (compliantPolicies / totalPolicies) * 100 - (violationCount * 2));

    return {
      score: Math.round(complianceScore),
      level: complianceScore >= 90 ? 'excellent' : complianceScore >= 70 ? 'good' : complianceScore >= 50 ? 'fair' : 'poor'
    };
  }

  parseTimeframe(timeframe) {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1));

    switch (unit) {
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      case 'w': return value * 7 * 24 * 60 * 60 * 1000;
      case 'm': return value * 30 * 24 * 60 * 60 * 1000;
      default: return 7 * 24 * 60 * 60 * 1000; // Default to 7 days
    }
  }

  getContentType(format) {
    const types = {
      'pdf': 'application/pdf',
      'html': 'text/html',
      'json': 'application/json',
      'csv': 'text/csv'
    };
    return types[format] || 'application/octet-stream';
  }

  async getThreatData(filters) {
    // Placeholder implementation
    return {
      threats: [],
      total: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byType: {},
      timeframe: filters.timeframe
    };
  }

  async getAlertsData(filters) {
    // Placeholder implementation
    return {
      alerts: [],
      total: 0,
      page: filters.page,
      totalPages: 0
    };
  }

  async getAssetSecurityData(filters) {
    // Placeholder implementation
    return {
      assets: [],
      total: 0,
      byStatus: {},
      byCriticality: {}
    };
  }

  async getUserActivityData(filters) {
    // Placeholder implementation
    return {
      activities: [],
      total: 0,
      page: filters.page,
      totalPages: 0
    };
  }

  /**
   * Create Express router
   */
  createRouter() {
    const router = express.Router();

    // Overview endpoints
    router.get('/overview', this.getOverview.bind(this));
    router.get('/realtime', this.getRealTimeData.bind(this));

    // Metrics endpoints
    router.get('/metrics', this.getMetrics.bind(this));

    // Incident endpoints
    router.get('/incidents', this.getIncidents.bind(this));

    // Policy endpoints
    router.get('/policies/compliance', this.getPolicyCompliance.bind(this));

    // Threat intelligence endpoints
    router.get('/threats', this.getThreatIntelligence.bind(this));

    // Report endpoints
    router.post('/reports/generate', this.generateReport.bind(this));

    // Alert endpoints
    router.get('/alerts', this.getAlerts.bind(this));

    // Asset security endpoints
    router.get('/assets/security', this.getAssetSecurity.bind(this));

    // User activity endpoints
    router.get('/users/activity', this.getUserActivity.bind(this));

    // Statistics endpoint
    router.get('/statistics', this.getStatistics.bind(this));

    return router;
  }

  /**
   * Get controller statistics
   */
  getStatistics() {
    return {
      enabled: this.config.enabled,
      cachingEnabled: this.config.cachingEnabled,
      cacheSize: this.cache.size,
      rateLimitTrackerSize: this.rateLimitTracker.size,
      rateLimitingEnabled: this.config.rateLimiting,
      components: {
        metricsCalculator: this.metricsCalculator.getStatistics(),
        metricsReporter: this.metricsReporter.getStatistics(),
        metricsDashboard: this.metricsDashboard.getStatistics(),
        policyManager: this.policyManager.getStatistics(),
        policyEnforcer: this.policyEnforcer.getStatistics(),
        incidentManager: this.incidentManager.getStatistics()
      }
    };
  }
}

module.exports = DashboardController;