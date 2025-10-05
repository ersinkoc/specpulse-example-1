const { v4: uuidv4 } = require('uuid');
const db = require('../database/connection');
const logger = require('../shared/utils/logger');
const redis = require('../config/redis');
const config = require('../config');
const userPreferencesService = require('./userPreferencesService');
const notificationEmailService = require('./notificationEmailService');
const notificationPriorityService = require('./notificationPriorityService');

/**
 * Notification Service
 * Handles core notification functionality including creation, delivery, and management
 */
class NotificationService {
  constructor() {
    this.publisher = redis.publisher;
    this.subscriber = redis.subscriber;
    this.setupRedisSubscriptions();
  }

  /**
   * Setup Redis subscriptions for notification channels
   */
  setupRedisSubscriptions() {
    // Subscribe to notification channels
    this.subscriber.subscribe('notifications:send', (message) => {
      this.handleNotificationSend(JSON.parse(message));
    });

    this.subscriber.subscribe('notifications:read', (message) => {
      this.handleNotificationRead(JSON.parse(message));
    });

    this.subscriber.subscribe('notifications:broadcast', (message) => {
      this.handleNotificationBroadcast(JSON.parse(message));
    });
  }

  /**
   * Create a new notification
   */
  async createNotification(data) {
    try {
      const {
        userId,
        title,
        message,
        category = 'system',
        type,
        priority = 'medium',
        data: notificationData = {},
        expiresAt,
        actions = []
      } = data;

      // Validate required fields
      if (!userId || !title || !message) {
        throw new Error('userId, title, and message are required');
      }

      // Validate category
      const validCategories = ['security', 'system', 'social', 'task', 'administrative'];
      if (!validCategories.includes(category)) {
        throw new Error(`Invalid category: ${category}`);
      }

      // Validate priority
      const validPriorities = ['low', 'medium', 'high', 'critical'];
      if (!validPriorities.includes(priority)) {
        throw new Error(`Invalid priority: ${priority}`);
      }

      const notificationId = uuidv4();

      // Insert notification into database
      const query = `
        INSERT INTO notifications (id, user_id, title, message, category, type, priority, data, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;

      const values = [
        notificationId,
        userId,
        title,
        message,
        category,
        type,
        priority,
        JSON.stringify(notificationData),
        expiresAt || null
      ];

      const result = await db.query(query, values);
      const notification = result.rows[0];

      // Insert notification actions if provided
      if (actions && actions.length > 0) {
        await this.insertNotificationActions(notificationId, actions);
      }

      // Create delivery tracking entries
      await this.createDeliveryTracking(notificationId);

      // Publish notification to Redis for real-time delivery
      await this.publishNotification(notification);

      logger.info('Notification created successfully', {
        notificationId,
        userId,
        category,
        priority
      });

      return {
        ...notification,
        actions: actions || []
      };

    } catch (error) {
      logger.error('Failed to create notification:', error);
      throw error;
    }
  }

  /**
   * Send notification to a specific user
   */
  async sendToUser(userId, notificationData) {
    try {
      // Determine optimal delivery strategy using priority service
      const deliveryStrategy = await notificationPriorityService.determineDeliveryStrategy(
        userId,
        notificationData
      );

      // Create the notification
      const notification = await this.createNotification({
        ...notificationData,
        userId,
        deliveryStrategy
      });

      // Track delivery attempts
      const deliveryAttempts = [];
      let anyChannelSucceeded = false;

      // Attempt delivery through each channel in priority order
      for (const channel of deliveryStrategy.channels) {
        const attemptResult = await this.attemptChannelDelivery(
          userId,
          notification,
          channel,
          deliveryStrategy
        );

        deliveryAttempts.push(attemptResult);

        if (attemptResult.success) {
          anyChannelSucceeded = true;
        }

        // For critical notifications, continue trying other channels even if one succeeds
        if (notification.priority !== 'critical' && attemptResult.success) {
          break;
        }
      }

      // Handle escalation if needed and no channels succeeded
      if (!anyChannelSucceeded && deliveryStrategy.retryConfig.escalationEnabled) {
        const escalationResult = await notificationPriorityService.handleEscalation(
          userId,
          notification,
          deliveryAttempts
        );

        if (escalationResult.escalated) {
          deliveryAttempts.push({
            channel: 'escalation',
            success: escalationResult.success,
            result: escalationResult,
            timestamp: new Date().toISOString()
          });

          if (escalationResult.success) {
            anyChannelSucceeded = true;
          }
        }
      }

      // Schedule retries for failed channels based on priority
      if (deliveryStrategy.retryConfig && deliveryStrategy.retryConfig.maxRetries > 0) {
        for (const attempt of deliveryAttempts) {
          if (!attempt.success && attempt.channel !== 'escalation') {
            const priorityConfig = notificationPriorityService.getPriorityConfig(notification.priority);

            if (attempt.retryCount < priorityConfig.maxRetries) {
              await this.scheduleNotificationRetry(notification.id, attempt.channel, {
                userId,
                notificationData,
                attemptCount: attempt.retryCount + 1,
                deliveryStrategy
              });
            }
          }
        }
      }

      // Add comprehensive delivery info to notification
      notification.deliveryInfo = {
        deliveryStrategy,
        deliveryAttempts,
        anyChannelSucceeded,
        totalChannelsAttempted: deliveryAttempts.length,
        successfulChannels: deliveryAttempts.filter(a => a.success).length,
        failedChannels: deliveryAttempts.filter(a => !a.success).length,
        escalationTriggered: deliveryAttempts.some(a => a.channel === 'escalation')
      };

      logger.info('Notification delivery completed', {
        notificationId: notification.id,
        userId,
        priority: notification.priority,
        category: notification.category,
        totalChannels: deliveryAttempts.length,
        successfulChannels: notification.deliveryInfo.successfulChannels,
        escalationTriggered: notification.deliveryInfo.escalationTriggered
      });

      return notification;

    } catch (error) {
      logger.error('Failed to send notification to user:', error);
      throw error;
    }
  }

  /**
   * Attempt delivery through a specific channel
   */
  async attemptChannelDelivery(userId, notification, channel, deliveryStrategy) {
    const attempt = {
      channel: channel.type,
      success: false,
      timestamp: new Date().toISOString(),
      retryCount: 0,
      error: null,
      result: null
    };

    try {
      // Mark channel as attempted
      await this.updateDeliveryStatus(notification.id, channel.type, 'sent');

      let result;

      switch (channel.type) {
        case 'websocket':
          result = await this.attemptWebSocketDelivery(userId, notification, channel);
          break;
        case 'email':
          result = await this.attemptEmailDelivery(userId, notification, channel, deliveryStrategy);
          break;
        default:
          throw new Error(`Unsupported channel type: ${channel.type}`);
      }

      if (result.success) {
        await this.updateDeliveryStatus(notification.id, channel.type, 'delivered');
        attempt.success = true;
        attempt.result = result;
      } else {
        await this.updateDeliveryStatus(notification.id, channel.type, 'failed', result.error);
        attempt.error = result.error;
        attempt.result = result;
      }

    } catch (error) {
      await this.updateDeliveryStatus(notification.id, channel.type, 'failed', error.message);
      attempt.error = error.message;
    }

    return attempt;
  }

  /**
   * Attempt WebSocket delivery
   */
  async attemptWebSocketDelivery(userId, notification, channelConfig) {
    try {
      // Check if user is online
      const isUserOnline = await this.isUserOnline(userId);
      if (!isUserOnline) {
        return {
          success: false,
          error: 'User offline',
          reason: 'no_active_connection'
        };
      }

      // Send via WebSocket
      await this.publisher.publish(
        `notifications:user:${userId}`,
        JSON.stringify({
          type: 'notification',
          data: notification,
          deliveryChannel: 'websocket',
          priority: notification.priority,
          timeout: channelConfig.timeout
        })
      );

      return {
        success: true,
        channel: 'websocket',
        deliveryMethod: 'realtime',
        messageId: notification.id,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        channel: 'websocket'
      };
    }
  }

  /**
   * Attempt email delivery
   */
  async attemptEmailDelivery(userId, notification, channelConfig, deliveryStrategy) {
    try {
      const emailOptions = {
        priority: notification.priority,
        deliveryStrategy,
        channelConfig
      };

      // Add escalation info if applicable
      if (deliveryStrategy.overridesApplied && deliveryStrategy.overridesApplied.length > 0) {
        emailOptions.isEscalation = true;
        emailOptions.overridesApplied = deliveryStrategy.overridesApplied;
      }

      const result = await notificationEmailService.sendNotificationEmail(
        userId,
        notification,
        emailOptions
      );

      return {
        success: result.success,
        channel: 'email',
        messageId: result.messageId,
        userId: result.userId,
        timestamp: new Date().toISOString(),
        skipped: result.skipped,
        error: result.error
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        channel: 'email'
      };
    }
  }

  /**
   * Send notifications to multiple users
   */
  async sendToUsers(userIds, notificationData) {
    const results = [];
    const errors = [];

    for (const userId of userIds) {
      try {
        const notification = await this.sendToUser(userId, notificationData);
        results.push({ userId, notification, success: true });
      } catch (error) {
        errors.push({ userId, error: error.message });
        results.push({ userId, success: false, error: error.message });
      }
    }

    return {
      results,
      successCount: results.filter(r => r.success).length,
      errorCount: errors.length,
      errors
    };
  }

  /**
   * Broadcast notification to all connected users
   */
  async broadcast(notificationData, options = {}) {
    try {
      const { excludeUsers = [], includeRoles = [] } = options;

      // Get all connected users from connection manager or database
      const connectedUsers = await this.getConnectedUsers(includeRoles, excludeUsers);

      if (connectedUsers.length === 0) {
        logger.info('No users available for broadcast');
        return { sentCount: 0, users: [] };
      }

      const results = await this.sendToUsers(connectedUsers, notificationData);

      logger.info('Notification broadcast sent', {
        totalUsers: connectedUsers.length,
        successCount: results.successCount,
        errorCount: results.errorCount
      });

      return results;

    } catch (error) {
      logger.error('Failed to broadcast notification:', error);
      throw error;
    }
  }

  /**
   * Get notifications for a user
   */
  async getUserNotifications(userId, options = {}) {
    try {
      const {
        limit = 50,
        offset = 0,
        category,
        priority,
        unreadOnly = false,
        includeExpired = false
      } = options;

      let query = `
        SELECT n.*,
               COALESCE(
                 json_agg(
                   json_build_object(
                     'action_id', na.action_id,
                     'label', na.label,
                     'url', na.url,
                     'action_type', na.action_type,
                     'style', na.style,
                     'action_data', na.action_data,
                     'clicked_at', na.clicked_at
                   )
                 ) FILTER (WHERE na.id IS NOT NULL),
                 '[]'::json
               ) as actions
        FROM notifications n
        LEFT JOIN notification_actions na ON n.id = na.notification_id
        WHERE n.user_id = $1
      `;

      const values = [userId];
      let paramIndex = 2;

      // Add filters
      if (category) {
        query += ` AND n.category = $${paramIndex++}`;
        values.push(category);
      }

      if (priority) {
        query += ` AND n.priority = $${paramIndex++}`;
        values.push(priority);
      }

      if (unreadOnly) {
        query += ` AND n.read_at IS NULL`;
      }

      if (!includeExpired) {
        query += ` AND (n.expires_at IS NULL OR n.expires_at > CURRENT_TIMESTAMP)`;
      }

      query += `
        GROUP BY n.id
        ORDER BY n.created_at DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;

      values.push(limit, offset);

      const result = await db.query(query, values);

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total
        FROM notifications n
        WHERE n.user_id = $1
        ${category ? `AND n.category = $2` : ''}
        ${priority ? (category ? `AND n.priority = $3` : `AND n.priority = $2`) : ''}
        ${unreadOnly ? `AND n.read_at IS NULL` : ''}
        ${!includeExpired ? `AND (n.expires_at IS NULL OR n.expires_at > CURRENT_TIMESTAMP)` : ''}
      `;

      const countResult = await db.query(countQuery, category && priority ? [userId, category, priority] :
                                               category ? [userId, category] :
                                               priority ? [userId, priority] : [userId]);

      return {
        notifications: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit,
        offset
      };

    } catch (error) {
      logger.error('Failed to get user notifications:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId, userId) {
    try {
      const query = `
        UPDATE notifications
        SET read_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND user_id = $2 AND read_at IS NULL
        RETURNING *
      `;

      const result = await db.query(query, [notificationId, userId]);

      if (result.rows.length === 0) {
        throw new Error('Notification not found or already read');
      }

      const notification = result.rows[0];

      // Publish read status update
      await this.publisher.publish(
        `notifications:user:${userId}`,
        JSON.stringify({
          type: 'notification_read',
          data: {
            notificationId,
            readAt: notification.read_at
          }
        })
      );

      return notification;

    } catch (error) {
      logger.error('Failed to mark notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark multiple notifications as read
   */
  async markMultipleAsRead(notificationIds, userId) {
    try {
      const query = `
        UPDATE notifications
        SET read_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1) AND user_id = $2 AND read_at IS NULL
        RETURNING id, read_at
      `;

      const result = await db.query(query, [notificationIds, userId]);
      const updatedNotifications = result.rows;

      // Publish read status updates
      for (const notification of updatedNotifications) {
        await this.publisher.publish(
          `notifications:user:${userId}`,
          JSON.stringify({
            type: 'notification_read',
            data: {
              notificationId: notification.id,
              readAt: notification.read_at
            }
          })
        );
      }

      return updatedNotifications;

    } catch (error) {
      logger.error('Failed to mark notifications as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId, filters = {}) {
    try {
      const { category, priority } = filters;

      let query = `
        UPDATE notifications
        SET read_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND read_at IS NULL
      `;

      const values = [userId];
      let paramIndex = 2;

      if (category) {
        query += ` AND category = $${paramIndex++}`;
        values.push(category);
      }

      if (priority) {
        query += ` AND priority = $${paramIndex++}`;
        values.push(priority);
      }

      query += ' RETURNING id, read_at';

      const result = await db.query(query, values);
      const updatedNotifications = result.rows;

      // Publish read status updates
      for (const notification of updatedNotifications) {
        await this.publisher.publish(
          `notifications:user:${userId}`,
          JSON.stringify({
            type: 'notification_read',
            data: {
              notificationId: notification.id,
              readAt: notification.read_at
            }
          })
        );
      }

      return updatedNotifications;

    } catch (error) {
      logger.error('Failed to mark all notifications as read:', error);
      throw error;
    }
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId, userId) {
    try {
      const query = `
        DELETE FROM notifications
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `;

      const result = await db.query(query, [notificationId, userId]);

      if (result.rows.length === 0) {
        throw new Error('Notification not found');
      }

      // Publish deletion event
      await this.publisher.publish(
        `notifications:user:${userId}`,
        JSON.stringify({
          type: 'notification_deleted',
          data: { notificationId }
        })
      );

      return { deleted: true, notificationId };

    } catch (error) {
      logger.error('Failed to delete notification:', error);
      throw error;
    }
  }

  /**
   * Get notification statistics for a user
   */
  async getUserNotificationStats(userId) {
    try {
      const query = `
        SELECT
          category,
          priority,
          COUNT(*) as total,
          COUNT(CASE WHEN read_at IS NULL THEN 1 END) as unread,
          COUNT(CASE WHEN read_at IS NOT NULL THEN 1 END) as read
        FROM notifications
        WHERE user_id = $1
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        GROUP BY category, priority
        ORDER BY category, priority
      `;

      const result = await db.query(query, [userId]);

      const stats = {
        total: 0,
        unread: 0,
        read: 0,
        byCategory: {},
        byPriority: {}
      };

      for (const row of result.rows) {
        stats.total += parseInt(row.total);
        stats.unread += parseInt(row.unread);
        stats.read += parseInt(row.read);

        // Category breakdown
        if (!stats.byCategory[row.category]) {
          stats.byCategory[row.category] = { total: 0, unread: 0, read: 0 };
        }
        stats.byCategory[row.category].total += parseInt(row.total);
        stats.byCategory[row.category].unread += parseInt(row.unread);
        stats.byCategory[row.category].read += parseInt(row.read);

        // Priority breakdown
        if (!stats.byPriority[row.priority]) {
          stats.byPriority[row.priority] = { total: 0, unread: 0, read: 0 };
        }
        stats.byPriority[row.priority].total += parseInt(row.total);
        stats.byPriority[row.priority].unread += parseInt(row.unread);
        stats.byPriority[row.priority].read += parseInt(row.read);
      }

      return stats;

    } catch (error) {
      logger.error('Failed to get user notification stats:', error);
      throw error;
    }
  }

  /**
   * Insert notification actions
   */
  async insertNotificationActions(notificationId, actions) {
    const query = `
      INSERT INTO notification_actions (notification_id, action_id, label, url, action_type, style, action_data)
      VALUES ${actions.map((_, index) =>
        `($1, $${index * 7 + 2}, $${index * 7 + 3}, $${index * 7 + 4}, $${index * 7 + 5}, $${index * 7 + 6}, $${index * 7 + 7})`
      ).join(', ')}
    `;

    const values = [notificationId];
    actions.forEach(action => {
      values.push(
        action.action_id,
        action.label,
        action.url || null,
        action.action_type,
        action.style || 'primary',
        JSON.stringify(action.action_data || {})
      );
    });

    await db.query(query, values);
  }

  /**
   * Create delivery tracking entries
   */
  async createDeliveryTracking(notificationId) {
    const query = `
      INSERT INTO notification_delivery (notification_id, channel, status)
      VALUES ($1, 'websocket', 'pending'), ($1, 'email', 'pending')
    `;

    await db.query(query, [notificationId]);
  }

  /**
   * Publish notification to Redis
   */
  async publishNotification(notification) {
    await this.publisher.publish(
      'notifications:send',
      JSON.stringify({
        notificationId: notification.id,
        userId: notification.user_id,
        notification
      })
    );
  }

  /**
   * Handle notification send from Redis
   */
  async handleNotificationSend(data) {
    // This method will be called when a notification is published
    // The actual WebSocket delivery will be handled by the WebSocket server
    logger.debug('Handling notification send from Redis', data);
  }

  /**
   * Handle notification read from Redis
   */
  async handleNotificationRead(data) {
    // This method will be called when a notification is marked as read
    logger.debug('Handling notification read from Redis', data);
  }

  /**
   * Handle notification broadcast from Redis
   */
  async handleNotificationBroadcast(data) {
    // This method will be called when a notification is broadcast
    logger.debug('Handling notification broadcast from Redis', data);
  }

  /**
   * Get connected users (placeholder - will integrate with connection manager)
   */
  async getConnectedUsers(includeRoles = [], excludeUsers = []) {
    // This is a placeholder implementation
    // In the actual implementation, this would query the connection manager
    // to get all connected users and filter by roles

    try {
      let query = `
        SELECT DISTINCT id as user_id
        FROM users u
        WHERE u.is_active = true
      `;

      const values = [];
      let paramIndex = 1;

      if (includeRoles.length > 0) {
        query += ` AND u.roles && $${paramIndex++}`;
        values.push(includeRoles);
      }

      if (excludeUsers.length > 0) {
        query += ` AND u.id != ALL($${paramIndex++})`;
        values.push(excludeUsers);
      }

      const result = await db.query(query, values);
      return result.rows.map(row => row.user_id);

    } catch (error) {
      logger.error('Failed to get connected users:', error);
      return [];
    }
  }

  /**
   * Update notification action click
   */
  async updateActionClick(notificationId, actionId, userId) {
    try {
      const query = `
        UPDATE notification_actions
        SET clicked_at = CURRENT_TIMESTAMP
        WHERE notification_id = $1 AND action_id = $2
        RETURNING *
      `;

      const result = await db.query(query, [notificationId, actionId]);

      if (result.rows.length === 0) {
        throw new Error('Action not found');
      }

      // Publish action click event
      await this.publisher.publish(
        `notifications:user:${userId}`,
        JSON.stringify({
          type: 'notification_action_clicked',
          data: {
            notificationId,
            actionId,
            clickedAt: result.rows[0].clicked_at
          }
        })
      );

      return result.rows[0];

    } catch (error) {
      logger.error('Failed to update action click:', error);
      throw error;
    }
  }

  /**
   * Update notification delivery status
   */
  async updateDeliveryStatus(notificationId, channel, status, failureReason = null) {
    try {
      const query = `
        UPDATE notification_delivery
        SET
          status = $2,
          sent_at = CASE WHEN $2 = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,
          delivered_at = CASE WHEN $2 = 'delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END,
          failure_reason = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE notification_id = $1 AND channel = $4
        RETURNING *
      `;

      const result = await db.query(query, [notificationId, status, failureReason, channel]);

      if (result.rows.length === 0) {
        // Insert new delivery tracking record if none exists
        const insertQuery = `
          INSERT INTO notification_delivery (notification_id, channel, status, failure_reason)
          VALUES ($1, $4, $2, $3)
          RETURNING *
        `;
        const insertResult = await db.query(insertQuery, [notificationId, status, failureReason, channel]);
        return insertResult.rows[0];
      }

      return result.rows[0];

    } catch (error) {
      logger.error('Failed to update delivery status:', error);
      throw error;
    }
  }

  /**
   * Schedule notification for later delivery (for quiet hours)
   */
  async scheduleNotification(userId, notificationData, scheduledFor) {
    try {
      const notificationId = uuidv4();

      // Create notification with scheduled flag
      const query = `
        INSERT INTO notifications (id, user_id, title, message, category, type, priority, data, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;

      const values = [
        notificationId,
        userId,
        notificationData.title,
        notificationData.message,
        notificationData.category,
        notificationData.type,
        notificationData.priority,
        JSON.stringify(notificationData.data || {}),
        notificationData.expiresAt || null
      ];

      const result = await db.query(query, values);
      const notification = result.rows[0];

      // Schedule for Redis
      const scheduledKey = `scheduled_notification:${notificationId}`;
      const scheduledData = {
        notificationId,
        userId,
        notificationData,
        scheduledFor: scheduledFor.toISOString(),
        createdAt: new Date().toISOString()
      };

      // Store in Redis with expiration
      await redis.setEx(
        scheduledKey,
        Math.ceil((scheduledFor.getTime() - Date.now()) / 1000) + 3600, // 1 hour buffer
        JSON.stringify(scheduledData)
      );

      // Add to scheduled notifications set for monitoring
      await redis.zadd(
        'scheduled_notifications',
        scheduledFor.getTime(),
        notificationId
      );

      logger.info('Notification scheduled for later delivery', {
        notificationId,
        userId,
        scheduledFor: scheduledFor.toISOString()
      });

      return {
        ...notification,
        scheduledFor,
        isScheduled: true
      };

    } catch (error) {
      logger.error('Failed to schedule notification:', error);
      throw error;
    }
  }

