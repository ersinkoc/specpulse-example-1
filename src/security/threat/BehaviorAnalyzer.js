/**
 * Behavior Analyzer - ML-based behavioral analysis for security threat detection
 * Implements anomaly detection using user behavior baselines and statistical analysis
 */

const EventEmitter = require('events');
const logger = require('../../shared/utils/logger');
const { calculateBaseline, detectAnomalies } = require('./utils/statisticalAnalysis');

class BehaviorAnalyzer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      windowSize: options.windowSize || 1000, // Number of data points for analysis
      threshold: options.threshold || 2.5, // Standard deviations for anomaly detection
      updateInterval: options.updateInterval || 60000, // 1 minute
      minDataPoints: options.minDataPoints || 50, // Minimum points before analysis
      ...options
    };

    this.behaviorProfiles = new Map(); // userId -> behavior profile
    this.anomalies = new Map(); // userId -> array of anomalies
    this.isRunning = false;
    this.updateTimer = null;
  }

  /**
   * Initialize the behavior analyzer
   */
  async initialize() {
    try {
      logger.info('Initializing Behavior Analyzer', {
        windowSize: this.options.windowSize,
        threshold: this.options.threshold
      });

      // Load existing behavior profiles if any
      await this.loadBehaviorProfiles();

      // Start periodic analysis
      this.startAnalysis();

      logger.info('Behavior Analyzer initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Behavior Analyzer', { error: error.message });
      throw error;
    }
  }

  /**
   * Record a security event for behavioral analysis
   */
  recordEvent(userId, eventType, metadata = {}) {
    try {
      const timestamp = Date.now();
      const event = {
        userId,
        eventType,
        timestamp,
        metadata,
        sessionId: metadata.sessionId || 'unknown',
        ipAddress: metadata.ipAddress || 'unknown',
        userAgent: metadata.userAgent || 'unknown'
      };

      // Store event in user's behavior profile
      const profile = this.getOrCreateProfile(userId);
      profile.events.push(event);

      // Maintain window size
      if (profile.events.length > this.options.windowSize) {
        profile.events = profile.events.slice(-this.options.windowSize);
      }

      // Update session metrics
      this.updateSessionMetrics(profile, event);

      // Emit event for real-time processing
      this.emit('eventRecorded', event);

      return event;
    } catch (error) {
      logger.error('Failed to record behavior event', {
        userId,
        eventType,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get or create behavior profile for user
   */
  getOrCreateProfile(userId) {
    if (!this.behaviorProfiles.has(userId)) {
      this.behaviorProfiles.set(userId, {
        userId,
        events: [],
        sessions: new Map(),
        baselines: {},
        lastAnalyzed: 0,
        createdAt: Date.now()
      });
    }
    return this.behaviorProfiles.get(userId);
  }

  /**
   * Update session metrics for behavior tracking
   */
  updateSessionMetrics(profile, event) {
    const sessionId = event.sessionId;

    if (!profile.sessions.has(sessionId)) {
      profile.sessions.set(sessionId, {
        sessionId,
        userId: event.userId,
        startTime: event.timestamp,
        endTime: event.timestamp,
        eventCount: 0,
        eventTypes: new Set(),
        ipAddresses: new Set(),
        userAgents: new Set(),
        locations: new Set()
      });
    }

    const session = profile.sessions.get(sessionId);
    session.endTime = event.timestamp;
    session.eventCount++;
    session.eventTypes.add(event.eventType);
    session.ipAddresses.add(event.ipAddress);
    session.userAgents.add(event.userAgent);

    if (event.metadata.location) {
      session.locations.add(event.metadata.location);
    }
  }

  /**
   * Start periodic behavioral analysis
   */
  startAnalysis() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.updateTimer = setInterval(() => {
      this.analyzeAllBehaviors();
    }, this.options.updateInterval);

    logger.info('Behavior analysis started', {
      interval: this.options.updateInterval
    });
  }

  /**
   * Stop behavioral analysis
   */
  stopAnalysis() {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }

    logger.info('Behavior analysis stopped');
  }

  /**
   * Analyze behaviors for all users
   */
  async analyzeAllBehaviors() {
    try {
      for (const [userId, profile] of this.behaviorProfiles.entries()) {
        await this.analyzeUserBehavior(userId, profile);
      }
    } catch (error) {
      logger.error('Error in behavioral analysis', { error: error.message });
    }
  }

  /**
   * Analyze behavior for specific user
   */
  async analyzeUserBehavior(userId, profile) {
    try {
      // Skip if not enough data points
      if (profile.events.length < this.options.minDataPoints) {
        return;
      }

      const anomalies = [];

      // Analyze various behavioral patterns
      anomalies.push(...this.analyzeLoginPatterns(userId, profile));
      anomalies.push(...this.analyzeAccessPatterns(userId, profile));
      anomalies.push(...this.analyzeTimePatterns(userId, profile));
      anomalies.push(...this.analyzeLocationPatterns(userId, profile));
      anomalies.push(...this.analyzeDevicePatterns(userId, profile));

      // Update baselines if needed
      this.updateBaselines(profile);

      // Process detected anomalies
      if (anomalies.length > 0) {
        await this.processAnomalies(userId, anomalies);
      }

      profile.lastAnalyzed = Date.now();
    } catch (error) {
      logger.error('Error analyzing user behavior', {
        userId,
        error: error.message
      });
    }
  }

  /**
   * Analyze login patterns for anomalies
   */
  analyzeLoginPatterns(userId, profile) {
    const anomalies = [];
    const loginEvents = profile.events.filter(e => e.eventType === 'login');

    if (loginEvents.length < 5) return anomalies;

    // Check for unusual login times
    const loginHours = loginEvents.map(e => new Date(e.timestamp).getHours());
    const baselineHours = profile.baselines.loginHours || [];

    const timeAnomalies = detectAnomalies(loginHours, baselineHours, {
      threshold: this.options.threshold,
      metric: 'login_time_pattern'
    });

    timeAnomalies.forEach(anomaly => {
      anomalies.push({
        type: 'unusual_login_time',
        severity: 'medium',
        confidence: anomaly.confidence,
        details: {
          userId,
          timestamp: anomaly.value,
          expectedHours: baselineHours,
          deviation: anomaly.deviation
        }
      });
    });

    // Check for rapid successive logins
    const recentLogins = loginEvents.filter(e =>
      Date.now() - e.timestamp < 300000 // Last 5 minutes
    );

    if (recentLogins.length > 5) {
      anomalies.push({
        type: 'rapid_successive_logins',
        severity: 'high',
        confidence: 0.8,
        details: {
          userId,
          loginCount: recentLogins.length,
          timeWindow: '5 minutes'
        }
      });
    }

    return anomalies;
  }

  /**
   * Analyze access patterns for anomalies
   */
  analyzeAccessPatterns(userId, profile) {
    const anomalies = [];
    const accessEvents = profile.events.filter(e =>
      ['api_access', 'resource_access'].includes(e.eventType)
    );

    if (accessEvents.length < 10) return anomalies;

    // Analyze request frequency
    const requestFrequency = this.calculateRequestFrequency(accessEvents);
    const baselineFrequency = profile.baselines.requestFrequency || 0;

    const frequencyRatio = requestFrequency / baselineFrequency;
    if (baselineFrequency > 0 && frequencyRatio > 3) {
      anomalies.push({
        type: 'unusual_access_frequency',
        severity: 'medium',
        confidence: Math.min(frequencyRatio / 5, 1),
        details: {
          userId,
          currentFrequency: requestFrequency,
          baselineFrequency,
          ratio: frequencyRatio
        }
      });
    }

    // Check for unusual resource access patterns
    const resourcePatterns = this.analyzeResourcePatterns(accessEvents);
    if (resourcePatterns.anomalous) {
      anomalies.push({
        type: 'unusual_resource_access',
        severity: 'medium',
        confidence: resourcePatterns.confidence,
        details: resourcePatterns.details
      });
    }

    return anomalies;
  }

  /**
   * Analyze time-based activity patterns
   */
  analyzeTimePatterns(userId, profile) {
    const anomalies = [];
    const recentEvents = profile.events.filter(e =>
      Date.now() - e.timestamp < 86400000 // Last 24 hours
    );

    if (recentEvents.length < 10) return anomalies;

    // Check for activity during unusual hours
    const activeHours = new Set(recentEvents.map(e =>
      new Date(e.timestamp).getHours()
    ));

    const baselineActiveHours = profile.baselines.activeHours || [];
    const unusualHours = [...activeHours].filter(hour =>
      !baselineActiveHours.includes(hour)
    );

    if (unusualHours.length > 0) {
      anomalies.push({
        type: 'unusual_activity_hours',
        severity: 'low',
        confidence: unusualHours.length / 24,
        details: {
          userId,
          unusualHours,
          baselineHours: baselineActiveHours
        }
      });
    }

    return anomalies;
  }

  /**
   * Analyze location patterns for anomalies
   */
  analyzeLocationPatterns(userId, profile) {
    const anomalies = [];
    const eventsWithLocation = profile.events.filter(e =>
      e.metadata && e.metadata.location
    );

    if (eventsWithLocation.length < 5) return anomalies;

    const locations = [...new Set(eventsWithLocation.map(e => e.metadata.location))];
    const baselineLocations = profile.baselines.locations || [];

    // Check for new locations
    const newLocations = locations.filter(loc => !baselineLocations.includes(loc));
    if (newLocations.length > 0) {
      anomalies.push({
        type: 'new_location_access',
        severity: 'medium',
        confidence: 0.7,
        details: {
          userId,
          newLocations,
          knownLocations: baselineLocations,
          eventCount: eventsWithLocation.length
        }
      });
    }

    // Check for impossible travel (multiple locations in short time)
    const impossibleTravel = this.detectImpossibleTravel(eventsWithLocation);
    if (impossibleTravel.detected) {
      anomalies.push({
        type: 'impossible_travel',
        severity: 'high',
        confidence: 0.9,
        details: impossibleTravel.details
      });
    }

    return anomalies;
  }

  /**
   * Analyze device/browser patterns
   */
  analyzeDevicePatterns(userId, profile) {
    const anomalies = [];
    const recentEvents = profile.events.filter(e =>
      Date.now() - e.timestamp < 604800000 // Last 7 days
    );

    if (recentEvents.length < 5) return anomalies;

    const userAgents = [...new Set(recentEvents.map(e => e.userAgent))];
    const baselineUserAgents = profile.baselines.userAgents || [];

    // Check for new devices
    const newUserAgents = userAgents.filter(ua => !baselineUserAgents.includes(ua));
    if (newUserAgents.length > 0) {
      anomalies.push({
        type: 'new_device_access',
        severity: 'medium',
        confidence: 0.6,
        details: {
          userId,
          newDevices: newUserAgents,
          knownDevices: baselineUserAgents
        }
      });
    }

    return anomalies;
  }

  /**
   * Calculate request frequency from events
   */
  calculateRequestFrequency(events) {
    if (events.length < 2) return 0;

    const timeSpan = events[events.length - 1].timestamp - events[0].timestamp;
    return (events.length / timeSpan) * 1000; // Requests per second
  }

  /**
   * Analyze resource access patterns
   */
  analyzeResourcePatterns(events) {
    const resourceAccess = {};

    events.forEach(event => {
      const resource = event.metadata?.resource || 'unknown';
      resourceAccess[resource] = (resourceAccess[resource] || 0) + 1;
    });

    const totalAccess = Object.values(resourceAccess).reduce((a, b) => a + b, 0);
    const entropy = this.calculateEntropy(Object.values(resourceAccess).map(count => count / totalAccess));

    // Low entropy might indicate focused attacks or automation
    if (entropy < 0.5 && totalAccess > 20) {
      return {
        anomalous: true,
        confidence: 1 - entropy,
        details: {
          entropy,
          totalAccess,
          resourceDistribution: resourceAccess
        }
      };
    }

    return { anomalous: false };
  }

  /**
   * Calculate Shannon entropy
   */
  calculateEntropy(probabilities) {
    return -probabilities.reduce((sum, p) => sum + p * Math.log2(p), 0);
  }

  /**
   * Detect impossible travel between locations
   */
  detectImpossibleTravel(eventsWithLocation) {
    const sortedEvents = eventsWithLocation
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-10); // Check last 10 events

    for (let i = 1; i < sortedEvents.length; i++) {
      const prevEvent = sortedEvents[i - 1];
      const currEvent = sortedEvents[i];

      const distance = this.calculateDistance(
        prevEvent.metadata.location,
        currEvent.metadata.location
      );

      const timeDiff = (currEvent.timestamp - prevEvent.timestamp) / 1000 / 3600; // Hours
      const maxSpeed = 1000; // km/h (commercial aircraft)

      if (distance > 0 && timeDiff > 0 && (distance / timeDiff) > maxSpeed) {
        return {
          detected: true,
          details: {
            distance,
            timeDiff,
            speed: distance / timeDiff,
            fromLocation: prevEvent.metadata.location,
            toLocation: currEvent.metadata.location,
            fromTime: new Date(prevEvent.timestamp),
            toTime: new Date(currEvent.timestamp)
          }
        };
      }
    }

    return { detected: false };
  }

  /**
   * Calculate distance between two locations (simplified)
   */
  calculateDistance(loc1, loc2) {
    // Simplified distance calculation
    // In real implementation, use proper geodetic calculations
    if (!loc1 || !loc2 || loc1 === loc2) return 0;

    // Extract coordinates if available, otherwise use city/country comparison
    const coord1 = this.extractCoordinates(loc1);
    const coord2 = this.extractCoordinates(loc2);

    if (coord1 && coord2) {
      // Haversine formula (simplified)
      const R = 6371; // Earth radius in km
      const dLat = (coord2.lat - coord1.lat) * Math.PI / 180;
      const dLon = (coord2.lon - coord1.lon) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(coord1.lat * Math.PI / 180) * Math.cos(coord2.lat * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    }

    // Fallback: return large distance for different locations
    return loc1 !== loc2 ? 500 : 0;
  }

  /**
   * Extract coordinates from location string
   */
  extractCoordinates(location) {
    // Simple regex to extract coordinates from location strings
    // Format: "City, Country" or "City, Country (lat, lon)"
    const coordMatch = location.match(/\(([-\d.]+),\s*([-\d.]+)\)/);
    if (coordMatch) {
      return {
        lat: parseFloat(coordMatch[1]),
        lon: parseFloat(coordMatch[2])
      };
    }
    return null;
  }

  /**
   * Update behavior baselines
   */
  updateBaselines(profile) {
    if (profile.events.length < this.options.minDataPoints) return;

    // Update various baselines
    const loginEvents = profile.events.filter(e => e.eventType === 'login');
    if (loginEvents.length >= 5) {
      profile.baselines.loginHours = this.calculateBaselineHours(loginEvents);
    }

    const activeHours = this.calculateActiveHours(profile.events);
    if (activeHours.length > 0) {
      profile.baselines.activeHours = activeHours;
    }

    const accessEvents = profile.events.filter(e =>
      ['api_access', 'resource_access'].includes(e.eventType)
    );
    if (accessEvents.length >= 10) {
      profile.baselines.requestFrequency = this.calculateRequestFrequency(accessEvents);
    }

    const locations = [...new Set(profile.events
      .filter(e => e.metadata?.location)
      .map(e => e.metadata.location)
    )];
    if (locations.length > 0) {
      profile.baselines.locations = locations;
    }

    const userAgents = [...new Set(profile.events.map(e => e.userAgent))];
    if (userAgents.length > 0) {
      profile.baselines.userAgents = userAgents;
    }
  }

  /**
   * Calculate baseline login hours
   */
  calculateBaselineHours(loginEvents) {
    const hours = loginEvents.map(e => new Date(e.timestamp).getHours());
    const frequency = {};

    hours.forEach(hour => {
      frequency[hour] = (frequency[hour] || 0) + 1;
    });

    // Return hours with frequency above threshold
    const threshold = Math.max(...Object.values(frequency)) * 0.3;
    return Object.keys(frequency)
      .filter(hour => frequency[hour] >= threshold)
      .map(hour => parseInt(hour));
  }

  /**
   * Calculate active hours from events
   */
  calculateActiveHours(events) {
    const hours = new Set();
    events.forEach(event => {
      hours.add(new Date(event.timestamp).getHours());
    });
    return Array.from(hours);
  }

  /**
   * Process detected anomalies
   */
  async processAnomalies(userId, anomalies) {
    try {
      // Store anomalies
      if (!this.anomalies.has(userId)) {
        this.anomalies.set(userId, []);
      }

      const userAnomalies = this.anomalies.get(userId);
      userAnomalies.push(...anomalies);

      // Maintain anomaly history size
      if (userAnomalies.length > 100) {
        userAnomalies.splice(0, userAnomalies.length - 100);
      }

      // Emit anomalies for processing
      anomalies.forEach(anomaly => {
        this.emit('anomalyDetected', {
          userId,
          anomaly,
          timestamp: Date.now()
        });
      });

      logger.warn('Behavior anomalies detected', {
        userId,
        anomalyCount: anomalies.length,
        types: anomalies.map(a => a.type)
      });
    } catch (error) {
      logger.error('Error processing anomalies', {
        userId,
        error: error.message
      });
    }
  }

  /**
   * Get user behavior profile
   */
  getBehaviorProfile(userId) {
    return this.behaviorProfiles.get(userId);
  }

  /**
   * Get user anomalies
   */
  getUserAnomalies(userId, limit = 50) {
    const anomalies = this.anomalies.get(userId) || [];
    return anomalies.slice(-limit);
  }

  /**
   * Get all recent anomalies
   */
  getRecentAnomalies(limit = 100, minSeverity = 'low') {
    const allAnomalies = [];

    for (const [userId, userAnomalies] of this.anomalies.entries()) {
      userAnomalies.forEach(anomaly => {
        if (this.isSeverityAtLeast(anomaly.severity, minSeverity)) {
          allAnomalies.push({
            userId,
            ...anomaly
          });
        }
      });
    }

    return allAnomalies
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limit);
  }

  /**
   * Check if severity meets minimum threshold
   */
  isSeverityAtLeast(severity, minSeverity) {
    const severityLevels = { low: 1, medium: 2, high: 3, critical: 4 };
    return (severityLevels[severity] || 0) >= (severityLevels[minSeverity] || 0);
  }

  /**
   * Load behavior profiles from storage
   */
  async loadBehaviorProfiles() {
    // Implementation would load from database or file
    // For now, initialize empty
    logger.debug('Behavior profiles loaded (initialized empty)');
  }

  /**
   * Save behavior profiles to storage
   */
  async saveBehaviorProfiles() {
    // Implementation would save to database or file
    logger.debug('Behavior profiles saved');
  }

  /**
   * Get statistics
   */
  getStatistics() {
    const totalUsers = this.behaviorProfiles.size;
    const totalEvents = Array.from(this.behaviorProfiles.values())
      .reduce((sum, profile) => sum + profile.events.length, 0);
    const totalAnomalies = Array.from(this.anomalies.values())
      .reduce((sum, anomalies) => sum + anomalies.length, 0);

    return {
      totalUsers,
      totalEvents,
      totalAnomalies,
      isRunning: this.isRunning,
      uptime: this.isRunning ? Date.now() - this.startTime : 0
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.stopAnalysis();
    await this.saveBehaviorProfiles();
    this.behaviorProfiles.clear();
    this.anomalies.clear();

    logger.info('Behavior Analyzer cleaned up');
  }
}

module.exports = BehaviorAnalyzer;