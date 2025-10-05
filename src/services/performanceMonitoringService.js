const EventEmitter = require('events');
const logger = require('../shared/utils/logger');
const config = require('../config');
const { performance } = require('perf_hooks');

/**
 * Performance Monitoring Service
 * Provides comprehensive monitoring and metrics collection for the notification system
 */
class PerformanceMonitoringService extends EventEmitter {
  constructor() {
    super();

    this.isEnabled = config.monitoring?.enabled !== false;
    this.sampleRate = config.monitoring?.sampleRate || 0.1; // 10% sampling
    this.metricsRetentionPeriod = config.monitoring?.retentionPeriod || 24 * 60 * 60 * 1000; // 24 hours

    // Metrics storage
    this.metrics = {
      websocket: {
        connections: {
          total: 0,
          active: 0,
          peak: 0,
          created: 0,
          destroyed: 0,
          rejected: 0,
          errors: 0,
          avgDuration: 0,
          avgCreationTime: 0
        },
        messages: {
          sent: 0,
          received: 0,
          errors: 0,
          avgLatency: 0,
          avgSize: 0,
          compressionRatio: 0,
          throughput: 0
        },
        performance: {
          cpuUsage: 0,
          memoryUsage: 0,
          eventLoopLag: 0,
          gcPause: 0,
          openFileDescriptors: 0
        }
      },
      notifications: {
        total: 0,
        successful: 0,
        failed: 0,
        byPriority: { low: 0, medium: 0, high: 0, critical: 0 },
        byCategory: { security: 0, system: 0, social: 0, task: 0, administrative: 0 },
        byChannel: { websocket: 0, email: 0, sms: 0 },
        avgProcessingTime: 0,
        deliveryRate: 0
      },
      database: {
        queries: 0,
        avgQueryTime: 0,
        slowQueries: 0,
        connectionPool: {
          active: 0,
          idle: 0,
          total: 0
        }
      },
      redis: {
        operations: 0,
        avgResponseTime: 0,
        hitRate: 0,
        memoryUsage: 0,
        connectedClients: 0
      }
    };

    // Time series data for trending
    this.timeSeriesData = new Map();
    this.alerts = [];
    this.thresholds = {
      websocketConnections: { warning: 8000, critical: 9500 },
      messageLatency: { warning: 100, critical: 500 }, // milliseconds
      errorRate: { warning: 0.05, critical: 0.1 }, // percentage
      memoryUsage: { warning: 0.8, critical: 0.9 }, // percentage
      cpuUsage: { warning: 0.8, critical: 0.95 } // percentage
    };

    // Performance collectors
    this.collectors = new Map();
    this.intervals = new Map();

    if (this.isEnabled) {
      this.startMonitoring();
    }
  }

  /**
   * Start performance monitoring
   */
  startMonitoring() {
    try {
      // Start system metrics collection
      this.startSystemMetricsCollection();

      // Start WebSocket metrics collection
      this.startWebSocketMetricsCollection();

      // Start notification metrics collection
      this.startNotificationMetricsCollection();

      // Start data retention cleanup
      this.startDataRetentionCleanup();

      logger.info('Performance monitoring service started');
    } catch (error) {
      logger.error('Failed to start performance monitoring:', error);
    }
  }

  /**
   * Record WebSocket connection event
   */
  recordWebSocketConnection(event, data = {}) {
    if (!this.isEnabled || !this.shouldSample()) return;

    const timestamp = Date.now();
    const metrics = this.metrics.websocket.connections;

    switch (event) {
      case 'created':
        metrics.total++;
        metrics.created++;
        if (data.creationTime) {
          this.updateAverage('avgCreationTime', data.creationTime, metrics.created);
        }
        break;

      case 'connected':
        metrics.active++;
        if (metrics.active > metrics.peak) {
          metrics.peak = metrics.active;
        }
        break;

      case 'disconnected':
        metrics.active = Math.max(0, metrics.active - 1);
        metrics.destroyed++;
        if (data.duration) {
          this.updateAverage('avgDuration', data.duration, metrics.destroyed);
        }
        break;

      case 'rejected':
        metrics.rejected++;
        break;

      case 'error':
        metrics.errors++;
        break;
    }

    // Store time series data
    this.storeTimeSeriesData('websocket.connections.' + event, 1, timestamp);

    // Check thresholds
    this.checkThresholds('websocket.connections', metrics);

    this.emit('metrics:websocket:connection', { event, data, timestamp });
  }

