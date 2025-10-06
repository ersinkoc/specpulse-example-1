/**
 * Alert Generator
 * Generates and manages security alerts with intelligent correlation and routing
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const winston = require('winston');

class AlertGenerator extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      enabled: config.enabled !== false,
      correlationWindow: config.correlationWindow || 300000, // 5 minutes
      deduplicationWindow: config.deduplicationWindow || 60000, // 1 minute
      maxAlertsPerMinute: config.maxAlertsPerMinute || 50,
      escalationThresholds: config.escalationThresholds || {
        critical: 1,
        high: 3,
        medium: 10,
        low: 20
      },
      alertRouting: config.alertRouting || {
        critical: ['email', 'sms', 'webhook'],
        high: ['email', 'webhook'],
        medium: ['email'],
        low: ['webhook']
      },
      suppressionRules: config.suppressionRules || [],
      enrichment: config.enrichment !== false,
      ...config
    };

    // Alert storage
    this.alerts = new Map();
    this.alertBuffer = [];
    this.correlationGroups = new Map();

    // Rate limiting
    this.alertRateTracker = new Map();
    this.lastCleanup = Date.now();

    // Alert statistics
    this.statistics = {
      totalGenerated: 0,
      totalSuppressed: 0,
      totalDeduplicated: 0,
      totalCorrelated: 0,
      bySeverity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      },
      byType: new Map()
    };

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
          filename: 'logs/alert-generator.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize alert generator
   */
  initialize() {
    try {
      // Start periodic cleanup
      this.startPeriodicCleanup();

      this.logger.info('Alert generator initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize alert generator:', error);
      throw error;
    }
  }

  /**
   * Generate security alert
   */
  async generateAlert(alertData) {
    if (!this.config.enabled) {
      return null;
    }

    try {
      // Check rate limits
      if (!this.checkRateLimit(alertData)) {
        this.statistics.totalSuppressed++;
        return null;
      }

      // Check suppression rules
      if (this.isSuppressed(alertData)) {
        this.statistics.totalSuppressed++;
        this.logger.debug('Alert suppressed by rules:', alertData);
        return null;
      }

      // Check for duplicates
      const duplicateId = this.findDuplicate(alertData);
      if (duplicateId) {
        this.statistics.totalDeduplicated++;
        return this.updateExistingAlert(duplicateId, alertData);
      }

      // Create new alert
      const alert = await this.createAlert(alertData);

      // Enrich alert with additional context
      if (this.config.enrichment) {
        await this.enrichAlert(alert);
      }

      // Check for correlation opportunities
      await this.checkCorrelation(alert);

      // Store alert
      this.alerts.set(alert.id, alert);
      this.alertBuffer.push(alert);

      // Update statistics
      this.updateStatistics(alert);

      // Emit alert for processing
      this.emit('alert', alert);

      // Determine routing
      const routing = this.determineRouting(alert);

      this.logger.info('Alert generated:', {
        id: alert.id,
        severity: alert.severity,
        type: alert.type,
        routing: routing
      });

      return {
        alertId: alert.id,
        severity: alert.severity,
        routing,
        correlation: alert.correlationId
      };

    } catch (error) {
      this.logger.error('Failed to generate alert:', error);
      throw error;
    }
  }

  /**
   * Check rate limits
   */
  checkRateLimit(alertData) {
    const now = Date.now();
    const minuteKey = Math.floor(now / 60000); // Current minute
    const key = `${alertData.type}-${alertData.severity}-${minuteKey}`;

    const currentCount = this.alertRateTracker.get(key) || 0;

    if (currentCount >= this.config.maxAlertsPerMinute) {
      return false;
    }

    this.alertRateTracker.set(key, currentCount + 1);
    return true;
  }

  /**
   * Check if alert should be suppressed
   */
  isSuppressed(alertData) {
    for (const rule of this.config.suppressionRules) {
      if (this.matchesRule(alertData, rule)) {
        this.logger.debug(`Alert suppressed by rule: ${rule.name}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Check if alert matches suppression rule
   */
  matchesRule(alertData, rule) {
    // Check type match
    if (rule.type && alertData.type !== rule.type) {
      return false;
    }

    // Check severity match
    if (rule.severity && alertData.severity !== rule.severity) {
      return false;
    }

    // Check source match
    if (rule.source && alertData.source !== rule.source) {
      return false;
    }

    // Check custom conditions
    if (rule.condition && !rule.condition(alertData)) {
      return false;
    }

    return true;
  }

  /**
   * Find duplicate alert
   */
  findDuplicate(alertData) {
    const now = Date.now();
    const deduplicationWindow = this.config.deduplicationWindow;

    for (const [alertId, alert] of this.alerts.entries()) {
      if (now - alert.createdAt.getTime() > deduplicationWindow) {
        continue; // Too old for deduplication
      }

      if (this.isDuplicate(alert, alertData)) {
        return alertId;
      }
    }

    return null;
  }

  /**
   * Check if two alerts are duplicates
   */
  isDuplicate(existingAlert, newAlertData) {
    return (
      existingAlert.type === newAlertData.type &&
      existingAlert.severity === newAlertData.severity &&
      existingAlert.source === newAlertData.source &&
      this.similarContent(existingAlert, newAlertData)
    );
  }

  /**
   * Check if alert content is similar
   */
  similarContent(existingAlert, newAlertData) {
    // Simple content similarity check
    const existingTitle = (existingAlert.title || '').toLowerCase();
    const newTitle = (newAlertData.title || '').toLowerCase();

    // If titles are very similar, consider as duplicate
    if (existingTitle && newTitle) {
      const similarity = this.calculateSimilarity(existingTitle, newTitle);
      return similarity > 0.8;
    }

    return false;
  }

  /**
   * Calculate string similarity (simplified)
   */
  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
      return 1.0;
    }

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Update existing alert
   */
  updateExistingAlert(alertId, newAlertData) {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return null;
    }

    // Update occurrence count
    alert.occurrences = (alert.occurrences || 1) + 1;
    alert.lastOccurrence = new Date();

    // Update context if provided
    if (newAlertData.context) {
      alert.context = { ...alert.context, ...newAlertData.context };
    }

    // Update severity if new alert is more severe
    const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    if (severityOrder[newAlertData.severity] > severityOrder[alert.severity]) {
      alert.severity = newAlertData.severity;
    }

    // Emit updated alert
    this.emit('alertUpdated', alert);

    return alertId;
  }

  /**
   * Create new alert
   */
  async createAlert(alertData) {
    const alert = {
      id: crypto.randomUUID(),
      type: alertData.type,
      severity: alertData.severity,
      title: alertData.title,
      description: alertData.description,
      source: alertData.source || 'unknown',
      triggerEvent: alertData.triggerEvent,
      context: alertData.context || {},
      createdAt: new Date(),
      lastOccurrence: new Date(),
      occurrences: 1,
      status: 'open',
      correlationId: null,
      routing: [],
      metadata: {}
    };

    return alert;
  }

  /**
   * Enrich alert with additional context
   */
  async enrichAlert(alert) {
    try {
      // Add geographic information if IP is available
      if (alert.triggerEvent && alert.triggerEvent.ip) {
        alert.metadata.geoLocation = await this.getGeoLocation(alert.triggerEvent.ip);
      }

      // Add threat intelligence
      alert.metadata.threatIntelligence = await this.getThreatIntelligence(alert);

      // Add historical context
      alert.metadata.historicalContext = await this.getHistoricalContext(alert);

      // Add related alerts
      alert.metadata.relatedAlerts = await this.findRelatedAlerts(alert);

    } catch (error) {
      this.logger.warn('Failed to enrich alert:', error);
    }
  }

  /**
   * Get geographic location for IP
   */
  async getGeoLocation(ip) {
    // Placeholder implementation
    // In production, integrate with GeoIP service
    return {
      ip: ip,
      country: 'unknown',
      city: 'unknown',
      latitude: null,
      longitude: null
    };
  }

  /**
   * Get threat intelligence data
   */
  async getThreatIntelligence(alert) {
    // Placeholder implementation
    // In production, integrate with threat intelligence feeds
    return {
      indicators: [],
      severity: 'unknown',
      confidence: 0
    };
  }

  /**
   * Get historical context
   */
  async getHistoricalContext(alert) {
    const last24Hours = Date.now() - (24 * 60 * 60 * 1000);
    const recentAlerts = Array.from(this.alerts.values())
      .filter(a => a.type === alert.type && a.createdAt.getTime() > last24Hours);

    return {
      count: recentAlerts.length,
      trend: this.calculateTrend(recentAlerts),
      lastOccurrence: recentAlerts.length > 0 ? recentAlerts[recentAlerts.length - 1].createdAt : null
    };
  }

  /**
   * Calculate trend from recent alerts
   */
  calculateTrend(alerts) {
    if (alerts.length < 2) return 'stable';

    const halfPoint = Math.floor(alerts.length / 2);
    const firstHalf = alerts.slice(0, halfPoint);
    const secondHalf = alerts.slice(halfPoint);

    const firstHalfRate = firstHalf.length / (halfPoint * 60 * 60 * 1000); // per ms
    const secondHalfRate = secondHalf.length / (halfPoint * 60 * 60 * 1000);

    if (secondHalfRate > firstHalfRate * 1.2) return 'increasing';
    if (secondHalfRate < firstHalfRate * 0.8) return 'decreasing';
    return 'stable';
  }

  /**
   * Find related alerts
   */
  async findRelatedAlerts(alert) {
    const correlationWindow = this.config.correlationWindow;
    const now = Date.now();

    return Array.from(this.alerts.values())
      .filter(a =>
        a.id !== alert.id &&
        a.type === alert.type &&
        (now - a.createdAt.getTime()) < correlationWindow
      )
      .slice(0, 10) // Limit to 10 related alerts
      .map(a => ({
        id: a.id,
        severity: a.severity,
        createdAt: a.createdAt,
        title: a.title
      }));
  }

  /**
   * Check for correlation opportunities
   */
  async checkCorrelation(alert) {
    const correlationWindow = this.config.correlationWindow;
    const now = Date.now();

    // Find recent alerts with similar characteristics
    const similarAlerts = Array.from(this.alerts.values())
      .filter(a =>
        a.id !== alert.id &&
        a.type === alert.type &&
        (now - a.createdAt.getTime()) < correlationWindow
      );

    if (similarAlerts.length >= 2) {
      // Create correlation group
      const correlationId = this.createCorrelationGroup(alert, similarAlerts);
      alert.correlationId = correlationId;

      this.statistics.totalCorrelated++;

      // Emit correlation event
      this.emit('correlation', {
        correlationId,
        alertCount: similarAlerts.length + 1,
        type: alert.type,
        severity: alert.severity
      });
    }
  }

  /**
   * Create correlation group
   */
  createCorrelationGroup(alert, similarAlerts) {
    const correlationId = crypto.randomUUID();

    const group = {
      id: correlationId,
      type: alert.type,
      severity: alert.severity,
      alerts: [alert.id, ...similarAlerts.map(a => a.id)],
      createdAt: new Date(),
      lastUpdate: new Date()
    };

    this.correlationGroups.set(correlationId, group);

    // Update similar alerts with correlation ID
    similarAlerts.forEach(a => {
      a.correlationId = correlationId;
    });

    return correlationId;
  }

  /**
   * Determine alert routing
   */
  determineRouting(alert) {
    const routing = this.config.alertRouting[alert.severity] || ['webhook'];
    alert.routing = routing;
    return routing;
  }

  /**
   * Update statistics
   */
  updateStatistics(alert) {
    this.statistics.totalGenerated++;

    // Update severity stats
    if (this.statistics.bySeverity[alert.severity]) {
      this.statistics.bySeverity[alert.severity]++;
    }

    // Update type stats
    const typeCount = this.statistics.byType.get(alert.type) || 0;
    this.statistics.byType.set(alert.type, typeCount + 1);
  }

  /**
   * Get alert statistics
   */
  getStatistics() {
    return {
      ...this.statistics,
      activeAlerts: this.alerts.size,
      correlationGroups: this.correlationGroups.size,
      alertBufferSize: this.alertBuffer.length
    };
  }

  /**
   * Get alerts by criteria
   */
  getAlerts(criteria = {}) {
    let alerts = Array.from(this.alerts.values());

    // Filter by severity
    if (criteria.severity) {
      alerts = alerts.filter(a => a.severity === criteria.severity);
    }

    // Filter by type
    if (criteria.type) {
      alerts = alerts.filter(a => a.type === criteria.type);
    }

    // Filter by status
    if (criteria.status) {
      alerts = alerts.filter(a => a.status === criteria.status);
    }

    // Filter by time range
    if (criteria.since) {
      const since = new Date(criteria.since);
      alerts = alerts.filter(a => a.createdAt >= since);
    }

    // Sort by creation time (newest first)
    alerts.sort((a, b) => b.createdAt - a.createdAt);

    // Apply limit
    if (criteria.limit) {
      alerts = alerts.slice(0, criteria.limit);
    }

    return alerts;
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId, acknowledgedBy) {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.status = 'acknowledged';
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;

    this.emit('alertAcknowledged', alert);
    return true;
  }

  /**
   * Resolve alert
   */
  resolveAlert(alertId, resolvedBy, resolution) {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    alert.resolvedBy = resolvedBy;
    alert.resolution = resolution;

    this.emit('alertResolved', alert);
    return true;
  }

  /**
   * Start periodic cleanup
   */
  startPeriodicCleanup() {
    setInterval(() => {
      this.cleanup();
    }, 60000); // Every minute
  }

  /**
   * Cleanup old data
   */
  cleanup() {
    const now = Date.now();
    const cleanupThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days

    // Clean up old alerts
    for (const [alertId, alert] of this.alerts.entries()) {
      if (now - alert.createdAt.getTime() > cleanupThreshold) {
        this.alerts.delete(alertId);
      }
    }

    // Clean up old rate tracker entries
    for (const [key, count] of this.alertRateTracker.entries()) {
      const minuteKey = parseInt(key.split('-').pop());
      const keyTime = minuteKey * 60000;
      if (now - keyTime > 3600000) { // 1 hour
        this.alertRateTracker.delete(key);
      }
    }

    // Clean up old correlation groups
    for (const [groupId, group] of this.correlationGroups.entries()) {
      if (now - group.lastUpdate.getTime() > cleanupThreshold) {
        this.correlationGroups.delete(groupId);
      }
    }

    // Trim alert buffer
    if (this.alertBuffer.length > 1000) {
      this.alertBuffer = this.alertBuffer.slice(-1000);
    }
  }

  /**
   * Reset alert generator
   */
  reset() {
    this.alerts.clear();
    this.alertBuffer = [];
    this.correlationGroups.clear();
    this.alertRateTracker.clear();
    this.resetStatistics();
  }

  /**
   * Reset statistics
   */
  resetStatistics() {
    this.statistics = {
      totalGenerated: 0,
      totalSuppressed: 0,
      totalDeduplicated: 0,
      totalCorrelated: 0,
      bySeverity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      },
      byType: new Map()
    };
  }
}

module.exports = AlertGenerator;