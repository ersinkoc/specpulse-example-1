const emailService = require('../../auth/services/emailService');
const userPreferencesService = require('./userPreferencesService');
const logger = require('../shared/utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Notification Email Service
 * Handles sending notifications via email for offline users
 */
class NotificationEmailService {
  constructor() {
    this.emailService = emailService;
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Ensure the base email service is initialized
      if (!this.emailService.isConfigured) {
        await this.emailService.initialize();
      }

      this.isInitialized = true;
      logger.info('Notification email service initialized');
    } catch (error) {
      logger.error('Failed to initialize notification email service:', error);
      this.isInitialized = false;
    }
  }

  /**
   * Send notification via email
   */
  async sendNotificationEmail(userId, notificationData, options = {}) {
    try {
      if (!this.isInitialized) {
        throw new Error('Notification email service not initialized');
      }

      // Get user email and preferences
      const { user, preferences } = await this.getUserEmailAndPreferences(userId);

      if (!user || !user.email) {
        throw new Error('User email not found');
      }

      // Check if user has email notifications enabled for this category
      if (!this.shouldSendEmailNotification(preferences, notificationData)) {
        logger.info('Email notification skipped due to user preferences', {
          userId,
          category: notificationData.category
        });
        return {
          success: false,
          reason: 'Email notifications disabled for this category',
          skipped: true
        };
      }

      // Generate email content
      const emailContent = await this.generateNotificationEmail(user, notificationData, options);

      // Send email
      const result = await this.emailService.transporter.sendMail({
        from: this.emailService.transporter.options.from,
        to: user.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        ...options.emailOptions
      });

      logger.info('Notification email sent successfully', {
        userId,
        userEmail: user.email,
        notificationId: notificationData.id,
        messageId: result.messageId,
        category: notificationData.category,
        priority: notificationData.priority
      });

      return {
        success: true,
        messageId: result.messageId,
        userId,
        userEmail: user.email,
        deliveryMethod: 'email',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to send notification email:', error);
      return {
        success: false,
        error: error.message,
        userId,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Send bulk notification emails
   */
  async sendBulkNotificationEmails(userIds, notificationData, options = {}) {
    try {
      const {
        batchSize = 50,
        delayBetweenBatches = 1000,
        skipUnsubscribed = true
      } = options;

      const results = {
        successful: [],
        failed: [],
        skipped: [],
        total: userIds.length
      };

      // Process users in batches
      for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize);

        const batchPromises = batch.map(async (userId) => {
          try {
            const result = await this.sendNotificationEmail(userId, notificationData, options);

            if (result.success) {
              results.successful.push(result);
            } else if (result.skipped) {
              results.skipped.push({ userId, reason: result.reason });
            } else {
              results.failed.push({ userId, error: result.error });
            }
          } catch (error) {
            results.failed.push({ userId, error: error.message });
          }
        });

        await Promise.all(batchPromises);

        // Add delay between batches to avoid rate limiting
        if (i + batchSize < userIds.length && delayBetweenBatches > 0) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
      }

      logger.info('Bulk notification emails completed', {
        total: results.total,
        successful: results.successful.length,
        failed: results.failed.length,
        skipped: results.skipped.length
      });

      return results;

    } catch (error) {
      logger.error('Failed to send bulk notification emails:', error);
      throw error;
    }
  }

  /**
   * Check if email notification should be sent based on user preferences
   */
  shouldSendEmailNotification(preferences, notificationData) {
    // Check if email notifications are globally enabled
    if (!preferences.emailNotificationsEnabled) {
      return false;
    }

    // Check category-specific email preferences
    const categoryPref = preferences.categoryPreferences[notificationData.category];
    if (!categoryPref || !categoryPref.emailEnabled) {
      return false;
    }

    // Check quiet hours
    if (preferences.quietHoursEnabled && this.isQuietHours(preferences)) {
      // During quiet hours, only send high/critical priority emails
      if (!['high', 'critical'].includes(notificationData.priority)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if current time is within quiet hours
   */
  isQuietHours(preferences) {
    if (!preferences.quietHoursEnabled || !preferences.quietHours) {
      return false;
    }

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const startTime = preferences.quietHours.startHour * 60 + preferences.quietHours.startMinute;
    const endTime = preferences.quietHours.endHour * 60 + preferences.quietHours.endMinute;

    if (startTime <= endTime) {
      // Same day range (e.g., 22:00 to 07:00)
      return currentTime >= startTime && currentTime < endTime;
    } else {
      // Overnight range (e.g., 22:00 to 07:00 next day)
      return currentTime >= startTime || currentTime < endTime;
    }
  }

  /**
   * Get user email and preferences
   */
  async getUserEmailAndPreferences(userId) {
    try {
      // Get user with email
      const db = require('../database/connection');
      const userQuery = 'SELECT id, email, name, username FROM users WHERE id = $1';
      const userResult = await db.query(userQuery, [userId]);

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = userResult.rows[0];

      // Get user preferences
      const preferences = await userPreferencesService.getUserPreferences(userId);

      return { user, preferences };
    } catch (error) {
      logger.error('Failed to get user email and preferences:', error);
      throw error;
    }
  }

  /**
   * Generate email content for notification
   */
  async generateNotificationEmail(user, notificationData, options = {}) {
    const {
      title,
      message,
      category,
      priority,
      data = {},
      expiresAt,
      actions = []
    } = notificationData;

    // Generate subject based on priority and category
    const subjectPrefix = this.getSubjectPrefix(priority);
    const categoryLabel = this.getCategoryLabel(category);
    const subject = `${subjectPrefix} ${categoryLabel}: ${title}`;

    // Generate HTML email
    const html = this.getNotificationEmailTemplate(user, {
      title,
      message,
      category,
      priority,
      categoryLabel,
      data,
      expiresAt,
      actions,
      ...options
    });

    // Generate plain text version
    const text = this.getNotificationEmailText(user, {
      title,
      message,
      category,
      priority,
      categoryLabel,
      data,
      expiresAt,
      actions,
      ...options
    });

    return { subject, html, text };
  }

  /**
   * Get subject prefix based on priority
   */
  getSubjectPrefix(priority) {
    const prefixes = {
      low: 'ℹ️',
      medium: '📢',
      high: '⚠️',
      critical: '🚨'
    };
    return prefixes[priority] || '📢';
  }

  /**
   * Get category label
   */
  getCategoryLabel(category) {
    const labels = {
      security: 'Security Alert',
      system: 'System Update',
      social: 'Social Activity',
      task: 'Task Reminder',
      administrative: 'Administrative'
    };
    return labels[category] || 'Notification';
  }

  /**
   * Generate HTML email template
   */
  getNotificationEmailTemplate(user, notificationData) {
    const {
      title,
      message,
      category,
      priority,
      categoryLabel,
      data,
      expiresAt,
      actions,
      customMessage = ''
    } = notificationData;

    const priorityColors = {
      low: '#3498db',
      medium: '#f39c12',
      high: '#e67e22',
      critical: '#e74c3c'
    };

    const categoryIcons = {
      security: '🔒',
      system: '⚙️',
      social: '💬',
      task: '✅',
      administrative: '⚡'
    };

    const priorityColor = priorityColors[priority] || '#f39c12';
    const categoryIcon = categoryIcons[category] || '📢';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
          .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { background: ${priorityColor}; color: white; padding: 20px; text-align: center; position: relative; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
          .header .category { font-size: 14px; opacity: 0.9; margin-top: 5px; }
          .header .icon { font-size: 48px; position: absolute; right: 20px; top: 50%; transform: translateY(-50%); }
          .content { padding: 30px; }
          .greeting { font-size: 18px; font-weight: 600; margin-bottom: 15px; color: #2c3e50; }
          .message { margin-bottom: 20px; line-height: 1.6; }
          .custom-message { background: #f8f9fa; border-left: 4px solid ${priorityColor}; padding: 15px; margin: 20px 0; border-radius: 0 4px 4px 0; }
          .actions { margin: 25px 0; }
          .action-button { display: inline-block; margin: 5px; padding: 12px 20px; background: ${priorityColor}; color: white; text-decoration: none; border-radius: 5px; font-weight: 500; }
          .action-button:hover { background: ${this.darkenColor(priorityColor)}; }
          .metadata { background: #f8f9fa; padding: 15px; border-radius: 4px; font-size: 12px; color: #6c757d; margin-top: 20px; }
          .metadata .item { margin: 5px 0; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #6c757d; background: #f8f9fa; border-top: 1px solid #e9ecef; }
          .priority-badge { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; background: ${priorityColor}; color: white; }
          @media (max-width: 600px) {
            .container { margin: 10px; }
            .header .icon { display: none; }
            .content { padding: 20px; }
            .action-button { display: block; width: 100%; margin: 10px 0; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${title}</h1>
            <div class="category">${categoryIcon} ${categoryLabel}</div>
            <div class="icon">${this.getSubjectPrefix(priority)}</div>
          </div>
          <div class="content">
            <p class="greeting">Hi ${user.name || user.username},</p>
            <div class="message">${message}</div>
            ${customMessage ? `<div class="custom-message">${customMessage}</div>` : ''}
            ${actions && actions.length > 0 ? `
              <div class="actions">
                <h3>Actions you can take:</h3>
                ${actions.map(action => `
                  <a href="${action.url}" class="action-button">${action.label || 'View Details'}</a>
                `).join('')}
              </div>
            ` : ''}
            <div class="metadata">
              <div class="item"><strong>Priority:</strong> <span class="priority-badge">${priority}</span></div>
              <div class="item"><strong>Category:</strong> ${categoryLabel}</div>
              <div class="item"><strong>Received:</strong> ${new Date().toLocaleString()}</div>
              ${expiresAt ? `<div class="item"><strong>Expires:</strong> ${new Date(expiresAt).toLocaleString()}</div>` : ''}
              ${data && Object.keys(data).length > 0 ? `
                <div class="item"><strong>Additional Info:</strong></div>
                ${Object.entries(data).map(([key, value]) =>
                  `<div class="item" style="margin-left: 10px;">• ${key}: ${value}</div>`
                ).join('')}
              ` : ''}
            </div>
          </div>
          <div class="footer">
            <p>This notification was sent because you have subscribed to ${categoryLabel} notifications.</p>
            <p>You can manage your notification preferences in your account settings.</p>
            <p>&copy; ${new Date().getFullYear()} Your Application. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate plain text email template
   */
  getNotificationEmailText(user, notificationData) {
    const { title, message, category, priority, categoryLabel, data, expiresAt, actions } = notificationData;

    let text = `${this.getSubjectPrefix(priority)} ${categoryLabel}: ${title}\n\n`;
    text += `Hi ${user.name || user.username},\n\n`;
    text += `${message}\n\n`;

    if (actions && actions.length > 0) {
      text += `Actions you can take:\n`;
      actions.forEach(action => {
        text += `- ${action.label || 'View Details'}: ${action.url}\n`;
      });
      text += '\n';
    }

    text += `---\n`;
    text += `Priority: ${priority.toUpperCase()}\n`;
    text += `Category: ${categoryLabel}\n`;
    text += `Received: ${new Date().toLocaleString()}\n`;
    if (expiresAt) {
      text += `Expires: ${new Date(expiresAt).toLocaleString()}\n`;
    }

    if (data && Object.keys(data).length > 0) {
      text += `Additional Information:\n`;
      Object.entries(data).forEach(([key, value]) => {
        text += `- ${key}: ${value}\n`;
      });
    }

    text += `\n---\n`;
    text += `This notification was sent because you have subscribed to ${categoryLabel} notifications.\n`;
    text += `You can manage your notification preferences in your account settings.\n`;
    text += `© ${new Date().getFullYear()} Your Application. All rights reserved.\n`;

    return text;
  }

  /**
   * Darken a color for hover states
   */
  darkenColor(color) {
    // Simple color darkening - in production, use a proper color library
    const colors = {
      '#3498db': '#2980b9',
      '#f39c12': '#e67e22',
      '#e67e22': '#d35400',
      '#e74c3c': '#c0392b'
    };
    return colors[color] || color;
  }

  /**
   * Send notification summary email (daily/weekly digest)
   */
  async sendNotificationDigest(userId, notifications, frequency = 'daily') {
    try {
      const { user, preferences } = await this.getUserEmailAndPreferences(userId);

      if (!user || !user.email) {
        throw new Error('User email not found');
      }

      const emailContent = this.generateDigestEmail(user, notifications, frequency);

      const result = await this.emailService.transporter.sendMail({
        from: this.emailService.transporter.options.from,
        to: user.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text
      });

      logger.info('Notification digest email sent', {
        userId,
        frequency,
        notificationCount: notifications.length,
        messageId: result.messageId
      });

      return {
        success: true,
        messageId: result.messageId,
        notificationCount: notifications.length
      };

    } catch (error) {
      logger.error('Failed to send notification digest:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate digest email content
   */
  generateDigestEmail(user, notifications, frequency) {
    const subject = `Your ${frequency} notification summary - ${notifications.length} new notifications`;

    // Group notifications by category
    const groupedNotifications = notifications.reduce((groups, notification) => {
      const category = notification.category || 'general';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(notification);
      return groups;
    }, {});

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Notification Digest</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
          .container { max-width: 700px; margin: 20px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 28px; font-weight: 600; }
          .header .subtitle { margin-top: 10px; opacity: 0.9; }
          .content { padding: 30px; }
          .summary { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; text-align: center; }
          .summary .count { font-size: 48px; font-weight: bold; color: #667eea; margin: 0; }
          .summary .label { font-size: 16px; color: #6c757d; }
          .category-section { margin-bottom: 30px; }
          .category-title { font-size: 20px; font-weight: 600; color: #2c3e50; margin-bottom: 15px; border-bottom: 2px solid #e9ecef; padding-bottom: 8px; }
          .notification-item { background: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 10px; border-left: 4px solid #667eea; }
          .notification-title { font-weight: 600; margin-bottom: 5px; }
          .notification-message { color: #6c757d; font-size: 14px; margin-bottom: 8px; }
          .notification-meta { font-size: 12px; color: #adb5bd; }
          .priority-badge { display: inline-block; padding: 2px 6px; border-radius: 8px; font-size: 10px; font-weight: 600; text-transform: uppercase; }
          .priority-low { background: #d1ecf1; color: #0c5460; }
          .priority-medium { background: #fff3cd; color: #856404; }
          .priority-high { background: #f8d7da; color: #721c24; }
          .priority-critical { background: #f5c6cb; color: #721c24; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #6c757d; background: #f8f9fa; border-top: 1px solid #e9ecef; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📬 Your ${frequency} Summary</h1>
            <div class="subtitle">Here's what you missed while you were away</div>
          </div>
          <div class="content">
            <div class="summary">
              <div class="count">${notifications.length}</div>
              <div class="label">New Notifications</div>
            </div>
            ${Object.entries(groupedNotifications).map(([category, categoryNotifications]) => `
              <div class="category-section">
                <h2 class="category-title">${this.getCategoryLabel(category)} (${categoryNotifications.length})</h2>
                ${categoryNotifications.map(notification => `
                  <div class="notification-item">
                    <div class="notification-title">${notification.title}</div>
                    <div class="notification-message">${notification.message}</div>
                    <div class="notification-meta">
                      <span class="priority-badge priority-${notification.priority}">${notification.priority}</span>
                      ${new Date(notification.createdAt).toLocaleString()}
                    </div>
                  </div>
                `).join('')}
              </div>
            `).join('')}
          </div>
          <div class="footer">
            <p>You're receiving this digest because you've enabled ${frequency} email summaries.</p>
            <p>You can change your notification preferences anytime in your account settings.</p>
            <p>&copy; ${new Date().getFullYear()} Your Application. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `Your ${frequency} notification summary\n\n` +
      `Hi ${user.name || user.username},\n\n` +
      `You have ${notifications.length} new notifications:\n\n` +
      Object.entries(groupedNotifications).map(([category, categoryNotifications]) =>
        `${this.getCategoryLabel(category)} (${categoryNotifications.length}):\n` +
        categoryNotifications.map(notification =>
          `- ${notification.title}: ${notification.message}\n  ${new Date(notification.createdAt).toLocaleString()}\n`
        ).join('')
      ).join('\n') +
      `\n\nYou can manage your notification preferences in your account settings.\n` +
      `© ${new Date().getFullYear()} Your Application. All rights reserved.`;

    return { subject, html, text };
  }

  /**
   * Health check
   */
  async healthCheck() {
    const baseHealth = await this.emailService.healthCheck();

    return {
      ...baseHealth,
      service: 'notification-email',
      initialized: this.isInitialized,
      timestamp: new Date().toISOString()
    };
  }
}

// Create singleton instance
const notificationEmailService = new NotificationEmailService();

module.exports = notificationEmailService;