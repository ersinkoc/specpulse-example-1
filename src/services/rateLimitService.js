const redis = require('../config/redis');
const logger = require('../shared/utils/logger');
const config = require('../config');

/**
 * Rate Limiting Service
 * Provides rate limiting for notifications and other operations
 */
class RateLimitService {
  constructor() {
    this.redis = redis.client;
    this.defaultWindow = 60 * 1000; // 1 minute
    this.defaultMax = 10; // 10 requests per minute
  }

  /**
   * Check if user is rate limited for a specific action
   */
  async isRateLimited(identifier, action, options = {}) {
    try {
      const {
        windowMs = this.defaultWindow,
        maxRequests = this.defaultMax,
        blockDuration = 0, // 0 = no block, >0 = block duration in ms
        customKey = null
      } = options;

      const key = customKey || `rate_limit:${action}:${identifier}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Use Redis pipeline for atomic operations
      const pipeline = this.redis.pipeline();

      // Remove old entries outside the window
      pipeline.zremrangebyscore(key, 0, windowStart);

      // Add current request
      pipeline.zadd(key, now, `${now}-${Math.random()}`);

      // Count requests in current window
      pipeline.zcard(key);

      // Set expiration for the key
      pipeline.expire(key, Math.ceil(windowMs / 1000) + 60);

      const results = await pipeline.exec();
      const currentCount = results[2][1]; // zcard result

      const isLimited = currentCount > maxRequests;

      if (isLimited) {
        logger.warn('Rate limit exceeded', {
          identifier,
          action,
          currentCount,
          maxRequests,
          windowMs
        });

        // Block for specified duration if needed
        if (blockDuration > 0) {
          const blockKey = `rate_limit_block:${action}:${identifier}`;
          await this.redis.setex(blockKey, Math.ceil(blockDuration / 1000), 'blocked');
        }
      }

      return {
        isLimited,
        currentCount,
        maxRequests,
        remainingRequests: Math.max(0, maxRequests - currentCount),
        resetTime: now + windowMs,
        windowMs
      };

    } catch (error) {
      logger.error('Failed to check rate limit:', error);
      // Default to not rate limiting on error
      return {
        isLimited: false,
        currentCount: 0,
        maxRequests: options.maxRequests || this.defaultMax,
        remainingRequests: options.maxRequests || this.defaultMax,
        resetTime: Date.now() + (options.windowMs || this.defaultWindow),
        windowMs: options.windowMs || this.defaultWindow,
        error: error.message
      };
    }
  }

  /**
   * Check if user is blocked
   */
  async isBlocked(identifier, action) {
    try {
      const blockKey = `rate_limit_block:${action}:${identifier}`;
      const isBlocked = await this.redis.exists(blockKey);

      if (isBlocked) {
        const ttl = await this.redis.ttl(blockKey);
        return {
          isBlocked: true,
          blockTimeRemaining: ttl * 1000 // Convert to milliseconds
        };
      }

      return {
        isBlocked: false,
        blockTimeRemaining: 0
      };

    } catch (error) {
      logger.error('Failed to check block status:', error);
      return {
        isBlocked: false,
        blockTimeRemaining: 0,
        error: error.message
      };
    }
  }

  /**
   * Rate limit for bulk notifications
   */
  async checkBulkNotificationLimit(adminId, targetCount, options = {}) {
    try {
      const {
        windowMs = 60 * 60 * 1000, // 1 hour
        maxUsersPerHour = 1000,
        maxNotificationsPerHour = 5000
      } = options;

      // Check user count limit
      const userLimitResult = await this.isRateLimited(adminId, 'bulk_users', {
        windowMs,
        maxRequests: maxUsersPerHour,
        customKey: `bulk_users:${adminId}`
      });

      // Check notification count limit
      const notificationLimitResult = await this.isRateLimited(adminId, 'bulk_notifications', {
        windowMs,
        maxRequests: maxNotificationsPerHour,
        customKey: `bulk_notifications:${adminId}`
      });

      // Track the actual bulk operation
      await this.trackBulkOperation(adminId, targetCount);

      const isLimited = userLimitResult.isLimited || notificationLimitResult.isLimited;

      return {
        isLimited,
        userLimit: userLimitResult,
        notificationLimit: notificationLimitResult,
        targetCount,
        recommendedBatchSize: Math.min(
          userLimitResult.remainingRequests,
          notificationLimitResult.remainingRequests,
          100 // Max batch size
        )
      };

    } catch (error) {
      logger.error('Failed to check bulk notification limit:', error);
      return {
        isLimited: false,
        targetCount,
        error: error.message
      };
    }
  }

  /**
   * Track bulk operation for analytics
   */
  async trackBulkOperation(adminId, targetCount) {
    try {
      const key = `bulk_operations:${adminId}:${new Date().toISOString().substring(0, 10)}`;
      const pipeline = this.redis.pipeline();

      pipeline.hincrby(key, 'total_operations', 1);
      pipeline.hincrby(key, 'total_notifications', targetCount);
      pipeline.expire(key, 7 * 24 * 60 * 60); // 7 days

      await pipeline.exec();

    } catch (error) {
      logger.error('Failed to track bulk operation:', error);
    }
  }

  /**
   * Get bulk operation statistics for an admin
   */
  async getBulkOperationStats(adminId, days = 7) {
    try {
      const stats = [];
      const now = new Date();

      for (let i = 0; i < days; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().substring(0, 10);

        const key = `bulk_operations:${adminId}:${dateStr}`;
        const data = await this.redis.hgetall(key);

        stats.push({
          date: dateStr,
          totalOperations: parseInt(data.total_operations || 0),
          totalNotifications: parseInt(data.total_notifications || 0)
        });
      }

      return stats.reverse(); // Most recent first

    } catch (error) {
      logger.error('Failed to get bulk operation stats:', error);
      return [];
    }
  }

  /**
   * Rate limit for individual user notifications
   */
  async checkUserNotificationLimit(userId, options = {}) {
    try {
      const {
        windowMs = 60 * 60 * 1000, // 1 hour
        maxNotificationsPerHour = 50
      } = options;

      return await this.isRateLimited(userId, 'user_notifications', {
        windowMs,
        maxRequests: maxNotificationsPerHour
      });

    } catch (error) {
      logger.error('Failed to check user notification limit:', error);
      return {
        isLimited: false,
        error: error.message
      };
    }
  }

  /**
   * Rate limit for admin actions
   */
  async checkAdminActionLimit(adminId, action, options = {}) {
    try {
      const {
        windowMs = 60 * 1000, // 1 minute
        maxActionsPerMinute = 30
      } = options;

      // Check if admin is blocked
      const blockResult = await this.isBlocked(adminId, `admin_${action}`);
      if (blockResult.isBlocked) {
        return {
          isLimited: true,
          isBlocked: true,
          blockTimeRemaining: blockResult.blockTimeRemaining,
          reason: 'Admin action blocked'
        };
      }

      // Check rate limit
      const result = await this.isRateLimited(adminId, `admin_${action}`, {
        windowMs,
        maxRequests: maxActionsPerMinute
      });

      if (result.isLimited && result.currentCount > maxActionsPerMinute * 2) {
        // Block if exceeded limit by 2x
        await this.redis.setex(
          `rate_limit_block:admin_${action}:${adminId}`,
          300, // 5 minutes block
          'blocked'
        );

        result.isBlocked = true;
        result.blockTimeRemaining = 300 * 1000;
        result.reason = 'Admin action blocked due to excessive requests';
      }

      return result;

    } catch (error) {
      logger.error('Failed to check admin action limit:', error);
      return {
        isLimited: false,
        error: error.message
      };
    }
  }

  /**
   * Get rate limit status for user
   */
  async getRateLimitStatus(identifier, action, options = {}) {
    try {
      const {
        windowMs = this.defaultWindow,
        maxRequests = this.defaultMax
      } = options;

      const key = `rate_limit:${action}:${identifier}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Get current count and oldest request
      const pipeline = this.redis.pipeline();
      pipeline.zcard(key);
      pipeline.zrange(key, 0, 0);
      pipeline.zrange(key, -1, -1);

      const results = await pipeline.exec();
      const currentCount = results[0][1];
      const oldestRequest = results[1][1];
      const newestRequest = results[2][1];

      return {
        currentCount,
        maxRequests,
        remainingRequests: Math.max(0, maxRequests - currentCount),
        windowMs,
        resetTime: oldestRequest.length > 0 ?
          parseInt(oldestRequest[0].split('-')[0]) + windowMs :
          now + windowMs,
        oldestRequest: oldestRequest.length > 0 ? parseInt(oldestRequest[0].split('-')[0]) : null,
        newestRequest: newestRequest.length > 0 ? parseInt(newestRequest[0].split('-')[0]) : null
      };

    } catch (error) {
      logger.error('Failed to get rate limit status:', error);
      return {
        error: error.message
      };
    }
  }

