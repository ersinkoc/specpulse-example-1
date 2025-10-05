const Redis = require('ioredis');
const config = require('../shared/config/environment');
const logger = require('../shared/utils/logger');

/**
 * Redis Configuration for Notification System
 * Handles pub/sub messaging and queue management for notifications
 */
class NotificationRedis {
  constructor() {
    this.publisher = null;
    this.subscriber = null;
    this.client = null;
    this.isInitialized = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // Start with 1 second

    this.initialize();
  }

  /**
   * Initialize Redis connections
   */
  async initialize() {
    try {
      const redisOptions = {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        family: 4,
        keepAlive: 30000,
        connectTimeout: 10000,
        commandTimeout: 5000
      };

      // Create publisher for sending messages
      this.publisher = new Redis(redisOptions);

      // Create subscriber for receiving messages
      this.subscriber = new Redis(redisOptions);

      // Create client for general operations
      this.client = new Redis(redisOptions);

      // Setup event handlers
      this.setupEventHandlers();

      // Connect all clients
      await Promise.all([
        this.publisher.connect(),
        this.subscriber.connect(),
        this.client.connect()
      ]);

      this.isInitialized = true;
      logger.info('Notification Redis clients initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize Notification Redis clients:', error);
      this.handleConnectionError(error);
    }
  }

  /**
   * Setup event handlers for Redis connections
   */
  setupEventHandlers() {
    // Publisher events
    this.publisher.on('connect', () => {
      logger.info('Notification Redis publisher connected');
      this.reconnectAttempts = 0;
    });

    this.publisher.on('error', (error) => {
      logger.error('Notification Redis publisher error:', error);
    });

    this.publisher.on('close', () => {
      logger.warn('Notification Redis publisher connection closed');
    });

    // Subscriber events
    this.subscriber.on('connect', () => {
      logger.info('Notification Redis subscriber connected');
    });

    this.subscriber.on('error', (error) => {
      logger.error('Notification Redis subscriber error:', error);
    });

    this.subscriber.on('close', () => {
      logger.warn('Notification Redis subscriber connection closed');
    });

    // Client events
    this.client.on('connect', () => {
      logger.info('Notification Redis client connected');
    });

    this.client.on('error', (error) => {
      logger.error('Notification Redis client error:', error);
    });

    this.client.on('close', () => {
      logger.warn('Notification Redis client connection closed');
    });
  }

