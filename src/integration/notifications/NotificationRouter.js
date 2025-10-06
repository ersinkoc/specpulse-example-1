/**
 * Notification Router - Routes security notifications to appropriate channels and recipients
 * Implements intelligent routing based on severity, type, and user preferences
 */

const EventEmitter = require('events');
const logger = require('../../shared/utils/logger');

class NotificationRouter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      defaultRoutingEnabled: options.defaultRoutingEnabled !== false,
      userPreferenceEnabled: options.userPreferenceEnabled !== false,
      escalationEnabled: options.escalationEnabled !== false,
      escalationDelay: options.escalationDelay || 300000, // 5 minutes
      maxEscalationLevel: options.maxEscalationLevel || 3,
      routingRules: options.routingRules || [],
      ...options
    };

    // Routing configuration
    this.routingRules = [];
    this.escalationRules = [];
    this.userPreferences = new Map(); // userId -> user notification preferences
    this.channelPriorities = new Map(); // channel -> priority level

    // Routing cache
    this.routingCache = new Map(); // cacheKey -> routing decision
    this.cacheTimeout = options.cacheTimeout || 300000; // 5 minutes

    // Statistics
    this.statistics = {
      totalRouted: 0,
      routingCacheHits: 0,
      escalations: 0,
      userPreferenceOverrides: 0,
      ruleMatches: new Map()
    };

    this.isInitialized = false;

    // Initialize default routing rules
    this.initializeDefaultRoutingRules();
    this.initializeDefaultEscalationRules();
    this.initializeChannelPriorities();
  }

  /**
   * Initialize the notification router
   */
  async initialize() {
    try {
      logger.info('Initializing Notification Router');

      this.isInitialized = true;
      logger.info('Notification Router initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize Notification Router', { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize default routing rules
   */
  initializeDefaultRoutingRules() {
    const defaultRules = [
      {
        id: 'severity_based_routing',
        name: 'Severity-based Routing',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'severity', operator: 'exists' }
        ],
        actions: {
          'critical': ['websocket', 'email', 'sms', 'slack', 'webhook'],
          'high': ['websocket', 'email', 'slack', 'webhook'],
          'medium': ['email', 'slack'],
          'low': ['email'],
          'info': ['websocket']
        },
        description: 'Route notifications based on severity level'
      },
      {
        id: 'type_based_routing',
        name: 'Type-based Routing',
        enabled: true,
        priority: 2,
        conditions: [
          { field: 'type', operator: 'exists' }
        ],
        actions: {
          'security_breach': ['websocket', 'email', 'sms', 'slack', 'webhook'],
          'brute_force': ['websocket', 'email', 'slack', 'webhook'],
          'malware': ['websocket', 'email', 'sms', 'webhook'],
          'vulnerability': ['email', 'slack'],
          'suspicious_activity': ['websocket', 'email', 'slack'],
          'privilege_escalation': ['websocket', 'email', 'slack', 'webhook'],
          'account_security': ['websocket', 'email', 'sms'],
          'system_anomaly': ['email', 'slack'],
          'api_abuse': ['websocket', 'email', 'slack', 'webhook'],
          'compliance': ['email', 'slack', 'webhook'],
          'data_access': ['email', 'slack', 'webhook'],
          'incident_management': ['websocket', 'email', 'slack'],
          'scan_result': ['email'],
          'system_update': ['email']
        },
        description: 'Route notifications based on event type'
      },
      {
        id: 'user_based_routing',
        name: 'User-based Routing',
        enabled: this.options.userPreferenceEnabled,
        priority: 3,
        conditions: [
          { field: 'userId', operator: 'exists' }
        ],
        actions: 'use_preferences',
        description: 'Route notifications based on user preferences'
      },
      {
        id: 'time_based_routing',
        name: 'Time-based Routing',
        enabled: true,
        priority: 4,
        conditions: [
          { field: 'timestamp', operator: 'exists' }
        ],
        actions: {
          'business_hours': ['websocket', 'email'],
          'after_hours': ['email', 'sms'],
          'weekend': ['email', 'sms']
        },
        description: 'Route notifications based on time of day'
      },
      {
        id: 'location_based_routing',
        name: 'Location-based Routing',
        enabled: false,
        priority: 5,
        conditions: [
          { field: 'location', operator: 'exists' }
        ],
        actions: {
          'office': ['websocket', 'email'],
          'remote': ['websocket', 'email', 'sms']
        },
        description: 'Route notifications based on user location'
      },
      {
        id: 'role_based_routing',
        name: 'Role-based Routing',
        enabled: true,
        priority: 6,
        conditions: [
          { field: 'userRole', operator: 'exists' }
        ],
        actions: {
          'admin': ['websocket', 'email', 'slack', 'webhook'],
          'security_admin': ['websocket', 'email', 'slack', 'webhook'],
          'auditor': ['email', 'slack'],
          'user': ['email'],
          'guest': []
        },
        description: 'Route notifications based on user role'
      }
    ];

    for (const rule of defaultRules) {
      this.routingRules.push(rule);
    }

    logger.debug('Default routing rules initialized', {
      rulesCount: defaultRules.length
    });
  }

  /**
   * Initialize default escalation rules
   */
  initializeDefaultEscalationRules() {
    const defaultRules = [
      {
        id: 'severity_escalation',
        name: 'Severity-based Escalation',
        enabled: this.options.escalationEnabled,
        priority: 1,
        conditions: [
          { field: 'severity', operator: 'equals', value: 'critical' },
          { field: 'acknowledged', operator: 'equals', value: false },
          { field: 'escalationLevel', operator: '<', value: this.options.maxEscalationLevel }
        ],
        actions: [
          'increase_escalation_level',
          'notify_escalation_team',
          'include_additional_recipients'
        ],
        description: 'Escalate critical notifications if not acknowledged'
      },
      {
        id: 'time_based_escalation',
        name: 'Time-based Escalation',
        enabled: this.options.escalationEnabled,
        priority: 2,
        conditions: [
          { field: 'timestamp', operator: 'exists' },
          { field: 'acknowledged', operator: 'equals', value: false },
          { field: 'timeSinceCreation', operator: '>', value: this.options.escalationDelay }
        ],
        actions: [
          'increase_escalation_level',
          'notify_escalation_team',
          'include_manager'
        ],
        description: 'Escalate notifications if not acknowledged within time window'
      },
      {
        id: 'failure_escalation',
        name: 'Failure-based Escalation',
        enabled: this.options.escalationEnabled,
        priority: 3,
        conditions: [
          { field: 'deliveryAttempts', operator: '>', value: 3 },
          { field: 'deliveryStatus', operator: 'equals', value: 'failed' },
          { field: 'escalationLevel', operator: '<', value: this.options.maxEscalationLevel }
        ],
        actions: [
          'increase_escalation_level',
          'investigate_delivery_failure',
          'notify_admin'
        ],
        description: 'Escalate notifications after delivery failures'
      }
    ];

    for (const rule of defaultRules) {
      this.escalationRules.push(rule);
    }

    logger.debug('Default escalation rules initialized', {
      rulesCount: defaultRules.length
    });
  }

  /**
   * Initialize channel priorities
   */
  initializeChannelPriorities() {
    const priorities = {
      'websocket': 1,      // Fastest, real-time
      'sms': 2,           // Fast, direct
      'slack': 3,          // Fast, team collaboration
      'email': 4,          // Reliable, documented
      'webhook': 5         // Custom integration
    };

    for (const [channel, priority] of Object.entries(priorities)) {
      this.channelPriorities.set(channel, priority);
    }

    logger.debug('Channel priorities initialized', {
      prioritiesCount: Object.keys(priorities).length
    });
  }

  /**
   * Route notification to appropriate channels
   */
  async routeNotification(notification) {
    try {
      // Check cache first
      const cacheKey = this.generateCacheKey(notification);
      if (this.routingCache.has(cacheKey)) {
        const cached = this.routingCache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.options.cacheTimeout) {
          this.statistics.routingCacheHits++;
          return cached.routingDecision;
        } else {
          this.routingCache.delete(cacheKey);
        }
      }

      // Start with default channels
      let channels = this.getDefaultChannels(notification);

      // Apply routing rules
      for (const rule of this.routingRules) {
        if (!rule.enabled) continue;

        if (this.evaluateConditions(rule.conditions, notification)) {
          channels = this.applyRuleActions(rule, channels, notification);
        }
      }

      // Apply user preferences if enabled
      if (this.options.userPreferenceEnabled && notification.userId) {
        channels = this.applyUserPreferences(channels, notification);
      }

      // Sort channels by priority
      channels = this.sortChannelsByPriority(channels);

      // Cache routing decision
      this.routingCache.set(cacheKey, {
        routingDecision: channels,
        timestamp: Date.now()
      });

      // Update statistics
      this.statistics.totalRouted++;
      for (const rule of this.routingRules) {
        if (rule.enabled && this.evaluateConditions(rule.conditions, notification)) {
          const ruleMatches = this.statistics.ruleMatches.get(rule.id) || 0;
          this.statistics.ruleMatches.set(rule.id, ruleMatches + 1);
        }
      }

      // Emit routing completed event
      this.emit('notificationRouted', {
        notificationId: notification.id,
        channels,
        routingMethod: 'default',
        cacheHit: false
      });

      return channels;

    } catch (error) {
      logger.error('Error routing notification', {
        notificationId: notification.id,
        error: error.message
      });

      // Return default channels as fallback
      return this.getDefaultChannels(notification);
    }
  }

  /**
   * Get default channels for notification
   */
  getDefaultChannels(notification) {
    const channels = [];

    // Always include WebSocket for real-time notifications
    if (this.options.enableWebSocket) {
      channels.push('websocket');
    }

    // Add email for most notifications
    if (this.options.enableEmail) {
      channels.push('email');
    }

    // Add SMS for critical notifications
    if (this.options.enableSMS && ['critical', 'high'].includes(notification.severity)) {
      channels.push('sms');
    }

    // Add Slack for team notifications
    if (this.options.enableSlack && ['critical', 'high', 'medium'].includes(notification.severity)) {
      channels.push('slack');
    }

    // Add webhook for integrations
    if (this.options.enableWebhook) {
      channels.push('webhook');
    }

    return Array.from(new Set(channels)); // Remove duplicates
  }

  /**
   * Apply rule actions to channels
   */
  applyRuleActions(rule, currentChannels, notification) {
    const actions = rule.actions;

    if (typeof actions === 'string' && actions === 'use_preferences') {
      // This will be handled by user preferences
      return currentChannels;
    }

    if (Array.isArray(actions)) {
      return Array.from(new Set([...currentChannels, ...actions]));
    }

    if (typeof actions === 'object') {
      // Handle conditional actions
      for (const [condition, channels] of Object.entries(actions)) {
        if (this.evaluateCondition(condition, notification)) {
          return Array.from(new Set([...currentChannels, ...channels]));
        }
      }
    }

    return currentChannels;
  }

  /**
   * Apply user preferences to channels
   */
  applyUserPreferences(channels, notification) {
    const userPreferences = this.userPreferences.get(notification.userId);
    if (!userPreferences) {
      return channels;
    }

    // Remove channels that user has disabled
    const enabledChannels = channels.filter(channel =>
      !userPreferences.disabledChannels || !userPreferences.disabledChannels.includes(channel)
    );

    // Add channels that user has explicitly enabled
    if (userPreferences.enabledChannels) {
      enabledChannels.push(...userPreferences.enabledChannels);
    }

    // Apply frequency preferences
    if (userPreferences.frequency) {
      return this.applyFrequencyPreferences(enabledChannels, userPreferences.frequency, notification);
    }

    // Apply quiet hours
    if (userPreferences.quietHours) {
      enabledChannels = this.applyQuietHours(enabledChannels, userPreferences.quietHours, notification);
    }

    return Array.from(new Set(enabledChannels));
  }

  /**
   * Apply frequency preferences
   */
  applyFrequencyPreferences(channels, frequency, notification) {
    const now = new Date();
    const currentHour = now.getHours();

    if (frequency.high && !['critical', 'high'].includes(notification.severity)) {
      // High frequency: only critical/high severity
      return channels.filter(channel => ['websocket', 'sms'].includes(channel));
    }

    if (frequency.low && notification.severity === 'info') {
      // Low frequency: no real-time channels for info
      return channels.filter(channel => !['websocket'].includes(channel));
    }

    return channels;
  }

  /**
   * Apply quiet hours
   */
  applyQuietHours(channels, quietHours, notification) {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    if (quietHours.enabled &&
        ((quietHours.days && quietHours.days.includes(currentDay)) ||
         (quietHours.start && quietHours.end &&
          (currentHour < quietHours.start || currentHour > quietHours.end)))) {

      // During quiet hours, disable real-time notifications
      return channels.filter(channel => !['websocket'].includes(channel));
    }

    return channels;
  }

  /**
   * Sort channels by priority
   */
  sortChannelsByPriority(channels) {
    return channels.sort((a, b) => {
      const priorityA = this.channelPriorities.get(a) || 999;
      const priorityB = this.channelPriorities.get(b) || 999;
      return priorityA - priorityB;
    });
  }

  /**
   * Evaluate routing conditions
   */
  evaluateConditions(conditions, notification) {
    if (!Array.isArray(conditions)) return false;

    return conditions.every(condition => this.evaluateCondition(condition, notification));
  }

  /**
   * Evaluate single condition
   */
  evaluateCondition(condition, notification) {
    const { field, operator, value } = condition;

    const fieldValue = this.getFieldValue(notification, field);
    if (fieldValue === null) return false;

    switch (operator) {
      case 'exists':
        return fieldValue !== null && fieldValue !== undefined;
      case 'equals':
        return fieldValue === value;
      case 'not_equals':
        return fieldValue !== value;
      case 'greater_than':
        return Number(fieldValue) > Number(value);
      'less_than':
        return Number(fieldValue) < Number(value);
      'greater_than_equal':
        return Number(fieldValue) >= Number(value);
      'less_than_equal':
        return Number(fieldValue) <= Number(value);
      'includes':
        return Array.isArray(value) ? value.includes(fieldValue) : String(fieldValue).includes(String(value));
      'not_includes':
        return Array.isArray(value) ? !value.includes(fieldValue) : !String(fieldValue).includes(String(value));
      'regex':
        return new RegExp(value).test(String(fieldValue));
      'in_time_range':
        return this.isInTimeRange(fieldValue, value);
      default:
        return false;
    }
  }

  /**
   * Get field value from notification
   */
  getFieldValue(notification, field) {
    if (!notification || !field) return null;

    // Support nested field access with dot notation
    const parts = field.split('.');
    let value = notification;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return null;
      }
    }

    return value;
  }

  /**
   * Check if timestamp is in time range
   */
  isInTimeRange(timestamp, timeRange) {
    if (!timeRange.start || !timeRange.end) return false;

    const ts = new Date(timestamp);
    const start = new Date(timeRange.start);
    const end = new Date(timeRange.end);

    return ts >= start && ts <= end;
  }

  /**
   * Escalate notification if conditions are met
   */
  async escalateNotification(notification) {
    try {
      let escalationLevel = notification.escalationLevel || 0;
      let escalated = false;

      // Check escalation rules
      for (const rule of this.escalationRules) {
        if (!rule.enabled) continue;

        if (this.evaluateConditions(rule.conditions, notification)) {
          escalationLevel = Math.min(escalationLevel + 1, this.options.maxEscalationLevel);
          escalated = true;

          // Apply escalation actions
          await this.applyEscalationActions(rule, notification, escalationLevel);

          this.statistics.escalations++;
          logger.info('Notification escalated', {
            notificationId: notification.id,
            ruleId: rule.id,
            escalationLevel,
            reason: rule.name
          });
        }
      }

      // Update notification with escalation level
      if (escalated) {
        notification.escalationLevel = escalationLevel;
        notification.escalatedAt = Date.now();

        this.emit('notificationEscalated', {
          notificationId: notification.id,
          escalationLevel,
          rules: this.escalationRules.filter(r => r.enabled && this.evaluateConditions(r.conditions, notification))
        });

        // Update cache
        const cacheKey = this.generateCacheKey(notification);
        if (this.routingCache.has(cacheKey)) {
          this.routingCache.delete(cacheKey);
        }
      }

      return escalated;

    } catch (error) {
      logger.error('Error escalating notification', {
        notificationId: notification.id,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Apply escalation actions
   */
  async applyEscalationActions(rule, notification, escalationLevel) {
    const actions = rule.actions;

    for (const action of actions) {
      switch (action) {
        case 'increase_escalation_level':
          // Handled in escalation method
          break;

        case 'notify_escalation_team':
          await this.notifyEscalationTeam(notification, escalationLevel);
          break;

        case 'include_additional_recipients':
          await this.includeAdditionalRecipients(notification);
          break;

        case 'include_manager':
          await this.includeManager(notification);
          break;

        case 'investigate_delivery_failure':
          await this.investigateDeliveryFailure(notification);
          break;

        case 'notify_admin':
          await this.notifyAdmin(notification);
          break;

        default:
          logger.warn('Unknown escalation action', { action });
      }
    }
  }

  /**
   * Notify escalation team
   */
  async notifyEscalationTeam(notification, escalationLevel) {
    this.emit('escalationTeamNotified', {
      notificationId: notification.id,
      escalationLevel,
      severity: notification.severity,
      title: notification.title
    });
  }

  /**
   * Include additional recipients
   */
  async includeAdditionalRecipients(notification) {
    this.emit('additionalRecipientsIncluded', {
      notificationId: notification.id
    });
  }

  /**
   * Include manager
   */
  async includeManager(notification) {
    this.emit('managerIncluded', {
      notificationId: notification.id
    });
  }

  /**
   * Investigate delivery failure
   */
  async investigateDeliveryFailure(notification) {
    this.emit('deliveryFailureInvestigation', {
      notificationId: notification.id,
      deliveryAttempts: notification.deliveryAttempts
    });
  }

  /**
   * Notify admin
   */
  async notifyAdmin(notification) {
    this.emit('adminNotified', {
      notificationId: notification.id
    });
  }

  /**
   * Set user preferences
   */
  setUserPreferences(userId, preferences) {
    this.userPreferences.set(userId, preferences);
    logger.debug('User preferences set', { userId });
  }

  /**
   * Get user preferences
   */
  getUserPreferences(userId) {
    return this.userPreferences.get(userId);
  }

  /**
   * Update user preferences
   */
  updateUserPreferences(userId, updates) {
    const current = this.userPreferences.get(userId) || {};
    const updated = { ...current, ...updates };
    this.userPreferences.set(userId, updated);

    this.statistics.userPreferenceOverrides++;
    logger.debug('User preferences updated', { userId });
  }

  /**
   * Remove user preferences
   */
  removeUserPreferences(userId) {
    const removed = this.userPreferences.delete(userId);
    if (removed) {
      logger.debug('User preferences removed', { userId });
    }
    return removed;
  }

  /**
   * Add routing rule
   */
  addRoutingRule(rule) {
    try {
      this.validateRoutingRule(rule);
      this.routingRules.push(rule);
      logger.debug('Routing rule added', { ruleId: rule.id });
    } catch (error) {
      logger.error('Error adding routing rule', { error: error.message });
      throw error;
    }
  }

  /**
   * Remove routing rule
   */
  removeRoutingRule(ruleId) {
    const index = this.routingRules.findIndex(rule => rule.id === ruleId);
    if (index !== -1) {
      const removed = this.routingRules.splice(index, 1)[0];
      logger.debug('Routing rule removed', { ruleId });
      return removed;
    }
    return null;
  }

  /**
   * Add escalation rule
   */
  addEscalationRule(rule) {
    try {
      this.validateEscalationRule(rule);
      this.escalationRules.push(rule);
      logger.debug('Escalation rule added', { ruleId: rule.id });
    } catch (error) {
      logger.error('Error adding escalation rule', { error: error.message });
      throw error;
    }
  }

  /**
   * Remove escalation rule
   */
  removeEscalationRule(ruleId) {
    const index = this.escalationRules.findIndex(rule => rule.id === ruleId);
    if (index !== -1) {
      const removed = this.escalationRules.splice(index, 1)[0];
      logger.debug('Escalation rule removed', { ruleId });
      return removed;
    }
    return null;
  }

  /**
   * Validate routing rule
   */
  validateRoutingRule(rule) {
    const requiredFields = ['id', 'name', 'conditions', 'actions'];
    const missingFields = requiredFields.filter(field => !rule[field]);

    if (missingFields.length > 0) {
      throw new Error(`Routing rule missing required fields: ${missingFields.join(', ')}`);
    }

    if (!Array.isArray(rule.conditions)) {
      throw new Error('Routing rule must have conditions array');
    }

    return true;
  }

  /**
   * Validate escalation rule
   */
  validateEscalationRule(rule) {
    const requiredFields = ['id', 'name', 'conditions', 'actions'];
    const missingFields = missingFields.filter(field => !rule[field]);

    if (missingFields.length > 0) {
      throw new Error(`Escalation rule missing required fields: ${missingFields.join(', ')}`);
    }

    if (!Array.isArray(rule.conditions)) {
      throw new Error('Escalation rule must have conditions array');
    }

    return true;
  }

  /**
   * Generate cache key
   */
  generateCacheKey(notification) {
    const key = [
      notification.type || 'unknown',
      notification.severity || 'unknown',
      notification.userId || 'anonymous',
      notification.userRole || 'unknown',
      notification.location ? 'has_location' : 'no_location',
      notification.timestamp ? 'has_timestamp' : 'no_timestamp'
    ].join('|');

    return key;
  }

  /**
   * Clear routing cache
   */
  clearCache() {
    this.routingCache.clear();
    logger.debug('Routing cache cleared');
  }

  /**
   * Get routing statistics
   */
  getStatistics() {
    return {
      isInitialized: this.isInitialized,
      ...this.statistics,
      totalRoutingRules: this.routingRules.length,
      activeRoutingRules: this.routingRules.filter(r => r.enabled).length,
      totalEscalationRules: this.escalationRules.length,
      activeEscalationRules: this.escalationRules.filter(r => r.enabled).length,
      totalUserPreferences: this.userPreferences.size,
      channelPriorities: Object.fromEntries(this.channelPriorities),
      cacheSize: this.routingCache.size,
      cacheTimeout: this.options.cacheTimeout
    };
  }

  /**
   * Export routing configuration
   */
  exportConfiguration() {
    return {
      routingRules: this.routingRules,
      escalationRules: this.escalationRules,
      channelPriorities: Object.fromEntries(this.channelPriorities),
      options: this.options
    };
  }

  /**
   * Import routing configuration
   */
  importConfiguration(config) {
    try {
      if (config.routingRules) {
        this.routingRules = config.routingRules;
      }

      if (config.escalationRules) {
        this.escalationRules = config.escalationRules;
      }

      if (config.channelPriorities) {
        this.channelPriorities = new Map(Object.entries(config.channelPriorities));
      }

      if (config.options) {
        this.options = { ...this.options, ...config.options };
      }

      logger.info('Routing configuration imported', {
        rulesImported: config.routingRules?.length || 0,
        escalationRulesImported: config.escalationRules?.length || 0
      });

    } catch (error) {
      logger.error('Error importing routing configuration', { error: error.message });
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      // Clear data structures
      this.routingRules = [];
      this.escalationRules = [];
      this.userPreferences.clear();
      this.channelPriorities.clear();
      this.routingCache.clear();

      // Reset statistics
      this.statistics = {
        totalRouted: 0,
        routingCacheHits: 0,
        escalations: 0,
        userPreferenceOverrides: 0,
        ruleMatches: new Map()
      };

      this.isInitialized = false;

      logger.info('Notification Router cleaned up');

    } catch (error) {
      logger.error('Error during Notification Router cleanup', { error: error.message });
    }
  }
}

module.exports = NotificationRouter;