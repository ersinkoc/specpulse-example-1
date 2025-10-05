const logger = require('../shared/utils/logger');
const userPreferencesService = require('./userPreferencesService');
const notificationEmailService = require('./notificationEmailService');

/**
 * Notification Priority Service
 * Handles cross-channel notification prioritization and escalation
 */
class NotificationPriorityService {
  constructor() {
    this.priorityLevels = {
      low: { weight: 1, maxRetries: 1, escalationDelay: 0 },
      medium: { weight: 2, maxRetries: 2, escalationDelay: 10 * 60 * 1000 }, // 10 minutes
      high: { weight: 3, maxRetries: 3, escalationDelay: 5 * 60 * 1000 }, // 5 minutes
      critical: { weight: 4, maxRetries: 5, escalationDelay: 1 * 60 * 1000 } // 1 minute
    };

    this.escalationRules = {
      critical: {
        overrideQuietHours: true,
        overrideChannelPreferences: true,
        requireMultipleChannels: true,
        maxEscalationTime: 15 * 60 * 1000 // 15 minutes
      },
      high: {
        overrideQuietHours: false,
        overrideChannelPreferences: false,
        requireMultipleChannels: false,
        maxEscalationTime: 30 * 60 * 1000 // 30 minutes
      },
      medium: {
        overrideQuietHours: false,
        overrideChannelPreferences: false,
        requireMultipleChannels: false,
        maxEscalationTime: 60 * 60 * 1000 // 1 hour
      },
      low: {
        overrideQuietHours: false,
        overrideChannelPreferences: false,
        requireMultipleChannels: false,
        maxEscalationTime: 0 // No escalation for low priority
      }
    };
  }

  /**
   * Determine optimal delivery strategy for notification
   */
  async determineDeliveryStrategy(userId, notificationData) {
    try {
      const { priority, category } = notificationData;
      const priorityConfig = this.priorityLevels[priority];
      const escalationRule = this.escalationRules[priority];

      if (!priorityConfig || !escalationRule) {
        throw new Error(`Invalid priority level: ${priority}`);
      }

      // Get user preferences
      const userPreferences = await userPreferencesService.getUserPreferences(userId);

      // Apply priority-based overrides
      const deliveryStrategy = await this.applyPriorityOverrides(
        userId,
        notificationData,
        userPreferences,
        escalationRule
      );

      // Determine channel selection based on priority
      deliveryStrategy.channels = await this.selectOptimalChannels(
        userId,
        notificationData,
        userPreferences,
        deliveryStrategy
      );

      // Set retry and escalation parameters
      deliveryStrategy.retryConfig = {
        maxRetries: priorityConfig.maxRetries,
        escalationDelay: escalationRule.escalationDelay,
        escalationEnabled: priorityConfig.weight >= 3 // high and critical
      };

      return deliveryStrategy;

    } catch (error) {
      logger.error('Failed to determine delivery strategy:', error);
      return this.getDefaultDeliveryStrategy(notificationData);
    }
  }

  /**
   * Apply priority-based overrides to user preferences
   */
  async applyPriorityOverrides(userId, notificationData, userPreferences, escalationRule) {
    const { priority } = notificationData;
    const strategy = {
      originalPreferences: { ...userPreferences },
      overridesApplied: [],
      quietHoursOverride: false,
      channelPreferenceOverride: false
    };

    // Override quiet hours for critical notifications
    if (escalationRule.overrideQuietHours && userPreferences.quiet_hours_enabled) {
      strategy.quietHoursOverride = true;
      strategy.overridesApplied.push('quiet_hours');
      logger.info('Quiet hours overridden for critical notification', {
        userId,
        priority,
        category: notificationData.category
      });
    }

    // Override channel preferences for critical notifications
    if (escalationRule.overrideChannelPreferences) {
      strategy.channelPreferenceOverride = true;
      strategy.overridesApplied.push('channel_preferences');

      // Enable all channels for critical notifications
      Object.keys(userPreferences.category_preferences).forEach(cat => {
        if (cat === notificationData.category || priority === 'critical') {
          userPreferences.category_preferences[cat].email = true;
          userPreferences.category_preferences[cat].websocket = true;
        }
      });

      logger.info('Channel preferences overridden for critical notification', {
        userId,
        priority,
        category: notificationData.category
      });
    }

    return strategy;
  }