  /**
   * Process scheduled notifications
   */
  async processScheduledNotifications() {
    try {
      const now = Date.now();
      const scheduledNotificationIds = await redis.zrangebyscore(
        'scheduled_notifications',
        0,
        now
      );

      const processedCount = scheduledNotificationIds.length;

      for (const notificationId of scheduledNotificationIds) {
        try {
          // Get scheduled notification data
          const scheduledKey = `scheduled_notification:${notificationId}`;
          const scheduledData = await redis.get(scheduledKey);

          if (scheduledData) {
            const { userId, notificationData } = JSON.parse(scheduledData);

            // Check if user preferences still allow this notification
            const preferenceCheck = await userPreferencesService.shouldUserReceiveNotification(userId, {
              category: notificationData.category,
              priority: notificationData.priority
            });

            if (preferenceCheck.shouldDeliver) {
              // Send the notification
              await this.sendToUser(userId, {
                ...notificationData,
                isFromSchedule: true,
                originalScheduledId: notificationId
              });

              logger.info('Scheduled notification delivered', {
                notificationId,
                userId
              });
            } else {
              logger.info('Scheduled notification blocked by preferences', {
                notificationId,
                userId,
                reason: preferenceCheck.reason
              });
            }

            // Clean up
            await redis.del(scheduledKey);
            await redis.zrem('scheduled_notifications', notificationId);
          }

        } catch (error) {
          logger.error('Failed to process scheduled notification:', {
            notificationId,
            error: error.message
          });
        }
      }

      if (processedCount > 0) {
        logger.info(`Processed ${processedCount} scheduled notifications`);
      }

      return processedCount;

    } catch (error) {
      logger.error('Failed to process scheduled notifications:', error);
      throw error;
    }
  }

