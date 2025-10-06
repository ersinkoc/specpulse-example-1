/**
 * Security System Performance Monitor
 * Real-time performance monitoring, alerting, and metrics collection for security operations
 */

const EventEmitter = require('events');
const winston = require('winston');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

class PerformanceMonitor extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Monitoring intervals
      metricsInterval: config.metricsInterval || 30000, // 30 seconds
      healthCheckInterval: config.healthCheckInterval || 60000, // 1 minute
      reportInterval: config.reportInterval || 3600000, // 1 hour

      // Performance thresholds
      thresholds: {
        memoryUsage: config.memoryUsageThreshold || 80, // 80%
        cpuUsage: config.cpuUsageThreshold || 75, // 75%
        diskUsage: config.diskUsageThreshold || 85, // 85%
        responseTime: config.responseTimeThreshold || 5000, // 5 seconds
        errorRate: config.errorRateThreshold || 5, // 5%
        queueSize: config.queueSizeThreshold || 100 // 100 items
      },

      // Alerting configuration
      alerting: {
        enabled: config.alertingEnabled !== false,
        cooldown: config.alertCooldown || 300000, // 5 minutes
        channels: config.alertChannels || ['log', 'event'],
        escalation: config.alertEscalation !== false
      },

      // Storage configuration
      storage: {
        enabled: config.storageEnabled !== false,
        retention: config.metricsRetention || 7776000000, // 90 days
        path: config.metricsPath || path.join(process.cwd(), 'metrics'),
        compression: config.metricsCompression !== false
      },

      ...config
    };

    // Metrics storage
    this.metrics = new Map();
    this.alerts = new Map();
    this.baselineMetrics = new Map();
    this.lastAlertTime = new Map();

    // Performance data
    this.performanceData = {
      system: {
        memory: [],
        cpu: [],
        disk: []
      },
      security: {
        scans: [],
        vulnerabilities: [],
        incidents: [],
        compliance: []
      },
      application: {
        responseTime: [],
        errorRate: [],
        queueSize: [],
        throughput: []
      }
    };

    // Monitoring state
    this.isMonitoring = false;
    this.startTime = Date.now();
    this.totalRequests = 0;
    this.totalErrors = 0;

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: 'logs/performance-monitor.log'
        })
      ]
    });

    this.initializeMonitor();
  }

  /**
   * Initialize the performance monitor
   */
  initializeMonitor() {
    // Create metrics directory
    if (this.config.storage.enabled && !fs.existsSync(this.config.storage.path)) {
      fs.mkdirSync(this.config.storage.path, { recursive: true });
    }

    // Load baseline metrics if available
    this.loadBaselineMetrics();

    this.logger.info('Performance monitor initialized', {
      metricsInterval: this.config.metricsInterval,
      thresholds: this.config.thresholds
    });
  }

  /**
   * Start performance monitoring
   */
  start() {
    if (this.isMonitoring) {
      this.logger.warn('Performance monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    this.startTime = Date.now();

    // Start monitoring intervals
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.metricsInterval);

    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);

    this.reportInterval = setInterval(() => {
      this.generatePerformanceReport();
    }, this.config.reportInterval);

    // Start metrics cleanup
    this.startMetricsCleanup();

    this.logger.info('Performance monitoring started');
    this.emit('monitoringStarted');
  }

  /**
   * Stop performance monitoring
   */
  stop() {
    if (!this.isMonitoring) {
      this.logger.warn('Performance monitoring is not running');
      return;
    }

    this.isMonitoring = false;

    // Clear intervals
    if (this.metricsInterval) clearInterval(this.metricsInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.reportInterval) clearInterval(this.reportInterval);

    // Generate final report
    this.generatePerformanceReport(true);

    this.logger.info('Performance monitoring stopped');
    this.emit('monitoringStopped');
  }

  /**
   * Collect system and application metrics
   */
  collectMetrics() {
    const timestamp = Date.now();

    try {
      // System metrics
      const systemMetrics = this.collectSystemMetrics();
      this.updateMetrics('system', systemMetrics, timestamp);

      // Security metrics
      const securityMetrics = this.collectSecurityMetrics();
      this.updateMetrics('security', securityMetrics, timestamp);

      // Application metrics
      const applicationMetrics = this.collectApplicationMetrics();
      this.updateMetrics('application', applicationMetrics, timestamp);

      // Check thresholds and generate alerts
      this.checkThresholds(systemMetrics, securityMetrics, applicationMetrics);

      // Store metrics if enabled
      if (this.config.storage.enabled) {
        this.storeMetrics(timestamp, systemMetrics, securityMetrics, applicationMetrics);
      }

      this.emit('metricsCollected', {
        timestamp,
        system: systemMetrics,
        security: securityMetrics,
        application: applicationMetrics
      });

    } catch (error) {
      this.logger.error('Failed to collect metrics:', error);
    }
  }

  /**
   * Collect system metrics
   */
  collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const totalMem = require('os').totalmem();
    const freeMem = require('os').freemem();

    return {
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
        usagePercent: (memUsage.heapUsed / memUsage.heapTotal) * 100,
        systemUsagePercent: ((totalMem - freeMem) / totalMem) * 100
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
        usagePercent: this.calculateCpuUsage(cpuUsage)
      },
      disk: {
        usagePercent: this.getDiskUsage()
      },
      uptime: process.uptime(),
      timestamp: Date.now()
    };
  }

  /**
   * Collect security metrics
   */
  collectSecurityMetrics() {
    // These would typically come from actual security services
    // For now, we'll use mock data or pull from existing metrics
    return {
      scans: {
        total: this.metrics.get('scans_total') || 0,
        successful: this.metrics.get('scans_successful') || 0,
        failed: this.metrics.get('scans_failed') || 0,
        averageDuration: this.metrics.get('scans_avg_duration') || 0,
        lastScan: this.metrics.get('last_scan_time') || null
      },
      vulnerabilities: {
        total: this.metrics.get('vulnerabilities_total') || 0,
        critical: this.metrics.get('vulnerabilities_critical') || 0,
        high: this.metrics.get('vulnerabilities_high') || 0,
        medium: this.metrics.get('vulnerabilities_medium') || 0,
        low: this.metrics.get('vulnerabilities_low') || 0,
        open: this.metrics.get('vulnerabilities_open') || 0,
        resolved: this.metrics.get('vulnerabilities_resolved') || 0
      },
      incidents: {
        total: this.metrics.get('incidents_total') || 0,
        open: this.metrics.get('incidents_open') || 0,
        resolved: this.metrics.get('incidents_resolved') || 0,
        averageResolutionTime: this.metrics.get('incidents_avg_resolution') || 0
      },
      compliance: {
        overall: this.metrics.get('compliance_overall') || 0,
        gdpr: this.metrics.get('compliance_gdpr') || 0,
        soc2: this.metrics.get('compliance_soc2') || 0,
        lastCheck: this.metrics.get('compliance_last_check') || null
      },
      timestamp: Date.now()
    };
  }

  /**
   * Collect application metrics
   */
  collectApplicationMetrics() {
    const errorRate = this.totalRequests > 0 ? (this.totalErrors / this.totalRequests) * 100 : 0;

    return {
      responseTime: {
        average: this.calculateAverageResponseTime(),
        p95: this.calculatePercentileResponseTime(95),
        p99: this.calculatePercentileResponseTime(99)
      },
      errorRate: errorRate,
      queueSize: {
        high: this.metrics.get('queue_high_size') || 0,
        medium: this.metrics.get('queue_medium_size') || 0,
        low: this.metrics.get('queue_low_size') || 0,
        total: this.getTotalQueueSize()
      },
      throughput: {
        requestsPerSecond: this.calculateThroughput(),
        requestsPerMinute: this.calculateThroughput(60000)
      },
      activeConnections: this.metrics.get('active_connections') || 0,
      timestamp: Date.now()
    };
  }

  /**
   * Update metrics storage
   */
  updateMetrics(category, data, timestamp) {
    // Store time-series data
    Object.keys(data).forEach(key => {
      const metricKey = `${category}.${key}`;
      const value = typeof data[key] === 'object' ? data[key].usagePercent || data[key] : data[key];

      if (!this.performanceData[category][key]) {
        this.performanceData[category][key] = [];
      }

      this.performanceData[category][key].push({
        timestamp,
        value: typeof data[key] === 'object' ? data[key] : { value }
      });

      // Keep only recent data (last 1000 points)
      if (this.performanceData[category][key].length > 1000) {
        this.performanceData[category][key] = this.performanceData[category][key].slice(-1000);
      }
    });

    // Update individual metrics
    Object.keys(data).forEach(key => {
      const metricKey = `${category}_${key}`;
      this.metrics.set(metricKey, data[key]);
    });
  }

  /**
   * Check performance thresholds and generate alerts
   */
  checkThresholds(systemMetrics, securityMetrics, applicationMetrics) {
    const checks = [
      // Memory checks
      {
        name: 'high_memory_usage',
        category: 'system',
        value: systemMetrics.memory.usagePercent,
        threshold: this.config.thresholds.memoryUsage,
        severity: 'warning'
      },
      {
        name: 'critical_memory_usage',
        category: 'system',
        value: systemMetrics.memory.usagePercent,
        threshold: 95,
        severity: 'critical'
      },

      // CPU checks
      {
        name: 'high_cpu_usage',
        category: 'system',
        value: systemMetrics.cpu.usagePercent,
        threshold: this.config.thresholds.cpuUsage,
        severity: 'warning'
      },

      // Disk checks
      {
        name: 'high_disk_usage',
        category: 'system',
        value: systemMetrics.disk.usagePercent,
        threshold: this.config.thresholds.diskUsage,
        severity: 'warning'
      },

      // Application checks
      {
        name: 'high_response_time',
        category: 'application',
        value: applicationMetrics.responseTime.average,
        threshold: this.config.thresholds.responseTime,
        severity: 'warning'
      },

      {
        name: 'high_error_rate',
        category: 'application',
        value: applicationMetrics.errorRate,
        threshold: this.config.thresholds.errorRate,
        severity: 'warning'
      },

      {
        name: 'large_queue_size',
        category: 'application',
        value: applicationMetrics.queueSize.total,
        threshold: this.config.thresholds.queueSize,
        severity: 'warning'
      }
    ];

    checks.forEach(check => {
      if (check.value > check.threshold) {
        this.generateAlert(check.name, {
          category: check.category,
          severity: check.severity,
          value: check.value,
          threshold: check.threshold,
          message: `${check.name.replace(/_/g, ' ')}: ${check.value.toFixed(2)} (threshold: ${check.threshold})`
        });
      }
    });
  }

  /**
   * Generate performance alert
   */
  generateAlert(alertName, alertData) {
    const now = Date.now();
    const lastAlert = this.lastAlertTime.get(alertName);

    // Check cooldown period
    if (lastAlert && (now - lastAlert) < this.config.alerting.cooldown) {
      return;
    }

    const alert = {
      id: this.generateAlertId(),
      name: alertName,
      ...alertData,
      timestamp: now,
      acknowledged: false
    };

    this.alerts.set(alert.id, alert);
    this.lastAlertTime.set(alertName, now);

    // Log alert
    this.logger.warn('Performance alert generated', alert);

    // Emit alert event
    this.emit('performanceAlert', alert);

    // Send to configured channels
    if (this.config.alerting.enabled) {
      this.sendAlert(alert);
    }
  }

  /**
   * Send alert to configured channels
   */
  sendAlert(alert) {
    this.config.alerting.channels.forEach(channel => {
      switch (channel) {
        case 'log':
          // Already logged in generateAlert
          break;
        case 'event':
          this.emit('alert', alert);
          break;
        case 'webhook':
          this.sendWebhookAlert(alert);
          break;
        default:
          this.logger.warn('Unknown alert channel:', channel);
      }
    });
  }

  /**
   * Send webhook alert
   */
  sendWebhookAlert(alert) {
    // Implementation would depend on webhook configuration
    this.logger.info('Webhook alert would be sent', { alertId: alert.id });
  }

  /**
   * Perform comprehensive health check
   */
  performHealthCheck() {
    const health = {
      status: 'healthy',
      timestamp: Date.now(),
      uptime: process.uptime(),
      checks: {}
    };

    try {
      // Check system resources
      const systemMetrics = this.collectSystemMetrics();
      health.checks.system = {
        status: systemMetrics.memory.usagePercent < 90 && systemMetrics.cpu.usagePercent < 85 ? 'healthy' : 'degraded',
        memory: systemMetrics.memory.usagePercent,
        cpu: systemMetrics.cpu.usagePercent,
        disk: systemMetrics.disk.usagePercent
      };

      // Check application metrics
      const applicationMetrics = this.collectApplicationMetrics();
      health.checks.application = {
        status: applicationMetrics.errorRate < 10 && applicationMetrics.responseTime.average < 10000 ? 'healthy' : 'degraded',
        errorRate: applicationMetrics.errorRate,
        responseTime: applicationMetrics.responseTime.average,
        queueSize: applicationMetrics.queueSize.total
      };

      // Check monitoring system
      health.checks.monitoring = {
        status: this.isMonitoring ? 'healthy' : 'unhealthy',
        isMonitoring: this.isMonitoring,
        metricsCollected: this.metrics.size,
        alertsActive: this.alerts.size
      };

      // Overall health status
      const degradedChecks = Object.values(health.checks).filter(check => check.status !== 'healthy').length;
      if (degradedChecks > 0) {
        health.status = degradedChecks > 1 ? 'unhealthy' : 'degraded';
      }

      this.emit('healthCheck', health);

      if (health.status !== 'healthy') {
        this.logger.warn('System health degraded', health);
      }

    } catch (error) {
      health.status = 'unhealthy';
      health.error = error.message;
      this.logger.error('Health check failed:', error);
    }

    return health;
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport(isFinal = false) {
    const report = {
      timestamp: Date.now(),
      period: isFinal ? 'final' : 'hourly',
      uptime: process.uptime(),
      summary: this.generateSummary(),
      trends: this.analyzeTrends(),
      alerts: this.getRecentAlerts(),
      recommendations: this.generateRecommendations()
    };

    // Store report
    if (this.config.storage.enabled) {
      const reportPath = path.join(this.config.storage.path, `performance_report_${Date.now()}.json`);
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    }

    this.logger.info('Performance report generated', {
      period: report.period,
      status: report.summary.overall
    });

    this.emit('performanceReport', report);

    return report;
  }

  /**
   * Generate performance summary
   */
  generateSummary() {
    const systemMetrics = this.collectSystemMetrics();
    const applicationMetrics = this.collectApplicationMetrics();

    return {
      overall: this.calculateOverallHealth(),
      system: {
        memoryUsage: systemMetrics.memory.usagePercent,
        cpuUsage: systemMetrics.cpu.usagePercent,
        diskUsage: systemMetrics.disk.usagePercent
      },
      application: {
        averageResponseTime: applicationMetrics.responseTime.average,
        errorRate: applicationMetrics.errorRate,
        totalRequests: this.totalRequests,
        totalErrors: this.totalErrors
      },
      monitoring: {
        uptime: process.uptime(),
        metricsCollected: this.metrics.size,
        alertsGenerated: this.alerts.size
      }
    };
  }

  /**
   * Analyze performance trends
   */
  analyzeTrends() {
    const trends = {};

    Object.keys(this.performanceData).forEach(category => {
      trends[category] = {};

      Object.keys(this.performanceData[category]).forEach(metric => {
        const data = this.performanceData[category][metric];
        if (data.length < 2) return;

        const recent = data.slice(-10);
        const older = data.slice(-20, -10);

        if (older.length > 0) {
          const recentAvg = recent.reduce((sum, point) => sum + (point.value.value || point.value), 0) / recent.length;
          const olderAvg = older.reduce((sum, point) => sum + (point.value.value || point.value), 0) / older.length;

          const trend = ((recentAvg - olderAvg) / olderAvg) * 100;
          trends[category][metric] = {
            trend: trend > 5 ? 'increasing' : trend < -5 ? 'decreasing' : 'stable',
            change: trend,
            current: recentAvg,
            previous: olderAvg
          };
        }
      });
    });

    return trends;
  }

  /**
   * Generate performance recommendations
   */
  generateRecommendations() {
    const recommendations = [];
    const systemMetrics = this.collectSystemMetrics();
    const applicationMetrics = this.collectApplicationMetrics();

    // Memory recommendations
    if (systemMetrics.memory.usagePercent > 80) {
      recommendations.push({
        category: 'memory',
        priority: 'high',
        message: 'High memory usage detected',
        suggestion: 'Consider increasing memory allocation or optimizing memory usage'
      });
    }

    // CPU recommendations
    if (systemMetrics.cpu.usagePercent > 75) {
      recommendations.push({
        category: 'cpu',
        priority: 'medium',
        message: 'High CPU usage detected',
        suggestion: 'Consider optimizing algorithms or scaling horizontally'
      });
    }

    // Response time recommendations
    if (applicationMetrics.responseTime.average > this.config.thresholds.responseTime) {
      recommendations.push({
        category: 'performance',
        priority: 'high',
        message: 'Slow response times detected',
        suggestion: 'Investigate bottlenecks and optimize critical paths'
      });
    }

    // Error rate recommendations
    if (applicationMetrics.errorRate > this.config.thresholds.errorRate) {
      recommendations.push({
        category: 'reliability',
        priority: 'critical',
        message: 'High error rate detected',
        suggestion: 'Investigate root causes and implement error handling improvements'
      });
    }

    return recommendations;
  }

  /**
   * Utility methods
   */
  calculateCpuUsage(cpuUsage) {
    // Simple CPU usage calculation - in real implementation would be more sophisticated
    return (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to milliseconds
  }

  getDiskUsage() {
    try {
      const stats = fs.statSync(process.cwd());
      // Simplified disk usage - in real implementation would use proper disk space checking
      return Math.random() * 100; // Mock value
    } catch (error) {
      return 0;
    }
  }

  calculateAverageResponseTime() {
    const responseTimes = this.performanceData.application.responseTime;
    if (!responseTimes || responseTimes.length === 0) return 0;

    const recent = responseTimes.slice(-100);
    return recent.reduce((sum, point) => sum + (point.value.average || 0), 0) / recent.length;
  }

  calculatePercentileResponseTime(percentile) {
    const responseTimes = this.performanceData.application.responseTime;
    if (!responseTimes || responseTimes.length === 0) return 0;

    const values = responseTimes.map(point => point.value.average || 0).sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * values.length) - 1;
    return values[Math.max(0, index)];
  }

  getTotalQueueSize() {
    return (this.metrics.get('queue_high_size') || 0) +
           (this.metrics.get('queue_medium_size') || 0) +
           (this.metrics.get('queue_low_size') || 0);
  }

  calculateThroughput(period = 1000) {
    // Simple throughput calculation
    return this.totalRequests / (process.uptime() / (period / 1000));
  }

  calculateOverallHealth() {
    const systemMetrics = this.collectSystemMetrics();
    const applicationMetrics = this.collectApplicationMetrics();

    let score = 100;

    // Deduct points for high resource usage
    if (systemMetrics.memory.usagePercent > 80) score -= 20;
    if (systemMetrics.cpu.usagePercent > 75) score -= 15;
    if (applicationMetrics.errorRate > 5) score -= 25;
    if (applicationMetrics.responseTime.average > 5000) score -= 15;

    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'fair';
    return 'poor';
  }

  generateAlertId() {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getRecentAlerts(hours = 24) {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    return Array.from(this.alerts.values()).filter(alert => alert.timestamp > cutoff);
  }

  loadBaselineMetrics() {
    // Load baseline metrics from file if exists
    try {
      const baselinePath = path.join(this.config.storage.path, 'baseline_metrics.json');
      if (fs.existsSync(baselinePath)) {
        const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
        Object.keys(baseline).forEach(key => {
          this.baselineMetrics.set(key, baseline[key]);
        });
        this.logger.info('Baseline metrics loaded');
      }
    } catch (error) {
      this.logger.warn('Failed to load baseline metrics:', error);
    }
  }

  storeMetrics(timestamp, systemMetrics, securityMetrics, applicationMetrics) {
    try {
      const metricsData = {
        timestamp,
        system: systemMetrics,
        security: securityMetrics,
        application: applicationMetrics
      };

      const filePath = path.join(this.config.storage.path, `metrics_${timestamp}.json`);
      fs.writeFileSync(filePath, JSON.stringify(metricsData));

      // Clean up old metrics files
      this.cleanupOldMetrics();

    } catch (error) {
      this.logger.error('Failed to store metrics:', error);
    }
  }

  cleanupOldMetrics() {
    try {
      const files = fs.readdirSync(this.config.storage.path);
      const cutoff = Date.now() - this.config.storage.retention;

      files.forEach(file => {
        if (file.startsWith('metrics_') && file.endsWith('.json')) {
          const filePath = path.join(this.config.storage.path, file);
          const stats = fs.statSync(filePath);

          if (stats.mtime.getTime() < cutoff) {
            fs.unlinkSync(filePath);
          }
        }
      });

    } catch (error) {
      this.logger.error('Failed to cleanup old metrics:', error);
    }
  }

  startMetricsCleanup() {
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 3600000); // Cleanup every hour
  }

  /**
   * Public API methods
   */
  recordRequest(duration, isError = false) {
    this.totalRequests++;
    if (isError) this.totalErrors++;

    // Store response time data
    if (!this.performanceData.application.responseTime) {
      this.performanceData.application.responseTime = [];
    }

    this.performanceData.application.responseTime.push({
      timestamp: Date.now(),
      value: { duration, isError }
    });

    // Keep only recent data
    if (this.performanceData.application.responseTime.length > 1000) {
      this.performanceData.application.responseTime = this.performanceData.application.responseTime.slice(-1000);
    }
  }

  setCustomMetric(name, value) {
    this.metrics.set(name, value);
  }

  getMetrics() {
    return {
      system: this.collectSystemMetrics(),
      security: this.collectSecurityMetrics(),
      application: this.collectApplicationMetrics(),
      custom: Object.fromEntries(this.metrics)
    };
  }

  getAlerts(severity = null) {
    let alerts = Array.from(this.alerts.values());
    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity);
    }
    return alerts.sort((a, b) => b.timestamp - a.timestamp);
  }

  acknowledgeAlert(alertId) {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = Date.now();
      this.emit('alertAcknowledged', alert);
      return true;
    }
    return false;
  }
}

module.exports = PerformanceMonitor;