  /**
   * Record WebSocket message event
   */
  recordWebSocketMessage(event, data = {}) {
    if (!this.isEnabled || !this.shouldSample()) return;

    const timestamp = Date.now();
    const metrics = this.metrics.websocket.messages;

    switch (event) {
      case 'sent':
        metrics.sent++;
        if (data.size) {
          this.updateAverage('avgSize', data.size, metrics.sent);
        }
        break;

      case 'received':
        metrics.received++;
        break;

      case 'error':
        metrics.errors++;
        break;

      case 'latency':
        if (data.latency) {
          this.updateAverage('avgLatency', data.latency, this.metrics.websocket.messages.sent);
        }
        break;

      case 'compression':
        if (data.ratio) {
          this.updateAverage('compressionRatio', data.ratio, metrics.sent);
        }
        break;
    }

    // Store time series data
    this.storeTimeSeriesData('websocket.messages.' + event, 1, timestamp);

    // Calculate throughput (messages per second)
    this.calculateThroughput();

    this.emit('metrics:websocket:message', { event, data, timestamp });
  }

  /**
   * Record notification event
   */
  recordNotification(event, data = {}) {
    if (!this.isEnabled || !this.shouldSample()) return;

    const timestamp = Date.now();
    const metrics = this.metrics.notifications;

    switch (event) {
      case 'sent':
        metrics.total++;
        if (data.priority) {
          metrics.byPriority[data.priority]++;
        }
        if (data.category) {
          metrics.byCategory[data.category]++;
        }
        if (data.channel) {
          metrics.byChannel[data.channel]++;
        }
        break;

      case 'delivered':
        metrics.successful++;
        break;

      case 'failed':
        metrics.failed++;
        break;

      case 'processing_time':
        if (data.processingTime) {
          this.updateAverage('avgProcessingTime', data.processingTime, metrics.total);
        }
        break;
    }

    // Calculate delivery rate
    if (metrics.total > 0) {
      metrics.deliveryRate = metrics.successful / metrics.total;
    }

    // Store time series data
    this.storeTimeSeriesData('notifications.' + event, 1, timestamp);

    // Check error rate thresholds
    if (metrics.total > 0) {
      const errorRate = metrics.failed / metrics.total;
      this.checkThresholds('errorRate', errorRate);
    }

    this.emit('metrics:notification', { event, data, timestamp });
  }

  /**
   * Record database operation
   */
  recordDatabaseOperation(event, data = {}) {
    if (!this.isEnabled || !this.shouldSample()) return;

    const timestamp = Date.now();
    const metrics = this.metrics.database;

    switch (event) {
      case 'query':
        metrics.queries++;
        if (data.duration) {
          this.updateAverage('avgQueryTime', data.duration, metrics.queries);

          // Track slow queries
          if (data.duration > 1000) { // 1 second threshold
            metrics.slowQueries++;
          }
        }
        break;

      case 'connection_pool':
        if (data.active !== undefined) metrics.connectionPool.active = data.active;
        if (data.idle !== undefined) metrics.connectionPool.idle = data.idle;
        if (data.total !== undefined) metrics.connectionPool.total = data.total;
        break;
    }

    this.storeTimeSeriesData('database.' + event, 1, timestamp);
    this.emit('metrics:database', { event, data, timestamp });
  }