  /**
   * Start scheduled notification processor
   */
  startScheduledNotificationProcessor() {
    // Process scheduled notifications every minute
    setInterval(async () => {
      try {
        await this.processScheduledNotifications();
      } catch (error) {
        logger.error('Error in scheduled notification processor:', error);
      }
    }, 60000); // 1 minute

    logger.info('Scheduled notification processor started');
  }

  /**
   * Clean up expired notifications
   */
  async cleanupExpiredNotifications() {
    try {
      const query = 'SELECT cleanup_expired_notifications() as deleted_count';
      const result = await db.query(query);
      const deletedCount = result.rows[0].deleted_count;

      logger.info(`Cleaned up ${deletedCount} expired notifications`);
      return deletedCount;

    } catch (error) {
      logger.error('Failed to cleanup expired notifications:', error);
      throw error;
    }
  }

  /**
   * Check if user is online (has active WebSocket connections)
   */
  async isUserOnline(userId) {
    try {
      // Check if user has active connections in Redis
      const onlineKey = `user_connections:${userId}`;
      const connections = await redis.client.smembers(onlineKey);

      return connections && connections.length > 0;
    } catch (error) {
      logger.error('Failed to check user online status:', error);
      return false; // Assume offline if check fails
    }
  }

  /**
   * Schedule notification retry for failed delivery
   */
  async scheduleNotificationRetry(notificationId, channel, retryData) {
    try {
      const { userId, notificationData, attemptCount = 1 } = retryData;
      const maxRetries = 3;

      if (attemptCount >= maxRetries) {
        logger.warn('Max retry attempts reached for notification', {
          notificationId,
          channel,
          attemptCount
        });
        return false;
      }

      // Calculate retry delay with exponential backoff
      const baseDelay = 5 * 60 * 1000; // 5 minutes
      const exponentialDelay = baseDelay * Math.pow(2, attemptCount - 1);
      const retryDelay = Math.min(exponentialDelay, 60 * 60 * 1000); // Max 1 hour

      const retryAt = Date.now() + retryDelay;

      // Store retry data in Redis
      const retryKey = `notification_retry:${notificationId}:${channel}`;
      const retryInfo = {
        notificationId,
        channel,
        userId,
        notificationData,
        attemptCount: attemptCount + 1,
        scheduledAt: Date.now(),
        retryAt
      };

      await redis.client.setex(retryKey, Math.ceil(retryDelay / 1000) + 60, JSON.stringify(retryInfo));
      await redis.client.zadd('notification_retries', retryAt, `${notificationId}:${channel}`);

      logger.info('Notification retry scheduled', {
        notificationId,
        channel,
        attemptCount,
        retryDelay: Math.round(retryDelay / 1000 / 60), // minutes
        retryAt: new Date(retryAt).toISOString()
      });

      return true;
    } catch (error) {
      logger.error('Failed to schedule notification retry:', error);
      return false;
    }
  }

