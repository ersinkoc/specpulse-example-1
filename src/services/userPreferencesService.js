const { v4: uuidv4 } = require('uuid');
const db = require('../database/connection');
const logger = require('../shared/utils/logger');

/**
 * User Preferences Service
 * Manages user notification preferences and settings
 */
class UserPreferencesService {
  constructor() {
    this.defaultPreferences = {
      category_preferences: {
        security: { enabled: true, websocket: true, email: true, quiet_hours: false },
        system: { enabled: true, websocket: true, email: false, quiet_hours: true },
        social: { enabled: true, websocket: true, email: false, quiet_hours: true },
        task: { enabled: true, websocket: true, email: true, quiet_hours: false },
        administrative: { enabled: true, websocket: true, email: true, quiet_hours: false }
      },
      priority_preferences: {
        low: { websocket: false, email: false },
        medium: { websocket: true, email: false },
        high: { websocket: true, email: true },
        critical: { websocket: true, email: true }
      },
      quiet_hours_enabled: false,
      quiet_hours_start: '22:00:00',
      quiet_hours_end: '08:00:00',
      quiet_hours_timezone: 'UTC',
      max_notifications_per_hour: 50,
      group_similar_notifications: true,
      sound_enabled: true,
      vibration_enabled: true
    };
  }

  /**
   * Get user preferences
   */
  async getUserPreferences(userId) {
    try {
      const query = `
        SELECT * FROM user_notification_preferences
        WHERE user_id = $1
      `;

      const result = await db.query(query, [userId]);

      if (result.rows.length === 0) {
        // Return default preferences if none exist
        return {
          userId,
          ...this.defaultPreferences,
          isNewUser: true
        };
      }

      const preferences = result.rows[0];

      return {
        userId: preferences.user_id,
        categoryPreferences: preferences.category_preferences,
        priorityPreferences: preferences.priority_preferences,
        quietHoursEnabled: preferences.quiet_hours_enabled,
        quietHoursStart: preferences.quiet_hours_start,
        quietHoursEnd: preferences.quiet_hours_end,
        quietHoursTimezone: preferences.quiet_hours_timezone,
        maxNotificationsPerHour: preferences.max_notifications_per_hour,
        groupSimilarNotifications: preferences.group_similar_notifications,
        soundEnabled: preferences.sound_enabled,
        vibrationEnabled: preferences.vibration_enabled,
        createdAt: preferences.created_at,
        updatedAt: preferences.updated_at,
        isNewUser: false
      };

    } catch (error) {
      logger.error('Failed to get user preferences:', error);
      throw error;
    }
  }

