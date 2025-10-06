/**
 * Authentication Event Monitor - Monitors and analyzes authentication events for security threats
 * Provides real-time monitoring, anomaly detection, and security alerting for auth events
 */

const EventEmitter = require('events');
const logger = require('../../shared/utils/logger');

class AuthEventMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      eventBufferSize: options.eventBufferSize || 10000,
      anomalyThreshold: options.anomalyThreshold || 0.8,
      alertThreshold: options.alertThreshold || 0.9,
      monitoringInterval: options.monitoringInterval || 60000, // 1 minute
      maxFailedLoginsPerIP: options.maxFailedLoginsPerIP || 10,
      maxFailedLoginsPerUser: options.maxFailedLoginsPerUser || 5,
      suspiciousActivityWindow: options.suspiciousActivityWindow || 300000, // 5 minutes
      ...options
    };

    // Event storage
    this.authEvents = []; // Circular buffer for auth events
    this.activeMonitors = new Map(); // monitorId -> monitor config
    this.securityAlerts = []; // Circular buffer for security alerts
    this.eventPatterns = new Map(); // patternId -> pattern config

    // Tracking data
    this.ipTracking = new Map(); // ip -> event count and metadata
    this.userTracking = new Map(); // userId -> event count and metadata
    this.geographicTracking = new Map(); // location -> event metadata

    // Analysis data
    this.anomalyDetector = null;
    this.statistics = {
      totalEvents: 0,
      successfulLogins: 0,
      failedLogins: 0,
      accountLocks: 0,
      suspiciousActivities: 0,
      securityAlerts: 0
    };

    this.isRunning = false;
    this.monitoringTimer = null;

    // Initialize default monitors and patterns
    this.initializeDefaultMonitors();
    this.initializeEventPatterns();
  }

  /**
   * Initialize the auth event monitor
   */
  async initialize() {
    try {
      logger.info('Initializing Authentication Event Monitor');

      // Start periodic monitoring
      this.startMonitoring();

      this.isRunning = true;
      logger.info('Authentication Event Monitor initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize Authentication Event Monitor', { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize default security monitors
   */
  initializeDefaultMonitors() {
    const defaultMonitors = [
      {
        id: 'brute_force_detection',
        name: 'Brute Force Attack Detection',
        enabled: true,
        type: 'pattern_based',
        description: 'Detects brute force login attempts',
        config: {
          maxFailedAttempts: this.options.maxFailedLoginsPerIP,
          timeWindow: this.options.suspiciousActivityWindow,
          action: 'alert_and_block'
        }
      },
      {
        id: 'credential_stuffing_detection',
        name: 'Credential Stuffing Detection',
        enabled: true,
        type: 'pattern_based',
        description: 'Detects credential stuffing attacks',
        config: {
          maxFailedAttempts: 20,
          timeWindow: this.options.suspiciousActivityWindow,
          uniqueUserThreshold: 3,
          action: 'alert'
        }
      },
      {
        id: 'geographic_anomaly_detection',
        name: 'Geographic Anomaly Detection',
        enabled: false,
        type: 'behavioral',
        description: 'Detects unusual geographic access patterns',
        config: {
          maxDistanceKm: 1000,
          minTimeDifference: 1800000, // 30 minutes
          action: 'alert'
        }
      },
      {
        id: 'time_based_anomaly_detection',
        name: 'Time-based Anomaly Detection',
        enabled: true,
        type: 'behavioral',
        description: 'Detects unusual login time patterns',
        config: {
          unusualHours: [0, 1, 2, 3, 4, 5],
          frequencyThreshold: 0.1,
          action: 'alert'
        }
      },
      {
        id: 'device_anomaly_detection',
        name: 'Device Anomaly Detection',
        enabled: true,
        type: 'behavioral',
        description: 'Detects new or unusual device access',
        config: {
          newDeviceAlert: true,
          deviceFingerprintRequired: true,
          action: 'alert'
        }
      },
      {
        id: 'account_takeover_detection',
        name: 'Account Takeover Detection',
        enabled: true,
        type: 'behavioral',
        description: 'Detects potential account takeover attempts',
        config: {
          behaviorChangeThreshold: 0.7,
          passwordChangeThreshold: 0.8,
          action: 'alert_and_block'
        }
      }
    ];

    for (const monitor of defaultMonitors) {
      this.activeMonitors.set(monitor.id, monitor);
    }

    logger.debug('Default security monitors initialized', {
      monitorsCount: defaultMonitors.length
    });
  }

  /**
   * Initialize event patterns for detection
   */
  initializeEventPatterns() {
    const defaultPatterns = [
      {
        id: 'rapid_failed_logins',
        name: 'Rapid Failed Logins',
        type: 'sequence',
        description: 'Multiple failed logins in short time',
        pattern: ['login_failed', 'login_failed', 'login_failed'],
        timeWindow: 60000, // 1 minute
        severity: 'high'
      },
      {
        id: 'failed_to_success_pattern',
        name: 'Failed to Success Pattern',
        type: 'sequence',
        description: 'Failed login followed by successful login',
        pattern: ['login_failed', 'login_failed', 'login_success'],
        timeWindow: 300000, // 5 minutes
        severity: 'medium'
      },
      {
        id: 'password_reset_after_failed',
        name: 'Password Reset After Failed Login',
        type: 'sequence',
        description: 'Password reset request after failed login',
        pattern: ['login_failed', 'password_reset'],
        timeWindow: 1800000, // 30 minutes
        severity: 'high'
      },
      {
        id: 'concurrent_sessions',
        name: 'Concurrent Sessions',
        type: 'count_based',
        description: 'Multiple active sessions for same user',
        threshold: 5,
        timeWindow: 3600000, // 1 hour
        severity: 'medium'
      },
      {
        id: 'account_lock_after_failures',
        name: 'Account Lock After Failures',
        type: 'sequence',
        description: 'Account lock after multiple failed attempts',
        pattern: ['login_failed', 'login_failed', 'login_failed', 'account_locked'],
        timeWindow: 600000, // 10 minutes
        severity: 'critical'
      }
    ];

    for (const pattern of defaultPatterns) {
      this.eventPatterns.set(pattern.id, pattern);
    }

    logger.debug('Default event patterns initialized', {
      patternsCount: defaultPatterns.length
    });
  }

  /**
   * Start periodic monitoring
   */
  startMonitoring() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }

    this.monitoringTimer = setInterval(async () => {
      await this.performPeriodicAnalysis();
    }, this.options.monitoringInterval);

    logger.info('Authentication event monitoring started', {
      interval: this.options.monitoringInterval
    });
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }

    this.isRunning = false;
    logger.info('Authentication event monitoring stopped');
  }

  /**
   * Process authentication event
   */
  async processAuthEvent(event) {
    try {
      // Add timestamp if not present
      if (!event.timestamp) {
        event.timestamp = Date.now();
      }

      // Add unique ID
      event.id = this.generateEventId();

      // Store event
      this.addEventToBuffer(event);

      // Update tracking data
      this.updateTrackingData(event);

      // Update statistics
      this.updateStatistics(event);

      // Run real-time monitors
      await this.runRealTimeMonitors(event);

      // Check for patterns
      await this.checkEventPatterns(event);

      // Emit event processed
      this.emit('authEventProcessed', event);

    } catch (error) {
      logger.error('Error processing authentication event', {
        eventId: event.id,
        error: error.message
      });
    }
  }

  /**
   * Add event to circular buffer
   */
  addEventToBuffer(event) {
    this.authEvents.push(event);

    // Maintain buffer size
    if (this.authEvents.length > this.options.eventBufferSize) {
      this.authEvents.splice(0, this.authEvents.length - this.options.eventBufferSize);
    }
  }

  /**
   * Update tracking data
   */
  updateTrackingData(event) {
    const now = event.timestamp;

    // Update IP tracking
    if (event.ipAddress) {
      if (!this.ipTracking.has(event.ipAddress)) {
        this.ipTracking.set(event.ipAddress, {
          firstSeen: now,
          lastSeen: now,
          eventCount: 0,
          eventTypes: new Map(),
          userAgents: new Set(),
          successfulLogins: 0,
          failedLogins: 0,
          uniqueUsers: new Set()
        });
      }

      const ipData = this.ipTracking.get(event.ipAddress);
      ipData.lastSeen = now;
      ipData.eventCount++;
      ipData.eventTypes.set(event.eventType, (ipData.eventTypes.get(event.eventType) || 0) + 1);

      if (event.userAgent) {
        ipData.userAgents.add(event.userAgent);
      }

      if (event.userId) {
        ipData.uniqueUsers.add(event.userId);
      }

      if (event.eventType === 'login_success') {
        ipData.successfulLogins++;
      } else if (event.eventType === 'login_failed') {
        ipData.failedLogins++;
      }
    }

    // Update user tracking
    if (event.userId) {
      if (!this.userTracking.has(event.userId)) {
        this.userTracking.set(event.userId, {
          firstSeen: now,
          lastSeen: now,
          eventCount: 0,
          eventTypes: new Map(),
          ipAddresses: new Set(),
          userAgents: new Set(),
          successfulLogins: 0,
          failedLogins: 0,
          lastLogin: null,
          lastFailedLogin: null,
          consecutiveFailures: 0,
          geographicLocations: new Set()
        });
      }

      const userData = this.userTracking.get(event.userId);
      userData.lastSeen = now;
      userData.eventCount++;
      userData.eventTypes.set(event.eventType, (userData.eventTypes.get(event.eventType) || 0) + 1);

      if (event.ipAddress) {
        userData.ipAddresses.add(event.ipAddress);
      }

      if (event.userAgent) {
        userData.userAgents.add(event.userAgent);
      }

      if (event.eventType === 'login_success') {
        userData.successfulLogins++;
        userData.lastLogin = now;
        userData.consecutiveFailures = 0;
      } else if (event.eventType === 'login_failed') {
        userData.failedLogins++;
        userData.lastFailedLogin = now;
        userData.consecutiveFailures++;
      }

      if (event.location) {
        userData.geographicLocations.add(event.location);
      }
    }

    // Update geographic tracking
    if (event.location) {
      if (!this.geographicTracking.has(event.location)) {
        this.geographicTracking.set(event.location, {
          firstSeen: now,
          lastSeen: now,
          eventCount: 0,
          uniqueUsers: new Set(),
          uniqueIPs: new Set()
        });
      }

      const geoData = this.geographicTracking.get(event.location);
      geoData.lastSeen = now;
      geoData.eventCount++;

      if (event.userId) {
        geoData.uniqueUsers.add(event.userId);
      }

      if (event.ipAddress) {
        geoData.uniqueIPs.add(event.ipAddress);
      }
    }
  }

  /**
   * Update statistics
   */
  updateStatistics(event) {
    this.statistics.totalEvents++;

    switch (event.eventType) {
      case 'login_success':
        this.statistics.successfulLogins++;
        break;
      case 'login_failed':
        this.statistics.failedLogins++;
        break;
      case 'account_locked':
        this.statistics.accountLocks++;
        break;
    }
  }

  /**
   * Run real-time monitors
   */
  async runRealTimeMonitors(event) {
    try {
      for (const [monitorId, monitor] of this.activeMonitors.entries()) {
        if (!monitor.enabled) continue;

        const result = await this.runMonitor(monitor, event);
        if (result.detected) {
          await this.handleSecurityDetection(monitor, result);
        }
      }
    } catch (error) {
      logger.error('Error running real-time monitors', { error: error.message });
    }
  }

  /**
   * Run specific monitor
   */
  async runMonitor(monitor, event) {
    try {
      switch (monitor.type) {
        case 'pattern_based':
          return this.runPatternBasedMonitor(monitor, event);
        case 'behavioral':
          return this.runBehavioralMonitor(monitor, event);
        case 'statistical':
          return this.runStatisticalMonitor(monitor, event);
        default:
          return { detected: false, reason: `Unknown monitor type: ${monitor.type}` };
      }
    } catch (error) {
      logger.error('Error running monitor', {
        monitorId: monitor.id,
        error: error.message
      });
      return { detected: false, error: error.message };
    }
  }

  /**
   * Run pattern-based monitor
   */
  runPatternBasedMonitor(monitor, event) {
    const config = monitor.config;
    let detected = false;
    let details = {};

    switch (monitor.id) {
      case 'brute_force_detection':
        detected = this.detectBruteForce(event.ipAddress, config);
        details = { ipAddress: event.ipAddress, failedAttempts: this.getRecentFailedLogins(event.ipAddress, config.timeWindow) };
        break;

      case 'credential_stuffing_detection':
        detected = this.detectCredentialStuffing(event, config);
        details = { ipAddress: event.ipAddress, failedUsers: this.getUniqueFailedUsers(event.ipAddress, config.timeWindow) };
        break;

      default:
        return { detected: false, reason: 'Unknown pattern-based monitor' };
    }

    return { detected, details, monitor: monitor.id };
  }

  /**
   * Run behavioral monitor
   */
  runBehavioralMonitor(monitor, event) {
    const config = monitor.config;
    let detected = false;
    let details = {};

    switch (monitor.id) {
      case 'geographic_anomaly_detection':
        detected = this.detectGeographicAnomaly(event, config);
        details = { location: event.location, previousLocations: this.getUserPreviousLocations(event.userId) };
        break;

      case 'time_based_anomaly_detection':
        detected = this.detectTimeBasedAnomaly(event, config);
        details = { loginTime: new Date(event.timestamp).getHours(), userHistory: this.getUserLoginTimes(event.userId) };
        break;

      case 'device_anomaly_detection':
        detected = this.detectDeviceAnomaly(event, config);
        details = { deviceFingerprint: event.deviceFingerprint, userDevices: this.getUserDevices(event.userId) };
        break;

      case 'account_takeover_detection':
        detected = this.detectAccountTakeover(event, config);
        details = { userId: event.userId, behaviorChange: this.calculateBehaviorChange(event.userId) };
        break;

      default:
        return { detected: false, reason: 'Unknown behavioral monitor' };
    }

    return { detected, details, monitor: monitor.id };
  }

  /**
   * Run statistical monitor
   */
  runStatisticalMonitor(monitor, event) {
    // Statistical monitor implementation
    return { detected: false, reason: 'Statistical monitor not implemented' };
  }

  /**
   * Detect brute force attacks
   */
  detectBruteForce(ipAddress, config) {
    const recentFailures = this.getRecentFailedLogins(ipAddress, config.timeWindow);
    return recentFailures >= config.maxFailedAttempts;
  }

  /**
   * Detect credential stuffing attacks
   */
  detectCredentialStuffing(event, config) {
    const recentFailures = this.getUniqueFailedUsers(event.ipAddress, config.timeWindow);
    return recentFailures >= config.uniqueUserThreshold;
  }

  /**
   * Detect geographic anomalies
   */
  detectGeographicAnomaly(event, config) {
    if (!event.location) return false;

    const userData = this.userTracking.get(event.userId);
    if (!userData || userData.geographicLocations.size === 0) return false;

    // Check if location is new for user
    return !userData.geographicLocations.has(event.location);
  }

  /**
   * Detect time-based anomalies
   */
  detectTimeBasedAnomaly(event, config) {
    const loginHour = new Date(event.timestamp).getHours();
    const userLoginTimes = this.getUserLoginTimes(event.userId);

    if (userLoginTimes.length < 10) return false; // Not enough data

    // Calculate frequency of login during unusual hours
    const unusualHourLogins = userLoginTimes.filter(hour => config.unusualHours.includes(hour));
    const unusualFrequency = unusualHourLogins.length / userLoginTimes.length;

    return unusualFrequency > config.frequencyThreshold;
  }

  /**
   * Detect device anomalies
   */
  detectDeviceAnomaly(event, config) {
    if (!event.deviceFingerprint) return false;

    const userData = this.userTracking.get(event.userId);
    if (!userData || userData.userAgents.size === 0) return true; // New device

    return !userData.userAgents.has(event.deviceFingerprint);
  }

  /**
   * Detect account takeover
   */
  detectAccountTakeover(event, config) {
    const userData = this.userTracking.get(event.userId);
    if (!userData) return false;

    const behaviorChange = this.calculateBehaviorChange(event.userId);
    return behaviorChange > config.behaviorChangeThreshold;
  }

  /**
   * Get recent failed logins for IP
   */
  getRecentFailedLogins(ipAddress, timeWindow) {
    const now = Date.now();
    const cutoff = now - timeWindow;

    let count = 0;
    for (const event of this.authEvents) {
      if (event.timestamp >= cutoff &&
          event.ipAddress === ipAddress &&
          event.eventType === 'login_failed') {
        count++;
      }
    }

    return count;
  }

  /**
   * Get unique failed users for IP
   */
  getUniqueFailedUsers(ipAddress, timeWindow) {
    const now = Date.now();
    const cutoff = now - timeWindow;
    const uniqueUsers = new Set();

    for (const event of this.authEvents) {
      if (event.timestamp >= cutoff &&
          event.ipAddress === ipAddress &&
          event.eventType === 'login_failed' &&
          event.userId) {
        uniqueUsers.add(event.userId);
      }
    }

    return uniqueUsers.size;
  }

  /**
   * Get user previous locations
   */
  getUserPreviousLocations(userId) {
    const userData = this.userTracking.get(userId);
    return userData ? Array.from(userData.geographicLocations) : [];
  }

  /**
   * Get user login times
   */
  getUserLoginTimes(userId) {
    const userData = this.userTracking.get(userId);
    if (!userData) return [];

    const loginTimes = [];
    for (const event of this.authEvents) {
      if (event.userId === userId && event.eventType === 'login_success') {
        loginTimes.push(new Date(event.timestamp).getHours());
      }
    }

    return loginTimes;
  }

  /**
   * Get user devices
   */
  getUserDevices(userId) {
    const userData = this.userTracking.get(userId);
    return userData ? Array.from(userData.userAgents) : [];
  }

  /**
   * Calculate behavior change
   */
  calculateBehaviorChange(userId) {
    const userData = this.userTracking.get(userId);
    if (!userData) return 0;

    // Simple behavior change calculation based on recent activity
    const now = Date.now();
    const recentWindow = 86400000; // 24 hours
    const cutoff = now - recentWindow;

    let recentEvents = 0;
    let recentFailedLogins = 0;

    for (const event of this.authEvents) {
      if (event.timestamp >= cutoff && event.userId === userId) {
        recentEvents++;
        if (event.eventType === 'login_failed') {
          recentFailedLogins++;
        }
      }
    }

    // Calculate behavior change score
    const failureRate = recentEvents > 0 ? recentFailedLogins / recentEvents : 0;
    const behaviorChange = failureRate * userData.consecutiveFailures;

    return Math.min(1, behaviorChange);
  }

  /**
   * Check event patterns
   */
  async checkEventPatterns(event) {
    try {
      for (const [patternId, pattern] of this.eventPatterns.entries()) {
        const match = await this.checkPattern(pattern, event);
        if (match) {
          await this.handlePatternMatch(pattern, match);
        }
      }
    } catch (error) {
      logger.error('Error checking event patterns', { error: error.message });
    }
  }

  /**
   * Check specific pattern
   */
  async checkPattern(pattern, event) {
    const now = event.timestamp;
    const cutoff = now - pattern.timeWindow;

    // Get recent events
    const recentEvents = this.authEvents.filter(e =>
      e.timestamp >= cutoff &&
      e.eventType === pattern.pattern[0] ||
      e.eventType === pattern.pattern[pattern.pattern.length - 1]
    );

    // Check sequence patterns
    if (pattern.type === 'sequence') {
      return this.checkSequencePattern(pattern, recentEvents);
    }

    // Check count-based patterns
    if (pattern.type === 'count_based') {
      return this.checkCountBasedPattern(pattern, recentEvents);
    }

    return false;
  }

  /**
   * Check sequence pattern
   */
  checkSequencePattern(pattern, events) {
    const requiredSequence = pattern.pattern;
    if (events.length < requiredSequence.length) return false;

    // Look for the sequence in the events
    for (let i = 0; i <= events.length - requiredSequence.length; i++) {
      let sequenceMatched = true;

      for (let j = 0; j < requiredSequence.length; j++) {
        if (events[i + j].eventType !== requiredSequence[j]) {
          sequenceMatched = false;
          break;
        }
      }

      if (sequenceMatched) {
        return {
          patternId: pattern.id,
          patternName: pattern.name,
          severity: pattern.severity,
          events: events.slice(i, i + requiredSequence.length),
          startTime: events[i].timestamp,
          endTime: events[i + requiredSequence.length - 1].timestamp
        };
      }
    }

    return false;
  }

  /**
   * Check count-based pattern
   */
  checkCountBasedPattern(pattern, events) {
    const count = events.length;
    return count >= pattern.threshold ? {
      patternId: pattern.id,
      patternName: pattern.name,
      severity: pattern.severity,
      count,
      threshold: pattern.threshold,
      timeWindow: pattern.timeWindow
    } : false;
  }

  /**
   * Handle security detection
   */
  async handleSecurityDetection(monitor, result) {
    try {
      const alert = {
        id: this.generateAlertId(),
        type: 'security_detection',
        monitorId: monitor.id,
        monitorName: monitor.name,
        severity: this.determineSeverity(monitor, result),
        timestamp: Date.now(),
        details: result.details,
        action: monitor.config.action,
        resolved: false
      };

      // Add to alerts buffer
      this.addAlertToBuffer(alert);

      // Update statistics
      this.statistics.suspiciousActivities++;
      this.statistics.securityAlerts++;

      // Log detection
      logger.warn('Security detection triggered', {
        monitorId: monitor.id,
        monitorName: monitor.name,
        severity: alert.severity,
        details: result.details
      });

      // Emit security detection event
      this.emit('securityDetection', {
        monitor,
        result,
        alert
      });

      // Take action based on monitor configuration
      await this.takeSecurityAction(alert, monitor.config.action);

    } catch (error) {
      logger.error('Error handling security detection', {
        monitorId: monitor.id,
        error: error.message
      });
    }
  }

  /**
   * Handle pattern match
   */
  async handlePatternMatch(pattern, match) {
    try {
      const alert = {
        id: this.generateAlertId(),
        type: 'pattern_match',
        patternId: pattern.id,
        patternName: pattern.name,
        severity: pattern.severity,
        timestamp: Date.now(),
        details: match,
        resolved: false
      };

      // Add to alerts buffer
      this.addAlertToBuffer(alert);

      // Update statistics
      this.statistics.suspiciousActivities++;
      this.statistics.securityAlerts++;

      // Log pattern match
      logger.warn('Security pattern matched', {
        patternId: pattern.id,
        patternName: pattern.name,
        severity: pattern.severity,
        details: match
      });

      // Emit pattern match event
      this.emit('patternMatched', {
        pattern,
        match,
        alert
      });

    } catch (error) {
      logger.error('Error handling pattern match', {
        patternId: pattern.id,
        error: error.message
      });
    }
  }

  /**
   * Take security action
   */
  async takeSecurityAction(alert, action) {
    try {
      switch (action) {
        case 'alert':
          // Just emit the alert
          this.emit('securityAlert', alert);
          break;

        case 'alert_and_block':
          // Emit alert and block
          this.emit('securityAlert', alert);
          this.emit('blockRequest', {
            reason: 'security_detection',
            monitorId: alert.monitorId,
            alertId: alert.id
          });
          break;

        case 'alert_and_terminate':
          // Emit alert and terminate sessions
          this.emit('securityAlert', alert);
          if (alert.details && alert.details.userId) {
            this.emit('terminateSessions', {
              userId: alert.details.userId,
              reason: 'security_detection',
              alertId: alert.id
            });
          }
          break;

        default:
          logger.warn('Unknown security action', { action });
      }

    } catch (error) {
      logger.error('Error taking security action', {
        action,
        error: error.message
      });
    }
  }

  /**
   * Determine severity
   */
  determineSeverity(monitor, result) {
    // Start with monitor's default severity
    let severity = monitor.config.severity || 'medium';

    // Adjust based on result details
    if (result.details && result.details.failedAttempts) {
      if (result.details.failedAttempts > 20) {
        severity = 'critical';
      } else if (result.details.failedAttempts > 10) {
        severity = 'high';
      }
    }

    return severity;
  }

  /**
   * Add alert to circular buffer
   */
  addAlertToBuffer(alert) {
    this.securityAlerts.push(alert);

    // Maintain buffer size
    if (this.securityAlerts.length > 1000) {
      this.securityAlerts.splice(0, this.securityAlerts.length - 1000);
    }
  }

  /**
   * Perform periodic analysis
   */
  async performPeriodicAnalysis() {
    try {
      const now = Date.now();

      // Clean old tracking data
      this.cleanTrackingData(now);

      // Analyze trends
      const trends = this.analyzeTrends();

      // Update anomaly detection
      if (this.anomalyDetector) {
        await this.anomalyDetector.analyze(this.authEvents);
      }

      // Emit periodic analysis results
      this.emit('periodicAnalysisCompleted', {
        timestamp: now,
        trends,
        statistics: this.getStatistics()
      });

    } catch (error) {
      logger.error('Error during periodic analysis', { error: error.message });
    }
  }

  /**
   * Clean old tracking data
   */
  cleanTrackingData(now) {
    const retentionPeriod = 7 * 24 * 60 * 60 * 1000; // 7 days
    const cutoff = now - retentionPeriod;

    // Clean IP tracking
    for (const [ip, data] of this.ipTracking.entries()) {
      if (data.lastSeen < cutoff) {
        this.ipTracking.delete(ip);
      }
    }

    // Clean user tracking
    for (const [userId, data] of this.userTracking.entries()) {
      if (data.lastSeen < cutoff) {
        this.userTracking.delete(userId);
      }
    }

    // Clean geographic tracking
    for (const [location, data] of this.geographicTracking.entries()) {
      if (data.lastSeen < cutoff) {
        this.geographicTracking.delete(location);
      }
    }
  }

  /**
   * Analyze trends
   */
  analyzeTrends() {
    const now = Date.now();
    const lastHour = now - 3600000;
    const last24Hours = now - 86400000;

    const recentEvents = this.authEvents.filter(e => e.timestamp >= lastHour);
    const dailyEvents = this.authEvents.filter(e => e.timestamp >= last24Hours);

    const hourlyTrends = {
      totalEvents: recentEvents.length,
      successfulLogins: recentEvents.filter(e => e.eventType === 'login_success').length,
      failedLogins: recentEvents.filter(e => e.eventType === 'login_failed').length,
      uniqueIPs: new Set(recentEvents.map(e => e.ipAddress)).size,
      uniqueUsers: new Set(recentEvents.map(e => e.userId).filter(Boolean)).size
    };

    const dailyTrends = {
      totalEvents: dailyEvents.length,
      successfulLogins: dailyEvents.filter(e => e.eventType === 'login_success').length,
      failedLogins: dailyEvents.filter(e => e.eventType === 'login_failed').length,
      uniqueIPs: new Set(dailyEvents.map(e => e.ipAddress)).size,
      uniqueUsers: new Set(dailyEvents.map(e => e.userId).filter(Boolean)).size
    };

    return {
      hourly: hourlyTrends,
      daily: dailyTrends
    };
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit = 100, eventType = null, userId = null, ipAddress = null) {
    let events = [...this.authEvents].reverse(); // Most recent first

    if (eventType) {
      events = events.filter(e => e.eventType === eventType);
    }

    if (userId) {
      events = events.filter(e => e.userId === userId);
    }

    if (ipAddress) {
      events = events.filter(e => e.ipAddress === ipAddress);
    }

    return events.slice(0, limit);
  }

  /**
   * Get security alerts
   */
  getSecurityAlerts(limit = 100, severity = null, resolved = null) {
    let alerts = [...this.securityAlerts].reverse(); // Most recent first

    if (severity) {
      alerts = alerts.filter(a => a.severity === severity);
    }

    if (resolved !== null) {
      alerts = alerts.filter(a => a.resolved === resolved);
    }

    return alerts.slice(0, limit);
  }

  /**
   * Get statistics
   */
  getStatistics() {
    return {
      ...this.statistics,
      isRunning: this.isRunning,
      eventBufferSize: this.authEvents.length,
      alertBufferSize: this.securityAlerts.length,
      activeMonitors: Array.from(this.activeMonitors.values()).filter(m => m.enabled).length,
      totalMonitors: this.activeMonitors.size,
      trackingData: {
        ipAddresses: this.ipTracking.size,
        users: this.userTracking.size,
        locations: this.geographicTracking.size
      },
      monitoringInterval: this.options.monitoringInterval
    };
  }

  /**
   * Generate event ID
   */
  generateEventId() {
    return `auth_event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate alert ID
   */
  generateAlertId() {
    return `auth_alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      // Stop monitoring
      this.stopMonitoring();

      // Clear data structures
      this.authEvents = [];
      this.activeMonitors.clear();
      this.securityAlerts = [];
      this.eventPatterns.clear();
      this.ipTracking.clear();
      this.userTracking.clear();
      this.geographicTracking.clear();

      // Reset statistics
      this.statistics = {
        totalEvents: 0,
        successfulLogins: 0,
        failedLogins: 0,
        accountLocks: 0,
        suspiciousActivities: 0,
        securityAlerts: 0
      };

      this.isInitialized = false;

      logger.info('Authentication Event Monitor cleaned up');

    } catch (error) {
      logger.error('Error during Authentication Event Monitor cleanup', { error: error.message });
    }
  }
}

module.exports = AuthEventMonitor;