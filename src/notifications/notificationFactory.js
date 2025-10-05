const {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_TYPES,
  BaseNotification
} = require('./models');
const notificationService = require('./notificationService');

/**
 * Notification Factory
 * Factory methods to create different types of notifications
 */
class NotificationFactory {
  /**
   * Create a security notification
   */
  static createSecurityNotification(type, userId, data = {}) {
    const templates = {
      [NOTIFICATION_TYPES.LOGIN_SUCCESS]: {
        title: 'Successful Login',
        message: 'You have successfully logged in to your account',
        priority: NOTIFICATION_PRIORITIES.LOW
      },
      [NOTIFICATION_TYPES.LOGIN_FAILED]: {
        title: 'Failed Login Attempt',
        message: 'There was a failed login attempt on your account',
        priority: NOTIFICATION_PRIORITIES.HIGH
      },
      [NOTIFICATION_TYPES.PASSWORD_CHANGED]: {
        title: 'Password Changed',
        message: 'Your password has been successfully changed',
        priority: NOTIFICATION_PRIORITIES.MEDIUM
      },
      [NOTIFICATION_TYPES.SUSPICIOUS_ACTIVITY]: {
        title: 'Suspicious Activity Detected',
        message: 'We detected suspicious activity on your account',
        priority: NOTIFICATION_PRIORITIES.CRITICAL
      }
    };

    const template = templates[type] || {
      title: 'Security Alert',
      message: 'A security event has occurred on your account',
      priority: NOTIFICATION_PRIORITIES.MEDIUM
    };

    return notificationService.validateNotification({
      ...BaseNotification,
      category: NOTIFICATION_CATEGORIES.SECURITY,
      type,
      userId,
      ...template,
      data: {
        ...data,
        ipAddress: data.ipAddress || 'Unknown',
        location: data.location || 'Unknown',
        device: data.device || 'Unknown'
      },
      actions: this.getSecurityActions(type)
    });
  }

  /**
   * Create a system notification
   */
  static createSystemNotification(type, data = {}) {
    const templates = {
      [NOTIFICATION_TYPES.SYSTEM_MAINTENANCE]: {
        title: 'Scheduled Maintenance',
        message: 'System maintenance is scheduled for the specified time',
        priority: NOTIFICATION_PRIORITIES.MEDIUM
      },
      [NOTIFICATION_TYPES.SYSTEM_UPDATE]: {
        title: 'System Update',
        message: 'A new system update is available',
        priority: NOTIFICATION_PRIORITIES.LOW
      },
      [NOTIFICATION_TYPES.DOWNTIME_ALERT]: {
        title: 'Service Downtime',
        message: 'Some services may be temporarily unavailable',
        priority: NOTIFICATION_PRIORITIES.HIGH
      }
    };

    const template = templates[type] || {
      title: 'System Notification',
      message: 'A system event has occurred',
      priority: NOTIFICATION_PRIORITIES.MEDIUM
    };

    return notificationService.validateNotification({
      ...BaseNotification,
      category: NOTIFICATION_CATEGORIES.SYSTEM,
      type,
      ...template,
      data: {
        ...data,
        scheduledTime: data.scheduledTime,
        duration: data.duration,
        affectedServices: data.affectedServices || []
      },
      actions: this.getSystemActions(type)
    });
  }

  /**
   * Create a social notification
   */
  static createSocialNotification(type, userId, data = {}) {
    const templates = {
      [NOTIFICATION_TYPES.NEW_FOLLOWER]: {
        title: 'New Follower',
        message: `${data.followerName} started following you`,
        priority: NOTIFICATION_PRIORITIES.LOW
      },
      [NOTIFICATION_TYPES.MENTION]: {
        title: 'You were mentioned',
        message: `${data.mentionerName} mentioned you in ${data.context}`,
        priority: NOTIFICATION_PRIORITIES.MEDIUM
      },
      [NOTIFICATION_TYPES.MESSAGE_RECEIVED]: {
        title: 'New Message',
        message: `You received a message from ${data.senderName}`,
        priority: NOTIFICATION_PRIORITIES.MEDIUM
      },
      [NOTIFICATION_TYPES.LIKE_RECEIVED]: {
        title: 'New Like',
        message: `${data.likerName} liked your ${data.itemType}`,
        priority: NOTIFICATION_PRIORITIES.LOW
      }
    };

    const template = templates[type] || {
      title: 'Social Notification',
      message: 'A social event has occurred',
      priority: NOTIFICATION_PRIORITIES.LOW
    };

    return notificationService.validateNotification({
      ...BaseNotification,
      category: NOTIFICATION_CATEGORIES.SOCIAL,
      type,
      userId,
      ...template,
      data: {
        ...data,
        followerId: data.followerId,
        mentionerId: data.mentionerId,
        senderId: data.senderId,
        likerId: data.likerId,
        itemId: data.itemId,
        itemType: data.itemType
      },
      actions: this.getSocialActions(type, data)
    });
  }