  /**
   * Create or update user preferences
   */
  async updateUserPreferences(userId, preferencesData) {
    try {
      const {
        categoryPreferences,
        priorityPreferences,
        quietHoursEnabled,
        quietHoursStart,
        quietHoursEnd,
        quietHoursTimezone,
        maxNotificationsPerHour,
        groupSimilarNotifications,
        soundEnabled,
        vibrationEnabled
      } = this.validatePreferences(preferencesData);

      const query = `
        INSERT INTO user_notification_preferences (
          user_id,
          category_preferences,
          priority_preferences,
          quiet_hours_enabled,
          quiet_hours_start,
          quiet_hours_end,
          quiet_hours_timezone,
          max_notifications_per_hour,
          group_similar_notifications,
          sound_enabled,
          vibration_enabled
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (user_id)
        DO UPDATE SET
          category_preferences = EXCLUDED.category_preferences,
          priority_preferences = EXCLUDED.priority_preferences,
          quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
          quiet_hours_start = EXCLUDED.quiet_hours_start,
          quiet_hours_end = EXCLUDED.quiet_hours_end,
          quiet_hours_timezone = EXCLUDED.quiet_hours_timezone,
          max_notifications_per_hour = EXCLUDED.max_notifications_per_hour,
          group_similar_notifications = EXCLUDED.group_similar_notifications,
          sound_enabled = EXCLUDED.sound_enabled,
          vibration_enabled = EXCLUDED.vibration_enabled,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;

      const values = [
        userId,
        JSON.stringify(categoryPreferences || this.defaultPreferences.category_preferences),
        JSON.stringify(priorityPreferences || this.defaultPreferences.priority_preferences),
        quietHoursEnabled !== undefined ? quietHoursEnabled : this.defaultPreferences.quiet_hours_enabled,
        quietHoursStart || this.defaultPreferences.quiet_hours_start,
        quietHoursEnd || this.defaultPreferences.quiet_hours_end,
        quietHoursTimezone || this.defaultPreferences.quiet_hours_timezone,
        maxNotificationsPerHour || this.defaultPreferences.max_notifications_per_hour,
        groupSimilarNotifications !== undefined ? groupSimilarNotifications : this.defaultPreferences.group_similar_notifications,
        soundEnabled !== undefined ? soundEnabled : this.defaultPreferences.sound_enabled,
        vibrationEnabled !== undefined ? vibrationEnabled : this.defaultPreferences.vibration_enabled
      ];

      const result = await db.query(query, values);
      const updatedPreferences = result.rows[0];

      logger.info('User preferences updated', {
        userId,
        quietHoursEnabled: updatedPreferences.quiet_hours_enabled,
        maxNotificationsPerHour: updatedPreferences.max_notifications_per_hour
      });

      return {
        userId: updatedPreferences.user_id,
        categoryPreferences: updatedPreferences.category_preferences,
        priorityPreferences: updatedPreferences.priority_preferences,
        quietHoursEnabled: updatedPreferences.quiet_hours_enabled,
        quietHoursStart: updatedPreferences.quiet_hours_start,
        quietHoursEnd: updatedPreferences.quiet_hours_end,
        quietHoursTimezone: updatedPreferences.quiet_hours_timezone,
        maxNotificationsPerHour: updatedPreferences.max_notifications_per_hour,
        groupSimilarNotifications: updatedPreferences.group_similar_notifications,
        soundEnabled: updatedPreferences.sound_enabled,
        vibrationEnabled: updatedPreferences.vibration_enabled,
        createdAt: updatedPreferences.created_at,
        updatedAt: updatedPreferences.updated_at
      };

    } catch (error) {
      logger.error('Failed to update user preferences:', error);
      throw error;
    }
  }

  /**
   * Check if user should receive notification based on preferences
   */
  async shouldUserReceiveNotification(userId, notificationData) {
    try {
      const preferences = await this.getUserPreferences(userId);

      // If user is new, use default preferences
      if (preferences.isNewUser) {
        await this.updateUserPreferences(userId, this.defaultPreferences);
        return this.checkNotificationAgainstDefaults(notificationData);
      }

      const { category, priority } = notificationData;

      // Check category preferences
      const categoryPref = preferences.categoryPreferences[category];
      if (!categoryPref || !categoryPref.enabled) {
        return {
          shouldDeliver: false,
          reason: 'Category disabled',
          channels: []
        };
      }

      // Check if it's quiet hours
      if (preferences.quietHoursEnabled && this.isQuietHours(preferences)) {
        if (categoryPref.quiet_hours) {
          return {
            shouldDeliver: false,
            reason: 'Quiet hours',
            channels: []
          };
        }
      }

      // Determine delivery channels based on priority
      const priorityPref = preferences.priorityPreferences[priority];
      const channels = [];

      if (categoryPref.websocket && priorityPref.websocket) {
        channels.push('websocket');
      }

      if (categoryPref.email && priorityPref.email) {
        channels.push('email');
      }

      return {
        shouldDeliver: channels.length > 0,
        reason: channels.length > 0 ? 'Allowed' : 'No delivery channels enabled',
        channels
      };

    } catch (error) {
      logger.error('Failed to check user notification preferences:', error);
      // Default to allow delivery if preferences check fails
      return {
        shouldDeliver: true,
        reason: 'Preferences check failed - default allow',
        channels: ['websocket']
      };
    }
  }

  /**
   * Check if current time is within quiet hours
   */
  isQuietHours(preferences) {
    try {
      const now = new Date();
      const currentTime = this.getTimeInTimezone(now, preferences.quietHoursTimezone || 'UTC');
      const currentTimeStr = currentTime.toTimeString().substring(0, 8);

      const startTime = preferences.quietHoursStart;
      const endTime = preferences.quietHoursEnd;

      // Handle cases where quiet hours span midnight (e.g., 22:00 to 08:00)
      if (startTime > endTime) {
        return currentTimeStr >= startTime || currentTimeStr <= endTime;
      } else {
        return currentTimeStr >= startTime && currentTimeStr <= endTime;
      }

    } catch (error) {
      logger.error('Failed to check quiet hours:', error);
      return false;
    }
  }

  /**
   * Get time in specific timezone
   */
  getTimeInTimezone(date, timezone) {
    try {
      // Simple timezone offset handling - in production, use a proper timezone library
      const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
      return new Date(utcTime);
    } catch (error) {
      logger.error('Failed to convert timezone:', error);
      return date;
    }
  }

  /**
   * Validate preferences data
   */
  validatePreferences(preferencesData) {
    const errors = [];

    // Validate category preferences
    if (preferencesData.categoryPreferences) {
      const validCategories = ['security', 'system', 'social', 'task', 'administrative'];
      for (const category of Object.keys(preferencesData.categoryPreferences)) {
        if (!validCategories.includes(category)) {
          errors.push(`Invalid category: ${category}`);
        }

        const catPref = preferencesData.categoryPreferences[category];
        if (typeof catPref.enabled !== 'boolean') {
          errors.push(`Category ${category}: enabled must be boolean`);
        }
        if (typeof catPref.websocket !== 'boolean') {
          errors.push(`Category ${category}: websocket must be boolean`);
        }
        if (typeof catPref.email !== 'boolean') {
          errors.push(`Category ${category}: email must be boolean`);
        }
        if (typeof catPref.quiet_hours !== 'boolean') {
          errors.push(`Category ${category}: quiet_hours must be boolean`);
        }
      }
    }

    // Validate priority preferences
    if (preferencesData.priorityPreferences) {
      const validPriorities = ['low', 'medium', 'high', 'critical'];
      for (const priority of Object.keys(preferencesData.priorityPreferences)) {
        if (!validPriorities.includes(priority)) {
          errors.push(`Invalid priority: ${priority}`);
        }

        const priorityPref = preferencesData.priorityPreferences[priority];
        if (typeof priorityPref.websocket !== 'boolean') {
          errors.push(`Priority ${priority}: websocket must be boolean`);
        }
        if (typeof priorityPref.email !== 'boolean') {
          errors.push(`Priority ${priority}: email must be boolean`);
        }
      }
    }

    // Validate quiet hours
    if (preferencesData.quietHoursStart && !this.isValidTime(preferencesData.quietHoursStart)) {
      errors.push('Invalid quiet_hours_start format (use HH:MM:SS)');
    }

    if (preferencesData.quietHoursEnd && !this.isValidTime(preferencesData.quietHoursEnd)) {
      errors.push('Invalid quiet_hours_end format (use HH:MM:SS)');
    }

    // Validate max notifications per hour
    if (preferencesData.maxNotificationsPerHour !== undefined) {
      const max = parseInt(preferencesData.maxNotificationsPerHour);
      if (isNaN(max) || max < 1 || max > 1000) {
        errors.push('max_notifications_per_hour must be between 1 and 1000');
      }
    }

    if (errors.length > 0) {
      throw new Error(`Validation errors: ${errors.join(', ')}`);
    }

    return preferencesData;
  }

  /**
   * Validate time format (HH:MM:SS)
   */
  isValidTime(timeStr) {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/;
    return timeRegex.test(timeStr);
  }

  /**
   * Check notification against default preferences
   */
  checkNotificationAgainstDefaults(notificationData) {
    const { category, priority } = notificationData;

    const categoryPref = this.defaultPreferences.category_preferences[category];
    if (!categoryPref || !categoryPref.enabled) {
      return {
        shouldDeliver: false,
        reason: 'Category disabled by default',
        channels: []
      };
    }

    const priorityPref = this.defaultPreferences.priority_preferences[priority];
    const channels = [];

    if (categoryPref.websocket && priorityPref.websocket) {
      channels.push('websocket');
    }

    if (categoryPref.email && priorityPref.email) {
      channels.push('email');
    }

    return {
      shouldDeliver: channels.length > 0,
      reason: channels.length > 0 ? 'Allowed by default' : 'No delivery channels enabled by default',
      channels
    };
  }

  /**
   * Reset user preferences to defaults
   */
  async resetUserPreferences(userId) {
    try {
      const query = `
        UPDATE user_notification_preferences
        SET
          category_preferences = $2,
          priority_preferences = $3,
          quiet_hours_enabled = $4,
          quiet_hours_start = $5,
          quiet_hours_end = $6,
          quiet_hours_timezone = $7,
          max_notifications_per_hour = $8,
          group_similar_notifications = $9,
          sound_enabled = $10,
          vibration_enabled = $11,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
        RETURNING *
      `;

      const values = [
        userId,
        JSON.stringify(this.defaultPreferences.category_preferences),
        JSON.stringify(this.defaultPreferences.priority_preferences),
        this.defaultPreferences.quiet_hours_enabled,
        this.defaultPreferences.quiet_hours_start,
        this.defaultPreferences.quiet_hours_end,
        this.defaultPreferences.quiet_hours_timezone,
        this.defaultPreferences.max_notifications_per_hour,
        this.defaultPreferences.group_similar_notifications,
        this.defaultPreferences.sound_enabled,
        this.defaultPreferences.vibration_enabled
      ];

      const result = await db.query(query, values);

      if (result.rows.length === 0) {
        // Create preferences if they don't exist
        return await this.updateUserPreferences(userId, this.defaultPreferences);
      }

      logger.info('User preferences reset to defaults', { userId });

      return {
        userId: result.rows[0].user_id,
        ...this.defaultPreferences,
        updatedAt: result.rows[0].updated_at
      };

    } catch (error) {
      logger.error('Failed to reset user preferences:', error);
      throw error;
    }
  }

  /**
   * Get preferences statistics
   */
  async getPreferencesStatistics() {
    try {
      const query = `
        SELECT
          COUNT(*) as total_users,
          COUNT(CASE WHEN quiet_hours_enabled = true THEN 1 END) as quiet_hours_users,
          AVG(max_notifications_per_hour) as avg_max_notifications,
          COUNT(CASE WHEN group_similar_notifications = true THEN 1 END) as grouping_users,
          COUNT(CASE WHEN sound_enabled = true THEN 1 END) as sound_users,
          COUNT(CASE WHEN vibration_enabled = true THEN 1 END) as vibration_users
        FROM user_notification_preferences
      `;

      const result = await db.query(query, [this.defaultPreferences.max_notifications_per_hour]);
      const stats = result.rows[0];

      return {
        totalUsers: parseInt(stats.total_users),
        quietHoursUsers: parseInt(stats.quiet_hours_users),
        avgMaxNotifications: Math.round(stats.avg_max_notifications || 0),
        groupingUsers: parseInt(stats.grouping_users),
        soundUsers: parseInt(stats.sound_users),
        vibrationUsers: parseInt(stats.vibration_users)
      };

    } catch (error) {
      logger.error('Failed to get preferences statistics:', error);
      throw error;
    }
  }

  /**
   * Update specific preference category
   */
  async updateCategoryPreference(userId, category, preferences) {
    try {
      const userPrefs = await this.getUserPreferences(userId);

      const updatedCategoryPrefs = {
        ...userPrefs.categoryPreferences,
        [category]: {
          ...userPrefs.categoryPreferences[category],
          ...preferences
        }
      };

      return await this.updateUserPreferences(userId, {
        categoryPreferences: updatedCategoryPrefs
      });

    } catch (error) {
      logger.error('Failed to update category preference:', error);
      throw error;
    }
  }

  /**
   * Update quiet hours settings
   */
  async updateQuietHours(userId, quietHoursData) {
    try {
      const userPrefs = await this.getUserPreferences(userId);

      const updatedQuietHours = {
        quietHoursEnabled: quietHoursData.enabled !== undefined ?
          quietHoursData.enabled : userPrefs.quietHoursEnabled,
        quietHoursStart: quietHoursData.start || userPrefs.quietHoursStart,
        quietHoursEnd: quietHoursData.end || userPrefs.quietHoursEnd,
        quietHoursTimezone: quietHoursData.timezone || userPrefs.quietHoursTimezone
      };

      return await this.updateUserPreferences(userId, updatedQuietHours);

    } catch (error) {
      logger.error('Failed to update quiet hours:', error);
      throw error;
    }
  }
}

// Create singleton instance
const userPreferencesService = new UserPreferencesService();

module.exports = userPreferencesService;