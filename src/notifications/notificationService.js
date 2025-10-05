const logger = require('../shared/utils/logger');
const websocketConfig = require('../websocket/config');
const notificationRedis = require('./redisConfig');

/**
 * Notification Service
 * Core service for handling real-time notifications
 */
class NotificationService {
  constructor() {
    this.wsServer = global.wsServer;
    this.notificationQueue = [];
    this.batchTimer = null;
    this.retryQueue = new Map(); // notificationId -> retry count
  }

  /**
   * Send a notification to a specific user
   */
  async sendToUser(userId, notification) {
    try {
      const validatedNotification = this.validateNotification(notification);

      // Check if user is online via WebSocket
      if (this.wsServer && this.wsServer.sendToUser(userId, validatedNotification)) {
        logger.info(`Notification sent via WebSocket to user ${userId}:`, validatedNotification.title);
        return {
          success: true,
          channel: 'websocket',
          notificationId: validatedNotification.id
        };
      }

      // User is offline, add to offline queue for later processing
      logger.info(`User ${userId} is offline, notification queued for offline delivery:`, validatedNotification.title);
      return await this.handleOfflineDelivery(userId, validatedNotification);
    } catch (error) {
      logger.error('Failed to send notification to user:', error);
      throw error;
    }
  }

  /**
   * Send notifications to multiple users
   */
  async sendToUsers(userIds, notification) {
    try {
      const validatedNotification = this.validateNotification(notification);
      const results = {
        success: true,
        totalRecipients: userIds.length,
        websocketDelivered: 0,
        offlineQueued: 0,
        failed: [],
        notificationId: validatedNotification.id
      };

      // Group users by online/offline status
      const onlineUsers = [];
      const offlineUsers = [];

      userIds.forEach(userId => {
        if (this.isUserOnline(userId)) {
          onlineUsers.push(userId);
        } else {
          offlineUsers.push(userId);
        }
      });

      // Send to online users via WebSocket
      if (onlineUsers.length > 0) {
        const deliveredCount = this.wsServer.sendToUsers(onlineUsers, validatedNotification);
        results.websocketDelivered = deliveredCount;
        logger.info(`WebSocket notification sent to ${deliveredCount}/${onlineUsers.length} online users`);
      }

      // Queue offline notifications
      if (offlineUsers.length > 0) {
        for (const userId of offlineUsers) {
          try {
            await this.handleOfflineDelivery(userId, validatedNotification);
            results.offlineQueued++;
          } catch (error) {
            results.failed.push({ userId, error: error.message });
          }
        }
      }

      return results;
    } catch (error) {
      logger.error('Failed to send bulk notification:', error);
      throw error;
    }
  }

  /**
   * Broadcast notification to all connected users
   */
  async broadcast(notification, options = {}) {
    try {
      const validatedNotification = this.validateNotification(notification);

      if (this.wsServer) {
        this.wsServer.broadcast(validatedNotification);
        logger.info('Broadcast notification sent to all connected users:', validatedNotification.title);

        return {
          success: true,
          channel: 'websocket',
          recipientCount: this.wsServer.getStats().totalConnections,
          notificationId: validatedNotification.id
        };
      }

      throw new Error('WebSocket server not available');
    } catch (error) {
      logger.error('Failed to broadcast notification:', error);
      throw error;
    }
  }

  /**
   * Add notification to batch queue for processing
   */
  async queueNotification(userId, notification) {
    const queuedNotification = {
      userId,
      notification: this.validateNotification(notification),
      timestamp: new Date().toISOString(),
      retryCount: 0
    };

    try {
      // Use Redis queue instead of in-memory queue
      await notificationRedis.enqueue('notifications:batch_queue', queuedNotification);
      logger.debug(`Notification queued for batch processing: ${queuedNotification.notification.title}`);

      // Start batch processing if not already running
      if (!this.batchTimer) {
        this.startBatchProcessing();
      }
    } catch (error) {
      logger.error('Failed to queue notification in Redis:', error);
      // Fallback to in-memory queue if Redis fails
      this.notificationQueue.push(queuedNotification);
      if (!this.batchTimer) {
        this.startBatchProcessing();
      }
    }
  }

  /**
   * Start batch processing of notifications
   */
  startBatchProcessing() {
    this.batchTimer = setTimeout(() => {
      this.processBatch();
    }, websocketConfig.notifications.batchTimeout);
  }

