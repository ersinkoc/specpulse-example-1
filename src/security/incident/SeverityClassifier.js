/**
 * Security Incident Severity Classifier
 * Automatically classifies security incident severity using machine learning and rule-based logic
 */

const EventEmitter = require('events');
const winston = require('winston');

class SeverityClassifier extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      enableML: config.enableML !== false,
      confidenceThreshold: config.confidenceThreshold || 0.7,
      fallbackMode: config.fallbackMode || 'rules',
      updateModelFrequency: config.updateModelFrequency || 86400000, // 24 hours
      minTrainingData: config.minTrainingData || 100,
      ...config
    };

    // Classification rules
    this.classificationRules = [];

    // ML model (simplified implementation)
    this.mlModel = null;
    this.trainingData = [];

    // Statistics
    this.statistics = {
      totalClassified: 0,
      correctPredictions: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byMethod: { rules: 0, ml: 0, fallback: 0 }
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
          filename: 'logs/severity-classifier.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize severity classifier
   */
  initialize() {
    try {
      // Initialize classification rules
      this.initializeClassificationRules();

      // Start periodic model updates
      if (this.config.enableML) {
        this.startModelUpdates();
      }

      this.logger.info('Severity classifier initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize severity classifier:', error);
      throw error;
    }
  }

  /**
   * Initialize classification rules
   */
  initializeClassificationRules() {
    // Critical severity rules
    this.classificationRules.push({
      id: 'data_breach_pii',
      severity: 'critical',
      confidence: 0.9,
      conditions: [
        { field: 'incidentType', operator: 'equals', value: 'data_breach' },
        { field: 'metadata', operator: 'contains', value: 'pii' }
      ],
      weight: 10,
      description: 'Data breach involving PII'
    });

    this.classificationRules.push({
      id: 'system_compromise',
      severity: 'critical',
      confidence: 0.95,
      conditions: [
        { field: 'incidentType', operator: 'equals', value: 'system_compromise' },
        { field: 'affectedAssets', operator: 'contains', value: 'production' }
      ],
      weight: 10,
      description: 'Production system compromise'
    });

    this.classificationRules.push({
      id: 'ransomware',
      severity: 'critical',
      confidence: 0.9,
      conditions: [
        { field: 'incidentType', operator: 'equals', value: 'malware' },
        { field: 'metadata', operator: 'contains', value: 'ransomware' }
      ],
      weight: 10,
      description: 'Ransomware infection'
    });

    this.classificationRules.push({
      id: 'privilege_escalation',
      severity: 'critical',
      confidence: 0.8,
      conditions: [
        { field: 'incidentType', operator: 'equals', value: 'privilege_escalation' },
        { field: 'severity', operator: 'equals', value: 'critical' }
      ],
      weight: 9,
      description: 'Critical privilege escalation'
    });

    // High severity rules
    this.classificationRules.push({
      id: 'malware_detection',
      severity: 'high',
      confidence: 0.8,
      conditions: [
        { field: 'incidentType', operator: 'equals', value: 'malware' }
      ],
      weight: 8,
      description: 'Malware detection'
    });

    this.classificationRules.push({
      id: 'unauthorized_access',
      severity: 'high',
      confidence: 0.7,
      conditions: [
        { field: 'incidentType', operator: 'equals', value: 'unauthorized_access' },
        { field: 'metadata', operator: 'contains', value: 'admin' }
      ],
      weight: 8,
      description: 'Unauthorized administrative access'
    });

    this.classificationRules.push({
      id: 'dos_attack',
      severity: 'high',
      confidence: 0.8,
      conditions: [
        { field: 'incidentType', operator: 'equals', value: 'dos_attack' }
      ],
      weight: 7,
      description: 'Denial of service attack'
    });

    this.classificationRules.push({
      id: 'sql_injection',
      severity: 'high',
      confidence: 0.85,
      conditions: [
        { field: 'incidentType', operator: 'equals', value: 'sql_injection' }
      ],
      weight: 9,
      description: 'SQL injection attack'
    });

    // Medium severity rules
    this.classificationRules.push({
      id: 'phishing',
      severity: 'medium',
      confidence: 0.7,
      conditions: [
        { field: 'incidentType', operator: 'equals', value: 'phishing' }
      ],
      weight: 6,
      description: 'Phishing attempt'
    });

    this.classificationRules.push({
      id: 'brute_force',
      severity: 'medium',
      confidence: 0.6,
      conditions: [
        { field: 'incidentType', operator: 'equals', value: 'brute_force' }
      ],
      weight: 5,
      description: 'Brute force attack'
    });

    this.classificationRules.push({
      id: 'data_access_anomaly',
      severity: 'medium',
      confidence: 0.5,
      conditions: [
        { field: 'incidentType', operator: 'equals', value: 'data_access' },
        { field: 'metadata', operator: 'greaterThan', value: { recordCount: 1000 } }
      ],
      weight: 6,
      description: 'Unusual data access pattern'
    });

    // Low severity rules
    this.classificationRules.push({
      id: 'failed_login',
      severity: 'low',
      confidence: 0.3,
      conditions: [
        { field: 'incidentType', operator: 'equals', value: 'authentication' },
        { field: 'subType', operator: 'equals', value: 'login_failure' }
      ],
      weight: 2,
      description: 'Failed login attempt'
    });

    this.classificationRules.push({
      id: 'suspicious_activity',
      severity: 'low',
      confidence: 0.4,
      conditions: [
        { field: 'incidentType', operator: 'equals', value: 'suspicious_activity' }
      ],
      weight: 3,
      description: 'Suspicious activity detected'
    });

    this.logger.info(`Initialized ${this.classificationRules.length} classification rules`);
  }

  /**
   * Classify incident severity
   */
  async classifySeverity(incidentData) {
    try {
      this.statistics.totalClassified++;

      // Try ML classification first if enabled
      if (this.config.enableML && this.mlModel) {
        const mlResult = await this.classifyWithML(incidentData);
        if (mlResult.confidence >= this.config.confidenceThreshold) {
          this.statistics.byMethod.ml++;
          this.statistics.correctPredictions += mlResult.correct ? 1 : 0;
          this.statistics.bySeverity[mlResult.severity]++;

          this.emit('classified', {
            incidentId: incidentData.id || 'unknown',
            severity: mlResult.severity,
            confidence: mlResult.confidence,
            method: 'ml',
            rules: []
          });

          return mlResult;
        }
      }

      // Fall back to rule-based classification
      const ruleResult = await this.classifyWithRules(incidentData);
      this.statistics.byMethod.rules++;
      this.statistics.bySeverity[ruleResult.severity]++;

      this.emit('classified', {
        incidentId: incidentData.id || 'unknown',
        severity: ruleResult.severity,
        confidence: ruleResult.confidence,
        method: 'rules',
        rules: ruleResult.matchedRules
      });

      return ruleResult;

    } catch (error) {
      this.logger.error('Failed to classify severity:', error);

      // Fallback to medium severity
      const fallbackResult = {
        severity: 'medium',
        confidence: 0.5,
        method: 'fallback',
        rules: []
      };

      this.statistics.byMethod.fallback++;
      this.statistics.bySeverity.medium++;

      return fallbackResult;
    }
  }

  /**
   * Classify using ML model
   */
  async classifyWithML(incidentData) {
    try {
      // Extract features from incident data
      const features = this.extractFeatures(incidentData);

      // Simplified ML prediction (in production, use proper ML library)
      const prediction = this.simplifiedMLPredict(features);

      const severityMap = { 0: 'low', 1: 'medium', 2: 'high', 3: 'critical' };

      return {
        severity: severityMap[prediction.class],
        confidence: prediction.confidence,
        correct: null, // Would be updated after human verification
        method: 'ml'
      };

    } catch (error) {
      this.logger.error('ML classification failed:', error);
      return null;
    }
  }

  /**
   * Classify using rules
   */
  async classifyWithRules(incidentData) {
    const matchedRules = [];
    let totalWeight = 0;
    let matchedWeight = 0;

    // Evaluate each rule
    for (const rule of this.classificationRules) {
      if (this.evaluateRule(rule, incidentData)) {
        matchedRules.push(rule);
        matchedWeight += rule.weight;
      }
      totalWeight += rule.weight;
    }

    if (matchedRules.length === 0) {
      // Default to medium severity if no rules match
      return {
        severity: 'medium',
        confidence: 0.3,
        method: 'rules',
        matchedRules: [],
        score: 0
      };
    }

    // Calculate weighted score
    const score = matchedWeight / totalWeight;

    // Determine severity based on highest weight matched rule
    const highestRule = matchedRules.reduce((prev, current) =>
      current.weight > prev.weight ? current : prev
    );

    return {
      severity: highestRule.severity,
      confidence: Math.min(score, 1.0),
      method: 'rules',
      matchedRules: matchedRules.map(r => r.id),
      score
    };
  }

  /**
   * Evaluate classification rule
   */
  evaluateRule(rule, incidentData) {
    try {
      // All conditions must be met
      for (const condition of rule.conditions) {
        if (!this.evaluateCondition(condition, incidentData)) {
          return false;
        }
      }
      return true;
    } catch (error) {
      this.logger.error(`Error evaluating rule ${rule.id}:`, error);
      return false;
    }
  }

  /**
   * Evaluate single condition
   */
  evaluateCondition(condition, incidentData) {
    const value = this.getNestedValue(incidentData, condition.field);

    switch (condition.operator) {
      case 'equals':
        return value === condition.value;

      case 'not_equals':
        return value !== condition.value;

      case 'contains':
        return Array.isArray(value) ?
          value.includes(condition.value) :
          String(value).toLowerCase().includes(String(condition.value).toLowerCase());

      case 'not_contains':
        return !this.evaluateCondition({ ...condition, operator: 'contains' }, incidentData);

      case 'greaterThan':
        return Number(value) > Number(condition.value);

      case 'lessThan':
        return Number(value) < Number(condition.value);

      case 'greaterThanOrEqual':
        return Number(value) >= Number(condition.value);

      case 'lessThanOrEqual':
        return Number(value) <= Number(condition.value);

      case 'exists':
        return value !== null && value !== undefined;

      case 'not_exists':
        return value === null || value === undefined;

      case 'matches':
        return new RegExp(condition.value).test(String(value));

      default:
        this.logger.warn(`Unknown operator: ${condition.operator}`);
        return false;
    }
  }

  /**
   * Get nested value from object
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : null;
    }, obj);
  }

  /**
   * Extract features for ML classification
   */
  extractFeatures(incidentData) {
    const features = {};

    // Incident type features
    const incidentTypes = ['authentication', 'authorization', 'data', 'system', 'malware', 'dos_attack', 'sql_injection', 'phishing', 'brute_force', 'privilege_escalation', 'unauthorized_access', 'suspicious_activity'];
    incidentTypes.forEach(type => {
      features[`type_${type}`] = incidentData.incidentType === type ? 1 : 0;
    });

    // Severity features
    const severityMap = { low: 1, medium: 2, high: 3, critical: 4 };
    features['severity_numeric'] = severityMap[incidentData.severity] || 0;

    // Source features
    const sources = ['user_reported', 'automated_detection', 'security_monitoring', 'external_alert'];
    sources.forEach(source => {
      features[`source_${source}`] = incidentData.source === source ? 1 : 0;
    });

    // Affected assets count
    if (incidentData.affectedAssets && Array.isArray(incidentData.affectedAssets)) {
      features['affected_assets_count'] = incidentData.affectedAssets.length;
    }

    // Time-based features
    if (incidentData.detectedAt) {
      const hour = new Date(incidentData.detectedAt).getHours();
      const dayOfWeek = new Date(incidentData.detectedAt).getDay();

      features['hour_of_day'] = hour;
      features['day_of_week'] = dayOfWeek;
      features['is_business_hours'] = hour >= 9 && hour <= 17 && dayOfWeek >= 1 && dayOfWeek <= 5 ? 1 : 0;
    }

    // Metadata features
    if (incidentData.metadata) {
      const metadata = incidentData.metadata;

      // Common metadata keys
      ['recordCount', 'userCount', 'systemCount', 'networkCount'].forEach(key => {
        if (metadata[key] !== undefined) {
          features[`metadata_${key}`] = Number(metadata[key]) || 0;
        }
      });

      // Boolean metadata
      ['hasPII', 'isProduction', 'isExternal', 'automatedResponse'].forEach(key => {
        features[`metadata_${key}`] = metadata[key] ? 1 : 0;
      });
    }

    return features;
  }

  /**
   * Simplified ML prediction
   */
  simplifiedMLPredict(features) {
    // This is a very simplified ML implementation
    // In production, use a proper ML library like TensorFlow.js

    // Simple weighted score calculation
    const weights = {
      type_malware: 3,
      type_system_compromise: 3,
      type_privilege_escalation: 3,
      type_data_breach: 3,
      type_sql_injection: 3,
      type_unauthorized_access: 2,
      type_dos_attack: 2,
      type_phishing: 1,
      type_brute_force: 1,
      severity_numeric: 1,
      is_production: 2,
      has_PII: 3,
      affected_assets_count: 0.1,
      metadata_recordCount: 0.001
    };

    let score = 0;
    for (const [feature, value] of Object.entries(features)) {
      if (weights[feature]) {
        score += weights[feature] * value;
      }
    }

    // Normalize score to 0-3 range (low, medium, high, critical)
    const normalizedScore = Math.min(Math.max(score / 10, 0), 3);

    // Add some randomness to simulate ML uncertainty
    const confidence = 0.7 + Math.random() * 0.3;

    return {
      class: Math.round(normalizedScore),
      confidence: confidence
    };
  }

  /**
   * Add training data
   */
  addTrainingData(incidentData, actualSeverity) {
    const features = this.extractFeatures(incidentData);
    const severityMap = { low: 0, medium: 1, high: 2, critical: 3 };

    this.trainingData.push({
      features,
      target: severityMap[actualSeverity],
      timestamp: new Date()
    });

    // Limit training data size
    if (this.trainingData.length > 10000) {
      this.trainingData.shift();
    }

    // Update ML model periodically
    if (this.trainingData.length >= this.config.minTrainingData) {
      this.updateMLModel();
    }
  }

  /**
   * Update ML model
   */
  updateMLModel() {
    try {
      // This is a placeholder for ML model training
      // In production, implement proper model training

      this.mlModel = {
        type: 'simplified',
        trainedAt: new Date(),
        trainingDataSize: this.trainingData.length,
        accuracy: 0.75 // Placeholder
      };

      this.logger.info('ML model updated', {
        trainingDataSize: this.trainingData.length,
        accuracy: this.mlModel.accuracy
      });

    } catch (error) {
      this.logger.error('Failed to update ML model:', error);
    }
  }

  /**
   * Start periodic model updates
   */
  startModelUpdates() {
    setInterval(() => {
      if (this.trainingData.length >= this.config.minTrainingData) {
        this.updateMLModel();
      }
    }, this.config.updateModelFrequency);
  }

  /**
   * Get classification statistics
   */
  getStatistics() {
    const accuracy = this.statistics.totalClassified > 0 ?
      (this.statistics.correctPredictions / this.statistics.totalClassified) * 100 : 0;

    return {
      ...this.statistics,
      accuracy: Math.round(accuracy * 100) / 100,
      trainingDataSize: this.trainingData.length,
      modelEnabled: this.config.enableML,
      rulesCount: this.classificationRules.length
    };
  }

  /**
   * Update classification accuracy
   */
  updateAccuracy(predictedSeverity, actualSeverity) {
    if (predictedSeverity === actualSeverity) {
      this.statistics.correctPredictions++;
    }
  }

  /**
   * Add new classification rule
   */
  addRule(rule) {
    if (!rule.id || !rule.severity || !rule.conditions) {
      throw new Error('Rule must have id, severity, and conditions');
    }

    rule.confidence = rule.confidence || 0.7;
    rule.weight = rule.weight || 5;
    rule.description = rule.description || 'Custom rule';

    this.classificationRules.push(rule);
    this.logger.info(`Added classification rule: ${rule.id}`);
  }

  /**
   * Remove classification rule
   */
  removeRule(ruleId) {
    const index = this.classificationRules.findIndex(r => r.id === ruleId);
    if (index !== -1) {
      this.classificationRules.splice(index, 1);
      this.logger.info(`Removed classification rule: ${ruleId}`);
    }
  }

  /**
   * Get all classification rules
   */
  getRules() {
    return this.classificationRules.map(rule => ({
      id: rule.id,
      severity: rule.severity,
      confidence: rule.confidence,
      weight: rule.weight,
      description: rule.description,
      conditions: rule.conditions
    }));
  }

  /**
   * Reset classifier
   */
  reset() {
    this.trainingData = [];
    this.mlModel = null;
    this.resetStatistics();
  }

  /**
   * Reset statistics
   */
  resetStatistics() {
    this.statistics = {
      totalClassified: 0,
      correctPredictions: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byMethod: { rules: 0, ml: 0, fallback: 0 }
    };
  }
}

module.exports = SeverityClassifier;