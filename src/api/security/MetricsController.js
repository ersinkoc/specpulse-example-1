/**
 * Security Metrics Controller
 * API endpoints for security metrics collection and analysis
 */

const express = require('express');
const winston = require('winston');
const { SecurityMetricsCalculator } = require('../../security/metrics/SecurityMetricsCalculator');
const { MetricsReporter } = require('../../security/metrics/MetricsReporter');

class MetricsController {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled !== false,
      cachingEnabled: config.cachingEnabled !== false,
      cacheTimeout: config.cacheTimeout || 300000, // 5 minutes
      aggregationWindows: config.aggregationWindows || {
        hourly: 3600000,      // 1 hour
        daily: 86400000,      // 24 hours
        weekly: 604800000,    // 7 days
        monthly: 2592000000   // 30 days
      },
      exportFormats: config.exportFormats || ['json', 'csv', 'excel', 'pdf'],
      maxExportRecords: config.maxExportRecords || 10000,
      realTimeUpdates: config.realTimeUpdates !== false,
      ...config
    };

    // Initialize components
    this.metricsCalculator = new SecurityMetricsCalculator();
    this.metricsReporter = new MetricsReporter();

    // Cache
    this.cache = new Map();

    // Real-time subscribers
    this.subscribers = new Map();

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
          filename: 'logs/metrics-controller.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize metrics controller
   */
  async initialize() {
    try {
      this.logger.info('Security metrics controller initialized');
    } catch (error) {
      this.logger.error('Failed to initialize metrics controller:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive metrics
   */
  async getMetrics(req, res) {
    try {
      const {
        timeRange = 'daily',
        filters = {},
        includeTrends = false,
        includeAnomalies = false
      } = req.query;

      // Validate time range
      const validTimeRanges = Object.keys(this.config.aggregationWindows);
      if (!validTimeRanges.includes(timeRange)) {
        return res.status(400).json({
          error: 'Invalid time range',
          message: `Valid time ranges: ${validTimeRanges.join(', ')}`
        });
      }

      // Check cache
      const cacheKey = `metrics_${timeRange}_${JSON.stringify(filters)}_${includeTrends}_${includeAnomalies}`;
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }

      // Calculate metrics
      const metrics = await this.metricsCalculator.calculateMetrics(timeRange, filters);

      // Add additional data if requested
      const response = { metrics };

      if (includeTrends === 'true') {
        response.trends = await this.calculateTrends(timeRange, filters);
      }

      if (includeAnomalies === 'true') {
        response.anomalies = await this.detectAnomalies(metrics);
      }

      // Cache the result
      this.setCachedData(cacheKey, response);

      res.json(response);

    } catch (error) {
      this.logger.error('Failed to get metrics:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve metrics'
      });
    }
  }

  /**
   * Get specific metrics category
   */
  async getCategoryMetrics(req, res) {
    try {
      const { category, timeRange = 'daily', filters = {} } = req.params;

      // Validate category
      const validCategories = ['incidents', 'securityEvents', 'compliance', 'performance', 'risk', 'assets', 'users', 'threats'];
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          error: 'Invalid category',
          message: `Valid categories: ${validCategories.join(', ')}`
        });
      }

      // Check cache
      const cacheKey = `category_${category}_${timeRange}_${JSON.stringify(filters)}`;
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }

      // Calculate full metrics first
      const fullMetrics = await this.metricsCalculator.calculateMetrics(timeRange, filters);

      // Extract category-specific metrics
      const categoryMetrics = this.extractCategoryMetrics(fullMetrics, category);

      // Cache the result
      this.setCachedData(cacheKey, categoryMetrics);

      res.json(categoryMetrics);

    } catch (error) {
      this.logger.error(`Failed to get ${req.params.category} metrics:`, error);
      res.status(500).json({
        error: 'Internal server error',
        message: `Failed to retrieve ${req.params.category} metrics`
      });
    }
  }

  /**
   * Get real-time metrics
   */
  async getRealTimeMetrics(req, res) {
    try {
      // Get real-time data from metrics calculator
      const realTimeData = this.metricsCalculator.getRealTimeMetrics();

      res.json({
        timestamp: new Date(),
        data: realTimeData,
        subscribers: this.subscribers.size
      });

    } catch (error) {
      this.logger.error('Failed to get real-time metrics:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve real-time metrics'
      });
    }
  }

  /**
   * Get metrics trends
   */
  async getTrends(req, res) {
    try {
      const {
        metric,
        timeRange = 'weekly',
        periods = 4,
        filters = {}
      } = req.query;

      // Validate parameters
      const validPeriods = [1, 2, 3, 4, 6, 12];
      if (!validPeriods.includes(parseInt(periods))) {
        return res.status(400).json({
          error: 'Invalid periods',
          message: `Valid periods: ${validPeriods.join(', ')}`
        });
      }

      // Calculate trends
      const trends = await this.calculateTrendsData(metric, timeRange, periods, filters);

      res.json(trends);

    } catch (error) {
      this.logger.error('Failed to get trends:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve trends'
      });
    }
  }

  /**
   * Get anomalies
   */
  async getAnomalies(req, res) {
    try {
      const {
        timeRange = 'daily',
        severity = 'all',
        filters = {}
      } = req.query;

      // Get current metrics
      const metrics = await this.metricsCalculator.calculateMetrics(timeRange, filters);

      // Detect anomalies
      const anomalies = await this.detectAnomalies(metrics);

      // Filter by severity if specified
      let filteredAnomalies = anomalies;
      if (severity !== 'all') {
        filteredAnomalies = anomalies.filter(a => a.severity === severity);
      }

      res.json({
        timestamp: new Date(),
        total: anomalies.length,
        filtered: filteredAnomalies.length,
        anomalies: filteredAnomalies
      });

    } catch (error) {
      this.logger.error('Failed to get anomalies:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve anomalies'
      });
    }
  }

  /**
   * Get compliance metrics
   */
  async getComplianceMetrics(req, res) {
    try {
      const {
        framework = 'all',
        timeRange = 'monthly',
        includeDetails = false
      } = req.query;

      // Get compliance metrics
      const complianceMetrics = await this.getComplianceMetricsData(framework, timeRange);

      if (includeDetails === 'true') {
        // Add detailed compliance information
        complianceMetrics.details = await this.getComplianceDetails(framework);
      }

      res.json(complianceMetrics);

    } catch (error) {
      this.logger.error('Failed to get compliance metrics:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve compliance metrics'
      });
    }
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(req, res) {
    try {
      const {
        timeRange = 'hourly',
        includeSystemMetrics = false
      } = req.query;

      // Get performance metrics
      const performanceMetrics = await this.getPerformanceMetricsData(timeRange);

      if (includeSystemMetrics === 'true') {
        // Add system performance metrics
        performanceMetrics.system = await this.getSystemPerformanceMetrics();
      }

      res.json(performanceMetrics);

    } catch (error) {
      this.logger.error('Failed to get performance metrics:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve performance metrics'
      });
    }
  }

  /**
   * Export metrics
   */
  async exportMetrics(req, res) {
    try {
      const {
        format = 'json',
        timeRange = 'monthly',
        categories = [],
        filters = {}
      } = req.body;

      // Validate format
      const validFormats = this.config.exportFormats;
      if (!validFormats.includes(format)) {
        return res.status(400).json({
          error: 'Invalid format',
          message: `Valid formats: ${validFormats.join(', ')}`
        });
      }

      // Get metrics data
      const metricsData = await this.prepareExportData(timeRange, categories, filters);

      // Generate export
      const exportData = await this.generateExport(metricsData, format);

      // Set appropriate headers
      const filename = `security_metrics_${timeRange}_${new Date().toISOString().split('T')[0]}.${format}`;

      if (format === 'json') {
        return res.json(exportData);
      }

      // For other formats, return file download
      res.setHeader('Content-Type', this.getExportContentType(format));
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(exportData);

    } catch (error) {
      this.logger.error('Failed to export metrics:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to export metrics'
      });
    }
  }

  /**
   * Get KPI metrics
   */
  async getKPIs(req, res) {
    try {
      const { period = 'monthly', targetComparison = true } = req.query;

      // Calculate KPIs
      const kpis = await this.calculateKPIs(period);

      if (targetComparison === 'true') {
        // Add target comparison
        kpis.targets = await this.getKPIsTargets(period);
        kpis.comparison = this.compareKPIsToTargets(kpis);
      }

      res.json(kpis);

    } catch (error) {
      this.logger.error('Failed to get KPIs:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve KPIs'
      });
    }
  }

  /**
   * Get dashboard widgets
   */
  async getDashboardWidgets(req, res) {
    try {
      const { dashboard = 'overview' } = req.query;

      // Get widget configurations
      const widgets = await this.getWidgetConfigurations(dashboard);

      // Get data for each widget
      const widgetData = await Promise.all(
        widgets.map(async widget => ({
          ...widget,
          data: await this.getWidgetData(widget)
        }))
      );

      res.json({
        dashboard,
        timestamp: new Date(),
        widgets: widgetData
      });

    } catch (error) {
      this.logger.error('Failed to get dashboard widgets:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve dashboard widgets'
      });
    }
  }

  /**
   * Subscribe to real-time updates
   */
  async subscribeToUpdates(req, res) {
    try {
      const { categories = [], filters = {} } = req.body;
      const subscriptionId = this.generateSubscriptionId();

      // Store subscription
      this.subscribers.set(subscriptionId, {
        id: subscriptionId,
        categories,
        filters,
        createdAt: new Date(),
        lastUpdate: new Date()
      });

      res.json({
        subscriptionId,
        message: 'Successfully subscribed to real-time updates',
        categories,
        filters
      });

    } catch (error) {
      this.logger.error('Failed to subscribe to updates:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to subscribe to updates'
      });
    }
  }

  /**
   * Unsubscribe from updates
   */
  async unsubscribeFromUpdates(req, res) {
    try {
      const { subscriptionId } = req.params;

      if (this.subscribers.has(subscriptionId)) {
        this.subscribers.delete(subscriptionId);
        res.json({
          message: 'Successfully unsubscribed',
          subscriptionId
        });
      } else {
        res.status(404).json({
          error: 'Subscription not found',
          message: 'Invalid subscription ID'
        });
      }

    } catch (error) {
      this.logger.error('Failed to unsubscribe from updates:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to unsubscribe'
      });
    }
  }

  /**
   * Helper methods
   */
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

  extractCategoryMetrics(fullMetrics, category) {
    switch (category) {
      case 'incidents':
        return {
          category,
          data: fullMetrics.incidents,
          trends: this.calculateCategoryTrends(fullMetrics, 'incidents')
        };
      case 'securityEvents':
        return {
          category,
          data: fullMetrics.securityEvents,
          trends: this.calculateCategoryTrends(fullMetrics, 'securityEvents')
        };
      case 'compliance':
        return {
          category,
          data: fullMetrics.compliance,
          trends: this.calculateCategoryTrends(fullMetrics, 'compliance')
        };
      case 'performance':
        return {
          category,
          data: fullMetrics.performance,
          trends: this.calculateCategoryTrends(fullMetrics, 'performance')
        };
      case 'risk':
        return {
          category,
          data: fullMetrics.risk,
          trends: this.calculateCategoryTrends(fullMetrics, 'risk')
        };
      case 'assets':
        return {
          category,
          data: fullMetrics.assets,
          trends: this.calculateCategoryTrends(fullMetrics, 'assets')
        };
      case 'users':
        return {
          category,
          data: fullMetrics.userBehavior,
          trends: this.calculateCategoryTrends(fullMetrics, 'userBehavior')
        };
      case 'threats':
        return {
          category,
          data: fullMetrics.threatIntelligence,
          trends: this.calculateCategoryTrends(fullMetrics, 'threatIntelligence')
        };
      default:
        return { category, data: null, trends: null };
    }
  }

  calculateCategoryTrends(metrics, category) {
    // Simplified trend calculation
    const categoryData = metrics[category] || {};

    if (categoryData.total > 0) {
      return {
        direction: 'stable',
        change: 0,
        confidence: 0.8
      };
    }

    return {
      direction: 'stable',
      change: 0,
      confidence: 0
    };
  }

  async calculateTrends(timeRange, filters) {
    // Placeholder for trend calculation
    return {
      direction: 'stable',
      change: 0,
      period: timeRange,
      confidence: 0.8
    };
  }

  async detectAnomalies(metrics) {
    // Simplified anomaly detection
    const anomalies = [];

    // Check for anomalies in different metrics categories
    Object.keys(metrics).forEach(category => {
      const categoryData = metrics[category];

      if (category === 'incidents' && categoryData.total > 50) {
        anomalies.push({
          type: 'high_incident_volume',
          severity: 'high',
          category,
          value: categoryData.total,
          threshold: 50,
          description: 'Unusually high incident volume detected'
        });
      }

      if (category === 'performance' && categoryData.responseTime?.average > 5000) {
        anomalies.push({
          type: 'slow_response_time',
          severity: 'medium',
          category,
          value: categoryData.responseTime.average,
          threshold: 5000,
          description: 'Response time degradation detected'
        });
      }
    });

    return anomalies;
  }

  async calculateTrendsData(metric, timeRange, periods, filters) {
    // Placeholder implementation
    return {
      metric,
      timeRange,
      periods: parseInt(periods),
      data: [],
      trend: 'stable'
    };
  }

  async getComplianceMetricsData(framework, timeRange) {
    // Placeholder implementation
    return {
      framework,
      timeRange,
      overallScore: 85,
      categories: {
        security: 90,
        privacy: 80,
        availability: 88,
        integrity: 85
      }
    };
  }

  async getComplianceDetails(framework) {
    // Placeholder implementation
    return {
      requirements: [],
      gaps: [],
      recommendations: []
    };
  }

  async getPerformanceMetricsData(timeRange) {
    // Placeholder implementation
    return {
      responseTime: { average: 250, p95: 500, p99: 1000 },
      throughput: { requests: 1000, events: 5000 },
      availability: { percentage: 99.9, uptime: 86400 },
      resourceUtilization: { cpu: 65, memory: 70, disk: 45 }
    };
  }

  async getSystemPerformanceMetrics() {
    // Placeholder implementation
    return {
      cpu: 65,
      memory: 70,
      disk: 45,
      network: 30
    };
  }

  async prepareExportData(timeRange, categories, filters) {
    // Get full metrics data
    const metrics = await this.metricsCalculator.calculateMetrics(timeRange, filters);

    // Filter by categories if specified
    if (categories.length > 0) {
      const filteredData = {};
      categories.forEach(category => {
        if (metrics[category]) {
          filteredData[category] = metrics[category];
        }
      });
      return filteredData;
    }

    return metrics;
  }

  async generateExport(data, format) {
    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
      case 'csv':
        return this.convertToCSV(data);
      case 'excel':
        return this.convertToExcel(data);
      case 'pdf':
        return this.convertToPDF(data);
      default:
        return JSON.stringify(data, null, 2);
    }
  }

  convertToCSV(data) {
    // Simplified CSV conversion
    let csv = 'Category,Metric,Value,Unit,Timestamp\n';

    Object.entries(data).forEach(([category, categoryData]) => {
      if (typeof categoryData === 'object' && categoryData !== null) {
        Object.entries(categoryData).forEach(([metric, value]) => {
          if (typeof value === 'number') {
            csv += `${category},${metric},${value},number,${new Date().toISOString()}\n`;
          }
        });
      }
    });

    return csv;
  }

  convertToExcel(data) {
    // Placeholder for Excel conversion
    return JSON.stringify(data, null, 2);
  }

  convertToPDF(data) {
    // Placeholder for PDF conversion
    return JSON.stringify(data, null, 2);
  }

  getExportContentType(format) {
    const types = {
      'json': 'application/json',
      'csv': 'text/csv',
      'excel': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'pdf': 'application/pdf'
    };
    return types[format] || 'application/octet-stream';
  }

  async calculateKPIs(period) {
    // Placeholder implementation
    return {
      period,
      securityScore: 85,
      incidentResponseTime: 2.5,
      complianceRate: 92,
      availability: 99.9,
      threatDetectionRate: 88
    };
  }

  async getKPIsTargets(period) {
    // Placeholder implementation
    return {
      securityScore: 90,
      incidentResponseTime: 2.0,
      complianceRate: 95,
      availability: 99.95,
      threatDetectionRate: 90
    };
  }

  compareKPIsToTargets(kpis) {
    const comparison = {};

    Object.entries(kpis).forEach(([key, actual]) => {
      if (kpis.targets[key]) {
        const target = kpis.targets[key];
        const variance = ((actual - target) / target) * 100;
        comparison[key] = {
          actual,
          target,
          variance,
          status: variance >= 0 ? 'met' : variance > -10 ? 'near_miss' : 'missed'
        };
      }
    });

    return comparison;
  }

  async getWidgetConfigurations(dashboard) {
    // Placeholder implementation
    return [
      {
        id: 'overview_score',
        type: 'gauge',
        title: 'Security Score',
        size: { w: 2, h: 2 },
        category: 'overview'
      },
      {
        id: 'incident_trend',
        type: 'line',
        title: 'Incident Trend',
        size: { w: 3, h: 2 },
        category: 'incidents'
      },
      {
        id: 'compliance_status',
        type: 'bar',
        title: 'Compliance Status',
        size: { w: 2, h: 2 },
        category: 'compliance'
      }
    ];
  }

  async getWidgetData(widget) {
    // Get data based on widget category
    const metrics = await this.metricsCalculator.calculateMetrics('daily');
    return {
      value: metrics[widget.category]?.total || 0,
      trend: 'stable',
      lastUpdated: new Date()
    };
  }

  generateSubscriptionId() {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create Express router
   */
  createRouter() {
    const router = express.Router();

    // Main metrics endpoints
    router.get('/', this.getMetrics.bind(this));
    router.get('/category/:category', this.getCategoryMetrics.bind(this));
    router.get('/realtime', this.getRealTimeMetrics.bind(this));

    // Trend and analysis endpoints
    router.get('/trends', this.getTrends.bind(this));
    router.get('/anomalies', this.getAnomalies.bind(this));

    // Specific metrics endpoints
    router.get('/compliance', this.getComplianceMetrics.bind(this));
    router.get('/performance', this.getPerformanceMetrics.bind(this));

    // Export and reporting endpoints
    router.post('/export', this.exportMetrics.bind(this));

    // KPI endpoints
    router.get('/kpis', this.getKPIs.bind(this));

    // Dashboard endpoints
    router.get('/dashboard/widgets', this.getDashboardWidgets.bind(this));

    // Real-time subscriptions
    router.post('/subscribe', this.subscribeToUpdates.bind(this));
    router.delete('/unsubscribe/:subscriptionId', this.unsubscribeFromUpdates.bind(this));

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
      subscribers: this.subscribers.size,
      realTimeUpdates: this.config.realTimeUpdates,
      components: {
        metricsCalculator: this.metricsCalculator.getStatistics(),
        metricsReporter: this.metricsReporter.getStatistics()
      }
    };
  }
}

module.exports = MetricsController;