  /**
   * Create a task notification
   */
  static createTaskNotification(type, userId, data = {}) {
    const templates = {
      [NOTIFICATION_TYPES.TASK_ASSIGNED]: {
        title: 'New Task Assigned',
        message: `You have been assigned a new task: ${data.taskTitle}`,
        priority: NOTIFICATION_PRIORITIES.MEDIUM
      },
      [NOTIFICATION_TYPES.TASK_COMPLETED]: {
        title: 'Task Completed',
        message: `Task "${data.taskTitle}" has been completed`,
        priority: NOTIFICATION_PRIORITIES.LOW
      },
      [NOTIFICATION_TYPES.TASK_DUE_SOON]: {
        title: 'Task Due Soon',
        message: `Task "${data.taskTitle}" is due soon`,
        priority: NOTIFICATION_PRIORITIES.HIGH
      },
      [NOTIFICATION_TYPES.TASK_OVERDUE]: {
        title: 'Task Overdue',
        message: `Task "${data.taskTitle}" is overdue`,
        priority: NOTIFICATION_PRIORITIES.CRITICAL
      }
    };

    const template = templates[type] || {
      title: 'Task Notification',
      message: 'A task event has occurred',
      priority: NOTIFICATION_PRIORITIES.MEDIUM
    };

    return notificationService.validateNotification({
      ...BaseNotification,
      category: NOTIFICATION_CATEGORIES.TASK,
      type,
      userId,
      ...template,
      data: {
        ...data,
        taskId: data.taskId,
        taskTitle: data.taskTitle,
        dueDate: data.dueDate,
        assigneeName: data.assigneeName,
        projectName: data.projectName
      },
      actions: this.getTaskActions(type, data)
    });
  }

  /**
   * Create an administrative notification
   */
  static createAdministrativeNotification(type, data = {}) {
    const templates = {
      [NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT]: {
        title: 'System Announcement',
        message: data.message || 'Important system announcement',
        priority: NOTIFICATION_PRIORITIES.HIGH
      },
      [NOTIFICATION_TYPES.POLICY_UPDATE]: {
        title: 'Policy Update',
        message: 'Terms of service or privacy policy have been updated',
        priority: NOTIFICATION_PRIORITIES.MEDIUM
      },
      [NOTIFICATION_TYPES.BULK_MESSAGE]: {
        title: data.title || 'Important Message',
        message: data.message || 'An important message from administrators',
        priority: NOTIFICATION_PRIORITIES.MEDIUM
      }
    };

    const template = templates[type] || {
      title: 'Administrative Notification',
      message: 'An administrative event has occurred',
      priority: NOTIFICATION_PRIORITIES.MEDIUM
    };

    return notificationService.validateNotification({
      ...BaseNotification,
      category: NOTIFICATION_CATEGORIES.ADMINISTRATIVE,
      type,
      ...template,
      data: {
        ...data,
        sentBy: data.sentBy || 'System Administrator',
        announcementId: data.announcementId,
        policyType: data.policyType
      },
      actions: this.getAdministrativeActions(type, data)
    });
  }

  /**
   * Get appropriate actions for security notifications
   */
  static getSecurityActions(type) {
    const actions = [];

    switch (type) {
      case NOTIFICATION_TYPES.LOGIN_FAILED:
        actions.push({
          id: 'review_account',
          label: 'Review Account',
          action: 'navigate',
          url: '/security/recent-activity',
          style: 'primary'
        });
        break;
      case NOTIFICATION_TYPES.SUSPICIOUS_ACTIVITY:
        actions.push({
          id: 'secure_account',
          label: 'Secure Account',
          action: 'navigate',
          url: '/security/secure-account',
          style: 'danger'
        });
        actions.push({
          id: 'review_activity',
          label: 'Review Activity',
          action: 'navigate',
          url: '/security/recent-activity',
          style: 'secondary'
        });
        break;
    }

    actions.push({
      id: 'dismiss',
      label: 'Dismiss',
      action: 'dismiss',
      style: 'secondary'
    });

    return actions;
  }

