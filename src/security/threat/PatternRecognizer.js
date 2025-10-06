/**
 * Pattern Recognizer - Advanced pattern recognition for security threat detection
 * Identifies attack patterns, malicious behaviors, and security threats using various algorithms
 */

const EventEmitter = require('events');
const logger = require('../../shared/utils/logger');

class PatternRecognizer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      windowSize: options.windowSize || 1000,
      confidenceThreshold: options.confidenceThreshold || 0.7,
      maxPatterns: options.maxPatterns || 1000,
      updateInterval: options.updateInterval || 300000, // 5 minutes
      ...options
    };

    this.patterns = new Map(); // patternId -> pattern definition
    this.activeMatches = new Map(); // patternId -> array of active matches
    this.eventBuffer = []; // Circular buffer for recent events
    this.bufferIndex = 0;
    this.isRunning = false;
    this.updateTimer = null;

    // Initialize built-in security patterns
    this.initializeSecurityPatterns();
  }

  /**
   * Initialize the pattern recognizer
   */
  async initialize() {
    try {
      logger.info('Initializing Pattern Recognizer');

      // Load custom patterns if any
      await this.loadCustomPatterns();

      // Start pattern matching
      this.startPatternMatching();

      logger.info('Pattern Recognizer initialized successfully', {
        patternCount: this.patterns.size
      });
    } catch (error) {
      logger.error('Failed to initialize Pattern Recognizer', { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize built-in security patterns
   */
  initializeSecurityPatterns() {
    // Brute force attack pattern
    this.addPattern({
      id: 'brute_force_login',
      name: 'Brute Force Login Attack',
      description: 'Multiple failed login attempts followed by successful login',
      severity: 'high',
      category: 'authentication',
      windowMs: 300000, // 5 minutes
      conditions: [
        { type: 'event_count', field: 'eventType', value: 'login_failed', operator: '>=', count: 5 },
        { type: 'event_sequence', events: ['login_failed', 'login_success'] }
      ],
      confidence: 0.8
    });

    // Credential stuffing pattern
    this.addPattern({
      id: 'credential_stuffing',
      name: 'Credential Stuffing Attack',
      description: 'Multiple login attempts from different IPs with same username',
      severity: 'high',
      category: 'authentication',
      windowMs: 600000, // 10 minutes
      conditions: [
        { type: 'unique_field_count', field: 'ipAddress', operator: '>=', count: 3 },
        { type: 'same_field_value', field: 'userId' },
        { type: 'event_count', field: 'eventType', value: 'login_failed', operator: '>=', count: 3 }
      ],
      confidence: 0.9
    });

    // Data exfiltration pattern
    this.addPattern({
      id: 'data_exfiltration',
      name: 'Data Exfiltration',
      description: 'Large volume of data access or download in short time',
      severity: 'high',
      category: 'data_loss',
      windowMs: 3600000, // 1 hour
      conditions: [
        { type: 'field_aggregate', field: 'metadata.size', operator: 'sum', value: 100000000 }, // 100MB
        { type: 'event_count', field: 'eventType', value: 'data_access', operator: '>=', count: 10 }
      ],
      confidence: 0.75
    });

    // API abuse pattern
    this.addPattern({
      id: 'api_abuse',
      name: 'API Abuse',
      description: 'High frequency API calls indicating potential abuse',
      severity: 'medium',
      category: 'api_abuse',
      windowMs: 60000, // 1 minute
      conditions: [
        { type: 'event_count', field: 'eventType', value: 'api_access', operator: '>=', count: 100 }
      ],
      confidence: 0.7
    });
  }

  /**
   * Process security event for pattern matching
   */
  processEvent(event) {
    try {
      // Add event to buffer
      this.addToBuffer(event);

      // Check all patterns against current event
      this.checkPatterns(event);

      this.emit('eventProcessed', event);
    } catch (error) {
      logger.error('Error processing event in Pattern Recognizer', {
        eventId: event.id,
        error: error.message
      });
    }
  }

  /**
   * Add event to circular buffer
   */
  addToBuffer(event) {
    if (this.eventBuffer.length < this.options.windowSize) {
      this.eventBuffer.push(event);
    } else {
      this.eventBuffer[this.bufferIndex] = event;
      this.bufferIndex = (this.bufferIndex + 1) % this.options.windowSize;
    }
  }

  /**
   * Check all patterns against event
   */
  checkPatterns(event) {
    for (const [patternId, pattern] of this.patterns.entries()) {
      try {
        const match = this.evaluatePattern(pattern, event);
        if (match && match.confidence >= this.options.confidenceThreshold) {
          this.handlePatternMatch(patternId, pattern, match);
        }
      } catch (error) {
        logger.error('Error evaluating pattern', {
          patternId,
          error: error.message
        });
      }
    }
  }

  /**
   * Evaluate pattern against event
   */
  evaluatePattern(pattern, event) {
    const windowStart = Date.now() - pattern.windowMs;
    const relevantEvents = this.getRelevantEvents(windowStart, pattern);

    let conditionsMet = 0;
    const results = [];

    for (const condition of pattern.conditions) {
      const result = this.evaluateCondition(condition, relevantEvents, event);
      results.push(result);
      if (result.met) {
        conditionsMet++;
      }
    }

    // All conditions must be met for pattern match
    const allConditionsMet = conditionsMet === pattern.conditions.length;

    if (!allConditionsMet) {
      return null;
    }

    // Calculate confidence based on condition strengths
    const avgConditionConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
    const finalConfidence = Math.min(avgConditionConfidence, pattern.confidence);

    return {
      patternId: pattern.id,
      patternName: pattern.name,
      severity: pattern.severity,
      category: pattern.category,
      confidence: finalConfidence,
      timestamp: Date.now(),
      eventCount: relevantEvents.length,
      events: relevantEvents.slice(-10), // Last 10 events for context
      conditions: results
    };
  }

  /**
   * Evaluate individual condition
   */
  evaluateCondition(condition, events, currentEvent) {
    try {
      switch (condition.type) {
        case 'event_count':
          return this.evaluateEventCount(condition, events);
        case 'event_sequence':
          return this.evaluateEventSequence(condition, events);
        case 'unique_field_count':
          return this.evaluateUniqueFieldCount(condition, events);
        case 'same_field_value':
          return this.evaluateSameFieldValue(condition, events);
        case 'field_pattern':
          return this.evaluateFieldPattern(condition, events);
        case 'field_aggregate':
          return this.evaluateFieldAggregate(condition, events);
        default:
          return { met: false, confidence: 0, reason: `Unknown condition type: ${condition.type}` };
      }
    } catch (error) {
      logger.error('Error evaluating condition', {
        conditionType: condition.type,
        error: error.message
      });
      return { met: false, confidence: 0, reason: error.message };
    }
  }

  /**
   * Evaluate event count condition
   */
  evaluateEventCount(condition, events) {
    const matchingEvents = events.filter(e => this.matchesField(e, condition.field, condition.value));
    const count = matchingEvents.length;

    let met = false;
    switch (condition.operator) {
      case '>':
        met = count > condition.count;
        break;
      case '>=':
        met = count >= condition.count;
        break;
      default:
        met = count >= condition.count;
    }

    const confidence = Math.min(count / condition.count, 1);

    return {
      met,
      confidence,
      details: { count, threshold: condition.count, matchingEvents: matchingEvents.length }
    };
  }

  /**
   * Evaluate event sequence condition
   */
  evaluateEventSequence(condition, events) {
    const eventTypes = condition.events;
    if (events.length < eventTypes.length) {
      return { met: false, confidence: 0, reason: 'Not enough events' };
    }

    // Look for the sequence in the events
    for (let i = 0; i <= events.length - eventTypes.length; i++) {
      let sequenceMatched = true;

      for (let j = 0; j < eventTypes.length; j++) {
        if (events[i + j].eventType !== eventTypes[j]) {
          sequenceMatched = false;
          break;
        }
      }

      if (sequenceMatched) {
        return {
          met: true,
          confidence: 0.9,
          details: { sequence: eventTypes, startIndex: i }
        };
      }
    }

    return { met: false, confidence: 0, reason: 'Sequence not found' };
  }

  /**
   * Evaluate unique field count condition
   */
  evaluateUniqueFieldCount(condition, events) {
    const uniqueValues = new Set();

    events.forEach(event => {
      const value = this.getFieldValue(event, condition.field);
      if (value !== undefined) {
        uniqueValues.add(value);
      }
    });

    const count = uniqueValues.size;
    let met = false;

    switch (condition.operator) {
      case '>=':
        met = count >= condition.count;
        break;
      default:
        met = count >= condition.count;
    }

    const confidence = Math.min(count / condition.count, 1);

    return {
      met,
      confidence,
      details: { uniqueCount: count, threshold: condition.count, values: Array.from(uniqueValues) }
    };
  }

  /**
   * Evaluate same field value condition
   */
  evaluateSameFieldValue(condition, events) {
    if (events.length === 0) {
      return { met: false, confidence: 0, reason: 'No events to evaluate' };
    }

    const firstValue = this.getFieldValue(events[0], condition.field);
    if (firstValue === undefined) {
      return { met: false, confidence: 0, reason: 'Field not found' };
    }

    const allSame = events.every(event =>
      this.getFieldValue(event, condition.field) === firstValue
    );

    return {
      met: allSame,
      confidence: allSame ? 0.9 : 0,
      details: { fieldValue: firstValue, eventCount: events.length }
    };
  }

  /**
   * Evaluate field pattern condition
   */
  evaluateFieldPattern(condition, events) {
    const matchingEvents = events.filter(event => {
      const value = this.getFieldValue(event, condition.field);
      return value && condition.pattern.test(value);
    });

    const confidence = events.length > 0 ? matchingEvents.length / events.length : 0;

    return {
      met: matchingEvents.length > 0,
      confidence,
      details: {
        matchingEvents: matchingEvents.length,
        totalEvents: events.length,
        pattern: condition.pattern.toString()
      }
    };
  }

  /**
   * Evaluate field aggregate condition
   */
  evaluateFieldAggregate(condition, events) {
    const values = events
      .map(event => this.getFieldValue(event, condition.field))
      .filter(value => value !== undefined && !isNaN(value));

    if (values.length === 0) {
      return { met: false, confidence: 0, reason: 'No valid values to aggregate' };
    }

    let aggregate;
    switch (condition.operator) {
      case 'sum':
        aggregate = values.reduce((sum, val) => sum + val, 0);
        break;
      default:
        aggregate = values.reduce((sum, val) => sum + val, 0);
    }

    const met = aggregate >= condition.value;
    const confidence = Math.min(aggregate / condition.value, 1);

    return {
      met,
      confidence,
      details: { aggregate, threshold: condition.value, operator: condition.operator, count: values.length }
    };
  }

  /**
   * Get relevant events for pattern evaluation
   */
  getRelevantEvents(windowStart, pattern) {
    return this.eventBuffer.filter(event =>
      event.timestamp >= windowStart &&
      this.isEventRelevantToPattern(event, pattern)
    );
  }

  /**
   * Check if event is relevant to pattern
   */
  isEventRelevantToPattern(event, pattern) {
    // For now, consider all events relevant
    return true;
  }

  /**
   * Check if event field matches condition
   */
  matchesField(event, field, value) {
    const eventValue = this.getFieldValue(event, field);
    return eventValue === value;
  }

  /**
   * Get field value from event
   */
  getFieldValue(event, field) {
    if (!event || !field) return undefined;

    // Support nested field access with dot notation
    const parts = field.split('.');
    let value = event;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Handle pattern match
   */
  handlePatternMatch(patternId, pattern, match) {
    try {
      // Store the match
      if (!this.activeMatches.has(patternId)) {
        this.activeMatches.set(patternId, []);
      }

      const matches = this.activeMatches.get(patternId);
      matches.push(match);

      // Limit matches in memory
      if (matches.length > this.options.maxPatterns) {
        matches.splice(0, matches.length - this.options.maxPatterns);
      }

      // Emit pattern match event
      this.emit('patternMatched', {
        patternId,
        pattern,
        match,
        timestamp: Date.now()
      });

      logger.warn('Security pattern matched', {
        patternId,
        patternName: pattern.name,
        severity: pattern.severity,
        confidence: match.confidence
      });
    } catch (error) {
      logger.error('Error handling pattern match', {
        patternId,
        error: error.message
      });
    }
  }

  /**
   * Add custom pattern
   */
  addPattern(pattern) {
    try {
      // Validate pattern structure
      this.validatePattern(pattern);

      this.patterns.set(pattern.id, pattern);

      logger.debug('Pattern added', {
        patternId: pattern.id,
        name: pattern.name,
        category: pattern.category
      });
    } catch (error) {
      logger.error('Error adding pattern', {
        patternId: pattern.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate pattern structure
   */
  validatePattern(pattern) {
    const requiredFields = ['id', 'name', 'description', 'severity', 'category', 'conditions'];

    for (const field of requiredFields) {
      if (!pattern[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (!Array.isArray(pattern.conditions) || pattern.conditions.length === 0) {
      throw new Error('Pattern must have at least one condition');
    }
  }

  /**
   * Start pattern matching
   */
  startPatternMatching() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.startTime = Date.now();

    this.updateTimer = setInterval(() => {
      this.cleanupOldMatches();
    }, this.options.updateInterval);

    logger.info('Pattern matching started');
  }

  /**
   * Stop pattern matching
   */
  stopPatternMatching() {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }

    logger.info('Pattern matching stopped');
  }

  /**
   * Clean up old matches
   */
  cleanupOldMatches() {
    const cutoffTime = Date.now() - 86400000; // 24 hours ago

    for (const [patternId, matches] of this.activeMatches.entries()) {
      const filteredMatches = matches.filter(match =>
        match.timestamp > cutoffTime
      );

      if (filteredMatches.length !== matches.length) {
        this.activeMatches.set(patternId, filteredMatches);
      }
    }
  }

  /**
   * Load custom patterns from storage
   */
  async loadCustomPatterns() {
    // Implementation would load from database or file
    logger.debug('Custom patterns loaded (using built-in patterns only)');
  }

  /**
   * Get statistics
   */
  getStatistics() {
    const totalPatterns = this.patterns.size;
    const totalMatches = Array.from(this.activeMatches.values())
      .reduce((sum, matches) => sum + matches.length, 0);
    const bufferUtilization = this.eventBuffer.length / this.options.windowSize;

    return {
      totalPatterns,
      totalMatches,
      bufferUtilization,
      isRunning: this.isRunning,
      uptime: this.isRunning ? Date.now() - this.startTime : 0
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.stopPatternMatching();
    this.patterns.clear();
    this.activeMatches.clear();
    this.eventBuffer = [];

    logger.info('Pattern Recognizer cleaned up');
  }
}

module.exports = PatternRecognizer;