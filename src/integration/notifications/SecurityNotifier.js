/**
 * Security Notifier - Integrates security audit system with real-time notification system
 * Sends security alerts, notifications, and updates through multiple channels
 */

const EventEmitter = require('events');
const logger = require('../../shared/utils/logger');

class SecurityNotifier extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      enableWebSocket: options.enableWebSocket !== false,
      enableEmail: options.enableEmail !== false,
      enableSMS: options.enableSMS || false,
      enableSlack: options.enableSlack || false,
      enableWebhook: options.enableWebhook || false,
      notificationQueueSize: options.notificationQueueSize || 1000,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 5000,
      throttlingEnabled: options.throttlingEnabled !== false,
      throttlingWindow: options.throttlingWindow || 60000, // 1 minute
      maxNotificationsPerWindow: options.maxNotificationsPerWindow || 10,
      ...options
    };

    // Notification channels
    this.channels = new Map(); // channelId -> channel config
    this.notificationQueue = [];
    this.throttlingTracker = new Map(); // userId -> notifications in current window
    this.deliveryTracker = new Map(); // notificationId -> delivery status

    // Notification service references
    this.webSocketService = null;
    this.emailService = null;
    this.smsService = null;
    this.slackService = null;
    this.webhookService = null;

    // Statistics
    this.statistics = {
      totalNotifications: 0,
      deliveredNotifications: 0,
      failedNotifications: 0,
      notificationsByChannel: new Map(),
      notificationsByType: new Map(),
      notificationsBySeverity: new Map()
    };

    this.isInitialized = false;
    this.processingTimer = null;

    // Initialize default channels
    this.initializeDefaultChannels();
  }

  /**
   * Initialize the security notifier
   */
  async initialize(services = {}) {
    try {
      logger.info('Initializing Security Notifier');

      // Assign services
      this.webSocketService = services.webSocketService;
      this.emailService = services.emailService;
      this.smsService = services.smsService;
      this.slackService = services.slackService;
      this.webhookService = services.webhookService;

      // Start processing notifications
      this.startNotificationProcessing();

      this.isInitialized = true;
      logger.info('Security Notifier initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize Security Notifier', { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize default notification channels
   */
  initializeDefaultChannels() {
    const defaultChannels = [
      {
        id: 'websocket',
        name: 'WebSocket Notifications',
        enabled: this.options.enableWebSocket,
        type: 'realtime',
        description: 'Real-time WebSocket notifications',
        config: {
          room: 'security-alerts',
          priority: 1
        }
      },
      {
        id: 'email',
        name: 'Email Notifications',
        enabled: this.options.enableEmail,
        type: 'async',
        description: 'Email notification delivery',
        config: {
          templateEngine: 'handlebars',
          retryAttempts: this.options.retryAttempts,
          retryDelay: this.options.retryDelay
        }
      },
      {
        id: 'sms',
        name: 'SMS Notifications',
        enabled: this.options.enableSMS,
        type: 'async',
        description: 'SMS notification delivery',
        config: {
          maxLength: 160,
          retryAttempts: this.options.retryAttempts,
          retryDelay: this.options.retryDelay
        }
      },
      {
        id: 'slack',
        name: 'Slack Notifications',
        enabled: this.options.enableSlack,
        type: 'async',
        description: 'Slack channel notifications',
        config: {
          channel: '#security-alerts',
          webhookUrl: process.env.SLACK_WEBHOOK_URL,
          retryAttempts: this.options.retryAttempts
        }
      },
      {
        id: 'webhook',
        name: 'Webhook Notifications',
        enabled: this.options.enableWebhook,
        type: 'async',
        description: 'Custom webhook notifications',
        config: {
          url: process.env.SECURITY_WEBHOOK_URL,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.WEBHOOK_AUTH_TOKEN}`
          },
          retryAttempts: this.options.retryAttempts,
          retryDelay: this.options.retryDelay
        }
      }
    ];

    for (const channel of defaultChannels) {
      this.channels.set(channel.id, channel);
    }

    logger.debug('Default notification channels initialized', {
      channelsCount: defaultChannels.length
    });
  }

  /**
   * Start notification processing
   */
  startNotificationProcessing() {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
    }

    this.processingTimer = setInterval(async () => {
      await this.processNotificationQueue();
    }, 1000); // Process every second

    logger.info('Notification processing started');
  }

  /**
   * Send security notification
   */
  async sendNotification(notification) {
    try {
      // Add metadata
      const enhancedNotification = {
        id: this.generateNotificationId(),
        timestamp: Date.now(),
        ...notification,
        createdAt: Date.now(),
        deliveryStatus: 'pending',
        deliveryAttempts: 0,
        channels: this.determineChannels(notification),
        retryCount: 0
      };

      // Check throttling
      if (this.options.throttlingEnabled && this.isThrottled(enhancedNotification)) {
        logger.debug('Notification throttled', {
          notificationId: enhancedNotification.id,
          userId: enhancedNotification.userId
        });
        return { throttled: true, notificationId: enhancedNotification.id };
      }

      // Add to queue
      this.addToQueue(enhancedNotification);

      // Update statistics
      this.statistics.totalNotifications++;

      // Emit notification queued event
      this.emit('notificationQueued', {
        notificationId: enhancedNotification.id,
        type: enhancedNotification.type,
        severity: enhancedNotification.severity
      });

      return { queued: true, notificationId: enhancedNotification.id };

    } catch (error) {
      logger.error('Error sending security notification', {
        error: error.message
      });
      return { error: error.message };
    }
  }

  /**
   * Process notification queue
   */
  async processNotificationQueue() {
    try {
      if (this.notificationQueue.length === 0) return;

      // Get next notification
      const notification = this.notificationQueue.shift();

      // Process through all enabled channels
      const deliveryPromises = [];
      for (const channelId of notification.channels) {
        const channel = this.channels.get(channelId);
        if (channel && channel.enabled) {
          deliveryPromises.push(this.deliverToChannel(channel, notification));
        }
      }

      // Wait for all deliveries
      const deliveryResults = await Promise.allSettled(deliveryPromises);

      // Update notification status
      this.updateNotificationStatus(notification, deliveryResults);

      // Update statistics
      this.updateDeliveryStatistics(deliveryResults);

      // Emit notification processed event
      this.emit('notificationProcessed', {
        notificationId: notification.id,
        results: deliveryResults
      });

    } catch (error) {
      logger.error('Error processing notification queue', { error: error.message });
    }
  }

  /**
   * Deliver notification to specific channel
   */
  async deliverToChannel(channel, notification) {
    try {
      let result = { success: false, channel: channel.id, error: null };

      switch (channel.id) {
        case 'websocket':
          result = await this.deliverWebSocket(channel, notification);
          break;
        case 'email':
          result = await this.deliverEmail(channel, notification);
          break;
        case 'sms':
          result = await this.deliverSMS(channel, notification);
          break;
        case 'slack':
          result = await this.deliverSlack(channel, notification);
          break;
        case 'webhook':
          result = await this.deliverWebhook(channel, notification);
          break;
        default:
          result = { success: false, channel: channel.id, error: `Unknown channel: ${channel.id}` };
      }

      return result;

    } catch (error) {
      logger.error('Error delivering notification to channel', {
        channelId: channel.id,
        notificationId: notification.id,
        error: error.message
      });

      return { success: false, channel: channel.id, error: error.message };
    }
  }

  /**
   * Deliver WebSocket notification
   */
  async deliverWebSocket(channel, notification) {
    try {
      if (!this.webSocketService) {
        return { success: false, channel: 'websocket', error: 'WebSocket service not available' };
      }

      const room = channel.config.room || 'security-alerts';
      const payload = {
        type: 'security_notification',
        notification: {
          id: notification.id,
          type: notification.type,
          severity: notification.severity,
          title: notification.title,
          message: notification.message,
          timestamp: notification.timestamp,
          data: notification.data
        }
      };

      // Send to WebSocket room
      await this.webSocketService.sendToRoom(room, payload);

      return { success: true, channel: 'websocket', deliveredTo: room };

    } catch (error) {
      logger.error('Error delivering WebSocket notification', { error: error.message });
      return { success: false, channel: 'websocket', error: error.message };
    }
  }

  /**
   * Deliver email notification
   */
  async deliverEmail(channel, notification) {
    try {
      if (!this.emailService) {
        return { success: false, channel: 'email', error: 'Email service not available' };
      }

      const emailPayload = {
        to: notification.recipients?.email || [],
        subject: `[${notification.severity.toUpperCase()}] ${notification.title}`,
        template: 'security-alert',
        data: {
          notification,
          severity: notification.severity,
          type: notification.type,
          timestamp: new Date(notification.timestamp).toISOString(),
          details: notification.data
        }
      };

      // Send email
      await this.emailService.send(emailPayload);

      return { success: true, channel: 'email', deliveredTo: emailPayload.to };

    } catch (error) {
      logger.error('Error delivering email notification', { error: error.message });
      return { success: false, channel: 'email', error: error.message };
    }
  }

  /**
   * Deliver SMS notification
   */
  async deliverSMS(channel, notification) {
    try {
      if (!this.smsService) {
        return { success: false, channel: 'sms', error: 'SMS service not available' };
      }

      const smsPayload = {
        to: notification.recipients?.sms || [],
        message: this.formatSMSMessage(notification),
        priority: notification.severity === 'critical' ? 'high' : 'normal'
      };

      // Send SMS
      await this.smsService.send(smsPayload);

      return { success: true, channel: 'sms', deliveredTo: smsPayload.to };

    } catch (error) {
      logger.error('Error delivering SMS notification', { error: error.message });
      return { success: false, channel: 'sms', error: error.message };
    }
  }

  /**
   * Deliver Slack notification
   */
  async deliverSlack(channel, notification) {
    try {
      if (!this.slackService) {
        return { success: false, channel: 'slack', error: 'Slack service not available' };
      }

      const slackPayload = {
        channel: channel.config.channel,
        attachments: [
          {
            color: this.getSlackColor(notification.severity),
            title: notification.title,
            text: notification.message,
            fields: this.formatSlackFields(notification),
            footer: `Security Alert #${notification.id}`,
            ts: Math.floor(notification.timestamp / 1000)
          }
        ]
      };

      // Send to Slack
      await this.slackService.sendMessage(slackPayload);

      return { success: true, channel: 'slack', deliveredTo: channel.config.channel };

    } catch (error) {
      logger.error('Error delivering Slack notification', { error: error.message });
      return { success: false, channel: 'slack', error: error.message };
    }
  }

  /**
   * Deliver webhook notification
   */
  async deliverWebhook(channel, notification) {
    try {
      if (!this.webhookService) {
        return { success: false, channel: 'webhook', error: 'Webhook service not available' };
      }

      const webhookPayload = {
        notificationId: notification.id,
        type: notification.type,
        severity: notification.severity,
        title: notification.title,
        message: notification.message,
        timestamp: notification.timestamp,
        data: notification.data,
        recipients: notification.recipients,
        metadata: notification.metadata
      };

      // Send webhook
      await this.webhookService.send(channel.config.url, webhookPayload, {
        headers: channel.config.headers,
        timeout: 10000
      });

      return { success: true, channel: 'webhook', deliveredTo: channel.config.url };

    } catch (error) {
      logger.error('Error delivering webhook notification', { error: error.message });
      return { success: false, channel: 'webhook', error: error.message };
    }
  }

  /**
   * Determine appropriate channels for notification
   */
  determineChannels(notification) {
    const channels = [];

    // Always try WebSocket for real-time notifications
    if (this.options.enableWebSocket) {
      channels.push('websocket');
    }

    // Add channels based on severity
    switch (notification.severity) {
      case 'critical':
        if (this.options.enableEmail) channels.push('email');
        if (this.options.enableSMS) channels.push('sms');
        if (this.options.enableSlack) channels.push('slack');
        if (this.options.enableWebhook) channels.push('webhook');
        break;
      case 'high':
        if (this.options.enableEmail) channels.push('email');
        if (this.options.enableSlack) channels.push('slack');
        if (this.options.enableWebhook) channels.push('webhook');
        break;
      case 'medium':
        if (this.options.enableEmail) channels.push('email');
        if (this.options.enableSlack) channels.push('slack');
        break;
      case 'low':
        if (this.options.enableEmail) channels.push('email');
        break;
    }

    // Add channels based on notification type
    if (notification.type === 'incident_resolution') {
      // All resolved incidents get email notifications
      if (!channels.includes('email') && this.options.enableEmail) {
        channels.push('email');
      }
    }

    return Array.from(new Set(channels)); // Remove duplicates
  }

  /**
   * Check if notification is throttled
   */
  isThrottled(notification) {
    const now = Date.now();
    const windowStart = now - this.options.throttlingWindow;

    // Clean old throttling entries
    for (const [userId, data] of this.throttlingTracker.entries()) {
      if (data.windowStart < windowStart) {
        this.throttlingTracker.delete(userId);
      }
    }

    // Check current window
    const userData = this.throttlingTracker.get(notification.userId || 'anonymous');
    if (userData) {
      return userData.count >= this.options.maxNotificationsPerWindow;
    }

    // Initialize throttling tracker
    this.throttlingTracker.set(notification.userId || 'anonymous', {
      windowStart,
      count: 1
    });

    return false;
  }

  /**
   * Add notification to queue
   */
  addToQueue(notification) {
    this.notificationQueue.push(notification);

    // Maintain queue size
    if (this.notificationQueue.length > this.options.notificationQueueSize) {
      this.notificationQueue.shift(); // Remove oldest notification
    }
  }

  /**
   * Update notification status
   */
  updateNotificationStatus(notification, deliveryResults) {
    const successCount = deliveryResults.filter(r => r.value.success).length;
    const totalCount = deliveryResults.length;

    if (successCount === totalCount) {
      notification.deliveryStatus = 'delivered';
      notification.deliveredAt = Date.now();
    } else if (successCount > 0) {
      notification.deliveryStatus = 'partial';
      notification.partiallyDeliveredAt = Date.now();
    } else {
      notification.deliveryStatus = 'failed';
      notification.failedAt = Date.now();
    }

    notification.deliveryAttempts++;
    notification.channels = deliveryResults.map(r => r.value.channel);
    notification.deliveryResults = deliveryResults.map(r => r.value);

    // Track delivery
    this.deliveryTracker.set(notification.id, {
      notification,
      deliveryResults,
      lastUpdated: Date.now()
    });
  }

  /**
   * Update delivery statistics
   */
  updateDeliveryStatistics(deliveryResults) {
    for (const result of deliveryResults) {
      if (!result.value) continue;

      if (result.value.success) {
        this.statistics.deliveredNotifications++;
      } else {
        this.statistics.failedNotifications++;
      }

      // Update channel statistics
      const channelStats = this.statistics.notificationsByChannel.get(result.value.channel) || {
        total: 0,
        delivered: 0,
        failed: 0
      };
      channelStats.total++;
      if (result.value.success) {
        channelStats.delivered++;
      } else {
        channelStats.failed++;
      }
      this.statistics.notificationsByChannel.set(result.value.channel, channelStats);

      // Update type statistics
      const typeStats = this.statistics.notificationsByChannel.get('notification') || {
        total: 0,
        delivered: 0,
        failed: 0
      };
      typeStats.total++;
      if (result.value.success) {
        typeStats.delivered++;
      } else {
        typeStats.failed++;
      }
      this.statistics.notificationsByChannel.set('notification', typeStats);
    }
  }

  /**
   * Format SMS message
   */
  formatSMSMessage(notification) {
    const maxLength = 160;
    let message = `[${notification.severity.toUpperCase()}] ${notification.title}`;

    if (notification.message) {
      const remainingLength = maxLength - message.length - 4; // "..." + space
      if (notification.message.length > remainingLength) {
        message += ': ' + notification.message.substring(0, remainingLength - 3) + '...';
      } else {
        message += ': ' + notification.message;
      }
    }

    return message;
  }

  /**
   * Get Slack color based on severity
   */
  getSlackColor(severity) {
    const colors = {
      'critical': 'danger',
      'high': 'warning',
      'medium': 'warning',
      'low': 'good',
      'info': 'good'
    };
    return colors[severity] || 'good';
  }

  /**
   * Format Slack fields
   */
  formatSlackFields(notification) {
    const fields = [];

    if (notification.type) {
      fields.push({
        title: 'Type',
        value: notification.type,
        short: true
      });
    }

    if (notification.userId) {
      fields.push({
        title: 'User',
        value: notification.userId,
        short: true
      });
    }

    if (notification.ipAddress) {
      fields.push({
        title: 'IP Address',
        value: notification.ipAddress,
        short: true
      });
    }

    if (notification.location) {
      fields.push({
        title: 'Location',
        value: notification.location,
        short: true
      });
    }

    if (notification.data && Object.keys(notification.data).length > 0) {
      fields.push({
        title: 'Details',
        value: JSON.stringify(notification.data, null, 2),
        short: false
      });
    }

    return fields;
  }

  /**
   * Get notification delivery status
   */
  getNotificationStatus(notificationId) {
    return this.deliveryTracker.get(notificationId);
  }

  /**
   * Get recent notifications
   */
  getRecentNotifications(limit = 100, userId = null, severity = null, type = null) {
    let notifications = Array.from(this.deliveryTracker.values())
      .map(tracker => tracker.notification)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (userId) {
      notifications = notifications.filter(n => n.userId === userId);
    }

    if (severity) {
      notifications = notifications.filter(n => n.severity === severity);
    }

    if (type) {
      notifications = notifications.filter(n => n.type === type);
    }

    return notifications.slice(0, limit);
  }

  /**
   * Get statistics
   */
  getStatistics() {
    return {
      isInitialized: this.isInitialized,
      ...this.statistics,
      queueSize: this.notificationQueue.length,
      activeChannels: Array.from(this.channels.values()).filter(c => c.enabled).length,
      totalChannels: this.channels.size,
      throttlingEnabled: this.options.throttlingEnabled,
      throttlingWindow: this.options.throttlingWindow,
      maxNotificationsPerWindow: this.options.maxNotificationsPerWindow,
      processingInterval: 1000
    };
  }

  /**
   * Generate notification ID
   */
  generateNotificationId() {
    return `sec_notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      // Stop processing
      if (this.processingTimer) {
        clearInterval(this.processingTimer);
        this.processingTimer = null;
      }

      // Clear data structures
      this.notificationQueue = [];
      this.channels.clear();
      this.deliveryTracker.clear();
      this.throttlingTracker.clear();

      // Reset statistics
      this.statistics = {
        totalNotifications: 0,
        deliveredNotifications: 0,
        failedNotifications: 0,
        notificationsByChannel: new Map(),
        notificationsByType: new Map(),
        notificationsBySeverity: new Map()
      };

      this.isInitialized = false;

      logger.info('Security Notifier cleaned up');

    } catch (error) {
      logger.error('Error during Security Notifier cleanup', { error: error.message });
    }
  }
}

module.exports = SecurityNotifier;