  /**
   * Select optimal delivery channels based on priority and user status
   */
  async selectOptimalChannels(userId, notificationData, userPreferences, deliveryStrategy) {
    const { priority } = notificationData;
    const escalationRule = this.escalationRules[priority];
    const channels = [];

    // Check if user is online
    const isUserOnline = await this.isUserOnline(userId);

    // Always try WebSocket first for online users
    if (isUserOnline) {
      channels.push({
        type: 'websocket',
        priority: 1, // Highest priority
        required: true,
        timeout: 30 * 1000 // 30 seconds
      });
    }

    // Add email channel based on priority and preferences
    const categoryPref = userPreferences.category_preferences[notificationData.category];
    if (categoryPref && categoryPref.email) {
      channels.push({
        type: 'email',
        priority: isUserOnline ? 2 : 1, // Primary if offline, secondary if online
        required: escalationRule.requireMultipleChannels || !isUserOnline,
        timeout: 5 * 60 * 1000 // 5 minutes
      });
    }

    // For critical notifications, ensure multiple channels
    if (escalationRule.requireMultipleChannels && channels.length < 2) {
      // Force add email if not already present
      if (!channels.find(ch => ch.type === 'email')) {
        channels.push({
          type: 'email',
          priority: 2,
          required: true,
          timeout: 2 * 60 * 1000 // 2 minutes for critical
        });
      }
    }

    // Sort channels by priority
    channels.sort((a, b) => a.priority - b.priority);

    return channels;
  }

  /**
   * Check if user is online
   */
  async isUserOnline(userId) {
    try {
      const redis = require('../config/redis');
      const onlineKey = `user_connections:${userId}`;
      const connections = await redis.client.smembers(onlineKey);
      return connections && connections.length > 0;
    } catch (error) {
      logger.error('Failed to check user online status:', error);
      return false;
    }
  }

  /**
   * Handle notification escalation
   */
  async handleEscalation(userId, notificationData, deliveryAttempts) {
    try {
      const { priority, id: notificationId } = notificationData;
      const escalationRule = this.escalationRules[priority];

      if (!escalationRule.escalationDelay) {
        return { escalated: false, reason: 'Escalation not supported for this priority' };
      }

      // Check if escalation is needed
      const failedAttempts = deliveryAttempts.filter(attempt => !attempt.success);
      if (failedAttempts.length === 0) {
        return { escalated: false, reason: 'All deliveries successful' };
      }

      // Determine escalation strategy
      const escalationStrategy = await this.determineEscalationStrategy(
        userId,
        notificationData,
        deliveryAttempts
      );

      if (escalulationStrategy.shouldEscalate) {
        return await this.executeEscalation(
          userId,
          notificationData,
          escalationStrategy
        );
      }

      return { escalated: false, reason: 'Escalation criteria not met' };

    } catch (error) {
      logger.error('Failed to handle notification escalation:', error);
      return { escalated: false, error: error.message };
    }
  }

  /**
   * Determine if escalation should occur
   */
  async determineEscalationStrategy(userId, notificationData, deliveryAttempts) {
    const { priority, category } = notificationData;
    const escalationRule = this.escalationRules[priority];

    const strategy = {
      shouldEscalate: false,
      escalationLevel: 1,
      additionalChannels: [],
      overrides: []
    };

    // Check if all required channels failed
    const requiredChannels = ['websocket', 'email'].filter(channel => {
      const userPref = userPreferencesService.getUserPreferences(userId);
      const catPref = userPref.category_preferences[category];
      return catPref && catPref[channel];
    });

    const failedRequiredChannels = deliveryAttempts.filter(attempt =>
      requiredChannels.includes(attempt.channel) && !attempt.success
    );

    // Escalate if all required channels failed
    if (failedRequiredChannels.length === requiredChannels.length && requiredChannels.length > 0) {
      strategy.shouldEscalate = true;
      strategy.escalationLevel = 2;
    }

    // For critical notifications, escalate faster
    if (priority === 'critical' && failedRequiredChannels.length > 0) {
      strategy.shouldEscalate = true;
      strategy.escalationLevel = 3;
    }

    // Add additional channels for escalation
    if (strategy.shouldEscalate) {
      if (strategy.escalationLevel >= 2 && !deliveryAttempts.find(attempt => attempt.channel === 'email')) {
        strategy.additionalChannels.push({
          type: 'email',
          reason: 'Escalation: Email fallback',
          priority: 1
        });
      }

      if (strategy.escalationLevel >= 3) {
        strategy.overrides.push('quiet_hours');
        strategy.overrides.push('rate_limits');
      }
    }

    return strategy;
  }

