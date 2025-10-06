/**
 * User Security Context - Manages security context and permissions for authenticated users
 * Provides role-based access control, security checks, and context-aware security decisions
 */

const EventEmitter = require('events');
const logger = require('../../shared/utils/logger');

class UserSecurityContext extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      defaultSessionTimeout: options.defaultSessionTimeout || 3600000, // 1 hour
      maxConcurrentSessions: options.maxConcurrentSessions || 5,
      sessionSecurityCheckInterval: options.sessionSecurityCheckInterval || 300000, // 5 minutes
      privilegeEscalationThreshold: options.privilegeEscalationThreshold || 0.8,
      contextCacheSize: options.contextCacheSize || 1000,
      ...options
    };

    // User context storage
    this.userContexts = new Map(); // userId -> user security context
    this.sessionContexts = new Map(); // sessionId -> session context
    this.rolePermissions = new Map(); // role -> permissions
    this.userRoles = new Map(); // userId -> roles
    this.privilegeEscalationAttempts = new Map(); // userId -> attempts

    // Security configurations
    this.securityPolicies = new Map(); // policyName -> policy config
    this.securityRules = new Map(); // ruleName -> rule function

    this.isInitialized = false;
    this.securityCheckTimer = null;

    // Initialize default roles and permissions
    this.initializeDefaultRoles();
    this.initializeSecurityPolicies();
    this.initializeSecurityRules();
  }

  /**
   * Initialize the user security context
   */
  async initialize() {
    try {
      logger.info('Initializing User Security Context');

      // Start periodic security checks
      this.startSecurityChecks();

      this.isInitialized = true;
      logger.info('User Security Context initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize User Security Context', { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize default roles and permissions
   */
  initializeDefaultRoles() {
    const defaultRoles = {
      'admin': {
        permissions: [
          'user:create', 'user:read', 'user:update', 'user:delete',
          'security:read', 'security:update', 'security:manage',
          'system:read', 'system:update', 'system:configure',
          'audit:read', 'audit:create', 'audit:export',
          'role:read', 'role:create', 'role:update', 'role:delete',
          'notification:read', 'notification:send', 'notification:manage'
        ],
        level: 100,
        description: 'Full system access'
      },
      'security_admin': {
        permissions: [
          'user:read', 'user:update',
          'security:read', 'security:update', 'security:manage',
          'audit:read', 'audit:create', 'audit:export',
          'notification:read', 'notification:send'
        ],
        level: 80,
        description: 'Security administration access'
      },
      'auditor': {
        permissions: [
          'user:read',
          'security:read',
          'audit:read', 'audit:create', 'audit:export',
          'notification:read'
        ],
        level: 60,
        description: 'Audit and monitoring access'
      },
      'user': {
        permissions: [
          'user:read:own',
          'profile:read:own', 'profile:update:own',
          'notification:read:own', 'notification:manage:own'
        ],
        level: 20,
        description: 'Standard user access'
      },
      'guest': {
        permissions: [
          'public:read'
        ],
        level: 10,
        description: 'Limited guest access'
      }
    };

    for (const [role, config] of Object.entries(defaultRoles)) {
      this.rolePermissions.set(role, config);
    }

    logger.debug('Default roles and permissions initialized', {
      rolesCount: Object.keys(defaultRoles).length
    });
  }

  /**
   * Initialize security policies
   */
  initializeSecurityPolicies() {
    const defaultPolicies = {
      'session_timeout': {
        enabled: true,
        timeout: this.options.defaultSessionTimeout,
        warningThreshold: 0.8,
        description: 'Automatic session timeout policy'
      },
      'max_concurrent_sessions': {
        enabled: true,
        maxSessions: this.options.maxConcurrentSessions,
        action: 'terminate_oldest',
        description: 'Maximum concurrent sessions per user'
      },
      'privilege_escalation_detection': {
        enabled: true,
        threshold: this.options.privilegeEscalationThreshold,
        action: 'alert_and_block',
        description: 'Detect and block privilege escalation attempts'
      },
      'suspicious_activity_detection': {
        enabled: true,
        checkInterval: 60000, // 1 minute
        maxFailedLogins: 5,
        maxAPIRequests: 1000,
        description: 'Detect suspicious user activity'
      },
      'geo_location_verification': {
        enabled: false, // Disabled by default
        action: 'alert',
        description: 'Verify user geographic location'
      },
      'device_verification': {
        enabled: true,
        action: 'alert',
        description: 'Verify user device fingerprint'
      }
    };

    for (const [policyName, config] of Object.entries(defaultPolicies)) {
      this.securityPolicies.set(policyName, config);
    }

    logger.debug('Default security policies initialized', {
      policiesCount: Object.keys(defaultPolicies).length
    });
  }

  /**
   * Initialize security rules
   */
  initializeSecurityRules() {
    // Rule functions for security checks
    const defaultRules = {
      'session_validity': (context) => {
        const now = Date.now();
        const sessionAge = now - context.sessionStartTime;
        const policy = this.securityPolicies.get('session_timeout');

        if (policy && policy.enabled) {
          return sessionAge < policy.timeout;
        }
        return true;
      },

      'user_account_status': (context) => {
        return !context.userLocked && context.userActive;
      },

      'concurrent_sessions': (context) => {
        const policy = this.securityPolicies.get('max_concurrent_sessions');
        if (!policy || !policy.enabled) return true;

        const userSessions = this.getUserSessions(context.userId);
        return userSessions.length <= policy.maxSessions;
      },

      'privilege_level': (context) => {
        const requiredLevel = context.requiredPrivilegeLevel || 0;
        return context.userRoleLevel >= requiredLevel;
      },

      'security_clearance': (context) => {
        const requiredClearance = context.requiredSecurityClearance || 'public';
        return this.hasSecurityClearance(context.userId, requiredClearance);
      },

      'time_based_access': (context) => {
        // Check if user has time-based access restrictions
        const policy = context.timeRestrictions;
        if (!policy) return true;

        const now = new Date();
        const currentHour = now.getHours();
        const currentDay = now.getDay();

        return this.checkTimeAccess(policy, currentHour, currentDay);
      }
    };

    for (const [ruleName, ruleFunction] of Object.entries(defaultRules)) {
      this.securityRules.set(ruleName, ruleFunction);
    }

    logger.debug('Default security rules initialized', {
      rulesCount: Object.keys(defaultRules).length
    });
  }

  /**
   * Create user security context
   */
  async createUserContext(userData, roles = ['user']) {
    try {
      const userId = userData.id || userData.userId;

      // Create user context
      const userContext = {
        userId,
        username: userData.username || userData.email,
        email: userData.email,
        createdAt: Date.now(),
        lastUpdated: Date.now(),

        // Security attributes
        userActive: userData.active !== false,
        userLocked: userData.locked || false,
        riskScore: userData.riskScore || 0.5,
        securityLevel: userData.securityLevel || 'standard',

        // Authentication data
        lastLogin: userData.lastLogin || null,
        lastLoginIP: userData.lastLoginIP || null,
        passwordChangedAt: userData.passwordChangedAt || null,
        twoFactorEnabled: userData.twoFactorEnabled || false,

        // Role and permissions
        roles: Array.isArray(roles) ? roles : [roles],
        permissions: this.getUserPermissions(roles),
        roleLevel: this.getRoleLevel(roles),

        // Access tracking
        loginCount: userData.loginCount || 0,
        failedLogins: userData.failedLogins || 0,
        lastActivity: Date.now(),

        // Security metadata
        knownDevices: new Set(),
        knownIPs: new Set(),
        securityFlags: new Set(),

        // Policies and restrictions
        timeRestrictions: userData.timeRestrictions || null,
        ipRestrictions: userData.ipRestrictions || null,
        deviceRestrictions: userData.deviceRestrictions || null,

        // Audit trail
        accessLog: [],
        securityEvents: []
      };

      // Store user context
      this.userContexts.set(userId, userContext);
      this.userRoles.set(userId, roles);

      logger.info('User security context created', {
        userId,
        roles,
        permissions: userContext.permissions.length
      });

      // Emit event
      this.emit('userContextCreated', {
        userId,
        roles,
        permissions: userContext.permissions
      });

      return userContext;

    } catch (error) {
      logger.error('Error creating user security context', {
        userId: userData.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create session context
   */
  async createSessionContext(userId, sessionData) {
    try {
      const userContext = this.userContexts.get(userId);
      if (!userContext) {
        throw new Error(`User context not found for user: ${userId}`);
      }

      const sessionId = sessionData.sessionId || this.generateSessionId();

      // Create session context
      const sessionContext = {
        sessionId,
        userId,
        sessionStartTime: Date.now(),
        lastActivity: Date.now(),
        expiresAt: Date.now() + this.options.defaultSessionTimeout,

        // Session data
        ipAddress: sessionData.ipAddress,
        userAgent: sessionData.userAgent,
        deviceFingerprint: sessionData.deviceFingerprint,

        // Security attributes
        sessionSecurityLevel: userContext.securityLevel,
        sessionRiskScore: userContext.riskScore,
        securityFlags: new Set(),

        // Access tracking
        requestsCount: 0,
        APIRequestsCount: 0,
        lastRequestTime: Date.now(),

        // Session metadata
        loginMethod: sessionData.loginMethod || 'password',
        twoFactorVerified: sessionData.twoFactorVerified || false,
        location: sessionData.location || null,

        // State
        isActive: true,
        terminatedReason: null
      };

      // Check concurrent session limit
      if (!this.checkConcurrentSessionLimit(userId)) {
        await this.handleConcurrentSessionLimit(userId);
      }

      // Store session context
      this.sessionContexts.set(sessionId, sessionContext);

      // Update user context
      userContext.lastLogin = Date.now();
      userContext.lastActivity = Date.now();
      userContext.loginCount++;
      userContext.knownIPs.add(sessionData.ipAddress);
      if (sessionData.deviceFingerprint) {
        userContext.knownDevices.add(sessionData.deviceFingerprint);
      }

      // Log session creation
      userContext.accessLog.push({
        type: 'session_created',
        timestamp: Date.now(),
        sessionId,
        ipAddress: sessionData.ipAddress,
        userAgent: sessionData.userAgent
      });

      logger.info('Session context created', {
        userId,
        sessionId,
        ipAddress: sessionData.ipAddress
      });

      // Emit event
      this.emit('sessionCreated', {
        userId,
        sessionId,
        ipAddress: sessionData.ipAddress
      });

      return sessionContext;

    } catch (error) {
      logger.error('Error creating session context', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check user permissions
   */
  hasPermission(userId, permission) {
    try {
      const userContext = this.userContexts.get(userId);
      if (!userContext) return false;

      // Check if user is locked
      if (userContext.userLocked) return false;

      // Check if user is active
      if (!userContext.userActive) return false;

      // Check direct permission
      if (userContext.permissions.includes(permission)) return true;

      // Check wildcard permissions
      const permissionParts = permission.split(':');
      for (let i = permissionParts.length - 1; i >= 0; i--) {
        const wildcardPermission = [...permissionParts.slice(0, i), '*'].join(':');
        if (userContext.permissions.includes(wildcardPermission)) return true;
      }

      // Check owner permissions
      if (permission.endsWith(':own') && userContext.permissions.includes(permission.replace(':own', ''))) {
        return true;
      }

      return false;

    } catch (error) {
      logger.error('Error checking user permission', {
        userId,
        permission,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Check user role
   */
  hasRole(userId, role) {
    const userContext = this.userContexts.get(userId);
    if (!userContext) return false;

    return userContext.roles.includes(role);
  }

  /**
   * Check security clearance
   */
  hasSecurityClearance(userId, requiredClearance) {
    const userContext = this.userContexts.get(userId);
    if (!userContext) return false;

    // Clearance levels: public < confidential < secret < top_secret
    const clearanceLevels = {
      'public': 1,
      'confidential': 2,
      'secret': 3,
      'top_secret': 4
    };

    const userClearance = userContext.securityClearance || 'public';
    const userLevel = clearanceLevels[userClearance] || 1;
    const requiredLevel = clearanceLevels[requiredClearance] || 1;

    return userLevel >= requiredLevel;
  }

  /**
   * Perform security check
   */
  async performSecurityCheck(userId, sessionId, context = {}) {
    try {
      const userContext = this.userContexts.get(userId);
      const sessionContext = this.sessionContexts.get(sessionId);

      if (!userContext) {
        return { authorized: false, reason: 'User context not found' };
      }

      if (!sessionContext) {
        return { authorized: false, reason: 'Session context not found' };
      }

      // Prepare check context
      const checkContext = {
        ...context,
        userId,
        sessionId,
        userContext,
        sessionContext,
        userRoleLevel: userContext.roleLevel,
        requiredPrivilegeLevel: context.requiredPrivilegeLevel || 0
      };

      // Execute security rules
      const ruleResults = [];
      for (const [ruleName, ruleFunction] of this.securityRules.entries()) {
        try {
          const result = ruleFunction(checkContext);
          ruleResults.push({ rule: ruleName, passed: result });

          if (!result) {
            logger.warn('Security rule failed', {
              userId,
              sessionId,
              rule: ruleName
            });
          }
        } catch (error) {
          logger.error('Error executing security rule', {
            rule: ruleName,
            error: error.message
          });
          ruleResults.push({ rule: ruleName, passed: false, error: error.message });
        }
      }

      // Check if all rules passed
      const allRulesPassed = ruleResults.every(result => result.passed);
      const failedRules = ruleResults.filter(result => !result.passed);

      // Update session activity
      if (allRulesPassed) {
        sessionContext.lastActivity = Date.now();
        sessionContext.requestsCount++;
        userContext.lastActivity = Date.now();
      }

      const result = {
        authorized: allRulesPassed,
        reason: allRulesPassed ? 'All security checks passed' : 'Security checks failed',
        ruleResults,
        failedRules: failedRules.map(r => r.rule),
        securityLevel: userContext.securityLevel,
        riskScore: userContext.riskScore
      };

      // Log security check
      this.logSecurityCheck(userId, sessionId, result);

      // Emit event
      this.emit('securityCheckPerformed', {
        userId,
        sessionId,
        authorized: allRulesPassed,
        failedRules: failedRules.length
      });

      return result;

    } catch (error) {
      logger.error('Error performing security check', {
        userId,
        sessionId,
        error: error.message
      });

      return {
        authorized: false,
        reason: 'Security check error',
        error: error.message
      };
    }
  }

  /**
   * Update user security context
   */
  async updateUserContext(userId, updates) {
    try {
      const userContext = this.userContexts.get(userId);
      if (!userContext) {
        throw new Error(`User context not found for user: ${userId}`);
      }

      // Apply updates
      const previousData = { ...userContext };
      Object.assign(userContext, updates);
      userContext.lastUpdated = Date.now();

      // Handle role changes
      if (updates.roles) {
        userContext.roles = Array.isArray(updates.roles) ? updates.roles : [updates.roles];
        userContext.permissions = this.getUserPermissions(userContext.roles);
        userContext.roleLevel = this.getRoleLevel(userContext.roles);
        this.userRoles.set(userId, userContext.roles);
      }

      // Log context update
      userContext.accessLog.push({
        type: 'context_updated',
        timestamp: Date.now(),
        updates: Object.keys(updates)
      });

      logger.info('User security context updated', {
        userId,
        updates: Object.keys(updates)
      });

      // Emit event
      this.emit('userContextUpdated', {
        userId,
        previousData,
        updates
      });

      return userContext;

    } catch (error) {
      logger.error('Error updating user security context', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Terminate session
   */
  async terminateSession(sessionId, reason = 'manual') {
    try {
      const sessionContext = this.sessionContexts.get(sessionId);
      if (!sessionContext) {
        logger.warn('Session not found for termination', { sessionId });
        return null;
      }

      const userId = sessionContext.userId;
      const userContext = this.userContexts.get(userId);

      // Update session context
      sessionContext.isActive = false;
      sessionContext.terminatedReason = reason;
      sessionContext.terminatedAt = Date.now();

      // Remove from active sessions
      this.sessionContexts.delete(sessionId);

      // Log session termination
      if (userContext) {
        userContext.accessLog.push({
          type: 'session_terminated',
          timestamp: Date.now(),
          sessionId,
          reason,
          duration: Date.now() - sessionContext.sessionStartTime
        });
      }

      logger.info('Session terminated', {
        userId,
        sessionId,
        reason,
        duration: Date.now() - sessionContext.sessionStartTime
      });

      // Emit event
      this.emit('sessionTerminated', {
        userId,
        sessionId,
        reason
      });

      return sessionContext;

    } catch (error) {
      logger.error('Error terminating session', {
        sessionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Lock user account
   */
  async lockUserAccount(userId, reason = 'security_violation') {
    try {
      const userContext = this.userContexts.get(userId);
      if (!userContext) {
        throw new Error(`User context not found for user: ${userId}`);
      }

      // Update user context
      userContext.userLocked = true;
      userContext.lockReason = reason;
      userContext.lockedAt = Date.now();
      userContext.lastUpdated = Date.now();

      // Add security flag
      userContext.securityFlags.add('account_locked');

      // Log account lock
      userContext.accessLog.push({
        type: 'account_locked',
        timestamp: Date.now(),
        reason
      });

      // Terminate all user sessions
      await this.terminateAllUserSessions(userId, 'account_locked');

      logger.warn('User account locked', {
        userId,
        reason
      });

      // Emit event
      this.emit('userAccountLocked', {
        userId,
        reason
      });

      return userContext;

    } catch (error) {
      logger.error('Error locking user account', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Terminate all user sessions
   */
  async terminateAllUserSessions(userId, reason = 'manual') {
    try {
      const terminatedSessions = [];

      for (const [sessionId, sessionContext] of this.sessionContexts.entries()) {
        if (sessionContext.userId === userId) {
          await this.terminateSession(sessionId, reason);
          terminatedSessions.push(sessionId);
        }
      }

      logger.info('All user sessions terminated', {
        userId,
        terminatedSessions: terminatedSessions.length,
        reason
      });

      return terminatedSessions;

    } catch (error) {
      logger.error('Error terminating all user sessions', {
        userId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Get user permissions from roles
   */
  getUserPermissions(roles) {
    const permissions = new Set();

    for (const role of roles) {
      const roleConfig = this.rolePermissions.get(role);
      if (roleConfig) {
        roleConfig.permissions.forEach(permission => permissions.add(permission));
      }
    }

    return Array.from(permissions);
  }

  /**
   * Get role level
   */
  getRoleLevel(roles) {
    let maxLevel = 0;

    for (const role of roles) {
      const roleConfig = this.rolePermissions.get(role);
      if (roleConfig && roleConfig.level > maxLevel) {
        maxLevel = roleConfig.level;
      }
    }

    return maxLevel;
  }

  /**
   * Get user sessions
   */
  getUserSessions(userId) {
    const sessions = [];

    for (const [sessionId, sessionContext] of this.sessionContexts.entries()) {
      if (sessionContext.userId === userId && sessionContext.isActive) {
        sessions.push(sessionContext);
      }
    }

    return sessions;
  }

  /**
   * Check concurrent session limit
   */
  checkConcurrentSessionLimit(userId) {
    const policy = this.securityPolicies.get('max_concurrent_sessions');
    if (!policy || !policy.enabled) return true;

    const userSessions = this.getUserSessions(userId);
    return userSessions.length < policy.maxSessions;
  }

  /**
   * Handle concurrent session limit
   */
  async handleConcurrentSessionLimit(userId) {
    const policy = this.securityPolicies.get('max_concurrent_sessions');
    if (!policy || !policy.enabled) return;

    const userSessions = this.getUserSessions(userId);
    if (userSessions.length < policy.maxSessions) return;

    // Sort sessions by last activity (oldest first)
    userSessions.sort((a, b) => a.lastActivity - b.lastActivity);

    // Terminate oldest sessions
    const sessionsToTerminate = userSessions.slice(0, userSessions.length - policy.maxSessions + 1);

    for (const session of sessionsToTerminate) {
      await this.terminateSession(session.sessionId, 'concurrent_session_limit');
    }

    logger.info('Concurrent session limit enforced', {
      userId,
      terminatedSessions: sessionsToTerminate.length,
      maxSessions: policy.maxSessions
    });
  }

  /**
   * Check time-based access
   */
  checkTimeAccess(policy, currentHour, currentDay) {
    if (!policy.allowedHours && !policy.allowedDays) return true;

    // Check hour restrictions
    if (policy.allowedHours && !policy.allowedHours.includes(currentHour)) {
      return false;
    }

    // Check day restrictions
    if (policy.allowedDays && !policy.allowedDays.includes(currentDay)) {
      return false;
    }

    return true;
  }

  /**
   * Start periodic security checks
   */
  startSecurityChecks() {
    if (this.securityCheckTimer) {
      clearInterval(this.securityCheckTimer);
    }

    this.securityCheckTimer = setInterval(async () => {
      await this.performPeriodicSecurityChecks();
    }, this.options.sessionSecurityCheckInterval);

    logger.info('Periodic security checks started', {
      interval: this.options.sessionSecurityCheckInterval
    });
  }

  /**
   * Perform periodic security checks
   */
  async performPeriodicSecurityChecks() {
    try {
      const now = Date.now();
      const expiredSessions = [];
      const suspiciousSessions = [];

      // Check for expired sessions
      for (const [sessionId, sessionContext] of this.sessionContexts.entries()) {
        if (now > sessionContext.expiresAt) {
          expiredSessions.push(sessionId);
        }
      }

      // Terminate expired sessions
      for (const sessionId of expiredSessions) {
        await this.terminateSession(sessionId, 'session_expired');
      }

      // Check for suspicious activity
      for (const [sessionId, sessionContext] of this.sessionContexts.entries()) {
        const userContext = this.userContexts.get(sessionContext.userId);
        if (userContext && this.isSuspiciousActivity(userContext, sessionContext)) {
          suspiciousSessions.push(sessionId);
        }
      }

      // Emit periodic check results
      this.emit('periodicSecurityCheckCompleted', {
        timestamp: now,
        expiredSessions: expiredSessions.length,
        suspiciousSessions: suspiciousSessions.length,
        activeSessions: this.sessionContexts.size
      });

    } catch (error) {
      logger.error('Error during periodic security checks', { error: error.message });
    }
  }

  /**
   * Check for suspicious activity
   */
  isSuspiciousActivity(userContext, sessionContext) {
    const now = Date.now();
    const sessionAge = now - sessionContext.sessionStartTime;
    const requestRate = sessionContext.requestsCount / (sessionAge / 1000 / 60); // Requests per minute

    // High request rate
    if (requestRate > 100) {
      return true;
    }

    // Unusual user agent
    if (!userContext.knownDevices.has(sessionContext.deviceFingerprint)) {
      return true;
    }

    // Unusual IP address
    if (!userContext.knownIPs.has(sessionContext.ipAddress)) {
      return true;
    }

    return false;
  }

  /**
   * Log security check
   */
  logSecurityCheck(userId, sessionId, result) {
    const userContext = this.userContexts.get(userId);
    if (userContext) {
      userContext.securityEvents.push({
        type: 'security_check',
        timestamp: Date.now(),
        sessionId,
        authorized: result.authorized,
        reason: result.reason,
        failedRules: result.failedRules
      });

      // Maintain event history size
      if (userContext.securityEvents.length > 100) {
        userContext.securityEvents = userContext.securityEvents.slice(-50);
      }
    }
  }

  /**
   * Generate session ID
   */
  generateSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
  }

  /**
   * Get security statistics
   */
  getStatistics() {
    const now = Date.now();
    const activeSessions = Array.from(this.sessionContexts.values()).filter(s => s.isActive);

    return {
      isInitialized: this.isInitialized,
      totalUsers: this.userContexts.size,
      activeUsers: Array.from(this.userContexts.values()).filter(u => u.userActive).length,
      lockedUsers: Array.from(this.userContexts.values()).filter(u => u.userLocked).length,
      totalSessions: this.sessionContexts.size,
      activeSessions: activeSessions.length,
      averageRiskScore: this.calculateAverageRiskScore(),
      totalRoles: this.rolePermissions.size,
      totalPolicies: this.securityPolicies.size,
      totalRules: this.securityRules.size,
      securityCheckInterval: this.options.sessionSecurityCheckInterval
    };
  }

  /**
   * Calculate average risk score
   */
  calculateAverageRiskScore() {
    if (this.userContexts.size === 0) return 0;

    const totalScore = Array.from(this.userContexts.values())
      .reduce((sum, context) => sum + context.riskScore, 0);

    return totalScore / this.userContexts.size;
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      // Clear timers
      if (this.securityCheckTimer) {
        clearInterval(this.securityCheckTimer);
        this.securityCheckTimer = null;
      }

      // Clear data structures
      this.userContexts.clear();
      this.sessionContexts.clear();
      this.rolePermissions.clear();
      this.userRoles.clear();
      this.privilegeEscalationAttempts.clear();

      this.isInitialized = false;

      logger.info('User Security Context cleaned up');

    } catch (error) {
      logger.error('Error during User Security Context cleanup', { error: error.message });
    }
  }
}

module.exports = UserSecurityContext;