  /**
   * Handle connection errors with reconnection logic
   */
  handleConnectionError(error) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      logger.warn(`Attempting to reconnect to Redis (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);

      setTimeout(() => {
        this.initialize();
      }, delay);
    } else {
      logger.error('Max Redis reconnection attempts reached. Please check Redis configuration.');
      this.isInitialized = false;
    }
  }

  /**
   * Publish a message to a channel
   */
  async publish(channel, message) {
    if (!this.isInitialized || !this.publisher) {
      throw new Error('Redis publisher not initialized');
    }

    try {
      const serializedMessage = JSON.stringify({
        ...message,
        timestamp: new Date().toISOString(),
        messageId: this.generateMessageId()
      });

      const result = await this.publisher.publish(channel, serializedMessage);

      logger.debug(`Message published to channel ${channel}: ${result} subscribers reached`);
      return result;
    } catch (error) {
      logger.error(`Failed to publish message to channel ${channel}:`, error);
      throw error;
    }
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(channel, callback) {
    if (!this.isInitialized || !this.subscriber) {
      throw new Error('Redis subscriber not initialized');
    }

    try {
      await this.subscriber.subscribe(channel);

      this.subscriber.on('message', (receivedChannel, message) => {
        if (receivedChannel === channel) {
          try {
            const parsedMessage = JSON.parse(message);
            callback(parsedMessage);
          } catch (parseError) {
            logger.error(`Failed to parse message from channel ${channel}:`, parseError);
          }
        }
      });

      logger.info(`Subscribed to Redis channel: ${channel}`);
    } catch (error) {
      logger.error(`Failed to subscribe to channel ${channel}:`, error);
      throw error;
    }
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel) {
    if (!this.isInitialized || !this.subscriber) {
      return;
    }

    try {
      await this.subscriber.unsubscribe(channel);
      logger.info(`Unsubscribed from Redis channel: ${channel}`);
    } catch (error) {
      logger.error(`Failed to unsubscribe from channel ${channel}:`, error);
    }
  }

  /**
   * Add item to a queue (using Redis list)
   */
  async enqueue(queueName, item, options = {}) {
    if (!this.isInitialized || !this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      const serializedItem = JSON.stringify({
        ...item,
        id: this.generateMessageId(),
        enqueuedAt: new Date().toISOString(),
        retryCount: 0
      });

      if (options.priority) {
        // Use sorted set for priority queues (higher score = higher priority)
        await this.client.zadd(queueName, options.priority, serializedItem);
      } else {
        // Use regular list for FIFO queues
        await this.client.lpush(queueName, serializedItem);
      }

      logger.debug(`Item enqueued to ${queueName}: ${item.title || 'unnamed'}`);
    } catch (error) {
      logger.error(`Failed to enqueue item to ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Remove item from a queue
   */
  async dequeue(queueName, options = {}) {
    if (!this.isInitialized || !this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      let result;

      if (options.priority) {
        // Get highest priority item from sorted set
        result = await this.client.zpopmax(queueName);
        result = result.length > 0 ? result[0].value : null;
      } else {
        // Use blocking pop for FIFO queues with timeout
        const timeout = options.timeout || 1; // 1 second default
        result = await this.client.brpop(queueName, timeout);
        result = result ? result[1] : null; // Extract the value from [key, value] array
      }

      if (result) {
        const parsedItem = JSON.parse(result);
        logger.debug(`Item dequeued from ${queueName}: ${parsedItem.title || 'unnamed'}`);
        return parsedItem;
      }

      return null;
    } catch (error) {
      logger.error(`Failed to dequeue item from ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Get queue size
   */
  async getQueueSize(queueName) {
    if (!this.isInitialized || !this.client) {
      return 0;
    }

    try {
      // Check if it's a priority queue (sorted set)
      const isPriorityQueue = await this.client.exists(queueName) &&
        await this.client.type(queueName) === 'zset';

      if (isPriorityQueue) {
        return await this.client.zcard(queueName);
      } else {
        return await this.client.llen(queueName);
      }
    } catch (error) {
      logger.error(`Failed to get queue size for ${queueName}:`, error);
      return 0;
    }
  }

  /**
   * Set a key with expiration
   */
  async setWithExpiry(key, value, ttlSeconds) {
    if (!this.isInitialized || !this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      const serializedValue = JSON.stringify(value);
      await this.client.setex(key, ttlSeconds, serializedValue);
      logger.debug(`Key ${key} set with ${ttlSeconds} seconds TTL`);
    } catch (error) {
      logger.error(`Failed to set key ${key} with expiry:`, error);
      throw error;
    }
  }

  /**
   * Get a key
   */
  async get(key) {
    if (!this.isInitialized || !this.client) {
      return null;
    }

    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error(`Failed to get key ${key}:`, error);
      return null;
    }
  }

  /**
   * Delete a key
   */
  async delete(key) {
    if (!this.isInitialized || !this.client) {
      return false;
    }

    try {
      const result = await this.client.del(key);
      logger.debug(`Key ${key} deleted: ${result > 0}`);
      return result > 0;
    } catch (error) {
      logger.error(`Failed to delete key ${key}:`, error);
      return false;
    }
  }

  /**
   * Increment a counter
   */
  async increment(key, amount = 1) {
    if (!this.isInitialized || !this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      const result = await this.client.incrby(key, amount);
      logger.debug(`Counter ${key} incremented by ${amount}: ${result}`);
      return result;
    } catch (error) {
      logger.error(`Failed to increment counter ${key}:`, error);
      throw error;
    }
  }

  /**
   * Add item to retry queue
   */
  async addToRetryQueue(item, delaySeconds = 5) {
    const retryQueueName = 'notifications:retry_queue';
    const retryAt = Math.floor(Date.now() / 1000) + delaySeconds;

    await this.enqueue(retryQueueName, item, { priority: retryAt });
    logger.debug(`Item added to retry queue, will retry at ${new Date(retryAt * 1000).toISOString()}`);
  }

  /**
   * Process retry queue
   */
  async processRetryQueue() {
    const retryQueueName = 'notifications:retry_queue';
    const now = Math.floor(Date.now() / 1000);

    try {
      // Get items ready for retry (items with timestamp <= now)
      const items = await this.client.zrangebyscore(retryQueueName, 0, now);

      if (items.length > 0) {
        // Remove processed items from queue
        await this.client.zremrangebyscore(retryQueueName, 0, now);

        // Parse and return items
        return items.map(item => JSON.parse(item));
      }

      return [];
    } catch (error) {
      logger.error('Failed to process retry queue:', error);
      return [];
    }
  }

  /**
   * Get connection statistics
   */
  getStats() {
    return {
      isInitialized: this.isInitialized,
      publisherStatus: this.publisher ? this.publisher.status : 'disconnected',
      subscriberStatus: this.subscriber ? this.subscriber.status : 'disconnected',
      clientStatus: this.client ? this.client.status : 'disconnected',
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Generate unique message ID
   */
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    logger.info('Shutting down Notification Redis clients...');

    const shutdownPromises = [];

    if (this.publisher) {
      shutdownPromises.push(this.publisher.quit());
    }

    if (this.subscriber) {
      shutdownPromises.push(this.subscriber.quit());
    }

    if (this.client) {
      shutdownPromises.push(this.client.quit());
    }

    try {
      await Promise.all(shutdownPromises);
      logger.info('Notification Redis clients shut down successfully');
    } catch (error) {
      logger.error('Error shutting down Notification Redis clients:', error);
    }

    this.isInitialized = false;
  }
}

// Create singleton instance
const notificationRedis = new NotificationRedis();

module.exports = notificationRedis;