  /**
   * Clear rate limit for user (admin use)
   */
  async clearRateLimit(identifier, action) {
    try {
      const key = `rate_limit:${action}:${identifier}`;
      await this.redis.del(key);

      logger.info('Rate limit cleared', {
        identifier,
        action
      });

      return true;

    } catch (error) {
      logger.error('Failed to clear rate limit:', error);
      return false;
    }
  }

  /**
   * Get global rate limit statistics
   */
  async getGlobalStats() {
    try {
      // This would typically be implemented with Redis keyspace notifications
      // For now, return basic stats
      const info = await this.redis.info('memory');

      return {
        redisMemory: info,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to get global stats:', error);
      return {
        error: error.message
      };
    }
  }

  /**
   * Clean up old rate limit data
   */
  async cleanup() {
    try {
      const pattern = 'rate_limit:*';
      const keys = await this.redis.keys(pattern);

      let cleanedCount = 0;
      for (const key of keys) {
        const ttl = await this.redis.ttl(key);
        if (ttl === -1) { // No expiration set
          await this.redis.expire(key, 3600); // Set 1 hour expiration
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} rate limit keys`);
      }

      return cleanedCount;

    } catch (error) {
      logger.error('Failed to cleanup rate limit data:', error);
      return 0;
    }
  }
}

// Create singleton instance
const rateLimitService = new RateLimitService();

module.exports = rateLimitService;