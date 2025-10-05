/**
 * Notification Models and Types
 * Defines data structures for notifications
 */

// Notification categories
const NOTIFICATION_CATEGORIES = {
  SECURITY: 'security',
  SYSTEM: 'system',
  SOCIAL: 'social',
  TASK: 'task',
  ADMINISTRATIVE: 'administrative'
};

// Notification priorities
const NOTIFICATION_PRIORITIES = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

// Notification types
const NOTIFICATION_TYPES = {
  // Security notifications
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILED: 'login_failed',
  PASSWORD_CHANGED: 'password_changed',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity',

  // System notifications
  SYSTEM_MAINTENANCE: 'system_maintenance',
  SYSTEM_UPDATE: 'system_update',
  DOWNTIME_ALERT: 'downtime_alert',

  // Social notifications
  NEW_FOLLOWER: 'new_follower',
  MENTION: 'mention',
  MESSAGE_RECEIVED: 'message_received',
  LIKE_RECEIVED: 'like_received',

  // Task notifications
  TASK_ASSIGNED: 'task_assigned',
  TASK_COMPLETED: 'task_completed',
  TASK_DUE_SOON: 'task_due_soon',
  TASK_OVERDUE: 'task_overdue',

  // Administrative notifications
  SYSTEM_ANNOUNCEMENT: 'system_announcement',
  POLICY_UPDATE: 'policy_update',
  BULK_MESSAGE: 'bulk_message'
};

// Base notification structure
const BaseNotification = {
  id: '', // Generated UUID
  title: '', // Required
  message: '', // Required
  category: NOTIFICATION_CATEGORIES.SYSTEM, // Required
  type: '', // Optional specific type
  priority: NOTIFICATION_PRIORITIES.MEDIUM, // Required
  data: {}, // Optional additional data
  timestamp: '', // ISO timestamp
  expiresIn: 86400000, // milliseconds (24 hours default)
  read: false, // Read status
  userId: '', // Target user ID
  actions: [], // Array of action buttons
  metadata: {} // Optional metadata
};

// Notification action structure
const NotificationAction = {
  id: '', // Action identifier
  label: '', // Button label
  url: '', // Optional URL to navigate to
  action: '', // Action type (e.g., 'confirm', 'dismiss', 'navigate')
  style: 'primary', // Button style (primary, secondary, danger)
  data: {} // Optional action data
};

// User notification preferences
const UserNotificationPreferences = {
  userId: '', // User ID
  categories: {
    [NOTIFICATION_CATEGORIES.SECURITY]: {
      enabled: true,
      websocket: true,
      email: true,
      quietHours: false
    },
    [NOTIFICATION_CATEGORIES.SYSTEM]: {
      enabled: true,
      websocket: true,
      email: false,
      quietHours: true
    },
    [NOTIFICATION_CATEGORIES.SOCIAL]: {
      enabled: true,
      websocket: true,
      email: false,
      quietHours: true
    },
    [NOTIFICATION_CATEGORIES.TASK]: {
      enabled: true,
      websocket: true,
      email: true,
      quietHours: false
    },
    [NOTIFICATION_CATEGORIES.ADMINISTRATIVE]: {
      enabled: true,
      websocket: true,
      email: true,
      quietHours: false
    }
  },
  priorities: {
    [NOTIFICATION_PRIORITIES.LOW]: {
      websocket: false,
      email: false
    },
    [NOTIFICATION_PRIORITIES.MEDIUM]: {
      websocket: true,
      email: false
    },
    [NOTIFICATION_PRIORITIES.HIGH]: {
      websocket: true,
      email: true
    },
    [NOTIFICATION_PRIORITIES.CRITICAL]: {
      websocket: true,
      email: true
    }
  },
  quietHours: {
    enabled: false,
    startTime: '22:00', // 10 PM
    endTime: '08:00', // 8 AM
    timezone: 'UTC'
  },
  settings: {
    maxNotificationsPerHour: 50,
    groupSimilarNotifications: true,
    soundEnabled: true,
    vibrationEnabled: true
  }
};

// Notification statistics
const NotificationStats = {
  totalSent: 0,
  totalDelivered: 0,
  totalRead: 0,
  totalFailed: 0,
  byCategory: {
    [NOTIFICATION_CATEGORIES.SECURITY]: 0,
    [NOTIFICATION_CATEGORIES.SYSTEM]: 0,
    [NOTIFICATION_CATEGORIES.SOCIAL]: 0,
    [NOTIFICATION_CATEGORIES.TASK]: 0,
    [NOTIFICATION_CATEGORIES.ADMINISTRATIVE]: 0
  },
  byPriority: {
    [NOTIFICATION_PRIORITIES.LOW]: 0,
    [NOTIFICATION_PRIORITIES.MEDIUM]: 0,
    [NOTIFICATION_PRIORITIES.HIGH]: 0,
    [NOTIFICATION_PRIORITIES.CRITICAL]: 0
  },
  deliveryRates: {
    websocket: 0,
    email: 0,
    offline: 0
  }
};

// Notification queue item for batch processing
const QueueItem = {
  id: '', // Queue item ID
  userId: '', // Target user
  notification: {}, // Notification object
  timestamp: null, // Queue timestamp
  retryCount: 0, // Number of retries
  maxRetries: 3, // Maximum retry attempts
  nextRetryAt: null, // Next retry timestamp
  status: 'queued', // queued, processing, sent, failed, expired
  channels: ['websocket'] // Delivery channels to try
};

module.exports = {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_TYPES,
  BaseNotification,
  NotificationAction,
  UserNotificationPreferences,
  NotificationStats,
  QueueItem
};