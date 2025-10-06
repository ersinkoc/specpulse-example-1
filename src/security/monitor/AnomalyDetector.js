/**
 * Anomaly Detector
 * Real-time security anomaly detection using machine learning and statistical analysis
 */

const EventEmitter = require('events');
const winston = require('winston');
const crypto = require('crypto');

class AnomalyDetector extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      windowSize: config.windowSize || 300, // 5 minutes in seconds
      minDataPoints: config.minDataPoints || 30,
      sensitivity: config.sensitivity || 0.8, // 0-1 scale
      updateInterval: config.updateInterval || 60000, // 1 minute
      maxPatterns: config.maxPatterns || 1000,
      alertThreshold: config.alertThreshold || 0.9,
      learningMode: config.learningMode !== false,
      ...config
    };

    // Baseline patterns for different metrics
    this.baselinePatterns = new Map();

    // Recent event data for analysis
    this.eventBuffer = [];

    // Statistical models
    this.models = new Map();

    // Anomaly scores
    this.anomalyScores = new Map();

    // Alert history to prevent alert fatigue
    this.alertHistory = new Map();

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
          filename: 'logs/anomaly-detector.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize anomaly detector
   */
  initialize() {
    try {
      // Start periodic model updates
      this.startModelUpdates();

      // Initialize baseline patterns
      this.initializeBaselinePatterns();

      this.logger.info('Anomaly detector initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize anomaly detector:', error);
      throw error;
    }
  }

  /**
   * Initialize baseline patterns
   */
  initializeBaselinePatterns() {
    const defaultPatterns = {
      // Authentication patterns
      'auth:login_rate': {
        type: 'rate',
        baseline: { mean: 10, stdDev: 5, min: 0, max: 50 },
        window: 300, // 5 minutes
        sensitivity: 0.8
      },
      'auth:failed_login_rate': {
        type: 'rate',
        baseline: { mean: 2, stdDev: 2, min: 0, max: 20 },
        window: 300,
        sensitivity: 0.9
      },
      'auth:unique_users': {
        type: 'count',
        baseline: { mean: 50, stdDev: 20, min: 10, max: 200 },
        window: 300,
        sensitivity: 0.7
      },

      // API patterns
      'api:request_rate': {
        type: 'rate',
        baseline: { mean: 100, stdDev: 30, min: 20, max: 500 },
        window: 60, // 1 minute
        sensitivity: 0.8
      },
      'api:error_rate': {
        type: 'percentage',
        baseline: { mean: 2, stdDev: 1, min: 0, max: 10 },
        window: 300,
        sensitivity: 0.9
      },
      'api:response_time': {
        type: 'latency',
        baseline: { mean: 200, stdDev: 100, min: 50, max: 1000 },
        window: 300,
        sensitivity: 0.8
      },

      // Data access patterns
      'data:access_rate': {
        type: 'rate',
        baseline: { mean: 50, stdDev: 20, min: 10, max: 200 },
        window: 300,
        sensitivity: 0.8
      },
      'data:bulk_access': {
        type: 'count',
        baseline: { mean: 5, stdDev: 3, min: 0, max: 20 },
        window: 300,
        sensitivity: 0.9
      },

      // System patterns
      'system:cpu_usage': {
        type: 'percentage',
        baseline: { mean: 30, stdDev: 15, min: 0, max: 80 },
        window: 300,
        sensitivity: 0.7
      },
      'system:memory_usage': {
        type: 'percentage',
        baseline: { mean: 40, stdDev: 10, min: 20, max: 70 },
        window: 300,
        sensitivity: 0.8
      }
    };

    for (const [key, pattern] of Object.entries(defaultPatterns)) {
      this.baselinePatterns.set(key, pattern);
    }

    this.logger.info(`Initialized ${this.baselinePatterns.size} baseline patterns`);
  }

  /**
   * Analyze event for anomalies
   */
  async analyzeEvent(event) {
    try {
      // Add event to buffer
      this.eventBuffer.push({
        ...event,
        timestamp: Date.now()
      });

      // Maintain buffer size
      if (this.eventBuffer.length > this.config.maxPatterns) {
        this.eventBuffer.shift();
      }

      // Extract features from event
      const features = this.extractFeatures(event);

      // Analyze each feature
      const anomalies = [];

      for (const [featureName, featureValue] of Object.entries(features)) {
        const anomaly = await this.analyzeFeature(featureName, featureValue, event);
        if (anomaly) {
          anomalies.push(anomaly);
        }
      }

      // Detect complex patterns
      const complexAnomalies = await this.detectComplexPatterns(event);
      anomalies.push(...complexAnomalies);

      // Emit anomalies if any found
      if (anomalies.length > 0) {
        this.emit('anomaly', {
          eventId: event.id,
          event,
          anomalies,
          timestamp: new Date(),
          severity: this.calculateSeverity(anomalies)
        });

        // Generate alerts for high-severity anomalies
        const highSeverityAnomalies = anomalies.filter(a => a.severity === 'high' || a.severity === 'critical');
        if (highSeverityAnomalies.length > 0) {
          await this.generateAnomalyAlert(event, highSeverityAnomalies);
        }
      }

      return anomalies;

    } catch (error) {
      this.logger.error('Failed to analyze event:', error);
      return [];
    }
  }

  /**
   * Extract features from event
   */
  extractFeatures(event) {
    const features = {};
    const now = Date.now();

    // Time-based features
    const hour = new Date(now).getHours();
    const dayOfWeek = new Date(now).getDay();

    // Authentication features
    if (event.type === 'authentication') {
      features[`auth:${event.subtype}_rate`] = 1; // Will be aggregated

      if (event.subtype === 'login_failure') {
        features['auth:failed_login_rate'] = 1;
      }

      if (event.userId) {
        features['auth:unique_users'] = event.userId;
      }
    }

    // API features
    if (event.method && event.url) {
      features['api:request_rate'] = 1;

      if (event.statusCode && event.statusCode >= 400) {
        features['api:error_rate'] = 1;
      }

      if (event.responseTime) {
        features['api:response_time'] = event.responseTime;
      }
    }

    // Data access features
    if (event.type === 'data') {
      features['data:access_rate'] = 1;

      if (event.metadata && event.metadata.recordCount > 100) {
        features['data:bulk_access'] = 1;
      }
    }

    // Add contextual features
    features['time:hour'] = hour;
    features['time:day_of_week'] = dayOfWeek;
    features['source:ip'] = event.ip;

    return features;
  }

  /**
   * Analyze specific feature for anomalies
   */
  async analyzeFeature(featureName, featureValue, event) {
    const pattern = this.baselinePatterns.get(featureName);
    if (!pattern) {
      return null;
    }

    try {
      // Get recent values for this feature
      const recentValues = this.getRecentValues(featureName, pattern.window);

      if (recentValues.length < this.config.minDataPoints) {
        // Not enough data for analysis
        return null;
      }

      // Calculate anomaly score
      const anomalyScore = this.calculateAnomalyScore(featureValue, pattern, recentValues);

      if (anomalyScore > this.config.sensitivity) {
        const severity = this.getSeverityFromScore(anomalyScore);

        return {
          feature: featureName,
          value: featureValue,
          expected: pattern.baseline,
          score: anomalyScore,
          severity,
          description: this.generateAnomalyDescription(featureName, featureValue, pattern),
          timestamp: new Date()
        };
      }

      return null;

    } catch (error) {
      this.logger.error(`Failed to analyze feature ${featureName}:`, error);
      return null;
    }
  }

  /**
   * Get recent values for a feature
   */
  getRecentValues(featureName, windowSize) {
    const cutoff = Date.now() - (windowSize * 1000);

    return this.eventBuffer
      .filter(event => event.timestamp > cutoff)
      .map(event => this.extractFeatureValue(event, featureName))
      .filter(value => value !== null && value !== undefined);
  }

  /**
   * Extract specific feature value from event
   */
  extractFeatureValue(event, featureName) {
    // This is a simplified implementation
    // In practice, you'd maintain separate time-series for each feature

    switch (featureName) {
      case 'auth:login_rate':
      case 'api:request_rate':
      case 'data:access_rate':
        return 1; // Rate-based features would be aggregated elsewhere

      case 'auth:failed_login_rate':
        return event.subtype === 'login_failure' ? 1 : 0;

      case 'api:error_rate':
        return event.statusCode >= 400 ? 1 : 0;

      case 'api:response_time':
        return event.responseTime || null;

      default:
        return null;
    }
  }

  /**
   * Calculate anomaly score using statistical methods
   */
  calculateAnomalyScore(value, pattern, recentValues) {
    const { baseline } = pattern;

    // Z-score calculation
    const mean = this.calculateMean(recentValues);
    const stdDev = this.calculateStandardDeviation(recentValues, mean);

    if (stdDev === 0) {
      return 0;
    }

    const zScore = Math.abs((value - mean) / stdDev);

    // Normalize to 0-1 scale
    const maxZScore = 3; // Consider values beyond 3 sigma as highly anomalous
    const normalizedScore = Math.min(zScore / maxZScore, 1);

    // Adjust for pattern sensitivity
    return normalizedScore * pattern.sensitivity;
  }

  /**
   * Calculate mean of values
   */
  calculateMean(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Calculate standard deviation
   */
  calculateStandardDeviation(values, mean) {
    if (values.length === 0) return 0;

    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const avgSquaredDiff = this.calculateMean(squaredDiffs);

    return Math.sqrt(avgSquaredDiff);
  }

  /**
   * Get severity from anomaly score
   */
  getSeverityFromScore(score) {
    if (score >= 0.9) return 'critical';
    if (score >= 0.8) return 'high';
    if (score >= 0.6) return 'medium';
    return 'low';
  }

  /**
   * Generate anomaly description
   */
  generateAnomalyDescription(featureName, value, pattern) {
    const { baseline } = pattern;

    return `${featureName} value ${value} deviates significantly from expected baseline (mean: ${baseline.mean}, std dev: ${baseline.stdDev})`;
  }

  /**
   * Detect complex multi-feature patterns
   */
  async detectComplexPatterns(event) {
    const anomalies = [];

    try {
      // Detect brute force attacks
      const bruteForceAnomaly = await this.detectBruteForcePattern(event);
      if (bruteForceAnomaly) anomalies.push(bruteForceAnomaly);

      // Detect unusual data access patterns
      const dataAccessAnomaly = await this.detectDataAccessPattern(event);
      if (dataAccessAnomaly) anomalies.push(dataAccessAnomaly);

      // Detect suspicious geographic patterns
      const geoAnomaly = await this.detectGeographicPattern(event);
      if (geoAnomaly) anomalies.push(geoAnomaly);

      // Detect time-based anomalies
      const timeAnomaly = await this.detectTimeBasedPattern(event);
      if (timeAnomaly) anomalies.push(timeAnomaly);

    } catch (error) {
      this.logger.error('Failed to detect complex patterns:', error);
    }

    return anomalies;
  }

  /**
   * Detect brute force attack patterns
   */
  async detectBruteForcePattern(event) {
    if (event.type !== 'authentication' || event.subtype !== 'login_failure') {
      return null;
    }

    const recentFailures = this.eventBuffer.filter(e =>
      e.type === 'authentication' &&
      e.subtype === 'login_failure' &&
      e.ip === event.ip &&
      (Date.now() - e.timestamp) < 300000 // Last 5 minutes
    );

    if (recentFailures.length >= 10) {
      return {
        type: 'brute_force_attack',
        severity: 'high',
        description: `Multiple failed login attempts from ${event.ip}: ${recentFailures.length} failures in 5 minutes`,
        confidence: Math.min(recentFailures.length / 20, 1),
        evidence: {
          ip: event.ip,
          failureCount: recentFailures.length,
          timeWindow: '5 minutes'
        }
      };
    }

    return null;
  }

  /**
   * Detect unusual data access patterns
   */
  async detectDataAccessPattern(event) {
    if (event.type !== 'data') {
      return null;
    }

    const recentAccess = this.eventBuffer.filter(e =>
      e.type === 'data' &&
      e.userId === event.userId &&
      (Date.now() - e.timestamp) < 300000 // Last 5 minutes
    );

    if (recentAccess.length >= 100) {
      return {
        type: 'unusual_data_access',
        severity: 'medium',
        description: `High volume data access by user ${event.userId}: ${recentAccess.length} operations in 5 minutes`,
        confidence: Math.min(recentAccess.length / 200, 1),
        evidence: {
          userId: event.userId,
          accessCount: recentAccess.length,
          timeWindow: '5 minutes'
        }
      };
    }

    return null;
  }

  /**
   * Detect geographic anomalies
   */
  async detectGeographicPattern(event) {
    if (!event.ip) {
      return null;
    }

    // This would typically integrate with a GeoIP service
    // For now, return null as placeholder
    return null;
  }

  /**
   * Detect time-based anomalies
   */
  async detectTimeBasedPattern(event) {
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();

    // Unusual activity during off-hours
    if (hour >= 2 && hour <= 5) {
      if (event.type === 'authentication' || event.type === 'data') {
        return {
          type: 'off_hours_activity',
          severity: 'medium',
          description: `Security-sensitive activity detected during off-hours (${hour}:00)`,
          confidence: 0.7,
          evidence: {
            hour: hour,
            dayOfWeek: dayOfWeek,
            eventType: event.type
          }
        };
      }
    }

    return null;
  }

  /**
   * Calculate overall severity from multiple anomalies
   */
  calculateSeverity(anomalies) {
    if (anomalies.length === 0) return 'low';

    const severityScores = {
      'critical': 4,
      'high': 3,
      'medium': 2,
      'low': 1
    };

    const maxScore = Math.max(...anomalies.map(a => severityScores[a.severity] || 1));

    if (maxScore >= 4) return 'critical';
    if (maxScore >= 3) return 'high';
    if (maxScore >= 2) return 'medium';
    return 'low';
  }

  /**
   * Generate anomaly alert
   */
  async generateAnomalyAlert(event, anomalies) {
    const alertKey = `${event.type}-${event.subtype}-${event.ip || 'unknown'}`;
    const now = Date.now();

    // Check alert frequency to prevent fatigue
    if (this.alertHistory.has(alertKey)) {
      const lastAlert = this.alertHistory.get(alertKey);
      if (now - lastAlert < 300000) { // 5 minutes
        return; // Skip alert to prevent fatigue
      }
    }

    this.alertHistory.set(alertKey, now);

    const alert = {
      id: crypto.randomUUID(),
      type: 'anomaly_detected',
      severity: this.calculateSeverity(anomalies),
      title: `Security Anomaly Detected: ${event.type}:${event.subtype}`,
      description: anomalies.map(a => a.description).join('; '),
      source: 'anomaly-detector',
      triggerEvent: {
        id: event.id,
        type: event.type,
        subtype: event.subtype
      },
      context: {
        anomalies: anomalies,
        event: event
      },
      createdAt: new Date()
    };

    this.emit('alert', alert);
    this.logger.warn('Anomaly alert generated:', alert);
  }

  /**
   * Update baseline patterns with new data
   */
  updateBaselinePatterns() {
    try {
      for (const [featureName, pattern] of this.baselinePatterns.entries()) {
        const recentValues = this.getRecentValues(featureName, pattern.window * 2);

        if (recentValues.length >= this.config.minDataPoints) {
          const newMean = this.calculateMean(recentValues);
          const newStdDev = this.calculateStandardDeviation(recentValues, newMean);

          // Gradually update baseline (exponential moving average)
          const alpha = 0.1; // Learning rate
          pattern.baseline.mean = (1 - alpha) * pattern.baseline.mean + alpha * newMean;
          pattern.baseline.stdDev = (1 - alpha) * pattern.baseline.stdDev + alpha * newStdDev;
        }
      }

      this.logger.debug('Updated baseline patterns');

    } catch (error) {
      this.logger.error('Failed to update baseline patterns:', error);
    }
  }

  /**
   * Start periodic model updates
   */
  startModelUpdates() {
    setInterval(() => {
      if (this.config.learningMode) {
        this.updateBaselinePatterns();
      }
    }, this.config.updateInterval);
  }

  /**
   * Get current statistics
   */
  getStatistics() {
    return {
      bufferSize: this.eventBuffer.length,
      baselinePatterns: this.baselinePatterns.size,
      alertHistorySize: this.alertHistory.size,
      config: {
        windowSize: this.config.windowSize,
        sensitivity: this.config.sensitivity,
        learningMode: this.config.learningMode
      }
    };
  }

  /**
   * Reset anomaly detector
   */
  reset() {
    this.eventBuffer = [];
    this.anomalyScores.clear();
    this.alertHistory.clear();
    this.resetMetrics();
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    // Implementation for resetting internal metrics
  }
}

module.exports = AnomalyDetector;