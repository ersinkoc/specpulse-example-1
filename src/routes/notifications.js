const express = require('express');
const { body, validationResult, query } = require('express-validator');
const auth = require('../auth/middleware/authMiddleware');
const notificationService = require('../services/notificationService');
const userPreferencesService = require('../services/userPreferencesService');
const logger = require('../shared/utils/logger');

const router = express.Router();

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
 * GET /api/notifications
 * Get user's notifications with filtering and pagination
 */
router.get('/',
  auth.authenticate,
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
    query('category').optional().isIn(['security', 'system', 'social', 'task', 'administrative'])
      .withMessage('Invalid category'),
    query('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid priority'),
    query('unreadOnly').optional().isBoolean().withMessage('unreadOnly must be boolean'),
    query('includeExpired').optional().isBoolean().withMessage('includeExpired must be boolean')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        limit = 50,
        offset = 0,
        category,
        priority,
        unreadOnly,
        includeExpired
      } = req.query;

      const notifications = await notificationService.getUserNotifications(userId, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        category,
        priority,
        unreadOnly: unreadOnly === 'true',
        includeExpired: includeExpired === 'true'
      });

      res.json({
        success: true,
        data: notifications,
        message: `Retrieved ${notifications.notifications.length} notifications`
      });

    } catch (error) {
      logger.error('Failed to get notifications:', error);
      res.status(500).json({
        error: 'Failed to retrieve notifications',
        message: 'An error occurred while retrieving your notifications'
      });
    }
  }
);

/**
 * GET /api/notifications/stats
 * Get user's notification statistics
 */
router.get('/stats',
  auth.authenticate,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const stats = await notificationService.getUserNotificationStats(userId);

      res.json({
        success: true,
        data: stats,
        message: 'Notification statistics retrieved successfully'
      });

    } catch (error) {
      logger.error('Failed to get notification stats:', error);
      res.status(500).json({
        error: 'Failed to retrieve statistics',
        message: 'An error occurred while retrieving your notification statistics'
      });
    }
  }
);

/**
 * POST /api/notifications
 * Create and send a notification (user can send to self or admin can send to others)
 */
router.post('/',
  auth.authenticate,
  [
    body('userId').optional().isUUID().withMessage('User ID must be a valid UUID'),
    body('title').isLength({ min: 1, max: 255 }).withMessage('Title must be 1-255 characters'),
    body('message').isLength({ min: 1, max: 2000 }).withMessage('Message must be 1-2000 characters'),
    body('category').isIn(['security', 'system', 'social', 'task', 'administrative'])
      .withMessage('Invalid category'),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid priority'),
    body('type').optional().isString().withMessage('Type must be a string'),
    body('data').optional().isObject().withMessage('Data must be an object'),
    body('expiresAt').optional().isISO8601().withMessage('expiresAt must be a valid date'),
    body('actions').optional().isArray().withMessage('Actions must be an array')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { userId, title, message, category, priority = 'medium', type, data, expiresAt, actions } = req.body;
      const authenticatedUserId = req.user.id;
      const userRoles = req.user.roles || [];

      // Determine target user ID
      const targetUserId = userId || authenticatedUserId;

      // Check if user can send notification to target
      if (targetUserId !== authenticatedUserId && !userRoles.includes('admin')) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only send notifications to yourself'
        });
      }

      // Check user preferences for notification delivery
      const preferenceCheck = await userPreferencesService.shouldUserReceiveNotification(targetUserId, {
        category,
        priority
      });

      let notification;
      if (preferenceCheck.shouldDeliver) {
        notification = await notificationService.sendToUser(targetUserId, {
          title,
          message,
          category,
          priority,
          type: type || 'user_created',
          data: {
            ...data,
            createdBy: authenticatedUserId,
            preferenceCheck
          },
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          actions: actions || []
        });
      } else {
        // Create notification but don't deliver if blocked by preferences
        notification = await notificationService.createNotification({
          userId: targetUserId,
          title,
          message,
          category,
          priority,
          type: type || 'user_created',
          data: {
            ...data,
            createdBy: authenticatedUserId,
            preferenceCheck,
            blockedByPreferences: true
          },
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          actions: actions || []
        });
      }

      res.status(201).json({
        success: true,
        data: {
          notification,
          preferenceCheck,
          delivered: preferenceCheck.shouldDeliver
        },
        message: preferenceCheck.shouldDeliver ?
          'Notification created and sent successfully' :
          'Notification created but blocked by user preferences'
      });

    } catch (error) {
      logger.error('Failed to create notification:', error);
      res.status(500).json({
        error: 'Failed to create notification',
        message: 'An error occurred while creating the notification'
      });
    }
  }
);

/**
 * POST /api/notifications/broadcast
 * Broadcast notification to multiple users (admin only)
 */
router.post('/broadcast',
  auth.authenticate,
  auth.requireRole(['admin']),
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
    body('type').optional().isString().withMessage('Type must be a string'),
    body('data').optional().isObject().withMessage('Data must be an object'),
    body('expiresAt').optional().isISO8601().withMessage('expiresAt must be a valid date'),
    body('actions').optional().isArray().withMessage('Actions must be an array')
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
        type,
        data,
        expiresAt,
        actions
      } = req.body;

      const adminUserId = req.user.id;

      // Prepare broadcast options
      const broadcastOptions = {
        includeRoles: includeRoles || [],
        excludeUsers: excludeRoles || []
      };

      // Send broadcast
      const result = await notificationService.broadcast({
        title,
        message,
        category,
        priority,
        type: type || 'admin_broadcast',
        data: {
          ...data,
          createdBy: adminUserId,
          broadcastBy: req.user.email
        },
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        actions: actions || []
      }, broadcastOptions);

      res.status(201).json({
        success: true,
        data: {
          broadcast: result,
          sentCount: result.successCount,
          failedCount: result.errorCount,
          totalAttempted: userIds ? userIds.length : 'all connected users'
        },
        message: `Broadcast sent to ${result.successCount} users successfully`
      });

    } catch (error) {
      logger.error('Failed to broadcast notification:', error);
      res.status(500).json({
        error: 'Failed to broadcast notification',
        message: 'An error occurred while broadcasting the notification'
      });
    }
  }
);

