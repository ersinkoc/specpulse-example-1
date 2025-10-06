/**
 * False Positive Reducer - ML-based false positive reduction for security alerts
 * Uses machine learning to reduce false positives and improve alert accuracy
 */

const EventEmitter = require('events');
const logger = require('../../shared/utils/logger');

class FalsePositiveReducer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      modelThreshold: options.modelThreshold || 0.7,
      trainingDataSize: options.trainingDataSize || 1000,
      feedbackWindow: options.feedbackWindow || 86400000, // 24 hours
      minSamplesForTraining: options.minSamplesForTraining || 100,
      ...options
    };

    this.model = null;
    this.trainingData = [];
    this.feedbackData = new Map(); // alertId -> feedback
    this.statistics = {
      totalAlerts: 0,
      falsePositives: 0,
      truePositives: 0,
      reductionRate: 0
    };

    this.isInitialized = false;
  }

  /**
   * Initialize the false positive reducer
   */
  async initialize() {
    try {
      logger.info('Initializing False Positive Reducer');

      // Load existing training data
      await this.loadTrainingData();

      // Initialize ML model
      await this.initializeModel();

      // Load feedback data
      await this.loadFeedbackData();

      this.isInitialized = true;
      logger.info('False Positive Reducer initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize False Positive Reducer', { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize ML model for false positive detection
   */
  async initializeModel() {
    // Simple rule-based model for demonstration
    // In production, this would use TensorFlow.js or similar ML library
    this.model = {
      type: 'rule_based',
      version: '1.0',
      features: [
        'alertSeverity',
        'alertFrequency',
        'userRiskScore',
        'timeOfDay',
        'dayOfWeek',
        'sourceReputation',
        'patternConfidence',
        'historicalAccuracy'
      ],
      rules: [
        // High severity alerts are less likely to be false positives
        { condition: 'severity === "critical"', weight: -0.3 },
        { condition: 'severity === "high"', weight: -0.2 },
        { condition: 'severity === "medium"', weight: 0.1 },
        { condition: 'severity === "low"', weight: 0.3 },

        // Frequent alerts from same source might be false positives
        { condition: 'alertFrequency > 10', weight: 0.2 },
        { condition: 'alertFrequency > 50', weight: 0.4 },

        // Low risk users generate more false positives
        { condition: 'userRiskScore < 0.3', weight: 0.2 },
        { condition: 'userRiskScore > 0.7', weight: -0.1 },

        // Off-hours alerts have higher false positive rate
        { condition: 'timeOfDay < 6 || timeOfDay > 22', weight: 0.1 },

        // Weekend alerts have slightly higher false positive rate
        { condition: 'dayOfWeek === 0 || dayOfWeek === 6', weight: 0.05 },

        // Low reputation sources generate more false positives
        { condition: 'sourceReputation < 0.5', weight: 0.2 },

        // High confidence patterns are less likely to be false positives
        { condition: 'patternConfidence > 0.8', weight: -0.2 },
        { condition: 'patternConfidence < 0.5', weight: 0.1 }
      ]
    };

    logger.info('ML model initialized', { type: this.model.type, features: this.model.features.length });
  }

  /**
   * Process alert and determine if it's likely a false positive
   */
  async processAlert(alert) {
    try {
      if (!this.isInitialized) {
        throw new Error('False Positive Reducer not initialized');
      }

      // Extract features from alert
      const features = this.extractFeatures(alert);

      // Calculate false positive probability
      const falsePositiveProbability = this.calculateFalsePositiveProbability(features);

      // Determine if alert should be suppressed
      const shouldSuppress = falsePositiveProbability > this.options.modelThreshold;

      // Update statistics
      this.updateStatistics(alert, shouldSuppress);

      // Return result
      const result = {
        alertId: alert.id,
        falsePositiveProbability,
        shouldSuppress,
        confidence: 1 - Math.abs(falsePositiveProbability - 0.5) * 2,
        features,
        reasoning: this.generateReasoning(features, falsePositiveProbability)
      };

      // Emit event
      this.emit('alertProcessed', result);

      return result;

    } catch (error) {
      logger.error('Error processing alert', {
        alertId: alert.id,
        error: error.message
      });

      return {
        alertId: alert.id,
        falsePositiveProbability: 0,
        shouldSuppress: false,
        confidence: 0,
        error: error.message
      };
    }
  }

  /**
   * Extract features from alert
   */
  extractFeatures(alert) {
    const now = new Date();
    const alertTime = new Date(alert.timestamp || Date.now());

    return {
      alertSeverity: this.severityToScore(alert.severity),
      alertFrequency: this.getAlertFrequency(alert),
      userRiskScore: this.getUserRiskScore(alert.userId),
      timeOfDay: alertTime.getHours(),
      dayOfWeek: alertTime.getDay(),
      sourceReputation: this.getSourceReputation(alert.source),
      patternConfidence: alert.confidence || 0.5,
      historicalAccuracy: this.getHistoricalAccuracy(alert.patternId)
    };
  }

  /**
   * Convert severity to numeric score
   */
  severityToScore(severity) {
    const severityMap = {
      critical: 1.0,
      high: 0.8,
      medium: 0.6,
      low: 0.4,
      info: 0.2
    };
    return severityMap[severity] || 0.5;
  }

  /**
   * Get alert frequency for source/user
   */
  getAlertFrequency(alert) {
    // Count similar alerts in the last hour
    const oneHourAgo = Date.now() - 3600000;

    // This would query the database in a real implementation
    // For now, return a mock frequency
    return Math.floor(Math.random() * 20);
  }

  /**
   * Get user risk score
   */
  getUserRiskScore(userId) {
    // This would query the user risk assessment service
    // For now, return a mock risk score
    return Math.random();
  }

  /**
   * Get source reputation
   */
  getSourceReputation(source) {
    // This would query a source reputation service
    // For now, return a mock reputation score
    return Math.random();
  }

  /**
   * Get historical accuracy for pattern
   */
  getHistoricalAccuracy(patternId) {
    // This would query historical pattern accuracy
    // For now, return a mock accuracy
    return 0.7 + Math.random() * 0.3;
  }

  /**
   * Calculate false positive probability using model
   */
  calculateFalsePositiveProbability(features) {
    if (!this.model) {
      return 0.5; // Neutral probability
    }

    let score = 0.5; // Base score

    // Apply rules
    for (const rule of this.model.rules) {
      if (this.evaluateRule(rule.condition, features)) {
        score += rule.weight;
      }
    }

    // Normalize to 0-1 range
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Evaluate rule condition
   */
  evaluateRule(condition, features) {
    try {
      // Simple condition evaluator
      // In production, this would be more sophisticated
      if (condition.includes('severity')) {
        const severity = condition.match(/severity === "(\w+)"/);
        if (severity) {
          return features.alertSeverity === this.severityToScore(severity[1]);
        }
      }

      if (condition.includes('alertFrequency')) {
        const match = condition.match(/alertFrequency ([><=]+) (\d+)/);
        if (match) {
          return this.compareValues(features.alertFrequency, match[1], parseInt(match[2]));
        }
      }

      if (condition.includes('userRiskScore')) {
        const match = condition.match(/userRiskScore ([><=]+) ([\d.]+)/);
        if (match) {
          return this.compareValues(features.userRiskScore, match[1], parseFloat(match[2]));
        }
      }

      if (condition.includes('timeOfDay')) {
        const match = condition.match(/timeOfDay ([><=]+) (\d+)/);
        if (match) {
          return this.compareValues(features.timeOfDay, match[1], parseInt(match[2]));
        }
      }

      if (condition.includes('patternConfidence')) {
        const match = condition.match(/patternConfidence ([><=]+) ([\d.]+)/);
        if (match) {
          return this.compareValues(features.patternConfidence, match[1], parseFloat(match[2]));
        }
      }

      return false;
    } catch (error) {
      logger.error('Error evaluating rule', { condition, error: error.message });
      return false;
    }
  }

  /**
   * Compare values using operator
   */
  compareValues(value1, operator, value2) {
    switch (operator) {
      case '>': return value1 > value2;
      case '>=': return value1 >= value2;
      case '<': return value1 < value2;
      case '<=': return value1 <= value2;
      case '==': return value1 === value2;
      case '!=': return value1 !== value2;
      default: return false;
    }
  }

  /**
   * Generate reasoning for false positive determination
   */
  generateReasoning(features, probability) {
    const reasons = [];

    if (features.alertSeverity < 0.6) {
      reasons.push('Low severity alert');
    }

    if (features.alertFrequency > 10) {
      reasons.push('High frequency from source');
    }

    if (features.userRiskScore < 0.3) {
      reasons.push('Low risk user');
    }

    if (features.timeOfDay < 6 || features.timeOfDay > 22) {
      reasons.push('Off-hours alert');
    }

    if (features.sourceReputation < 0.5) {
      reasons.push('Low source reputation');
    }

    if (features.patternConfidence < 0.5) {
      reasons.push('Low pattern confidence');
    }

    return {
      probability,
      factors: reasons,
      summary: reasons.length > 0
        ? `Alert flagged as potential false positive due to: ${reasons.join(', ')}`
        : 'Alert appears legitimate based on available factors'
    };
  }

  /**
   * Record feedback for alert
   */
  async recordFeedback(alertId, isFalsePositive, feedback = {}) {
    try {
      this.feedbackData.set(alertId, {
        alertId,
        isFalsePositive,
        timestamp: Date.now(),
        feedback,
        processed: false
      });

      // Add to training data
      if (this.trainingData.length < this.options.trainingDataSize) {
        this.trainingData.push({
          alertId,
          isFalsePositive,
          timestamp: Date.now(),
          features: feedback.features || {}
        });
      }

      logger.debug('Feedback recorded', { alertId, isFalsePositive });

      // Emit event
      this.emit('feedbackRecorded', { alertId, isFalsePositive, feedback });

    } catch (error) {
      logger.error('Error recording feedback', {
        alertId,
        error: error.message
      });
    }
  }

  /**
   * Update statistics
   */
  updateStatistics(alert, wasSuppressed) {
    this.statistics.totalAlerts++;

    if (wasSuppressed) {
      this.statistics.falsePositives++;
    } else {
      this.statistics.truePositives++;
    }

    this.statistics.reductionRate = this.statistics.falsePositives / this.statistics.totalAlerts;
  }

  /**
   * Retrain model with new data
   */
  async retrainModel() {
    try {
      if (this.trainingData.length < this.options.minSamplesForTraining) {
        logger.warn('Insufficient training data for retraining', {
          current: this.trainingData.length,
          required: this.options.minSamplesForTraining
        });
        return;
      }

      logger.info('Retraining false positive model', {
        trainingDataSize: this.trainingData.length
      });

      // In a real implementation, this would retrain the ML model
      // For now, just log the retraining
      await this.performModelRetraining();

      // Clear processed feedback
      this.clearProcessedFeedback();

      logger.info('Model retraining completed');

      this.emit('modelRetrained', {
        timestamp: Date.now(),
        trainingDataSize: this.trainingData.length,
        modelVersion: this.model.version
      });

    } catch (error) {
      logger.error('Error retraining model', { error: error.message });
    }
  }

  /**
   * Perform actual model retraining
   */
  async performModelRetraining() {
    // Placeholder for model retraining logic
    // In production, this would use TensorFlow.js or similar

    // Simulate retraining time
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Update model version
    if (this.model) {
      this.model.version = (parseFloat(this.model.version) + 0.1).toFixed(1);
      this.model.lastTrained = Date.now();
    }
  }

  /**
   * Clear processed feedback
   */
  clearProcessedFeedback() {
    const cutoffTime = Date.now() - this.options.feedbackWindow;

    for (const [alertId, feedback] of this.feedbackData.entries()) {
      if (feedback.timestamp < cutoffTime) {
        this.feedbackData.delete(alertId);
      }
    }
  }

  /**
   * Get model statistics
   */
  getStatistics() {
    return {
      ...this.statistics,
      modelInitialized: this.isInitialized,
      modelType: this.model?.type,
      modelVersion: this.model?.version,
      trainingDataSize: this.trainingData.length,
      feedbackCount: this.feedbackData.size,
      reductionRate: this.statistics.reductionRate
    };
  }

  /**
   * Get detailed statistics for a time period
   */
  getDetailedStatistics(timeRange = '24h') {
    const now = Date.now();
    let startTime;

    switch (timeRange) {
      case '1h':
        startTime = now - 3600000;
        break;
      case '24h':
        startTime = now - 86400000;
        break;
      case '7d':
        startTime = now - 604800000;
        break;
      default:
        startTime = now - 86400000;
    }

    const recentFeedback = Array.from(this.feedbackData.values())
      .filter(feedback => feedback.timestamp >= startTime);

    const recentFalsePositives = recentFeedback.filter(f => f.isFalsePositive).length;
    const recentTruePositives = recentFeedback.filter(f => !f.isFalsePositive).length;
    const totalRecent = recentFalsePositives + recentTruePositives;

    return {
      timeRange,
      totalAlerts: totalRecent,
      falsePositives: recentFalsePositives,
      truePositives: recentTruePositives,
      falsePositiveRate: totalRecent > 0 ? recentFalsePositives / totalRecent : 0,
      reductionRate: totalRecent > 0 ? recentFalsePositives / totalRecent : 0
    };
  }

  /**
   * Load training data from storage
   */
  async loadTrainingData() {
    // Implementation would load from database or file
    logger.debug('Training data loaded (initialized empty)');
  }

  /**
   * Load feedback data from storage
   */
  async loadFeedbackData() {
    // Implementation would load from database or file
    logger.debug('Feedback data loaded (initialized empty)');
  }

  /**
   * Save training data to storage
   */
  async saveTrainingData() {
    // Implementation would save to database or file
    logger.debug('Training data saved');
  }

  /**
   * Save feedback data to storage
   */
  async saveFeedbackData() {
    // Implementation would save to database or file
    logger.debug('Feedback data saved');
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      await this.saveTrainingData();
      await this.saveFeedbackData();

      this.trainingData = [];
      this.feedbackData.clear();
      this.model = null;
      this.isInitialized = false;

      logger.info('False Positive Reducer cleaned up');
    } catch (error) {
      logger.error('Error during cleanup', { error: error.message });
    }
  }
}

module.exports = FalsePositiveReducer;