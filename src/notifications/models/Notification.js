const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../shared/utils/logger');

/**
 * Notification Model
 * Database model for notification operations
 */
class Notification {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }

  /**
   * Create a new notification
   */
  async create(notificationData) {
    const client = await this.pool.connect();
    try {
      const {
        userId,
        title,
        message,
        category,
        type,
        priority = 'medium',
        data = {},
        expiresIn = 86400000, // 24 hours default
        actions = []
      } = notificationData;

      const expiresAt = expiresIn > 0 ?
        new Date(Date.now() + expiresIn) : null;

      const query = `
        INSERT INTO notifications (
          id, user_id, title, message, category, type, priority,
          data, expires_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ) RETURNING *
      `;

      const values = [
        uuidv4(),
        userId,
        title,
        message,
        category,
        type,
        priority,
        JSON.stringify(data),
        expiresAt
      ];

      const result = await client.query(query, values);
      const notification = result.rows[0];

      // Create notification actions if provided
      if (actions && actions.length > 0) {
        await this.createActions(notification.id, actions);
      }

      // Create delivery tracking entries
      await this.createDeliveryTracking(notification.id);

      logger.info(`Notification created: ${notification.id} for user ${userId}`);
      return notification;

    } catch (error) {
      logger.error('Failed to create notification:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get notifications for a user
   */
  async getByUserId(userId, options = {}) {
    const client = await this.pool.connect();
    try {
      const {
        limit = 50,
        offset = 0,
        category,
        unreadOnly = false,
        includeActions = true,
        includeDelivery = false
      } = options;

      let query = `
        SELECT
          n.*,
          CASE WHEN n.read_at IS NULL THEN true ELSE false END as unread
        FROM notifications n
        WHERE n.user_id = $1
      `;

      const values = [userId];

      if (category) {
        query += ` AND n.category = $${values.length + 1}`;
        values.push(category);
      }

      if (unreadOnly) {
        query += ` AND n.read_at IS NULL`;
      }

      query += ` ORDER BY n.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
      values.push(limit, offset);

      const result = await client.query(query);
      const notifications = result.rows;

      // Include actions if requested
      if (includeActions) {
        for (const notification of notifications) {
          notification.actions = await this.getActions(notification.id);
        }
      }

      // Include delivery status if requested
      if (includeDelivery) {
        for (const notification of notifications) {
          notification.delivery = await this.getDeliveryStatus(notification.id);
        }
      }

      return notifications;

    } catch (error) {
      logger.error('Failed to get notifications for user:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get a specific notification by ID
   */
  async getById(notificationId, options = {}) {
    const client = await this.pool.connect();
    try {
      const { includeActions = true, includeDelivery = false } = options;

      const query = `
        SELECT
          n.*,
          CASE WHEN n.read_at IS NULL THEN true ELSE false END as unread
        FROM notifications n
        WHERE n.id = $1
      `;

      const result = await client.query(query, [notificationId]);

      if (result.rows.length === 0) {
        return null;
      }

      const notification = result.rows[0];

      // Include actions if requested
      if (includeActions) {
        notification.actions = await this.getActions(notificationId);
      }

      // Include delivery status if requested
      if (includeDelivery) {
        notification.delivery = await this.getDeliveryStatus(notificationId);
      }

      return notification;

    } catch (error) {
      logger.error('Failed to get notification by ID:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE notifications
        SET read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND read_at IS NULL
        RETURNING *
      `;

      const result = await client.query(query, [notificationId]);

      if (result.rows.length === 0) {
        return null; // Already read or doesn't exist
      }

      logger.info(`Notification marked as read: ${notificationId}`);
      return result.rows[0];

    } catch (error) {
      logger.error('Failed to mark notification as read:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Mark multiple notifications as read
   */
  async markMultipleAsRead(notificationIds, userId) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE notifications
        SET read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1) AND user_id = $2 AND read_at IS NULL
        RETURNING id
      `;

      const result = await client.query(query, [notificationIds, userId]);

      logger.info(`Marked ${result.rows.length} notifications as read for user ${userId}`);
      return result.rows.map(row => row.id);

    } catch (error) {
      logger.error('Failed to mark multiple notifications as read:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE notifications
        SET read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND read_at IS NULL
        RETURNING id
      `;

      const result = await client.query(query, [userId]);

      logger.info(`Marked all notifications as read for user ${userId}: ${result.rows.length} notifications`);
      return result.rows.length;

    } catch (error) {
      logger.error('Failed to mark all notifications as read:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete a notification
   */
  async delete(notificationId) {
    const client = await this.pool.connect();
    try {
      const query = 'DELETE FROM notifications WHERE id = $1 RETURNING id';
      const result = await client.query(query, [notificationId]);

      if (result.rows.length === 0) {
        return false;
      }

      logger.info(`Notification deleted: ${notificationId}`);
      return true;

    } catch (error) {
      logger.error('Failed to delete notification:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(userId, category = null) {
    const client = await this.pool.connect();
    try {
      let query = `
        SELECT COUNT(*) as count
        FROM notifications
        WHERE user_id = $1 AND read_at IS NULL
      `;

      const values = [userId];

      if (category) {
        query += ` AND category = $2`;
        values.push(category);
      }

      const result = await client.query(query, values);
      return parseInt(result.rows[0].count);

    } catch (error) {
      logger.error('Failed to get unread count:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create notification actions
   */
  async createActions(notificationId, actions) {
    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO notification_actions (
          id, notification_id, action_id, label, url, action_type,
          style, action_data, created_at
        ) VALUES
      `;

      const values = [];
      const params = [];

      actions.forEach((action, index) => {
        const paramIndex = index * 8 + 1;
        params.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, CURRENT_TIMESTAMP)`);

        values.push(
          uuidv4(),
          notificationId,
          action.id,
          action.label,
          action.url || null,
          action.action || action.action_type,
          action.style || 'primary',
          JSON.stringify(action.data || {})
        );
      });

      query += params.join(', ');
      await client.query(query, values);

    } catch (error) {
      logger.error('Failed to create notification actions:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get actions for a notification
   */
  async getActions(notificationId) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT * FROM notification_actions
        WHERE notification_id = $1
        ORDER BY id
      `;

      const result = await client.query(query, [notificationId]);
      return result.rows;

    } catch (error) {
      logger.error('Failed to get notification actions:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create delivery tracking entries
   */
  async createDeliveryTracking(notificationId, channels = ['websocket']) {
    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO notification_delivery (
          id, notification_id, channel, status, created_at
        ) VALUES
      `;

      const values = [];
      const params = [];

      channels.forEach((channel, index) => {
        const paramIndex = index * 4 + 1;
        params.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, 'pending', CURRENT_TIMESTAMP)`);

        values.push(
          uuidv4(),
          notificationId,
          channel
        );
      });

      query += params.join(', ');
      await client.query(query, values);

    } catch (error) {
      logger.error('Failed to create delivery tracking:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get delivery status for a notification
   */
  async getDeliveryStatus(notificationId) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT * FROM notification_delivery
        WHERE notification_id = $1
        ORDER BY created_at
      `;

      const result = await client.query(query, [notificationId]);
      return result.rows;

    } catch (error) {
      logger.error('Failed to get delivery status:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update delivery status
   */
  async updateDeliveryStatus(deliveryId, status, options = {}) {
    const client = await this.pool.connect();
    try {
      const {
        sentAt,
        deliveredAt,
        failureReason,
        retryCount,
        nextRetryAt
      } = options;

      let query = `
        UPDATE notification_delivery
        SET status = $1, updated_at = CURRENT_TIMESTAMP
      `;

      const values = [status];
      let paramIndex = 2;

      if (sentAt) {
        query += `, sent_at = $${paramIndex}`;
        values.push(sentAt);
        paramIndex++;
      }

      if (deliveredAt) {
        query += `, delivered_at = $${paramIndex}`;
        values.push(deliveredAt);
        paramIndex++;
      }

      if (failureReason) {
        query += `, failure_reason = $${paramIndex}`;
        values.push(failureReason);
        paramIndex++;
      }

      if (retryCount !== undefined) {
        query += `, retry_count = $${paramIndex}`;
        values.push(retryCount);
        paramIndex++;
      }

      if (nextRetryAt) {
        query += `, next_retry_at = $${paramIndex}`;
        values.push(nextRetryAt);
        paramIndex++;
      }

      query += ` WHERE id = $${paramIndex} RETURNING *`;
      values.push(deliveryId);

      const result = await client.query(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];

    } catch (error) {
      logger.error('Failed to update delivery status:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cleanup expired notifications
   */
  async cleanupExpired() {
    const client = await this.pool.connect();
    try {
      const query = `
        WITH deleted AS (
          DELETE FROM notifications
          WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP
          RETURNING id
        )
        SELECT COUNT(*) as count FROM deleted
      `;

      const result = await client.query(query);
      const count = parseInt(result.rows[0].count);

      if (count > 0) {
        logger.info(`Cleaned up ${count} expired notifications`);
      }

      return count;

    } catch (error) {
      logger.error('Failed to cleanup expired notifications:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get notification statistics
   */
  async getStatistics(userId = null, dateRange = 30) {
    const client = await this.pool.connect();
    try {
      let query = `
        SELECT
          category,
          priority,
          COUNT(*) as total,
          COUNT(CASE WHEN read_at IS NULL THEN 1 END) as unread,
          COUNT(CASE WHEN read_at IS NOT NULL THEN 1 END) as read,
          DATE(created_at) as date
        FROM notifications
        WHERE created_at >= CURRENT_DATE - INTERVAL '${dateRange} days'
      `;

      const values = [];

      if (userId) {
        query += ` AND user_id = $1`;
        values.push(userId);
      }

      query += `
        GROUP BY category, priority, DATE(created_at)
        ORDER BY date DESC, category, priority
      `;

      const result = await client.query(query, values);
      return result.rows;

    } catch (error) {
      logger.error('Failed to get notification statistics:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Close database connection
   */
  async close() {
    await this.pool.end();
  }
}

module.exports = Notification;