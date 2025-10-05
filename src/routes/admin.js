const express = require('express');
const { body, validationResult, query } = require('express-validator');
const auth = require('../auth/middleware/authMiddleware');
const notificationService = require('../services/notificationService');
const userPreferencesService = require('../services/userPreferencesService');
const notificationTemplateService = require('../services/notificationTemplateService');
const rateLimitService = require('../services/rateLimitService');
const db = require('../database/connection');
const logger = require('../shared/utils/logger');

const router = express.Router();

/**
 * Middleware to ensure admin access
 */
const requireAdmin = auth.requireRole(['admin']);

/**
 * Middleware to handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

/**
 * GET /api/admin/notifications
 * Get all notifications with advanced filtering (admin only)
 */
router.get('/notifications',
  auth.authenticate,
  requireAdmin,
  [
    query('limit').optional().isInt({ min: 1, max: 500 }).withMessage('Limit must be between 1 and 500'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
    query('userId').optional().isUUID().withMessage('User ID must be a valid UUID'),
    query('category').optional().isIn(['security', 'system', 'social', 'task', 'administrative'])
      .withMessage('Invalid category'),
    query('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid priority'),
    query('status').optional().isIn(['read', 'unread']).withMessage('Status must be read or unread'),
    query('dateFrom').optional().isISO8601().withMessage('dateFrom must be a valid date'),
    query('dateTo').optional().isISO8601().withMessage('dateTo must be a valid date'),
    query('type').optional().isString().withMessage('Type must be a string'),
    query('deliveryStatus').optional().isIn(['pending', 'sent', 'delivered', 'failed', 'expired', 'blocked'])
      .withMessage('Invalid delivery status')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        limit = 100,
        offset = 0,
        userId,
        category,
        priority,
        status,
        dateFrom,
        dateTo,
        type,
        deliveryStatus
      } = req.query;

      // Build WHERE conditions
      let whereConditions = [];
      let queryParams = [];
      let paramIndex = 1;

      if (userId) {
        whereConditions.push(`n.user_id = $${paramIndex++}`);
        queryParams.push(userId);
      }

      if (category) {
        whereConditions.push(`n.category = $${paramIndex++}`);
        queryParams.push(category);
      }

      if (priority) {
        whereConditions.push(`n.priority = $${paramIndex++}`);
        queryParams.push(priority);
      }

      if (status === 'read') {
        whereConditions.push(`n.read_at IS NOT NULL`);
      } else if (status === 'unread') {
        whereConditions.push(`n.read_at IS NULL`);
      }

      if (dateFrom) {
        whereConditions.push(`n.created_at >= $${paramIndex++}`);
        queryParams.push(dateFrom);
      }

      if (dateTo) {
        whereConditions.push(`n.created_at <= $${paramIndex++}`);
        queryParams.push(dateTo);
      }

      if (type) {
        whereConditions.push(`n.type = $${paramIndex++}`);
        queryParams.push(type);
      }

      if (deliveryStatus) {
        whereConditions.push(`nd.status = $${paramIndex++}`);
        queryParams.push(deliveryStatus);
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      const query = `
        SELECT
          n.*,
          u.email as user_email,
          u.roles as user_roles,
          COALESCE(
            json_agg(
              json_build_object(
                'channel', nd.channel,
                'status', nd.status,
                'sent_at', nd.sent_at,
                'delivered_at', nd.delivered_at,
                'failure_reason', nd.failure_reason,
                'retry_count', nd.retry_count
              )
            ) FILTER (WHERE nd.id IS NOT NULL),
            '[]'::json
          ) as delivery_status
        FROM notifications n
        LEFT JOIN users u ON n.user_id = u.id
        LEFT JOIN notification_delivery nd ON n.id = nd.notification_id
        ${whereClause}
        GROUP BY n.id, u.email, u.roles
        ORDER BY n.created_at DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;

      queryParams.push(parseInt(limit), parseInt(offset));

      const result = await db.query(query, queryParams);

      // Get total count
      const countQuery = `
        SELECT COUNT(DISTINCT n.id) as total
        FROM notifications n
        LEFT JOIN users u ON n.user_id = u.id
        LEFT JOIN notification_delivery nd ON n.id = nd.notification_id
        ${whereClause}
      `;

      const countResult = await db.query(countQuery, queryParams.slice(0, -2));
      const total = parseInt(countResult.rows[0].total);

      res.json({
        success: true,
        data: {
          notifications: result.rows,
          pagination: {
            total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            pages: Math.ceil(total / parseInt(limit))
          },
          filters: {
            userId,
            category,
            priority,
            status,
            dateFrom,
            dateTo,
            type,
            deliveryStatus
          }
        },
        message: `Retrieved ${result.rows.length} notifications`
      });

    } catch (error) {
      logger.error('Failed to get admin notifications:', error);
      res.status(500).json({
        error: 'Failed to retrieve notifications',
        message: 'An error occurred while retrieving notifications'
      });
    }
  }
);

/**
 * GET /api/admin/notifications/stats
 * Get comprehensive notification statistics (admin only)
 */
router.get('/notifications/stats',
  auth.authenticate,
  requireAdmin,
  [
    query('dateFrom').optional().isISO8601().withMessage('dateFrom must be a valid date'),
    query('dateTo').optional().isISO8601().withMessage('dateTo must be a valid date'),
    query('groupBy').optional().isIn(['day', 'week', 'month']).withMessage('Invalid groupBy parameter')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { dateFrom, dateTo, groupBy = 'day' } = req.query;

      // Build date filter
      let dateFilter = '';
      const queryParams = [];
      let paramIndex = 1;

      if (dateFrom) {
        dateFilter += ` AND n.created_at >= $${paramIndex++}`;
        queryParams.push(dateFrom);
      }

      if (dateTo) {
        dateFilter += ` AND n.created_at <= $${paramIndex++}`;
        queryParams.push(dateTo);
      }

      // Overall statistics
      const overallQuery = `
        SELECT
          COUNT(*) as total_notifications,
          COUNT(CASE WHEN n.read_at IS NULL THEN 1 END) as unread_notifications,
          COUNT(CASE WHEN n.read_at IS NOT NULL THEN 1 END) as read_notifications,
          COUNT(CASE WHEN nd.status = 'delivered' THEN 1 END) as delivered_notifications,
          COUNT(CASE WHEN nd.status = 'sent' THEN 1 END) as sent_notifications,
          COUNT(CASE WHEN nd.status = 'failed' THEN 1 END) as failed_notifications,
          COUNT(CASE WHEN nd.status = 'blocked' THEN 1 END) as blocked_notifications,
          COUNT(DISTINCT n.user_id) as unique_users,
          AVG(CASE WHEN n.read_at IS NOT NULL THEN
            EXTRACT(EPOCH FROM (n.read_at - n.created_at))/60
          END) as avg_read_time_minutes
        FROM notifications n
        LEFT JOIN notification_delivery nd ON n.id = nd.notification_id
        WHERE 1=1 ${dateFilter}
      `;

      const overallResult = await db.query(overallQuery, queryParams);

      // Category breakdown
      const categoryQuery = `
        SELECT
          n.category,
          COUNT(*) as total,
          COUNT(CASE WHEN n.read_at IS NULL THEN 1 END) as unread,
          COUNT(CASE WHEN nd.status = 'delivered' THEN 1 END) as delivered,
          COUNT(CASE WHEN nd.status = 'failed' THEN 1 END) as failed
        FROM notifications n
        LEFT JOIN notification_delivery nd ON n.id = nd.notification_id
        WHERE 1=1 ${dateFilter}
        GROUP BY n.category
        ORDER BY total DESC
      `;

      const categoryResult = await db.query(categoryQuery, queryParams);

      // Priority breakdown
      const priorityQuery = `
        SELECT
          n.priority,
          COUNT(*) as total,
          COUNT(CASE WHEN n.read_at IS NULL THEN 1 END) as unread,
          COUNT(CASE WHEN nd.status = 'delivered' THEN 1 END) as delivered,
          COUNT(CASE WHEN nd.status = 'failed' THEN 1 END) as failed
        FROM notifications n
        LEFT JOIN notification_delivery nd ON n.id = nd.notification_id
        WHERE 1=1 ${dateFilter}
        GROUP BY n.priority
        ORDER BY
          CASE n.priority
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
          END
      `;

      const priorityResult = await db.query(priorityQuery, queryParams);

      // Time series data
      let timeSeriesQuery;
      if (groupBy === 'day') {
        timeSeriesQuery = `
          SELECT
            DATE(n.created_at) as date,
            COUNT(*) as total,
            COUNT(CASE WHEN nd.status = 'delivered' THEN 1 END) as delivered,
            COUNT(CASE WHEN nd.status = 'failed' THEN 1 END) as failed
          FROM notifications n
          LEFT JOIN notification_delivery nd ON n.id = nd.notification_id
          WHERE 1=1 ${dateFilter}
          GROUP BY DATE(n.created_at)
          ORDER BY date DESC
          LIMIT 30
        `;
      } else if (groupBy === 'week') {
        timeSeriesQuery = `
          SELECT
            DATE_TRUNC('week', n.created_at) as date,
          COUNT(*) as total,
            COUNT(CASE WHEN nd.status = 'delivered' THEN 1 END) as delivered,
            COUNT(CASE WHEN nd.status = 'failed' THEN 1 END) as failed
          FROM notifications n
          LEFT JOIN notification_delivery nd ON n.id = nd.notification_id
          WHERE 1=1 ${dateFilter}
          GROUP BY DATE_TRUNC('week', n.created_at)
          ORDER BY date DESC
          LIMIT 12
        `;
      } else {
        timeSeriesQuery = `
          SELECT
            DATE_TRUNC('month', n.created_at) as date,
            COUNT(*) as total,
            COUNT(CASE WHEN nd.status = 'delivered' THEN 1 END) as delivered,
            COUNT(CASE WHEN nd.status = 'failed' THEN 1 END) as failed
          FROM notifications n
          LEFT JOIN notification_delivery nd ON n.id = nd.notification_id
          WHERE 1=1 ${dateFilter}
          GROUP BY DATE_TRUNC('month', n.created_at)
          ORDER BY date DESC
          LIMIT 12
        `;
      }

      const timeSeriesResult = await db.query(timeSeriesQuery, queryParams);

      // Delivery channel stats
      const channelQuery = `
        SELECT
          nd.channel,
          COUNT(*) as total,
          COUNT(CASE WHEN nd.status = 'delivered' THEN 1 END) as delivered,
          COUNT(CASE WHEN nd.status = 'sent' THEN 1 END) as sent,
          COUNT(CASE WHEN nd.status = 'failed' THEN 1 END) as failed,
          COUNT(CASE WHEN nd.status = 'blocked' THEN 1 END) as blocked
        FROM notification_delivery nd
        WHERE nd.created_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY nd.channel
        ORDER BY total DESC
      `;

      const channelResult = await db.query(channelQuery);

      // Top users by notification count
      const topUsersQuery = `
        SELECT
          u.id as user_id,
          u.email,
          COUNT(*) as notification_count,
          COUNT(CASE WHEN n.read_at IS NULL THEN 1 END) as unread_count
        FROM notifications n
        JOIN users u ON n.user_id = u.id
        WHERE 1=1 ${dateFilter}
        GROUP BY u.id, u.email
        ORDER BY notification_count DESC
        LIMIT 10
      `;

      const topUsersResult = await db.query(topUsersQuery, queryParams);

      const stats = {
        overall: overallResult.rows[0],
        categoryBreakdown: categoryResult.rows,
        priorityBreakdown: priorityResult.rows,
        timeSeries: timeSeriesResult.rows,
        channelStats: channelResult.rows,
        topUsers: topUsersResult.rows,
        generatedAt: new Date().toISOString(),
        filters: { dateFrom, dateTo, groupBy }
      };

      res.json({
        success: true,
        data: stats,
        message: 'Notification statistics retrieved successfully'
      });

    } catch (error) {
      logger.error('Failed to get admin notification stats:', error);
      res.status(500).json({
        error: 'Failed to retrieve statistics',
        message: 'An error occurred while retrieving notification statistics'
      });
    }
  }
);

/**
 * POST /api/admin/notifications/send
 * Send notification to specific user (admin override)
 */
router.post('/notifications/send',
  auth.authenticate,
  requireAdmin,
  [
    body('userId').isUUID().withMessage('User ID must be a valid UUID'),
    body('title').isLength({ min: 1, max: 255 }).withMessage('Title must be 1-255 characters'),
    body('message').isLength({ min: 1, max: 2000 }).withMessage('Message must be 1-2000 characters'),
    body('category').isIn(['security', 'system', 'social', 'task', 'administrative'])
      .withMessage('Invalid category'),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid priority'),
    body('type').optional().isString().withMessage('Type must be a string'),
    body('data').optional().isObject().withMessage('Data must be an object'),
    body('expiresAt').optional().isISO8601().withMessage('expiresAt must be a valid date'),
    body('actions').optional().isArray().withMessage('Actions must be an array'),
    body('overridePreferences').optional().isBoolean().withMessage('overridePreferences must be boolean')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        userId,
        title,
        message,
        category,
        priority = 'medium',
        type,
        data,
        expiresAt,
        actions,
        overridePreferences = false
      } = req.body;

      const adminUserId = req.user.id;

      let notification;
      if (overridePreferences) {
        // Create notification and force delivery regardless of preferences
        notification = await notificationService.createNotification({
          userId,
          title,
          message,
          category,
          priority,
          type: type || 'admin_override',
          data: {
            ...data,
            createdBy: adminUserId,
            overrideByAdmin: true,
            originalPreferenceCheck: null
          },
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          actions: actions || []
        });

        // Force delivery via WebSocket
        await notificationService.updateDeliveryStatus(notification.id, 'websocket', 'sent');

        // Publish immediately
        await notificationService.publisher.publish(
          `notifications:user:${userId}`,
          JSON.stringify({
            type: 'notification',
            data: notification,
            deliveryChannel: 'websocket',
            forcedByAdmin: true
          })
        );

        logger.info('Admin forced notification delivery', {
          notificationId: notification.id,
          userId,
          adminId: adminUserId,
          overridePreferences: true
        });

      } else {
        // Respect user preferences
        notification = await notificationService.sendToUser(userId, {
          title,
          message,
          category,
          priority,
          type: type || 'admin_sent',
          data: {
            ...data,
            createdBy: adminUserId
          },
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          actions: actions || []
        });
      }

      res.status(201).json({
        success: true,
        data: {
          notification,
          overridePreferences,
          delivered: notification.preferenceCheck?.shouldDeliver || overridePreferences
        },
        message: overridePreferences ?
          'Notification sent with admin override' :
          'Notification sent respecting user preferences'
      });

    } catch (error) {
      logger.error('Failed to send admin notification:', error);
      res.status(500).json({
        error: 'Failed to send notification',
        message: 'An error occurred while sending the notification'
      });
    }
  }
);

/**
 * POST /api/admin/notifications/bulk
 * Send bulk notifications with advanced options and rate limiting
 */
router.post('/notifications/bulk',
  auth.authenticate,
  requireAdmin,
  [
    body('title').isLength({ min: 1, max: 255 }).withMessage('Title must be 1-255 characters'),
    body('message').isLength({ min: 1, max: 2000 }).withMessage('Message must be 1-2000 characters'),
    body('category').isIn(['security', 'system', 'social', 'task', 'administrative'])
      .withMessage('Invalid category'),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid priority'),
    body('userIds').optional().isArray().withMessage('User IDs must be an array'),
    body('includeRoles').optional().isArray().withMessage('Include roles must be an array'),
    body('excludeRoles').optional().isArray().withMessage('Exclude roles must be an array'),
    body('excludeUsers').optional().isArray().withMessage('Exclude users must be an array'),
    body('type').optional().isString().withMessage('Type must be a string'),
    body('data').optional().isObject().withMessage('Data must be an object'),
    body('expiresAt').optional().isISO8601().withMessage('expiresAt must be a valid date'),
    body('actions').optional().isArray().withMessage('Actions must be an array'),
    body('overridePreferences').optional().isBoolean().withMessage('overridePreferences must be boolean'),
    body('dryRun').optional().isBoolean().withMessage('dryRun must be boolean'),
    body('batchSize').optional().isInt({ min: 1, max: 1000 }).withMessage('Batch size must be between 1 and 1000')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        title,
        message,
        category,
        priority = 'medium',
        userIds,
        includeRoles,
        excludeRoles,
        excludeUsers = [],
        type,
        data,
        expiresAt,
        actions,
        overridePreferences = false,
        dryRun = false,
        batchSize = 100
      } = req.body;

      const adminUserId = req.user.id;

      // Get target users for rate limiting check
      const targetUsers = userIds || await notificationService.getConnectedUsers(includeRoles || [], excludeUsers);
      const finalUserIds = targetUsers.filter(id => !excludeUsers.includes(id));
      const targetCount = finalUserIds.length;

      // Check rate limits
      const rateLimitCheck = await rateLimitService.checkBulkNotificationLimit(adminUserId, targetCount);

      if (rateLimitCheck.isLimited) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Bulk notification rate limit exceeded',
          data: {
            rateLimitCheck,
            recommendedBatchSize: rateLimitCheck.recommendedBatchSize,
            targetCount,
            retryAfter: rateLimitCheck.userLimit.resetTime
          }
        });
      }

      if (dryRun) {
        return res.json({
          success: true,
          data: {
            dryRun: true,
            targetUserCount: finalUserIds.length,
            targetUsers: finalUserIds.slice(0, 10), // Show first 10 for preview
            notificationPreview: {
              title,
              message,
              category,
              priority,
              type: type || 'admin_bulk'
            },
            estimatedDelivery: overridePreferences ? 'All users (override)' : 'Based on user preferences',
            rateLimitCheck
          },
          message: 'Dry run completed - no notifications sent'
        });
      }

      // Perform actual bulk send
      const broadcastOptions = {
        includeRoles: includeRoles || [],
        excludeUsers: [...excludeUsers, ...(userIds ? [] : await notificationService.getConnectedUsers(includeRoles || [], []))]
      };

      let result;
      if (overridePreferences) {
        // Override mode - send to all regardless of preferences
        result = await this.sendBulkWithOverride({
          title,
          message,
          category,
          priority,
          userIds,
          includeRoles,
          excludeRoles,
          excludeUsers,
          type,
          data,
          expiresAt,
          actions,
          adminUserId,
          batchSize
        });
      } else {
        // Normal mode - respect preferences
        result = await notificationService.broadcast({
          title,
          message,
          category,
          priority,
          type: type || 'admin_bulk',
          data: {
            ...data,
            createdBy: adminUserId,
            bulkOperation: true
          },
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          actions: actions || []
        }, broadcastOptions);
      }

      res.status(201).json({
        success: true,
        data: {
          bulkOperation: true,
          overridePreferences,
          sentCount: result.successCount,
          failedCount: result.errorCount,
          errors: result.errors || [],
          totalAttempted: userIds ? userIds.length : 'all matching users',
          batchSize
        },
        message: `Bulk notification operation completed: ${result.successCount} sent, ${result.errorCount} failed`
      });

    } catch (error) {
      logger.error('Failed to send bulk admin notifications:', error);
      res.status(500).json({
        error: 'Failed to send bulk notifications',
        message: 'An error occurred while sending bulk notifications'
      });
    }
  }
);

/**
 * GET /api/admin/users/:userId/notifications
 * Get all notifications for a specific user
 */
router.get('/users/:userId/notifications',
  auth.authenticate,
  requireAdmin,
  [
    query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('Limit must be between 1 and 200'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
    query('category').optional().isIn(['security', 'system', 'social', 'task', 'administrative'])
      .withMessage('Invalid category'),
    query('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid priority'),
    query('status').optional().isIn(['read', 'unread']).withMessage('Status must be read or unread')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { limit = 50, offset = 0, category, priority, status } = req.query;

      // Get user's notifications using the existing service
      const notifications = await notificationService.getUserNotifications(userId, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        category,
        priority,
        unreadOnly: status === 'unread',
        includeExpired: false
      });

      // Get user information
      const userQuery = `
        SELECT id, email, roles, is_active, created_at, last_login
        FROM users
        WHERE id = $1
      `;

      const userResult = await db.query(userQuery, [userId]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({
          error: 'User not found',
          message: 'The specified user does not exist'
        });
      }

      const userInfo = userResult.rows[0];

      // Get user's preferences
      const userPrefs = await userPreferencesService.getUserPreferences(userId);

      res.json({
        success: true,
        data: {
          user: userInfo,
          preferences: userPrefs,
          notifications: notifications.notifications,
          pagination: {
            total: notifications.total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            pages: Math.ceil(notifications.total / parseInt(limit))
          }
        },
        message: `Retrieved ${notifications.notifications.length} notifications for user`
      });

    } catch (error) {
      logger.error('Failed to get user notifications for admin:', error);
      res.status(500).json({
        error: 'Failed to retrieve user notifications',
        message: 'An error occurred while retrieving user notifications'
      });
    }
  }
);

/**
 * Helper method for bulk send with preference override
 */
async function sendBulkWithOverride(options) {
  const {
    title,
    message,
    category,
    priority,
    userIds,
    includeRoles,
    excludeRoles,
    excludeUsers,
    type,
    data,
    expiresAt,
    actions,
    adminUserId,
    batchSize = 100
  } = options;

  try {
    // Get target users
    let targetUsers = [];
    if (userIds) {
      targetUsers = userIds;
    } else {
      targetUsers = await notificationService.getConnectedUsers(includeRoles || [], excludeUsers);
      targetUsers = targetUsers.filter(id => !excludeUsers.includes(id));
    }

    const results = [];
    const errors = [];

    // Process in batches
    for (let i = 0; i < targetUsers.length; i += batchSize) {
      const batch = targetUsers.slice(i, i + batchSize);

      for (const userId of batch) {
        try {
          const notification = await notificationService.createNotification({
            userId,
            title,
            message,
            category,
            priority,
            type: type || 'admin_bulk_override',
            data: {
              ...data,
              createdBy: adminUserId,
              overrideByAdmin: true,
              bulkOperation: true
            },
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            actions: actions || []
          });

          // Force delivery
          await notificationService.updateDeliveryStatus(notification.id, 'websocket', 'sent');

          await notificationService.publisher.publish(
            `notifications:user:${userId}`,
            JSON.stringify({
              type: 'notification',
              data: notification,
              deliveryChannel: 'websocket',
              forcedByAdmin: true,
              bulkOperation: true
            })
          );

          results.push({ userId, notification, success: true });

        } catch (error) {
          errors.push({ userId, error: error.message });
          results.push({ userId, success: false, error: error.message });
        }
      }
    }

    logger.info('Admin bulk notification with override completed', {
      totalUsers: targetUsers.length,
      successCount: results.filter(r => r.success).length,
      errorCount: errors.length,
      adminId: adminUserId
    });

    return {
      results,
      successCount: results.filter(r => r.success).length,
      errorCount: errors.length,
      errors
    };

  } catch (error) {
    logger.error('Failed to send bulk notifications with override:', error);
    throw error;
  }
}

/**
 * GET /api/admin/templates
 * Get all notification templates (admin only)
 */
router.get('/templates',
  auth.authenticate,
  requireAdmin,
  [
    query('category').optional().isIn(['security', 'system', 'social', 'task', 'administrative'])
      .withMessage('Invalid category'),
    query('type').optional().isString().withMessage('Type must be a string'),
    query('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid priority'),
    query('isActive').optional().isBoolean().withMessage('isActive must be boolean'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        category,
        type,
        priority,
        isActive,
        limit = 100,
        offset = 0
      } = req.query;

      const filters = {
        category,
        type,
        priority,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        limit: parseInt(limit),
        offset: parseInt(offset)
      };

      const templates = await notificationTemplateService.getTemplates(filters);

      res.json({
        success: true,
        data: {
          templates,
          pagination: {
            limit: parseInt(limit),
            offset: parseInt(offset),
            total: templates.length
          }
        },
        message: `Retrieved ${templates.length} templates`
      });

    } catch (error) {
      logger.error('Failed to get admin templates:', error);
      res.status(500).json({
        error: 'Failed to retrieve templates',
        message: 'An error occurred while retrieving templates'
      });
    }
  }
);

/**
 * GET /api/admin/templates/:id
 * Get specific template (admin only)
 */
router.get('/templates/:id',
  auth.authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      const template = await notificationTemplateService.getTemplate(id);

      if (!template) {
        return res.status(404).json({
          error: 'Template not found',
          message: 'The specified template does not exist'
        });
      }

      res.json({
        success: true,
        data: template,
        message: 'Template retrieved successfully'
      });

    } catch (error) {
      logger.error('Failed to get admin template:', error);
      res.status(500).json({
        error: 'Failed to retrieve template',
        message: 'An error occurred while retrieving the template'
      });
    }
  }
);

/**
 * POST /api/admin/templates
 * Create new notification template (admin only)
 */
router.post('/templates',
  auth.authenticate,
  requireAdmin,
  [
    body('name').isLength({ min: 1, max: 255 }).withMessage('Name must be 1-255 characters'),
    body('category').isIn(['security', 'system', 'social', 'task', 'administrative'])
      .withMessage('Invalid category'),
    body('type').isLength({ min: 1, max: 100 }).withMessage('Type must be 1-100 characters'),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid priority'),
    body('titleTemplate').isLength({ min: 1, max: 255 }).withMessage('Title template must be 1-255 characters'),
    body('messageTemplate').isLength({ min: 1, max: 2000 }).withMessage('Message template must be 1-2000 characters'),
    body('defaultActions').optional().isArray().withMessage('Default actions must be an array'),
    body('variables').optional().isObject().withMessage('Variables must be an object'),
    body('isActive').optional().isBoolean().withMessage('Is active must be boolean')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const templateData = {
        ...req.body,
        createdBy: req.user.id
      };

      const template = await notificationTemplateService.createTemplate(templateData);

      res.status(201).json({
        success: true,
        data: template,
        message: 'Template created successfully'
      });

    } catch (error) {
      logger.error('Failed to create admin template:', error);
      res.status(500).json({
        error: 'Failed to create template',
        message: error.message || 'An error occurred while creating the template'
      });
    }
  }
);

/**
 * PUT /api/admin/templates/:id
 * Update notification template (admin only)
 */
router.put('/templates/:id',
  auth.authenticate,
  requireAdmin,
  [
    body('name').optional().isLength({ min: 1, max: 255 }).withMessage('Name must be 1-255 characters'),
    body('category').optional().isIn(['security', 'system', 'social', 'task', 'administrative'])
      .withMessage('Invalid category'),
    body('type').optional().isLength({ min: 1, max: 100 }).withMessage('Type must be 1-100 characters'),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid priority'),
    body('titleTemplate').optional().isLength({ min: 1, max: 255 }).withMessage('Title template must be 1-255 characters'),
    body('messageTemplate').optional().isLength({ min: 1, max: 2000 }).withMessage('Message template must be 1-2000 characters'),
    body('defaultActions').optional().isArray().withMessage('Default actions must be an array'),
    body('variables').optional().isObject().withMessage('Variables must be an object'),
    body('isActive').optional().isBoolean().withMessage('Is active must be boolean')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const template = await notificationTemplateService.updateTemplate(id, updateData);

      res.json({
        success: true,
        data: template,
        message: 'Template updated successfully'
      });

    } catch (error) {
      logger.error('Failed to update admin template:', error);
      res.status(500).json({
        error: 'Failed to update template',
        message: error.message || 'An error occurred while updating the template'
      });
    }
  }
);

/**
 * DELETE /api/admin/templates/:id
 * Delete notification template (admin only)
 */
router.delete('/templates/:id',
  auth.authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await notificationTemplateService.deleteTemplate(id);

      res.json({
        success: true,
        data: result,
        message: 'Template deleted successfully'
      });

    } catch (error) {
      logger.error('Failed to delete admin template:', error);
      res.status(500).json({
        error: 'Failed to delete template',
        message: error.message || 'An error occurred while deleting the template'
      });
    }
  }
);

/**
 * POST /api/admin/templates/:id/preview
 * Preview notification from template (admin only)
 */
router.post('/templates/:id/preview',
  auth.authenticate,
  requireAdmin,
  [
    body('variables').optional().isObject().withMessage('Variables must be an object')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { variables = {} } = req.body;

      const notification = await notificationTemplateService.renderNotification(id, variables);

      res.json({
        success: true,
        data: {
          templateId: id,
          variables,
          notification,
          preview: true
        },
        message: 'Template preview generated successfully'
      });

    } catch (error) {
      logger.error('Failed to preview admin template:', error);
      res.status(500).json({
        error: 'Failed to generate preview',
        message: error.message || 'An error occurred while generating the preview'
      });
    }
  }
);

/**
 * POST /api/admin/templates/:id/send
 * Send notification using template (admin only)
 */
router.post('/templates/:id/send',
  auth.authenticate,
  requireAdmin,
  [
    body('userId').isUUID().withMessage('User ID must be a valid UUID'),
    body('variables').optional().isObject().withMessage('Variables must be an object'),
    body('overridePreferences').optional().isBoolean().withMessage('overridePreferences must be boolean'),
    body('title').optional().isString().withMessage('Title must be a string'),
    body('message').optional().isString().withMessage('Message must be a string'),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid priority'),
    body('expiresAt').optional().isISO8601().withMessage('expiresAt must be a valid date')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        userId,
        variables = {},
        overridePreferences = false,
        title,
        message,
        priority,
        expiresAt
      } = req.body;

      const options = {
        overridePreferences,
        title,
        message,
        priority,
        expiresAt: expiresAt ? new Date(expiresAt) : null
      };

      const notification = await notificationTemplateService.sendFromTemplate(id, userId, variables, options);

      res.status(201).json({
        success: true,
        data: {
          templateId: id,
          userId,
          variables,
          options,
          notification
        },
        message: 'Notification sent from template successfully'
      });

    } catch (error) {
      logger.error('Failed to send admin template notification:', error);
      res.status(500).json({
        error: 'Failed to send notification from template',
        message: error.message || 'An error occurred while sending the notification'
      });
    }
  }
);

/**
 * GET /api/admin/templates/statistics
 * Get template statistics (admin only)
 */
router.get('/templates/statistics',
  auth.authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const stats = await notificationTemplateService.getTemplateStatistics();

      res.json({
        success: true,
        data: stats,
        message: 'Template statistics retrieved successfully'
      });

    } catch (error) {
      logger.error('Failed to get template statistics:', error);
      res.status(500).json({
        error: 'Failed to retrieve statistics',
        message: 'An error occurred while retrieving template statistics'
      });
    }
  }
);

/**
 * GET /api/admin/rate-limits/status
 * Get current rate limit status (admin only)
 */
router.get('/rate-limits/status',
  auth.authenticate,
  requireAdmin,
  [
    query('action').optional().isString().withMessage('Action must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const adminUserId = req.user.id;
      const { action = 'bulk_notifications' } = req.query;

      const status = await rateLimitService.getRateLimitStatus(adminUserId, action);

      res.json({
        success: true,
        data: {
          adminId: adminUserId,
          action,
          status,
          timestamp: new Date().toISOString()
        },
        message: 'Rate limit status retrieved successfully'
      });

    } catch (error) {
      logger.error('Failed to get rate limit status:', error);
      res.status(500).json({
        error: 'Failed to retrieve rate limit status',
        message: 'An error occurred while retrieving rate limit status'
      });
    }
  }
);

/**
 * GET /api/admin/rate-limits/bulk-stats
 * Get bulk operation statistics (admin only)
 */
router.get('/rate-limits/bulk-stats',
  auth.authenticate,
  requireAdmin,
  [
    query('days').optional().isInt({ min: 1, max: 30 }).withMessage('Days must be between 1 and 30')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const adminUserId = req.user.id;
      const { days = 7 } = req.query;

      const stats = await rateLimitService.getBulkOperationStats(adminUserId, parseInt(days));

      // Calculate totals
      const totals = stats.reduce((acc, day) => {
        acc.totalOperations += day.totalOperations;
        acc.totalNotifications += day.totalNotifications;
        return acc;
      }, {
        totalOperations: 0,
        totalNotifications: 0
      });

      res.json({
        success: true,
        data: {
          adminId: adminUserId,
          period: `${days} days`,
          stats,
          totals,
          averageOperationsPerDay: totals.totalOperations / days,
          averageNotificationsPerDay: totals.totalNotifications / days
        },
        message: 'Bulk operation statistics retrieved successfully'
      });

    } catch (error) {
      logger.error('Failed to get bulk operation stats:', error);
      res.status(500).json({
        error: 'Failed to retrieve bulk operation statistics',
        message: 'An error occurred while retrieving bulk operation statistics'
      });
    }
  }
);

/**
 * POST /api/admin/rate-limits/clear
 * Clear rate limit for admin (admin only)
 */
router.post('/rate-limits/clear',
  auth.authenticate,
  requireAdmin,
  [
    body('action').optional().isString().withMessage('Action must be a string'),
    body('confirm').optional().isBoolean().withMessage('Confirm must be boolean')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const adminUserId = req.user.id;
      const { action = 'bulk_notifications', confirm = false } = req.body;

      if (!confirm) {
        return res.status(400).json({
          error: 'Confirmation required',
          message: 'Please set confirm=true to clear rate limits'
        });
      }

      const cleared = await rateLimitService.clearRateLimit(adminUserId, action);

      res.json({
        success: true,
        data: {
          adminId: adminUserId,
          action,
          cleared,
          timestamp: new Date().toISOString()
        },
        message: cleared ? 'Rate limit cleared successfully' : 'Rate limit was already cleared'
      });

    } catch (error) {
      logger.error('Failed to clear rate limit:', error);
      res.status(500).json({
        error: 'Failed to clear rate limit',
        message: 'An error occurred while clearing rate limit'
      });
    }
  }
);

/**
 * GET /api/admin/rate-limits/global-stats
 * Get global rate limiting statistics (admin only)
 */
router.get('/rate-limits/global-stats',
  auth.authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const stats = await rateLimitService.getGlobalStats();

      res.json({
        success: true,
        data: stats,
        message: 'Global rate limit statistics retrieved successfully'
      });

    } catch (error) {
      logger.error('Failed to get global rate limit stats:', error);
      res.status(500).json({
        error: 'Failed to retrieve global statistics',
        message: 'An error occurred while retrieving global statistics'
      });
    }
  }
);

module.exports = router;