  /**
   * Process notification retries
   */
  async processNotificationRetries() {
    try {
      const now = Date.now();
      const retryIds = await redis.client.zrangebyscore('notification_retries', 0, now);

      if (retryIds.length === 0) {
        return 0;
      }

      let processedCount = 0;

      for (const retryId of retryIds) {
        try {
          const [notificationId, channel] = retryId.split(':');
          const retryKey = `notification_retry:${retryId}`;
          const retryData = await redis.client.get(retryKey);

          if (retryData) {
            const { userId, notificationData, attemptCount } = JSON.parse(retryData);

            // Attempt to resend the notification
            if (channel === 'email') {
              const result = await notificationEmailService.sendNotificationEmail(
                userId,
                { ...notificationData, id: notificationId },
                { isRetry: true, attemptCount }
              );

              if (result.success) {
                await this.updateDeliveryStatus(notificationId, channel, 'delivered');
                await redis.client.del(retryKey);
                await redis.client.zrem('notification_retries', retryId);
                processedCount++;

                logger.info('Notification retry successful', {
                  notificationId,
                  channel,
                  attemptCount,
                  messageId: result.messageId
                });
              } else {
                // Retry failed, schedule another retry
                await this.scheduleNotificationRetry(notificationId, channel, {
                  userId,
                  notificationData,
                  attemptCount
                });
              }
            }
          }
        } catch (error) {
          logger.error('Failed to process notification retry:', {
            retryId,
            error: error.message
          });
        }
      }

      if (processedCount > 0) {
        logger.info(`Processed ${processedCount} notification retries`);
      }

      return processedCount;
    } catch (error) {
      logger.error('Failed to process notification retries:', error);
      return 0;
    }
  }

  /**
   * Start retry processor (to be called during service initialization)
   */
  async startRetryProcessor() {
    // Process retries every 2 minutes
    setInterval(async () => {
      try {
        await this.processNotificationRetries();
      } catch (error) {
        logger.error('Retry processor error:', error);
      }
    }, 2 * 60 * 1000);

    logger.info('Notification retry processor started');
  }
}

// Create singleton instance
const notificationService = new NotificationService();

module.exports = notificationService;