/**
 * PUT /api/notifications/:id/read
 * Mark notification as read
 */
router.put('/:id/read',
  auth.authenticate,
  [
    body('markMultiple').optional().isBoolean().withMessage('markMultiple must be boolean'),
    body('notificationIds').optional().isArray().withMessage('notificationIds must be an array')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const notificationId = req.params.id;
      const { markMultiple, notificationIds } = req.body;

      let result;
      if (markMultiple && notificationIds && Array.isArray(notificationIds)) {
        // Mark multiple notifications as read
        result = await notificationService.markMultipleAsRead(notificationIds, userId);
      } else {
        // Mark single notification as read
        result = await notificationService.markAsRead(notificationId, userId);
      }

      res.json({
        success: true,
        data: {
          notifications: Array.isArray(result) ? result : [result],
          count: Array.isArray(result) ? result.length : 1
        },
        message: 'Notification(s) marked as read successfully'
      });

    } catch (error) {
      logger.error('Failed to mark notification as read:', error);
      res.status(500).json({
        error: 'Failed to mark notification as read',
        message: 'An error occurred while marking the notification as read'
      });
    }
  }
);

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read
 */
router.put('/read-all',
  auth.authenticate,
  [
    body('category').optional().isIn(['security', 'system', 'social', 'task', 'administrative'])
      .withMessage('Invalid category'),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid priority')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const filters = req.body;

      const updatedNotifications = await notificationService.markAllAsRead(userId, filters);

      res.json({
        success: true,
        data: {
          notifications: updatedNotifications,
          count: updatedNotifications.length,
          filters
        },
        message: `Marked ${updatedNotifications.length} notifications as read`
      });

    } catch (error) {
      logger.error('Failed to mark all notifications as read:', error);
      res.status(500).json({
        error: 'Failed to mark all notifications as read',
        message: 'An error occurred while marking all notifications as read'
      });
    }
  }
);

/**
 * DELETE /api/notifications/:id
 * Delete a notification
 */
router.delete('/:id',
  auth.authenticate,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const notificationId = req.params.id;

      const result = await notificationService.deleteNotification(notificationId, userId);

      res.json({
        success: true,
        data: result,
        message: 'Notification deleted successfully'
      });

    } catch (error) {
      logger.error('Failed to delete notification:', error);
      res.status(500).json({
        error: 'Failed to delete notification',
        message: 'An error occurred while deleting the notification'
      });
    }
  }
);

/**
 * POST /api/notifications/:id/action
 * Handle notification action click
 */
router.post('/:id/action',
  auth.authenticate,
  [
    body('actionId').notEmpty().withMessage('Action ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const notificationId = req.params.id;
      const { actionId } = req.body;

      const action = await notificationService.updateActionClick(notificationId, actionId, userId);

      res.json({
        success: true,
        data: {
          action,
          notificationId,
          actionId,
          clickedAt: action.clicked_at
        },
        message: 'Notification action clicked successfully'
      });

    } catch (error) {
      logger.error('Failed to handle notification action:', error);
      res.status(500).json({
        error: 'Failed to handle notification action',
        message: 'An error occurred while processing the notification action'
      });
    }
  }
);

/**
 * GET /api/notifications/history
 * Get notification history with advanced filtering
 */
router.get('/history',
  auth.authenticate,
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
    query('category').optional().isIn(['security', 'system', 'social', 'task', 'administrative'])
      .withMessage('Invalid category'),
    query('priority').optional().isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid priority'),
    query('status').optional().isIn(['read', 'unread']).withMessage('Status must be read or unread'),
    query('dateFrom').optional().isISO8601().withMessage('dateFrom must be a valid date'),
    query('dateTo').optional().isISO8601().withMessage('dateTo must be a valid date'),
    query('type').optional().isString().withMessage('Type must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        limit = 50,
        offset = 0,
        category,
        priority,
        status,
        dateFrom,
        dateTo,
        type
      } = req.query;

      // Build filters object
      const filters = {
        limit: parseInt(limit),
        offset: parseInt(offset),
        category,
        priority,
        unreadOnly: status === 'unread',
        includeExpired: false
      };

      // Add date filtering if provided
      if (dateFrom || dateTo) {
        filters.dateRange = {
          from: dateFrom ? new Date(dateFrom) : null,
          to: dateTo ? new Date(dateTo) : null
        };
      }

      const notifications = await notificationService.getUserNotifications(userId, filters);

      // Filter by type if specified
      let filteredNotifications = notifications.notifications;
      if (type) {
        filteredNotifications = filteredNotifications.filter(n => n.type === type);
      }

      res.json({
        success: true,
        data: {
          notifications: filteredNotifications,
          total: filteredNotifications.length,
          limit: parseInt(limit),
          offset: parseInt(offset),
          filters
        },
        message: `Retrieved ${filteredNotifications.length} notifications from history`
      });

    } catch (error) {
      logger.error('Failed to get notification history:', error);
      res.status(500).json({
        error: 'Failed to retrieve notification history',
        message: 'An error occurred while retrieving your notification history'
      });
    }
  }
);

module.exports = router;