  /**
   * Record Redis operation
   */
  recordRedisOperation(event, data = {}) {
    if (!this.isEnabled || !this.shouldSample()) return;

    const timestamp = Date.now();
    const metrics = this.metrics.redis;

    switch (event) {
      case 'operation':
        metrics.operations++;
        if (data.responseTime) {
          this.updateAverage('avgResponseTime', data.responseTime, metrics.operations);
        }
        break;

      case 'memory':
        if (data.memoryUsage) metrics.memoryUsage = data.memoryUsage;
        break;

      case 'clients':
        if (data.clientCount) metrics.connectedClients = data.clientCount;
        break;

      case 'hit_rate':
        if (data.hitRate) metrics.hitRate = data.hitRate;
        break;
    }

    this.storeTimeSeriesData('redis.' + event, 1, timestamp);
    this.emit('metrics:redis', { event, data, timestamp });
  }

  /**
   * Start system metrics collection
   */
  startSystemMetricsCollection() {
    const interval = setInterval(() => {
      try {
        // CPU Usage
        const cpuUsage = process.cpuUsage();
        const cpuPercent = (cpuUsage.user + cpuUsage.system) / (process.uptime() * 1000000) * 100;
        this.metrics.websocket.performance.cpuUsage = cpuPercent;

        // Memory Usage
        const memUsage = process.memoryUsage();
        this.metrics.websocket.performance.memoryUsage = memUsage.heapUsed;

        // Event Loop Lag
        const start = performance.now();
        setImmediate(() => {
          const lag = performance.now() - start;
          this.metrics.websocket.performance.eventLoopLag = lag;
        });

        // Open File Descriptors (Unix systems)
        if (process.platform !== 'win32') {
          try {
            const fs = require('fs');
            const fdCount = fs.readdirSync('/proc/self/fd').length;
            this.metrics.websocket.performance.openFileDescriptors = fdCount;
          } catch (error) {
            // Ignore errors reading file descriptors
          }
        }

        // Check thresholds
        this.checkThresholds('cpuUsage', cpuPercent / 100);
        this.checkThresholds('memoryUsage', memUsage.heapUsed / memUsage.heapTotal);

        this.emit('metrics:system', {
          cpuUsage: cpuPercent,
          memoryUsage: memUsage,
          timestamp: Date.now()
        });

      } catch (error) {
        logger.error('Error collecting system metrics:', error);
      }
    }, 5000); // Every 5 seconds

    this.intervals.set('system', interval);
  }

  /**
   * Start WebSocket metrics collection
   */
  startWebSocketMetricsCollection() {
    const interval = setInterval(() => {
      try {
        // Calculate throughput (messages per second over last minute)
        this.calculateThroughput();

        this.emit('metrics:websocket:snapshot', {
          metrics: this.metrics.websocket,
          timestamp: Date.now()
        });

      } catch (error) {
        logger.error('Error collecting WebSocket metrics:', error);
      }
    }, 10000); // Every 10 seconds

    this.intervals.set('websocket', interval);
  }

  /**
   * Start notification metrics collection
   */
  startNotificationMetricsCollection() {
    const interval = setInterval(() => {
      try {
        this.emit('metrics:notifications:snapshot', {
          metrics: this.metrics.notifications,
          timestamp: Date.now()
        });

      } catch (error) {
        logger.error('Error collecting notification metrics:', error);
      }
    }, 15000); // Every 15 seconds

    this.intervals.set('notifications', interval);
  }

  /**
   * Calculate throughput metrics
   */
  calculateThroughput() {
    const now = Date.now();
    const window = 60000; // 1 minute window

    // Get recent message counts from time series data
    const recentSent = this.getTimeSeriesDataSum('websocket.messages.sent', now - window, now);
    const recentReceived = this.getTimeSeriesDataSum('websocket.messages.received', now - window, now);

    this.metrics.websocket.messages.throughput = {
      sent: recentSent,
      received: recentReceived,
      total: recentSent + recentReceived
    };
  }