  /**
   * Process a batch of notifications
   */
  async processBatch() {
    const batch = [];

    // Try to get items from Redis queue first
    try {
      for (let i = 0; i < websocketConfig.notifications.batchSize; i++) {
        const item = await notificationRedis.dequeue('notifications:batch_queue', { timeout: 0 });
        if (item) {
          batch.push(item);
        } else {
          break; // No more items in queue
        }
      }
    } catch (error) {
      logger.error('Failed to dequeue from Redis:', error);
    }

    // Fallback to in-memory queue if Redis queue is empty or failed
    if (batch.length === 0 && this.notificationQueue.length > 0) {
      const memoryBatch = this.notificationQueue.splice(0, websocketConfig.notifications.batchSize);
      batch.push(...memoryBatch);
    }

    if (batch.length === 0) {
      this.batchTimer = null;
      return;
    }

    logger.info(`Processing notification batch of ${batch.length} notifications`);

    const results = {
      total: batch.length,
      successful: 0,
      failed: 0,
      retried: 0
    };

    for (const item of batch) {
      try {
        await this.sendToUser(item.userId, item.notification);
        results.successful++;
      } catch (error) {
        results.failed++;

        // Add to retry queue if under max retries
        if (item.retryCount < websocketConfig.notifications.maxRetries) {
          item.retryCount++;
          item.timestamp = new Date().toISOString();
          this.retryQueue.set(item.notification.id, item);
          results.retried++;

          // Use Redis retry queue instead of in-memory
          try {
            await notificationRedis.addToRetryQueue(item, websocketConfig.notifications.retryDelay / 1000);
          } catch (retryError) {
            logger.error('Failed to add to Redis retry queue:', retryError);
            // Fallback to in-memory retry scheduling
            setTimeout(() => {
              this.retryNotification(item.notification.id);
            }, websocketConfig.notifications.retryDelay);
          }
        } else {
          logger.error(`Notification failed after max retries:`, item.notification.title, error);
        }
      }
    }

    logger.info(`Batch processing completed: ${results.successful} successful, ${results.failed} failed, ${results.retried} retried`);

    // Continue processing if more items in queue
    const redisQueueSize = await notificationRedis.getQueueSize('notifications:batch_queue');
    if (redisQueueSize > 0 || this.notificationQueue.length > 0) {
      this.startBatchProcessing();
    } else {
      this.batchTimer = null;
    }
  }

  /**
   * Retry a failed notification
   */
  async retryNotification(notificationId) {
    const retryItem = this.retryQueue.get(notificationId);

    if (!retryItem) {
      return;
    }

    this.retryQueue.delete(notificationId);

    try {
      await this.sendToUser(retryItem.userId, retryItem.notification);
      logger.info(`Notification retry successful: ${retryItem.notification.title}`);
    } catch (error) {
      logger.error(`Notification retry failed: ${retryItem.notification.title}`, error);

      // Add back to queue if still under max retries
      if (retryItem.retryCount < websocketConfig.notifications.maxRetries) {
        retryItem.retryCount++;
        this.queueNotification(retryItem.userId, retryItem.notification);
      }
    }
  }

  /**
   * Handle offline delivery of notifications
   */
  async handleOfflineDelivery(userId, notification) {
    // This will be implemented in Phase 4 when we add email support
    // For now, we'll just log that the user is offline
    logger.info(`Offline delivery not yet implemented for user ${userId}, notification: ${notification.title}`);

    return {
      success: true,
      channel: 'offline',
      notificationId: notification.id,
      message: 'User offline - notification queued'
    };
  }

  /**
   * Validate notification structure and content
   */
  validateNotification(notification) {
    const validated = {
      id: notification.id || this.generateNotificationId(),
      title: notification.title || 'Untitled Notification',
      message: notification.message || '',
      category: notification.category || 'system',
      priority: notification.priority || 'medium',
      data: notification.data || {},
      timestamp: notification.timestamp || new Date().toISOString(),
      expiresIn: notification.expiresIn || 86400000, // 24 hours default
      actions: notification.actions || []
    };

    // Validate required fields
    if (!validated.title.trim()) {
      throw new Error('Notification title is required');
    }

    if (!validated.message.trim()) {
      throw new Error('Notification message is required');
    }

    // Validate category
    const validCategories = ['security', 'system', 'social', 'task', 'administrative'];
    if (!validCategories.includes(validated.category)) {
      throw new Error(`Invalid notification category: ${validated.category}`);
    }

    // Validate priority
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    if (!validPriorities.includes(validated.priority)) {
      throw new Error(`Invalid notification priority: ${validated.priority}`);
    }

    return validated;
  }

  /**
   * Check if a user is currently online
   */
  isUserOnline(userId) {
    if (!this.wsServer) {
      return false;
    }

    const stats = this.wsServer.getStats();
    // We'll need to enhance the WebSocket server to provide user-specific online status
    // For now, we'll assume all users could be online
    return stats.connectedUsers > 0;
  }

  /**
   * Generate a unique notification ID
   */
  generateNotificationId() {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get notification service statistics
   */
  getStats() {
    return {
      queuedNotifications: this.notificationQueue.length,
      retryQueueSize: this.retryQueue.size,
      batchTimerActive: !!this.batchTimer,
      websocketAvailable: !!this.wsServer,
      websocketStats: this.wsServer ? this.wsServer.getStats() : null
    };
  }

  /**
   * Clean up expired notifications from queues
   */
  cleanupExpiredNotifications() {
    const now = new Date();
    let cleanedCount = 0;

    // Clean notification queue
    this.notificationQueue = this.notificationQueue.filter(item => {
      const isExpired = (now - item.timestamp) > item.notification.expiresIn;
      if (isExpired) {
        cleanedCount++;
        logger.debug(`Expired notification removed from queue: ${item.notification.title}`);
      }
      return !isExpired;
    });

    // Clean retry queue
    for (const [notificationId, item] of this.retryQueue.entries()) {
      const isExpired = (now - item.timestamp) > item.notification.expiresIn;
      if (isExpired) {
        this.retryQueue.delete(notificationId);
        cleanedCount++;
        logger.debug(`Expired notification removed from retry queue: ${item.notification.title}`);
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} expired notifications`);
    }

    return cleanedCount;
  }
}

// Singleton instance
const notificationService = new NotificationService();

module.exports = notificationService;