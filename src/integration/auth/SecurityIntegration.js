/**
 * Security Integration - Connects security audit system with authentication system
 * Provides security context, monitoring, and behavioral analysis for authenticated users
 */

const EventEmitter = require('events');
const logger = require('../../shared/utils/logger');

class SecurityIntegration extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      securityScoringEnabled: options.securityScoringEnabled !== false,
      behaviorTrackingEnabled: options.behaviorTrackingEnabled !== false,
      riskAssessmentInterval: options.riskAssessmentInterval || 300000, // 5 minutes
      maxSecurityEvents: options.maxSecurityEvents || 1000,
      sessionTimeout: options.sessionTimeout || 3600000, // 1 hour
      ...options
    };

    // Security context storage
    this.userSecurityContexts = new Map(); // userId -> security context
    this.activeSessions = new Map(); // sessionId -> user session
    this.securityEvents = []; // Circular buffer for security events
    this.riskScores = new Map(); // userId -> risk score

    // Integration components
    this.authService = null;
    this.securityMonitor = null;
    this.behaviorAnalyzer = null;

    this.isInitialized = false;
  }

  /**
   * Initialize security integration
   */
  async initialize(authService, securityMonitor, behaviorAnalyzer) {
    try {
      logger.info('Initializing Security Integration');

      this.authService = authService;
      this.securityMonitor = securityMonitor;
      this.behaviorAnalyzer = behaviorAnalyzer;

      // Set up event listeners
      this.setupEventListeners();

      // Initialize security contexts for existing users
      await this.initializeExistingUserContexts();

      // Start periodic risk assessment
      this.startRiskAssessment();

      this.isInitialized = true;
      logger.info('Security Integration initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize Security Integration', { error: error.message });
      throw error;
    }
  }

  /**
   * Set up event listeners for authentication events
   */
  setupEventListeners() {
    if (!this.authService) return;

    // Listen to authentication events
    this.authService.on('userLogin', this.handleUserLogin.bind(this));
    this.authService.on('userLogout', this.handleUserLogout.bind(this));
    this.authService.on('loginFailed', this.handleLoginFailed.bind(this));
    this.authService.on('passwordChanged', this.handlePasswordChanged.bind(this));
    this.authService.on('accountLocked', this.handleAccountLocked.bind(this));
    this.authService.on('passwordReset', this.handlePasswordReset.bind(this));

    logger.debug('Security integration event listeners set up');
  }

  /**
   * Initialize security contexts for existing users
   */
  async initializeExistingUserContexts() {
    try {
      // In a real implementation, this would query the database for existing users
      // For now, just log that initialization is complete
      logger.debug('Existing user security contexts initialized');
    } catch (error) {
      logger.error('Error initializing existing user contexts', { error: error.message });
    }
  }

  /**
   * Start periodic risk assessment
   */
  startRiskAssessment() {
    if (this.riskAssessmentTimer) {
      clearInterval(this.riskAssessmentTimer);
    }

    this.riskAssessmentTimer = setInterval(async () => {
      await this.performRiskAssessment();
    }, this.options.riskAssessmentInterval);

    logger.info('Security risk assessment started', {
      interval: this.options.riskAssessmentInterval
    });
  }

  /**
   * Handle user login event
   */
  async handleUserLogin(loginData) {
    try {
      const { userId, sessionId, ipAddress, userAgent, timestamp } = loginData;

      logger.info('Security integration: User login detected', {
        userId,
        sessionId,
        ipAddress
      });

      // Create or update user security context
      const securityContext = await this.createOrUpdateSecurityContext(userId, {
        lastLogin: timestamp,
        lastLoginIP: ipAddress,
        lastLoginUserAgent: userAgent,
        loginCount: (this.userSecurityContexts.get(userId)?.loginCount || 0) + 1
      });

      // Create active session
      this.activeSessions.set(sessionId, {
        userId,
        sessionId,
        ipAddress,
        userAgent,
        startTime: timestamp,
        lastActivity: timestamp,
        securityLevel: this.calculateInitialSecurityLevel(securityContext)
      });

      // Record security event
      this.recordSecurityEvent({
        type: 'user_login',
        userId,
        sessionId,
        ipAddress,
        userAgent,
        timestamp,
        severity: 'info',
        context: {
          securityContext: securityContext.riskScore,
          isNewDevice: this.isNewDevice(userId, userAgent, ipAddress)
        }
      });

      // Update risk score
      await this.updateUserRiskScore(userId, 'login', {
        ipAddress,
        userAgent,
        timestamp
      });

      // Emit security event
      this.emit('securityEvent', {
        type: 'user_login',
        userId,
        securityContext,
        riskScore: this.riskScores.get(userId)
      });

    } catch (error) {
      logger.error('Error handling user login in security integration', {
        userId: loginData.userId,
        error: error.message
      });
    }
  }

  /**
   * Handle user logout event
   */
  async handleUserLogout(logoutData) {
    try {
      const { userId, sessionId, timestamp } = logoutData;

      logger.info('Security integration: User logout detected', {
        userId,
        sessionId
      });

      // Remove active session
      const session = this.activeSessions.get(sessionId);
      if (session) {
        this.activeSessions.delete(sessionId);

        // Calculate session duration
        const sessionDuration = timestamp - session.startTime;

        // Update security context
        const securityContext = this.userSecurityContexts.get(userId);
        if (securityContext) {
          securityContext.lastLogout = timestamp;
          securityContext.totalSessionTime = (securityContext.totalSessionTime || 0) + sessionDuration;
          securityContext.averageSessionTime = securityContext.totalSessionTime / securityContext.loginCount;
        }

        // Record security event
        this.recordSecurityEvent({
          type: 'user_logout',
          userId,
          sessionId,
          timestamp,
          severity: 'info',
          context: {
            sessionDuration,
            securityLevel: session.securityLevel
          }
        });
      }

      // Update risk score
      await this.updateUserRiskScore(userId, 'logout', { timestamp });

      // Emit security event
      this.emit('securityEvent', {
        type: 'user_logout',
        userId,
        sessionDuration
      });

    } catch (error) {
      logger.error('Error handling user logout in security integration', {
        userId: logoutData.userId,
        error: error.message
      });
    }
  }

  /**
   * Handle failed login event
   */
  async handleLoginFailed(loginData) {
    try {
      const { userId, username, ipAddress, userAgent, reason, timestamp } = loginData;

      logger.warn('Security integration: Failed login detected', {
        userId: userId || username,
        ipAddress,
        reason
      });

      // Record security event
      this.recordSecurityEvent({
        type: 'login_failed',
        userId: userId || null,
        username,
        ipAddress,
        userAgent,
        timestamp,
        severity: 'warning',
        context: {
          reason,
          suspicious: this.isSuspiciousFailedLogin(ipAddress, username)
        }
      });

      // Update risk score if we have a user ID
      if (userId) {
        await this.updateUserRiskScore(userId, 'failed_login', {
          ipAddress,
          reason,
          timestamp
        });
      }

      // Check for brute force patterns
      await this.checkBruteForcePattern(ipAddress, username, timestamp);

      // Emit security event
      this.emit('securityEvent', {
        type: 'login_failed',
        userId: userId || username,
        ipAddress,
        reason,
        severity: 'warning'
      });

    } catch (error) {
      logger.error('Error handling failed login in security integration', {
        error: error.message
      });
    }
  }

  /**
   * Handle password change event
   */
  async handlePasswordChanged(passwordData) {
    try {
      const { userId, timestamp, ipAddress, userAgent } = passwordData;

      logger.info('Security integration: Password change detected', { userId });

      // Update security context
      const securityContext = this.userSecurityContexts.get(userId);
      if (securityContext) {
        securityContext.lastPasswordChange = timestamp;
        securityContext.passwordChangeIP = ipAddress;
        securityContext.passwordChangeCount = (securityContext.passwordChangeCount || 0) + 1;
      }

      // Record security event
      this.recordSecurityEvent({
        type: 'password_changed',
        userId,
        ipAddress,
        userAgent,
        timestamp,
        severity: 'info',
        context: {
          suspicious: this.isSuspiciousPasswordChange(userId, ipAddress)
        }
      });

      // Reset some risk factors after password change
      await this.resetRiskFactorsAfterPasswordChange(userId);

      // Emit security event
      this.emit('securityEvent', {
        type: 'password_changed',
        userId
      });

    } catch (error) {
      logger.error('Error handling password change in security integration', {
        userId: passwordData.userId,
        error: error.message
      });
    }
  }

  /**
   * Handle account lock event
   */
  async handleAccountLocked(lockData) {
    try {
      const { userId, reason, timestamp, ipAddress } = lockData;

      logger.warn('Security integration: Account locked', {
        userId,
        reason
      });

      // Update security context
      const securityContext = this.userSecurityContexts.get(userId);
      if (securityContext) {
        securityContext.accountLocked = true;
        securityContext.lockReason = reason;
        securityContext.lockTimestamp = timestamp;
        securityContext.lockIP = ipAddress;
      }

      // Record security event
      this.recordSecurityEvent({
        type: 'account_locked',
        userId,
        ipAddress,
        timestamp,
        severity: 'high',
        context: {
          reason,
          requiresIntervention: true
        }
      });

      // Increase risk score significantly
      await this.updateUserRiskScore(userId, 'account_locked', {
        reason,
        ipAddress,
        timestamp
      });

      // Terminate all active sessions for this user
      await this.terminateUserSessions(userId);

      // Emit security event
      this.emit('securityEvent', {
        type: 'account_locked',
        userId,
        reason,
        severity: 'high'
      });

    } catch (error) {
      logger.error('Error handling account lock in security integration', {
        userId: lockData.userId,
        error: error.message
      });
    }
  }

  /**
   * Handle password reset event
   */
  async handlePasswordReset(resetData) {
    try {
      const { userId, timestamp, ipAddress, userAgent } = resetData;

      logger.info('Security integration: Password reset detected', { userId });

      // Record security event
      this.recordSecurityEvent({
        type: 'password_reset',
        userId,
        ipAddress,
        userAgent,
        timestamp,
        severity: 'warning',
        context: {
          suspicious: this.isSuspiciousPasswordReset(userId, ipAddress)
        }
      });

      // Update risk score
      await this.updateUserRiskScore(userId, 'password_reset', {
        ipAddress,
        timestamp
      });

      // Emit security event
      this.emit('securityEvent', {
        type: 'password_reset',
        userId
      });

    } catch (error) {
      logger.error('Error handling password reset in security integration', {
        userId: resetData.userId,
        error: error.message
      });
    }
  }

  /**
   * Create or update user security context
   */
  async createOrUpdateSecurityContext(userId, updates = {}) {
    try {
      let securityContext = this.userSecurityContexts.get(userId);

      if (!securityContext) {
        // Create new security context
        securityContext = {
          userId,
          createdAt: Date.now(),
          riskScore: 0.5, // Neutral risk score
          loginCount: 0,
          failedLogins: 0,
          lastLogin: null,
          lastLoginIP: null,
          lastLoginUserAgent: null,
          lastLogout: null,
          lastPasswordChange: null,
          passwordChangeCount: 0,
          accountLocked: false,
          knownDevices: new Set(),
          knownIPs: new Set(),
          securityLevel: 'standard',
          totalSessionTime: 0,
          averageSessionTime: 0,
          behavioralPatterns: new Map(),
          riskFactors: new Map()
        };
      }

      // Apply updates
      Object.assign(securityContext, updates);

      // Store updated context
      this.userSecurityContexts.set(userId, securityContext);

      return securityContext;

    } catch (error) {
      logger.error('Error creating/updating security context', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Record security event
   */
  recordSecurityEvent(event) {
    try {
      // Add unique ID and timestamp
      const securityEvent = {
        id: this.generateEventId(),
        timestamp: event.timestamp || Date.now(),
        ...event
      };

      // Add to circular buffer
      this.securityEvents.push(securityEvent);

      // Maintain buffer size
      if (this.securityEvents.length > this.options.maxSecurityEvents) {
        this.securityEvents.splice(0, this.securityEvents.length - this.options.maxSecurityEvents);
      }

      // Forward to security monitor if available
      if (this.securityMonitor) {
        this.securityMonitor.processEvent(securityEvent);
      }

      // Forward to behavior analyzer if available
      if (this.behaviorAnalyzer && this.options.behaviorTrackingEnabled) {
        this.behaviorAnalyzer.recordEvent(event.userId || 'anonymous', event.type, event);
      }

    } catch (error) {
      logger.error('Error recording security event', { error: error.message });
    }
  }

  /**
   * Update user risk score
   */
  async updateUserRiskScore(userId, eventType, context = {}) {
    try {
      if (!this.options.securityScoringEnabled) return;

      const currentScore = this.riskScores.get(userId) || 0.5;
      let newScore = currentScore;

      // Calculate risk adjustment based on event type
      const riskAdjustment = this.calculateRiskAdjustment(eventType, context);
      newScore = Math.max(0, Math.min(1, currentScore + riskAdjustment));

      // Apply time-based decay
      newScore = this.applyTimeBasedDecay(userId, newScore);

      // Update stored risk score
      this.riskScores.set(userId, newScore);

      // Update security context
      const securityContext = this.userSecurityContexts.get(userId);
      if (securityContext) {
        securityContext.riskScore = newScore;
        securityContext.securityLevel = this.calculateSecurityLevel(newScore);
      }

      logger.debug('User risk score updated', {
        userId,
        eventType,
        previousScore: currentScore,
        newScore,
        adjustment: riskAdjustment
      });

      // Emit risk score change event
      this.emit('riskScoreChanged', {
        userId,
        previousScore: currentScore,
        newScore,
        eventType,
        securityLevel: this.calculateSecurityLevel(newScore)
      });

    } catch (error) {
      logger.error('Error updating user risk score', {
        userId,
        error: error.message
      });
    }
  }

  /**
   * Calculate risk adjustment based on event type
   */
  calculateRiskAdjustment(eventType, context) {
    const adjustments = {
      'login': 0.0, // Neutral
      'logout': 0.0, // Neutral
      'failed_login': 0.1, // Increase risk
      'password_changed': -0.2, // Decrease risk
      'password_reset': 0.05, // Slight increase
      'account_locked': 0.5, // Significant increase
      'suspicious_activity': 0.3, // Moderate increase
      'security_violation': 0.4 // High increase
    };

    let adjustment = adjustments[eventType] || 0.0;

    // Apply context-based adjustments
    if (context.suspicious) {
      adjustment += 0.1;
    }

    if (eventType === 'failed_login' && context.bruteForce) {
      adjustment += 0.2;
    }

    return adjustment;
  }

  /**
   * Apply time-based decay to risk score
   */
  applyTimeBasedDecay(userId, score) {
    const securityContext = this.userSecurityContexts.get(userId);
    if (!securityContext) return score;

    const now = Date.now();
    const lastActivity = securityContext.lastLogin || securityContext.createdAt;
    const timeSinceActivity = now - lastActivity;

    // Decay rate: 0.1 per day of inactivity
    const daysSinceActivity = timeSinceActivity / (24 * 60 * 60 * 1000);
    const decay = daysSinceActivity * 0.1;

    return Math.max(0.1, score - decay); // Minimum risk score of 0.1
  }

  /**
   * Calculate security level based on risk score
   */
  calculateSecurityLevel(riskScore) {
    if (riskScore >= 0.8) return 'high';
    if (riskScore >= 0.6) return 'elevated';
    if (riskScore >= 0.4) return 'standard';
    if (riskScore >= 0.2) return 'low';
    return 'minimal';
  }

  /**
   * Calculate initial security level for session
   */
  calculateInitialSecurityLevel(securityContext) {
    return this.calculateSecurityLevel(securityContext.riskScore);
  }

  /**
   * Check if device is new for user
   */
  isNewDevice(userId, userAgent, ipAddress) {
    const securityContext = this.userSecurityContexts.get(userId);
    if (!securityContext) return true;

    const deviceKey = `${userAgent}_${ipAddress}`;
    return !securityContext.knownDevices.has(deviceKey);
  }

  /**
   * Check if failed login is suspicious
   */
  isSuspiciousFailedLogin(ipAddress, username) {
    // Count recent failed logins from this IP
    const recentFailures = this.securityEvents.filter(event =>
      event.type === 'login_failed' &&
      event.ipAddress === ipAddress &&
      (Date.now() - event.timestamp) < 3600000 // Last hour
    );

    return recentFailures.length >= 5;
  }

  /**
   * Check for brute force patterns
   */
  async checkBruteForcePattern(ipAddress, username, timestamp) {
    try {
      const recentFailures = this.securityEvents.filter(event =>
        event.type === 'login_failed' &&
        (event.username === username || event.ipAddress === ipAddress) &&
        (timestamp - event.timestamp) < 1800000 // Last 30 minutes
      );

      if (recentFailures.length >= 10) {
        // Emit brute force detection event
        this.emit('bruteForceDetected', {
          ipAddress,
          username,
          failureCount: recentFailures.length,
          timeWindow: '30 minutes',
          severity: 'high'
        });

        // Record security event
        this.recordSecurityEvent({
          type: 'brute_force_detected',
          ipAddress,
          username,
          timestamp,
          severity: 'high',
          context: {
            failureCount: recentFailures.length,
            timeWindow: '30 minutes'
          }
        });
      }
    } catch (error) {
      logger.error('Error checking brute force pattern', { error: error.message });
    }
  }

  /**
   * Check if password change is suspicious
   */
  isSuspiciousPasswordChange(userId, ipAddress) {
    const securityContext = this.userSecurityContexts.get(userId);
    if (!securityContext) return false;

    // Check if password change is from unknown IP
    if (securityContext.knownIPs.size > 0 && !securityContext.knownIPs.has(ipAddress)) {
      return true;
    }

    // Check if password change is too soon after last login
    if (securityContext.lastLogin) {
      const timeSinceLogin = Date.now() - securityContext.lastLogin;
      if (timeSinceLogin < 60000) { // Less than 1 minute
        return true;
      }
    }

    return false;
  }

  /**
   * Check if password reset is suspicious
   */
  isSuspiciousPasswordReset(userId, ipAddress) {
    const securityContext = this.userSecurityContexts.get(userId);
    if (!securityContext) return false;

    // Check for multiple recent password resets
    const recentResets = this.securityEvents.filter(event =>
      event.type === 'password_reset' &&
      event.userId === userId &&
      (Date.now() - event.timestamp) < 86400000 // Last 24 hours
    );

    return recentResets.length >= 2;
  }

  /**
   * Reset risk factors after password change
   */
  async resetRiskFactorsAfterPasswordChange(userId) {
    try {
      const currentScore = this.riskScores.get(userId) || 0.5;
      const resetScore = Math.max(0.3, currentScore - 0.2); // Reduce risk score but not below 0.3

      this.riskScores.set(userId, resetScore);

      // Update security context
      const securityContext = this.userSecurityContexts.get(userId);
      if (securityContext) {
        securityContext.riskScore = resetScore;
        securityContext.securityLevel = this.calculateSecurityLevel(resetScore);
        securityContext.failedLogins = 0; // Reset failed login count
      }

      logger.info('Risk factors reset after password change', {
        userId,
        previousScore: currentScore,
        newScore: resetScore
      });

    } catch (error) {
      logger.error('Error resetting risk factors after password change', {
        userId,
        error: error.message
      });
    }
  }

  /**
   * Terminate all active sessions for user
   */
  async terminateUserSessions(userId) {
    try {
      const terminatedSessions = [];

      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.userId === userId) {
          this.activeSessions.delete(sessionId);
          terminatedSessions.push(sessionId);
        }
      }

      logger.info('User sessions terminated', {
        userId,
        terminatedSessions: terminatedSessions.length
      });

      return terminatedSessions;

    } catch (error) {
      logger.error('Error terminating user sessions', {
        userId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Perform periodic risk assessment
   */
  async performRiskAssessment() {
    try {
      const now = Date.now();
      const riskUpdates = [];

      // Check for inactive sessions
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (now - session.lastActivity > this.options.sessionTimeout) {
          this.activeSessions.delete(sessionId);
          riskUpdates.push({
            type: 'session_timeout',
            userId: session.userId,
            sessionId,
            duration: now - session.startTime
          });
        }
      }

      // Update risk scores for all users
      for (const [userId] of this.userSecurityContexts.keys()) {
        await this.updateUserRiskScore(userId, 'periodic_assessment', { timestamp: now });
      }

      // Emit risk assessment completed event
      this.emit('riskAssessmentCompleted', {
        timestamp: now,
        terminatedSessions: riskUpdates.length,
        activeUsers: this.userSecurityContexts.size,
        activeSessions: this.activeSessions.size
      });

    } catch (error) {
      logger.error('Error during risk assessment', { error: error.message });
    }
  }

  /**
   * Get user security context
   */
  getUserSecurityContext(userId) {
    return this.userSecurityContexts.get(userId);
  }

  /**
   * Get user risk score
   */
  getUserRiskScore(userId) {
    return this.riskScores.get(userId) || 0.5;
  }

  /**
   * Get active sessions
   */
  getActiveSessions(userId = null) {
    const sessions = Array.from(this.activeSessions.values());

    if (userId) {
      return sessions.filter(session => session.userId === userId);
    }

    return sessions;
  }

  /**
   * Get recent security events
   */
  getRecentSecurityEvents(limit = 100, userId = null, eventType = null) {
    let events = [...this.securityEvents].reverse(); // Most recent first

    if (userId) {
      events = events.filter(event => event.userId === userId);
    }

    if (eventType) {
      events = events.filter(event => event.type === eventType);
    }

    return events.slice(0, limit);
  }

  /**
   * Get security statistics
   */
  getStatistics() {
    const now = Date.now();
    const last24Hours = now - 86400000;

    const recentEvents = this.securityEvents.filter(event => event.timestamp > last24Hours);

    return {
      isInitialized: this.isInitialized,
      totalUsers: this.userSecurityContexts.size,
      activeSessions: this.activeSessions.size,
      totalSecurityEvents: this.securityEvents.length,
      recentSecurityEvents: recentEvents.length,
      averageRiskScore: this.calculateAverageRiskScore(),
      highRiskUsers: this.getHighRiskUsers().length,
      lockedAccounts: this.getLockedAccounts().length,
      riskAssessmentInterval: this.options.riskAssessmentInterval,
      securityScoringEnabled: this.options.securityScoringEnabled,
      behaviorTrackingEnabled: this.options.behaviorTrackingEnabled
    };
  }

  /**
   * Calculate average risk score
   */
  calculateAverageRiskScore() {
    if (this.riskScores.size === 0) return 0;

    const totalScore = Array.from(this.riskScores.values()).reduce((sum, score) => sum + score, 0);
    return totalScore / this.riskScores.size;
  }

  /**
   * Get high risk users
   */
  getHighRiskUsers() {
    return Array.from(this.riskScores.entries())
      .filter(([userId, score]) => score >= 0.7)
      .map(([userId]) => userId);
  }

  /**
   * Get locked accounts
   */
  getLockedAccounts() {
    return Array.from(this.userSecurityContexts.entries())
      .filter(([userId, context]) => context.accountLocked)
      .map(([userId]) => userId);
  }

  /**
   * Generate unique event ID
   */
  generateEventId() {
    return `sec_event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      // Clear timers
      if (this.riskAssessmentTimer) {
        clearInterval(this.riskAssessmentTimer);
        this.riskAssessmentTimer = null;
      }

      // Clear data structures
      this.userSecurityContexts.clear();
      this.activeSessions.clear();
      this.securityEvents = [];
      this.riskScores.clear();

      // Remove event listeners
      if (this.authService) {
        this.authService.removeAllListeners();
      }

      this.isInitialized = false;

      logger.info('Security Integration cleaned up');

    } catch (error) {
      logger.error('Error during Security Integration cleanup', { error: error.message });
    }
  }
}

module.exports = SecurityIntegration;