  /**
   * Get appropriate actions for system notifications
   */
  static getSystemActions(type) {
    const actions = [];

    switch (type) {
      case NOTIFICATION_TYPES.SYSTEM_MAINTENANCE:
        actions.push({
          id: 'view_details',
          label: 'View Details',
          action: 'navigate',
          url: '/system/maintenance',
          style: 'primary'
        });
        break;
      case NOTIFICATION_TYPES.SYSTEM_UPDATE:
        actions.push({
          id: 'update_now',
          label: 'Update Now',
          action: 'navigate',
          url: '/system/update',
          style: 'primary'
        });
        break;
    }

    actions.push({
      id: 'dismiss',
      label: 'Dismiss',
      action: 'dismiss',
      style: 'secondary'
    });

    return actions;
  }

  /**
   * Get appropriate actions for social notifications
   */
  static getSocialActions(type, data) {
    const actions = [];

    switch (type) {
      case NOTIFICATION_TYPES.NEW_FOLLOWER:
        actions.push({
          id: 'view_profile',
          label: 'View Profile',
          action: 'navigate',
          url: `/users/${data.followerId}`,
          style: 'primary'
        });
        break;
      case NOTIFICATION_TYPES.MENTION:
        actions.push({
          id: 'view_mention',
          label: 'View Mention',
          action: 'navigate',
          url: data.mentionUrl,
          style: 'primary'
        });
        break;
      case NOTIFICATION_TYPES.MESSAGE_RECEIVED:
        actions.push({
          id: 'view_message',
          label: 'View Message',
          action: 'navigate',
          url: `/messages/${data.messageId}`,
          style: 'primary'
        });
        break;
    }

    actions.push({
      id: 'dismiss',
      label: 'Dismiss',
      action: 'dismiss',
      style: 'secondary'
    });

    return actions;
  }

  /**
   * Get appropriate actions for task notifications
   */
  static getTaskActions(type, data) {
    const actions = [];

    switch (type) {
      case NOTIFICATION_TYPES.TASK_ASSIGNED:
        actions.push({
          id: 'view_task',
          label: 'View Task',
          action: 'navigate',
          url: `/tasks/${data.taskId}`,
          style: 'primary'
        });
        break;
      case NOTIFICATION_TYPES.TASK_DUE_SOON:
      case NOTIFICATION_TYPES.TASK_OVERDUE:
        actions.push({
          id: 'complete_task',
          label: 'Complete Task',
          action: 'navigate',
          url: `/tasks/${data.taskId}/complete`,
          style: 'primary'
        });
        actions.push({
          id: 'view_task',
          label: 'View Task',
          action: 'navigate',
          url: `/tasks/${data.taskId}`,
          style: 'secondary'
        });
        break;
    }

    actions.push({
      id: 'dismiss',
      label: 'Dismiss',
      action: 'dismiss',
      style: 'secondary'
    });

    return actions;
  }

  /**
   * Get appropriate actions for administrative notifications
   */
  static getAdministrativeActions(type, data) {
    const actions = [];

    switch (type) {
      case NOTIFICATION_TYPES.POLICY_UPDATE:
        actions.push({
          id: 'view_policy',
          label: 'View Policy',
          action: 'navigate',
          url: `/policies/${data.policyType}`,
          style: 'primary'
        });
        break;
      case NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT:
        if (data.announcementUrl) {
          actions.push({
            id: 'read_more',
            label: 'Read More',
            action: 'navigate',
            url: data.announcementUrl,
            style: 'primary'
          });
        }
        break;
    }

    actions.push({
      id: 'dismiss',
      label: 'Dismiss',
      action: 'dismiss',
      style: 'secondary'
    });

    return actions;
  }

  /**
   * Create a custom notification
   */
  static createCustomNotification(options) {
    return notificationService.validateNotification({
      ...BaseNotification,
      ...options
    });
  }
}

module.exports = NotificationFactory;