  /**
   * Store time series data point
   */
  storeTimeSeriesData(key, value, timestamp) {
    if (!this.timeSeriesData.has(key)) {
      this.timeSeriesData.set(key, []);
    }

    const series = this.timeSeriesData.get(key);
    series.push({ timestamp, value });

    // Keep only recent data
    const cutoff = timestamp - this.metricsRetentionPeriod;
    const index = series.findIndex(point => point.timestamp >= cutoff);
    if (index > 0) {
      this.timeSeriesData.set(key, series.slice(index));
    }
  }

  /**
   * Get sum of time series data in time range
   */
  getTimeSeriesDataSum(key, startTime, endTime) {
    const series = this.timeSeriesData.get(key) || [];
    return series
      .filter(point => point.timestamp >= startTime && point.timestamp <= endTime)
      .reduce((sum, point) => sum + point.value, 0);
  }

  /**
   * Update running average
   */
  updateAverage(field, value, count) {
    const current = this.metrics.websocket.messages[field] || 0;
    this.metrics.websocket.messages[field] = (current * (count - 1) + value) / count;
  }

  /**
   * Check metrics against thresholds and generate alerts
   */
  checkThresholds(metric, value) {
    const threshold = this.thresholds[metric];
    if (!threshold) return;

    let alertLevel = null;
    if (value >= threshold.critical) {
      alertLevel = 'critical';
    } else if (value >= threshold.warning) {
      alertLevel = 'warning';
    }

    if (alertLevel) {
      const alert = {
        metric,
        value,
        threshold: threshold[alertLevel],
        level: alertLevel,
        timestamp: Date.now()
      };

      this.alerts.push(alert);

      // Keep only recent alerts
      this.alerts = this.alerts.filter(a => Date.now() - a.timestamp < 60 * 60 * 1000); // 1 hour

      this.emit('alert', alert);

      logger.warn(`Performance threshold exceeded`, {
        metric,
        value,
        threshold: threshold[alertLevel],
        level: alertLevel
      });
    }
  }

  /**
   * Determine if event should be sampled
   */
  shouldSample() {
    return Math.random() < this.sampleRate;
  }

  /**
   * Start data retention cleanup
   */
  startDataRetentionCleanup() {
    const interval = setInterval(() => {
      try {
        const now = Date.now();
        const cutoff = now - this.metricsRetentionPeriod;

        // Clean up time series data
        for (const [key, series] of this.timeSeriesData) {
          const filtered = series.filter(point => point.timestamp >= cutoff);
          if (filtered.length !== series.length) {
            this.timeSeriesData.set(key, filtered);
          }
        }

        // Clean up alerts
        this.alerts = this.alerts.filter(alert => alert.timestamp >= cutoff);

      } catch (error) {
        logger.error('Error during data retention cleanup:', error);
      }
    }, 60 * 60 * 1000); // Every hour

    this.intervals.set('cleanup', interval);
  }

  /**
   * Get comprehensive metrics report
   */
  getMetricsReport() {
    return {
      timestamp: Date.now(),
      uptime: process.uptime(),
      metrics: this.metrics,
      alerts: this.alerts.slice(-10), // Last 10 alerts
      timeSeriesSummary: this.getTimeSeriesSummary(),
      systemInfo: this.getSystemInfo()
    };
  }

  /**
   * Get time series summary
   */
  getTimeSeriesSummary() {
    const summary = {};
    const now = Date.now();
    const windows = [
      { name: '5m', duration: 5 * 60 * 1000 },
      { name: '15m', duration: 15 * 60 * 1000 },
      { name: '1h', duration: 60 * 60 * 1000 },
      { name: '24h', duration: 24 * 60 * 60 * 1000 }
    ];

    for (const [key, series] of this.timeSeriesData) {
      summary[key] = {};
      for (const window of windows) {
        const startTime = now - window.duration;
        const windowData = series.filter(point => point.timestamp >= startTime);

        if (windowData.length > 0) {
          const values = windowData.map(point => point.value);
          summary[key][window.name] = {
            count: values.length,
            sum: values.reduce((a, b) => a + b, 0),
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            min: Math.min(...values),
            max: Math.max(...values)
          };
        }
      }
    }

    return summary;
  }