  /**
   * Execute notification escalation
   */
  async executeEscalation(userId, notificationData, escalationStrategy) {
    try {
      const { id: notificationId, priority } = notificationData;

      logger.info('Executing notification escalation', {
        notificationId,
        userId,
        priority,
        escalationLevel: escalationStrategy.escalationLevel,
        additionalChannels: escalationStrategy.additionalChannels.length
      });

      const escalationResults = [];

      // Try additional channels
      for (const channel of escalationStrategy.additionalChannels) {
        try {
          let result;

          if (channel.type === 'email') {
            result = await notificationEmailService.sendNotificationEmail(
              userId,
              {
                ...notificationData,
                priority: 'critical', // Escalate to critical for delivery
                data: {
                  ...notificationData.data,
                  escalated: true,
                  escalationLevel: escalationStrategy.escalationLevel,
                  originalPriority: priority
                }
              },
              {
                isEscalation: true,
                escalationLevel: escalationStrategy.escalationLevel,
                reason: channel.reason
              }
            );
          }

          escalationResults.push({
            channel: channel.type,
            success: result && result.success,
            result,
            reason: channel.reason
          });

        } catch (error) {
          escalationResults.push({
            channel: channel.type,
            success: false,
            error: error.message,
            reason: channel.reason
          });
        }
      }

      const successfulEscalations = escalationResults.filter(r => r.success);

      return {
        escalated: true,
        escalationLevel: escalationStrategy.escalationLevel,
        results: escalationResults,
        success: successfulEscalations.length > 0,
        channelsAttempted: escalationStrategy.additionalChannels.length,
        successfulChannels: successfulEscalations.length
      };

    } catch (error) {
      logger.error('Failed to execute notification escalation:', error);
      return {
        escalated: false,
        error: error.message
      };
    }
  }

  /**
   * Get default delivery strategy
   */
  getDefaultDeliveryStrategy(notificationData) {
    return {
      channels: [
        {
          type: 'websocket',
          priority: 1,
          required: false,
          timeout: 30 * 1000
        }
      ],
      retryConfig: {
        maxRetries: 1,
        escalationDelay: 0,
        escalationEnabled: false
      },
      overridesApplied: [],
      quietHoursOverride: false,
      channelPreferenceOverride: false
    };
  }

  /**
   * Get priority statistics for monitoring
   */
  async getPriorityStatistics(timeRange = '24h') {
    try {
      const db = require('../database/connection');
      let timeFilter = '';

      switch (timeRange) {
        case '1h':
          timeFilter = "AND n.created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour'";
          break;
        case '24h':
          timeFilter = "AND n.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'";
          break;
        case '7d':
          timeFilter = "AND n.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'";
          break;
        default:
          timeFilter = "AND n.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'";
      }

      const query = `
        SELECT
          n.priority,
          COUNT(*) as total_sent,
          COUNT(CASE WHEN nd.status = 'delivered' THEN 1 END) as total_delivered,
          COUNT(CASE WHEN nd.status = 'failed' THEN 1 END) as total_failed,
          COUNT(CASE WHEN nd.channel = 'websocket' AND nd.status = 'delivered' THEN 1 END) as websocket_delivered,
          COUNT(CASE WHEN nd.channel = 'email' AND nd.status = 'delivered' THEN 1 END) as email_delivered,
          AVG(EXTRACT(EPOCH FROM (nd.delivered_at - nd.sent_at))) as avg_delivery_time_seconds
        FROM notifications n
        LEFT JOIN notification_delivery nd ON n.id = nd.notification_id
        WHERE 1=1 ${timeFilter}
        GROUP BY n.priority
        ORDER BY
          CASE n.priority
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
          END
      `;

      const result = await db.query(query);

      return result.rows.map(row => ({
        priority: row.priority,
        totalSent: parseInt(row.total_sent),
        totalDelivered: parseInt(row.total_delivered),
        totalFailed: parseInt(row.total_failed),
        deliveryRate: row.total_sent > 0 ? (row.total_delivered / row.total_sent * 100).toFixed(2) : 0,
        websocketDelivered: parseInt(row.websocket_delivered || 0),
        emailDelivered: parseInt(row.email_delivered || 0),
        avgDeliveryTime: Math.round(row.avg_delivery_time_seconds || 0),
        priorityWeight: this.priorityLevels[row.priority]?.weight || 0
      }));

    } catch (error) {
      logger.error('Failed to get priority statistics:', error);
      return [];
    }
  }

  /**
   * Validate priority configuration
   */
  validatePriorityConfig(priority) {
    return Object.keys(this.priorityLevels).includes(priority);
  }

  /**
   * Get priority configuration
   */
  getPriorityConfig(priority) {
    return this.priorityLevels[priority];
  }

  /**
   * Get escalation rules
   */
  getEscalationRules(priority) {
    return this.escalationRules[priority];
  }
}

// Create singleton instance
const notificationPriorityService = new NotificationPriorityService();

module.exports = notificationPriorityService;