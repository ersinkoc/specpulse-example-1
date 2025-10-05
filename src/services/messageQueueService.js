const redisClusterManager = require('../config/redisCluster');
const logger = require('../shared/utils/logger');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');
const payloadOptimizationService = require('./payloadOptimizationService');

/**
 * Enhanced Message Queue Service
 * Provides high-performance, scalable message queuing with Redis clustering support
 */
class MessageQueueService extends EventEmitter {
  constructor() {
    super();

    this.queues = new Map(); // queueName -> queue config
    this.consumers = new Map(); // queueName -> Set of consumer callbacks
    this.processing = new Set(); // Set of currently processing message IDs
    this.deadLetterQueue = 'messages:dlq';
    this.retryAttempts = new Map(); // messageId -> retry count

    // Configuration
    this.config = {
      maxRetries: 3,
      retryDelayBase: 1000, // 1 second base delay
      retryDelayMultiplier: 2,
      visibilityTimeout: 30000, // 30 seconds
      messageTTL: 7 * 24 * 60 * 60 * 1000, // 7 days
      maxInFlight: 100,
      batchSize: 10,
      pollInterval: 1000, // 1 second
      dlqMaxSize: 10000
    };

    // Metrics
    this.metrics = {
      queues: {
        total: 0,
        active: 0,
        sizes: new Map() // queueName -> size
      },
      messages: {
        enqueued: 0,
        dequeued: 0,
        processed: 0,
        failed: 0,
        retried: 0,
        deadLettered: 0,
        avgProcessingTime: 0,
        throughput: {
          messages: 0,
          bytes: 0
        }
      },
      performance: {
        avgLatency: 0,
        p95Latency: 0,
        p99Latency: 0,
        errorRate: 0
      }
    };

    // Start processing loops
    this.startProcessingLoops();
  }