  /**
   * Get system information
   */
  getSystemInfo() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: process.uptime(),
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      }
    };
  }

  /**
   * Get performance recommendations
   */
  getPerformanceRecommendations() {
    const recommendations = [];
    const metrics = this.metrics.websocket;

    // Connection recommendations
    if (metrics.connections.rejected > metrics.connections.total * 0.01) { // 1% rejection rate
      recommendations.push({
        category: 'connections',
        priority: 'high',
        message: 'High connection rejection rate detected. Consider increasing maxConnections or implementing connection pooling.',
        metric: 'rejectionRate',
        value: metrics.connections.rejected / metrics.connections.total
      });
    }

    // Latency recommendations
    if (metrics.messages.avgLatency > 100) {
      recommendations.push({
        category: 'performance',
        priority: 'medium',
        message: 'High message latency detected. Consider optimizing message processing or enabling compression.',
        metric: 'avgLatency',
        value: metrics.messages.avgLatency
      });
    }

    // Memory recommendations
    const memUsage = process.memoryUsage();
    const memoryUsagePercent = memUsage.heapUsed / memUsage.heapTotal;
    if (memoryUsagePercent > 0.8) {
      recommendations.push({
        category: 'memory',
        priority: 'high',
        message: 'High memory usage detected. Consider implementing memory optimization or increasing heap size.',
        metric: 'memoryUsage',
        value: memoryUsagePercent
      });
    }

    // Error rate recommendations
    if (metrics.connections.errors > 0) {
      const errorRate = metrics.connections.errors / metrics.connections.total;
      if (errorRate > 0.01) { // 1% error rate
        recommendations.push({
          category: 'reliability',
          priority: 'high',
          message: 'High error rate detected. Review error logs and implement better error handling.',
          metric: 'errorRate',
          value: errorRate
        });
      }
    }

    return recommendations;
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    // Reset all metrics to initial state
    this.metrics = {
      websocket: {
        connections: {
          total: 0,
          active: 0,
          peak: 0,
          created: 0,
          destroyed: 0,
          rejected: 0,
          errors: 0,
          avgDuration: 0,
          avgCreationTime: 0
        },
        messages: {
          sent: 0,
          received: 0,
          errors: 0,
          avgLatency: 0,
          avgSize: 0,
          compressionRatio: 0,
          throughput: 0
        },
        performance: {
          cpuUsage: 0,
          memoryUsage: 0,
          eventLoopLag: 0,
          gcPause: 0,
          openFileDescriptors: 0
        }
      },
      notifications: {
        total: 0,
        successful: 0,
        failed: 0,
        byPriority: { low: 0, medium: 0, high: 0, critical: 0 },
        byCategory: { security: 0, system: 0, social: 0, task: 0, administrative: 0 },
        byChannel: { websocket: 0, email: 0, sms: 0 },
        avgProcessingTime: 0,
        deliveryRate: 0
      },
      database: {
        queries: 0,
        avgQueryTime: 0,
        slowQueries: 0,
        connectionPool: {
          active: 0,
          idle: 0,
          total: 0
        }
      },
      redis: {
        operations: 0,
        avgResponseTime: 0,
        hitRate: 0,
        memoryUsage: 0,
        connectedClients: 0
      }
    };

    this.alerts = [];
    this.timeSeriesData.clear();

    logger.info('Performance metrics reset');
  }

  /**
   * Stop monitoring
   */
  stop() {
    // Clear all intervals
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();

    logger.info('Performance monitoring service stopped');
  }
}

// Create singleton instance
const performanceMonitoringService = new PerformanceMonitoringService();

module.exports = performanceMonitoringService;