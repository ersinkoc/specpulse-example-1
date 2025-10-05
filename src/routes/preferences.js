const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../auth/middleware/authMiddleware');
const { requireRole } = require('../auth/middleware/rbacMiddleware');
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
 * GET /api/preferences
 * Get current user's notification preferences
 */
router.get('/', auth.authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = await userPreferencesService.getUserPreferences(userId);

    res.json({
      success: true,
      data: preferences,
      message: preferences.isNewUser ?
        'Default preferences returned - user preferences will be created on first update' :
        'User preferences retrieved successfully'
    });

  } catch (error) {
    logger.error('Failed to get user preferences:', error);
    res.status(500).json({
      error: 'Failed to retrieve preferences',
      message: 'An error occurred while retrieving your preferences'
    });
  }
});

/**
 * PUT /api/preferences
 * Update user's notification preferences
 */
router.put('/',
  auth.authenticate,
  [
    body('categoryPreferences').optional().isObject().withMessage('Category preferences must be an object'),
    body('priorityPreferences').optional().isObject().withMessage('Priority preferences must be an object'),
    body('quietHoursEnabled').optional().isBoolean().withMessage('Quiet hours enabled must be boolean'),
    body('quietHoursStart').optional().matches(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/)
      .withMessage('Quiet hours start must be in HH:MM:SS format'),
    body('quietHoursEnd').optional().matches(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/)
      .withMessage('Quiet hours end must be in HH:MM:SS format'),
    body('quietHoursTimezone').optional().isString().withMessage('Timezone must be a string'),
    body('maxNotificationsPerHour').optional().isInt({ min: 1, max: 1000 })
      .withMessage('Max notifications per hour must be between 1 and 1000'),
    body('groupSimilarNotifications').optional().isBoolean().withMessage('Group similar notifications must be boolean'),
    body('soundEnabled').optional().isBoolean().withMessage('Sound enabled must be boolean'),
    body('vibrationEnabled').optional().isBoolean().withMessage('Vibration enabled must be boolean')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const updatedPreferences = await userPreferencesService.updateUserPreferences(userId, req.body);

      res.json({
        success: true,
        data: updatedPreferences,
        message: 'Preferences updated successfully'
      });

    } catch (error) {
      logger.error('Failed to update user preferences:', error);

      if (error.message.includes('Validation errors')) {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.message
        });
      }

      res.status(500).json({
        error: 'Failed to update preferences',
        message: 'An error occurred while updating your preferences'
      });
    }
  }
);

/**
 * POST /api/preferences/reset
 * Reset user preferences to defaults
 */
router.post('/reset', auth.authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = await userPreferencesService.resetUserPreferences(userId);

    res.json({
      success: true,
      data: preferences,
      message: 'Preferences reset to defaults successfully'
    });

  } catch (error) {
    logger.error('Failed to reset user preferences:', error);
    res.status(500).json({
      error: 'Failed to reset preferences',
      message: 'An error occurred while resetting your preferences'
    });
  }
});

/**
 * PUT /api/preferences/category/:category
 * Update specific category preferences
 */
router.put('/category/:category',
  auth.authenticate,
  [
    body('enabled').optional().isBoolean().withMessage('Enabled must be boolean'),
    body('websocket').optional().isBoolean().withMessage('WebSocket must be boolean'),
    body('email').optional().isBoolean().withMessage('Email must be boolean'),
    body('quiet_hours').optional().isBoolean().withMessage('Quiet hours must be boolean')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { category } = req.params;

      // Validate category
      const validCategories = ['security', 'system', 'social', 'task', 'administrative'];
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          error: 'Invalid category',
          message: `Category must be one of: ${validCategories.join(', ')}`
        });
      }

      const updatedPreferences = await userPreferencesService.updateCategoryPreference(
        userId,
        category,
        req.body
      );

      res.json({
        success: true,
        data: updatedPreferences,
        message: `${category} preferences updated successfully`
      });

    } catch (error) {
      logger.error('Failed to update category preference:', error);
      res.status(500).json({
        error: 'Failed to update category preference',
        message: 'An error occurred while updating the category preference'
      });
    }
  }
);

/**
 * PUT /api/preferences/quiet-hours
 * Update quiet hours settings
 */