  /**
   * Create a new queue
   */
  async createQueue(queueName, options = {}) {
    try {
      const queueConfig = {
        name: queueName,
        priority: options.priority || false,
        durable: options.durable !== false,
        maxLength: options.maxLength || 0,
        messageTTL: options.messageTTL || this.config.messageTTL,
        deadLetterQueue: options.deadLetterQueue || this.deadLetterQueue,
        maxRetries: options.maxRetries || this.config.maxRetries,
        visibilityTimeout: options.visibilityTimeout || this.config.visibilityTimeout,
        consumerGroup: options.consumerGroup || null,
        created: new Date().toISOString()
      };

      this.queues.set(queueName, queueConfig);
      this.metrics.queues.total++;

      // Create Redis data structures for the queue
      await this.initializeQueueInRedis(queueName, queueConfig);

      logger.info(`Queue created: ${queueName}`, queueConfig);
      this.emit('queue:created', { queueName, config: queueConfig });

      return queueConfig;

    } catch (error) {
      logger.error(`Failed to create queue ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Initialize queue structures in Redis
   */
  async initializeQueueInRedis(queueName, config) {
    const redis = redisClusterManager.getClient();

    // Create queue-specific keys
    const queueKey = `queue:${queueName}`;
    const processingKey = `queue:${queueName}:processing`;
    const metricsKey = `queue:${queueName}:metrics`;

    // Set up queue metadata
    await redis.hset(metricsKey, {
      created: config.created,
      messages_enqueued: 0,
      messages_dequeued: 0,
      messages_processed: 0,
      messages_failed: 0,
      last_activity: new Date().toISOString()
    });

    // Set expiration for metrics
    await redis.expire(metricsKey, 30 * 24 * 60 * 60); // 30 days

    logger.debug(`Queue ${queueName} initialized in Redis`);
  }

  /**
   * Enqueue a message
   */
  async enqueue(queueName, message, options = {}) {
    try {
      const queueConfig = this.queues.get(queueName);
      if (!queueConfig) {
        throw new Error(`Queue ${queueName} does not exist`);
      }

      const messageId = uuidv4();
      const now = Date.now();

      // Optimize payload before creating queue message
      const payloadOptimizationResult = await payloadOptimizationService.processMessage(message, {
        compression: {
          enabled: options.enableCompression !== false,
          threshold: options.compressionThreshold || 1024,
          algorithm: options.compressionAlgorithm || 'auto'
        },
        optimization: {
          enabled: options.enableOptimization !== false,
          removeNullFields: true,
          removeUndefinedFields: true,
          shortFieldNames: options.enableShortFieldNames || false
        }
      });

      const queueMessage = {
        id: messageId,
        payload: payloadOptimizationResult.data,
        metadata: {
          queueName,
          enqueuedAt: now,
          enqueuedAtISO: new Date(now).toISOString(),
          priority: options.priority || 0,
          delayUntil: options.delayUntil || 0,
          retryCount: 0,
          maxRetries: options.maxRetries || queueConfig.maxRetries,
          visibilityTimeout: options.visibilityTimeout || queueConfig.visibilityTimeout,
          ttl: options.ttl || queueConfig.messageTTL,
          correlationId: options.correlationId,
          userId: options.userId,
          sessionId: options.sessionId,
          tags: options.tags || [],
          // Add optimization metadata
          optimization: {
            originalSize: payloadOptimizationResult.metadata.originalSize,
            compressedSize: payloadOptimizationResult.metadata.compressedSize,
            isCompressed: payloadOptimizationResult.metadata.isCompressed,
            compressionAlgorithm: payloadOptimizationResult.metadata.algorithm,
            compressionRatio: payloadOptimizationResult.metadata.compressionRatio,
            optimizationRatio: payloadOptimizationResult.metadata.optimizationRatio
          }
        }
      };

      const redis = redisClusterManager.getClient();

      // Add delay logic if specified
      if (options.delayUntil && options.delayUntil > now) {
        await redis.zadd(`queue:${queueName}:delayed`, options.delayUntil, JSON.stringify(queueMessage));
      } else {
        // Enqueue immediately
        await this.enqueueMessage(redis, queueName, queueMessage, queueConfig);
      }

      // Update metrics
      this.metrics.messages.enqueued++;
      this.updateQueueMetrics(queueName, 'enqueued', 1);
      this.updateLatencyMetrics('enqueue', 0);

      // Track message size for throughput metrics (use compressed size if available)
      const messageSize = payloadOptimizationResult.metadata.compressedSize ||
                         JSON.stringify(queueMessage).length;
      this.metrics.messages.throughput.bytes += messageSize;

      logger.debug(`Message enqueued to ${queueName}`, {
        messageId,
        priority: queueMessage.metadata.priority,
        size: messageSize
      });

      this.emit('message:enqueued', { queueName, messageId, message: queueMessage });

      return messageId;

    } catch (error) {
      this.metrics.messages.failed++;
      logger.error(`Failed to enqueue message to ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Enqueue message to appropriate Redis structure
   */
  async enqueueMessage(redis, queueName, queueMessage, queueConfig) {
    const serializedMessage = JSON.stringify(queueMessage);

    if (queueConfig.priority) {
      // Use sorted set for priority queues (higher score = higher priority)
      await redis.zadd(`queue:${queueName}`, queueMessage.metadata.priority, serializedMessage);
    } else {
      // Use list for FIFO queues
      await redis.lpush(`queue:${queueName}`, serializedMessage);
    }

    // Apply max length limit if specified
    if (queueConfig.maxLength > 0) {
      if (queueConfig.priority) {
        await redis.zremrangebyrank(`queue:${queueName}`, 0, -(queueConfig.maxLength + 1));
      } else {
        await redis.ltrim(`queue:${queueName}`, 0, queueConfig.maxLength - 1);
      }
    }
  }

  /**
   * Dequeue a message
   */
  async dequeue(queueName, options = {}) {
    try {
      const queueConfig = this.queues.get(queueName);
      if (!queueConfig) {
        throw new Error(`Queue ${queueName} does not exist`);
      }

      const redis = redisClusterManager.getClient();

      // First process delayed messages
      await this.processDelayedMessages(redis, queueName);

      let message = null;

      if (queueConfig.priority) {
        // Priority queue: get highest priority message
        const result = await redis.zpopmax(`queue:${queueName}`);
        message = result.length > 0 ? JSON.parse(result[0].value) : null;
      } else {
        // FIFO queue: use blocking pop with timeout
        const timeout = options.timeout || this.config.pollInterval / 1000;
        const result = await redis.brpop(`queue:${queueName}`, timeout);
        message = result ? JSON.parse(result[1]) : null;
      }

      if (message) {
        // Restore optimized payload if needed
        if (message.metadata.optimization && message.metadata.optimization.isCompressed) {
          const restoreResult = await payloadOptimizationService.restoreMessage(
            message.payload,
            message.metadata.optimization
          );
          if (restoreResult.success) {
            message.payload = restoreResult.data;
          } else {
            logger.warn(`Failed to restore payload for message ${message.id}:`, restoreResult.error);
          }
        }

        // Move to processing queue with visibility timeout
        await redis.zadd(
          `queue:${queueName}:processing`,
          Date.now() + queueConfig.visibilityTimeout,
          JSON.stringify(message)
        );

        this.processing.add(message.id);
        this.metrics.messages.dequeued++;
        this.updateQueueMetrics(queueName, 'dequeued', 1);

        logger.debug(`Message dequeued from ${queueName}`, {
          messageId: message.id,
          priority: message.metadata.priority,
          wasCompressed: message.metadata.optimization?.isCompressed || false
        });

        this.emit('message:dequeued', { queueName, messageId: message.id, message });

        return message;
      }

      return null;

    } catch (error) {
      this.metrics.messages.failed++;
      logger.error(`Failed to dequeue message from ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Process delayed messages
   */
  async processDelayedMessages(redis, queueName) {
    try {
      const now = Date.now();
      const delayedMessages = await redis.zrangebyscore(`queue:${queueName}:delayed`, 0, now);

      if (delayedMessages.length > 0) {
        // Remove processed delayed messages
        await redis.zremrangebyscore(`queue:${queueName}:delayed`, 0, now);

        // Move to main queue
        const queueConfig = this.queues.get(queueName);
        for (const serializedMessage of delayedMessages) {
          const message = JSON.parse(serializedMessage);
          await this.enqueueMessage(redis, queueName, message, queueConfig);
        }

        logger.debug(`Processed ${delayedMessages.length} delayed messages for ${queueName}`);
      }
    } catch (error) {
      logger.error(`Failed to process delayed messages for ${queueName}:`, error);
    }
  }

  /**
   * Acknowledge message processing (successful completion)
   */
  async ack(queueName, messageId, processingTime = null) {
    try {
      const redis = redisClusterManager.getClient();

      // Remove from processing queue
      await redis.zrem(`queue:${queueName}:processing`, messageId);
      this.processing.delete(messageId);

      this.metrics.messages.processed++;
      this.updateQueueMetrics(queueName, 'processed', 1);

      if (processingTime) {
        this.updateLatencyMetrics('processing', processingTime);
      }

      // Clean up retry attempts
      this.retryAttempts.delete(messageId);

      logger.debug(`Message acknowledged: ${messageId} from ${queueName}`);
      this.emit('message:acked', { queueName, messageId, processingTime });

      return true;

    } catch (error) {
      logger.error(`Failed to ack message ${messageId}:`, error);
      return false;
    }
  }

  /**
   * Negative acknowledgment (message processing failed)
   */
  async nack(queueName, messageId, error = null, options = {}) {
    try {
      const redis = redisClusterManager.getClient();

      // Get message from processing queue
      const processingMessages = await redis.zrange(`queue:${queueName}:processing`, 0, -1);
      let message = null;

      for (const serializedMessage of processingMessages) {
        const parsedMessage = JSON.parse(serializedMessage);
        if (parsedMessage.id === messageId) {
          message = parsedMessage;
          break;
        }
      }

      if (!message) {
        logger.warn(`Message ${messageId} not found in processing queue for ${queueName}`);
        return false;
      }

      // Remove from processing queue
      await redis.zrem(`queue:${queueName}:processing`, messageId);
      this.processing.delete(messageId);

      // Handle retry logic
      const retryCount = this.retryAttempts.get(messageId) || 0;
      const maxRetries = options.maxRetries || message.metadata.maxRetries;

      if (retryCount < maxRetries) {
        // Retry the message
        this.retryAttempts.set(messageId, retryCount + 1);
        message.metadata.retryCount = retryCount + 1;
        message.metadata.lastError = error;
        message.metadata.lastRetryAt = new Date().toISOString();

        // Calculate retry delay with exponential backoff
        const retryDelay = this.config.retryDelayBase * Math.pow(this.config.retryDelayMultiplier, retryCount);
        message.metadata.delayUntil = Date.now() + retryDelay;

        // Re-enqueue with delay
        await this.enqueue(queueName, message.payload, {
          delayUntil: message.metadata.delayUntil,
          priority: message.metadata.priority,
          maxRetries: maxRetries
        });

        this.metrics.messages.retried++;
        logger.debug(`Message ${messageId} will be retried (${retryCount + 1}/${maxRetries})`, {
          queueName,
          retryDelay
        });

        this.emit('message:retried', { queueName, messageId, retryCount: retryCount + 1, error });

      } else {
        // Move to dead letter queue
        await this.moveToDeadLetterQueue(queueName, message, error);
        this.retryAttempts.delete(messageId);
      }

      return true;

    } catch (error) {
      logger.error(`Failed to nack message ${messageId}:`, error);
      return false;
    }
  }

  /**
   * Move message to dead letter queue
   */
  async moveToDeadLetterQueue(queueName, message, error = null) {
    try {
      const redis = redisClusterManager.getClient();

      const deadLetterMessage = {
        ...message,
        metadata: {
          ...message.metadata,
          deadLetteredAt: new Date().toISOString(),
          originalQueue: queueName,
          failureReason: error
        }
      };

      // Add to dead letter queue
      await redis.lpush(this.deadLetterQueue, JSON.stringify(deadLetterMessage));

      // Trim dead letter queue if it exceeds max size
      await redis.ltrim(this.deadLetterQueue, 0, this.config.dlqMaxSize - 1);

      this.metrics.messages.deadLettered++;
      this.updateQueueMetrics(queueName, 'dead_lettered', 1);

      logger.warn(`Message ${message.id} moved to dead letter queue`, {
        originalQueue: queueName,
        retryCount: message.metadata.retryCount,
        error
      });

      this.emit('message:dead_lettered', { queueName, messageId: message.id, message: deadLetterMessage, error });

    } catch (error) {
      logger.error(`Failed to move message to dead letter queue:`, error);
    }
  }

  /**
   * Register a consumer for a queue
   */
  async consume(queueName, callback, options = {}) {
    try {
      const queueConfig = this.queues.get(queueName);
      if (!queueConfig) {
        throw new Error(`Queue ${queueName} does not exist`);
      }

      if (!this.consumers.has(queueName)) {
        this.consumers.set(queueName, new Set());
        this.metrics.queues.active++;
      }

      const consumer = {
        id: uuidv4(),
        callback,
        options: {
          batchSize: options.batchSize || this.config.batchSize,
          pollInterval: options.pollInterval || this.config.pollInterval,
          maxConcurrency: options.maxConcurrency || 1,
          autoAck: options.autoAck !== false
        },
        isActive: true,
        processedCount: 0,
        errorCount: 0,
        lastActivity: Date.now()
      };

      this.consumers.get(queueName).add(consumer);

      // Start consumer loop
      this.startConsumerLoop(queueName, consumer);

      logger.info(`Consumer registered for queue: ${queueName}`, {
        consumerId: consumer.id,
        options: consumer.options
      });

      this.emit('consumer:registered', { queueName, consumerId: consumer.id });

      return consumer.id;

    } catch (error) {
      logger.error(`Failed to register consumer for ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Start consumer processing loop
   */
  async startConsumerLoop(queueName, consumer) {
    const processMessages = async () => {
      if (!consumer.isActive) {
        return;
      }

      try {
        const messages = [];

        // Batch processing
        for (let i = 0; i < consumer.options.batchSize; i++) {
          const message = await this.dequeue(queueName, {
            timeout: consumer.options.pollInterval / 1000
          });

          if (message) {
            messages.push(message);
          } else {
            break; // No more messages
          }
        }

        if (messages.length > 0) {
          // Process messages with concurrency control
          const promises = messages.map(message =>
            this.processMessage(queueName, message, consumer)
          );

          if (consumer.options.maxConcurrency > 1) {
            await Promise.allSettled(promises);
          } else {
            for (const promise of promises) {
              await promise;
            }
          }

          consumer.processedCount += messages.length;
          consumer.lastActivity = Date.now();
        }

      } catch (error) {
        consumer.errorCount++;
        logger.error(`Consumer ${consumer.id} error for queue ${queueName}:`, error);
      }

      // Schedule next processing
      if (consumer.isActive) {
        setTimeout(processMessages, consumer.options.pollInterval);
      }
    };

    // Start processing
    setTimeout(processMessages, 100);
  }

  /**
   * Process a single message
   */
  async processMessage(queueName, message, consumer) {
    const startTime = Date.now();

    try {
      // Call consumer callback
      const result = await consumer.callback(message);

      const processingTime = Date.now() - startTime;

      if (consumer.options.autoAck) {
        // Auto-ack if callback succeeded
        await this.ack(queueName, message.id, processingTime);
      }

      this.emit('message:processed', {
        queueName,
        messageId: message.id,
        processingTime,
        result
      });

      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;

      if (consumer.options.autoAck) {
        // Auto-nack if callback failed
        await this.nack(queueName, message.id, error.message);
      }

      this.emit('message:processing_failed', {
        queueName,
        messageId: message.id,
        processingTime,
        error
      });

      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName) {
    try {
      const redis = redisClusterManager.getClient();
      const queueConfig = this.queues.get(queueName);

      if (!queueConfig) {
        throw new Error(`Queue ${queueName} does not exist`);
      }

      const stats = {
        name: queueName,
        config: queueConfig,
        size: 0,
        processing: 0,
        delayed: 0,
        consumers: 0,
        metrics: {
          enqueued: 0,
          dequeued: 0,
          processed: 0,
          failed: 0,
          deadLettered: 0
        }
      };

      // Get queue sizes
      if (queueConfig.priority) {
        stats.size = await redis.zcard(`queue:${queueName}`);
      } else {
        stats.size = await redis.llen(`queue:${queueName}`);
      }

      stats.processing = await redis.zcard(`queue:${queueName}:processing`);
      stats.delayed = await redis.zcard(`queue:${queueName}:delayed`);

      // Get consumer count
      const consumers = this.consumers.get(queueName);
      if (consumers) {
        stats.consumers = consumers.size;
      }

      // Get metrics from Redis
      const metricsData = await redis.hgetall(`queue:${queueName}:metrics`);
      Object.assign(stats.metrics, metricsData);

      return stats;

    } catch (error) {
      logger.error(`Failed to get stats for queue ${queueName}:`, error);
      return null;
    }
  }

  /**
   * Get all queue statistics
   */
  async getAllQueueStats() {
    const stats = {
      totalQueues: this.queues.size,
      activeQueues: this.consumers.size,
      totalMessages: {
        enqueued: this.metrics.messages.enqueued,
        dequeued: this.metrics.messages.dequeued,
        processed: this.metrics.messages.processed,
        failed: this.metrics.messages.failed,
        retried: this.metrics.messages.retried,
        deadLettered: this.metrics.messages.deadLettered
      },
      queues: {}
    };

    // Get stats for each queue
    for (const queueName of this.queues.keys()) {
      try {
        stats.queues[queueName] = await this.getQueueStats(queueName);
      } catch (error) {
        logger.error(`Failed to get stats for queue ${queueName}:`, error);
      }
    }

    return stats;
  }

  /**
   * Update queue metrics in Redis
   */
  async updateQueueMetrics(queueName, metric, value) {
    try {
      const redis = redisClusterManager.getClient();
      await redis.hincrby(`queue:${queueName}:metrics`, `messages_${metric}`, value);
      await redis.hset(`queue:${queueName}:metrics`, 'last_activity', new Date().toISOString());
    } catch (error) {
      logger.error(`Failed to update metrics for queue ${queueName}:`, error);
    }
  }

  /**
   * Update latency metrics
   */
  updateLatencyMetrics(operation, latency) {
    // Simple moving average for now
    const current = this.metrics.performance.avgLatency;
    const count = this.metrics.messages.processed || 1;
    this.metrics.performance.avgLatency = (current * (count - 1) + latency) / count;
  }

  /**
   * Start processing loops for delayed messages and cleanup
   */
  startProcessingLoops() {
    // Process delayed messages
    setInterval(async () => {
      try {
        const redis = redisClusterManager.getClient();
        for (const queueName of this.queues.keys()) {
          await this.processDelayedMessages(redis, queueName);
        }
      } catch (error) {
        logger.error('Error in delayed message processing loop:', error);
      }
    }, 5000); // Every 5 seconds

    // Cleanup expired processing messages
    setInterval(async () => {
      try {
        const redis = redisClusterManager.getClient();
        const now = Date.now();

        for (const queueName of this.queues.keys()) {
          const expiredMessages = await redis.zrangebyscore(
            `queue:${queueName}:processing`,
            0,
            now - 30000 // Messages older than 30 seconds
          );

          if (expiredMessages.length > 0) {
            for (const serializedMessage of expiredMessages) {
              const message = JSON.parse(serializedMessage);
              await this.nack(queueName, message.id, 'Processing timeout');
            }
          }
        }
      } catch (error) {
        logger.error('Error in cleanup processing loop:', error);
      }
    }, 10000); // Every 10 seconds
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      processingMessages: this.processing.size,
      activeConsumers: Array.from(this.consumers.values()).reduce((sum, set) => sum + set.size, 0),
      timestamp: Date.now()
    };
  }

  /**
   * Shutdown the message queue service
   */
  async shutdown() {
    logger.info('Shutting down message queue service...');

    // Stop all consumers
    for (const [queueName, consumers] of this.consumers) {
      for (const consumer of consumers) {
        consumer.isActive = false;
      }
    }

    // Wait for processing messages to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Clear data structures
    this.consumers.clear();
    this.processing.clear();
    this.retryAttempts.clear();

    logger.info('Message queue service shutdown complete');
  }
}

// Create singleton instance
const messageQueueService = new MessageQueueService();

module.exports = messageQueueService;