router.put('/quiet-hours',
  auth.authenticate,
  [
    body('enabled').optional().isBoolean().withMessage('Enabled must be boolean'),
    body('start').optional().matches(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/)
      .withMessage('Start time must be in HH:MM:SS format'),
    body('end').optional().matches(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/)
      .withMessage('End time must be in HH:MM:SS format'),
    body('timezone').optional().isString().withMessage('Timezone must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const quietHoursData = {
        enabled: req.body.enabled,
        start: req.body.start,
        end: req.body.end,
        timezone: req.body.timezone
      };

      // Remove undefined values
      Object.keys(quietHoursData).forEach(key =>
        quietHoursData[key] === undefined && delete quietHoursData[key]
      );

      if (Object.keys(quietHoursData).length === 0) {
        return res.status(400).json({
          error: 'No valid fields provided',
          message: 'At least one field must be provided to update quiet hours'
        });
      }

      const updatedPreferences = await userPreferencesService.updateQuietHours(userId, quietHoursData);

      res.json({
        success: true,
        data: updatedPreferences,
        message: 'Quiet hours settings updated successfully'
      });

    } catch (error) {
      logger.error('Failed to update quiet hours:', error);
      res.status(500).json({
        error: 'Failed to update quiet hours',
        message: 'An error occurred while updating quiet hours settings'
      });
    }
  }
);

/**
 * GET /api/preferences/quiet-hours/status
 * Check if quiet hours are currently active
 */
router.get('/quiet-hours/status', auth.authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = await userPreferencesService.getUserPreferences(userId);

    const isQuietHours = preferences.quietHoursEnabled &&
      userPreferencesService.isQuietHours(preferences);

    res.json({
      success: true,
      data: {
        isActive: isQuietHours,
        quietHoursEnabled: preferences.quietHoursEnabled,
        quietHoursStart: preferences.quietHoursStart,
        quietHoursEnd: preferences.quietHoursEnd,
        quietHoursTimezone: preferences.quietHoursTimezone,
        currentTime: new Date().toISOString()
      },
      message: isQuietHours ? 'Quiet hours are currently active' : 'Quiet hours are not active'
    });

  } catch (error) {
    logger.error('Failed to check quiet hours status:', error);
    res.status(500).json({
      error: 'Failed to check quiet hours status',
      message: 'An error occurred while checking quiet hours status'
    });
  }
});

/**
 * GET /api/preferences/statistics
 * Get preferences statistics (admin only)
 */
router.get('/statistics',
  auth.authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const statistics = await userPreferencesService.getPreferencesStatistics();

      res.json({
        success: true,
        data: statistics,
        message: 'Preferences statistics retrieved successfully'
      });

    } catch (error) {
      logger.error('Failed to get preferences statistics:', error);
      res.status(500).json({
        error: 'Failed to retrieve statistics',
        message: 'An error occurred while retrieving preferences statistics'
      });
    }
  }
);

/**
 * POST /api/preferences/test-notification
 * Send a test notification to verify user preferences
 */
router.post('/test-notification',
  auth.authenticate,
  [
    body('category').isIn(['security', 'system', 'social', 'task', 'administrative'])
      .withMessage('Invalid category'),
    body('priority').isIn(['low', 'medium', 'high', 'critical'])
      .withMessage('Invalid priority'),
    body('title').optional().isString().withMessage('Title must be a string'),
    body('message').optional().isString().withMessage('Message must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { category, priority, title, message } = req.body;

      // Check if user should receive this test notification
      const preferenceCheck = await userPreferencesService.shouldUserReceiveNotification(userId, {
        category,
        priority
      });

      // Send test notification using notification service if should deliver
      let notificationSent = false;
      let notificationData = null;

      if (preferenceCheck.shouldDeliver) {
        const notificationService = require('../services/notificationService');

        notificationData = await notificationService.sendToUser(userId, {
          title: title || `Test ${category} Notification`,
          message: message || `This is a test ${priority} priority ${category} notification to verify your preferences.`,
          category,
          priority,
          type: 'test_notification',
          data: {
            isTest: true,
            requestedBy: userId,
            preferenceCheck
          }
        });

        notificationSent = true;
      }

      res.json({
        success: true,
        data: {
          testResult: {
            shouldDeliver: preferenceCheck.shouldDeliver,
            reason: preferenceCheck.reason,
            channels: preferenceCheck.channels,
            notificationSent,
            notificationData
          }
        },
        message: notificationSent ?
          'Test notification sent successfully' :
          'Test notification blocked by current preferences'
      });

    } catch (error) {
      logger.error('Failed to send test notification:', error);
      res.status(500).json({
        error: 'Failed to send test notification',
        message: 'An error occurred while sending the test notification'
      });
    }
  }
);

/**
 * GET /api/preferences/export
 * Export user preferences as JSON
 */
router.get('/export', auth.authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = await userPreferencesService.getUserPreferences(userId);

    // Remove sensitive/internal fields
    const exportData = {
      ...preferences,
      exportedAt: new Date().toISOString(),
      version: '1.0'
    };
    delete exportData.isNewUser;
    delete exportData.userId;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="preferences-${userId}.json"`);

    res.json({
      success: true,
      data: exportData,
      message: 'Preferences exported successfully'
    });

  } catch (error) {
    logger.error('Failed to export preferences:', error);
    res.status(500).json({
      error: 'Failed to export preferences',
      message: 'An error occurred while exporting your preferences'
    });
  }
});

module.exports = router;