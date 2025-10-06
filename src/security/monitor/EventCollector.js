/**
 * Event Collector
 * Real-time security event collection with Redis streams
 */

const Redis = require('ioredis');
const crypto = require('crypto');
const winston = require('winston');
const { auditLogger } = require('../logging/AuditLogger');

class EventCollector {
  constructor(config = {}) {
    this.config = {
      redis: {
        host: config.redis?.host || process.env.REDIS_HOST || 'localhost',
        port: config.redis?.port || process.env.REDIS_PORT || 6379,
        password: config.redis?.password || process.env.REDIS_PASSWORD,
        db: config.redis?.db || process.env.REDIS_DB || 0,
        keyPrefix: config.redis?.keyPrefix || 'security:',
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      },
      streams: {
        securityEvents: config.streams?.securityEvents || 'security-events',
        alerts: config.streams?.alerts || 'security-alerts',
        metrics: config.streams?.metrics || 'security-metrics'
      },
      bufferSize: config.bufferSize || 1000,
      flushInterval: config.flushInterval || 5000,
      retentionPeriod: config.retentionPeriod || 7 * 24 * 60 * 60 * 1000, // 7 days
      maxEventsPerSecond: config.maxEventsPerSecond || 1000,
      enableCompression: config.enableCompression !== false,
      ...config
    };

    this.redis = null;
    this.eventBuffer = [];
    this.rateLimiter = new Map();
    this.metrics = {
      eventsCollected: 0,
      eventsProcessed: 0,
      eventsDropped: 0,
      alertsGenerated: 0,
      lastReset: Date.now()
    };

    // Initialize logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({ format: winston.format.simple() }),
        new winston.transports.File({
          filename: 'logs/event-collector.log'
        })
      ]
    });

    this.initialize();
  }

  /**
   * Initialize Redis connection
   */
  async initialize() {
    try {
      this.redis = new Redis(this.config.redis);

      this.redis.on('connect', () => {
        this.logger.info('Event collector connected to Redis');
      });

      this.redis.on('error', (error) => {
        this.logger.error('Redis connection error:', error);
      });

      this.redis.on('close', () => {
        this.logger.warn('Redis connection closed');
      });

      // Test connection
      await this.redis.ping();

      // Start buffer flush timer
      this.startBufferFlush();

      this.logger.info('Event collector initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize event collector:', error);
      throw error;
    }
  }

  /**
   * Collect security event
   */
  async collectEvent(eventData) {
    try {
      // Validate event
      const validation = this.validateEvent(eventData);
      if (!validation.isValid) {
        this.logger.warn('Invalid event discarded:', validation.errors);
        this.metrics.eventsDropped++;
        return null;
      }

      // Rate limiting
      if (!this.checkRateLimit(eventData)) {
        this.metrics.eventsDropped++;
        return null;
      }

      // Sanitize event data
      const sanitizedEvent = this.sanitizeEvent(eventData);

      // Generate unique event ID
      const eventId = crypto.randomUUID();
      sanitizedEvent.id = eventId;
      sanitizedEvent.collectedAt = new Date().toISOString();

      // Add to buffer
      this.eventBuffer.push(sanitizedEvent);
      this.metrics.eventsCollected++;

      // Immediately flush critical events
      if (sanitizedEvent.severity === 'critical') {
        await this.flushBuffer();
      }

      return eventId;

    } catch (error) {
      this.logger.error('Failed to collect event:', error);
      this.metrics.eventsDropped++;
      throw error;
    }
  }

  /**
   * Validate event structure
   */
  validateEvent(eventData) {
    const errors = [];

    // Required fields
    if (!eventData.type) errors.push('Event type is required');
    if (!eventData.subtype) errors.push('Event subtype is required');
    if (!eventData.timestamp) errors.push('Event timestamp is required');
    if (!eventData.severity) errors.push('Event severity is required');

    // Validate severity
    const validSeverities = ['debug', 'info', 'warning', 'error', 'critical'];
    if (eventData.severity && !validSeverities.includes(eventData.severity)) {
      errors.push('Invalid severity level');
    }

    // Validate event type
    const validTypes = ['authentication', 'authorization', 'data', 'system', 'compliance'];
    if (eventData.type && !validTypes.includes(eventData.type)) {
      errors.push('Invalid event type');
    }

    // Check size limits
    const eventSize = JSON.stringify(eventData).length;
    if (eventSize > 1024 * 1024) { // 1MB limit
      errors.push('Event too large');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Check rate limiting
   */
  checkRateLimit(eventData) {
    const key = eventData.userId || eventData.ip || 'anonymous';
    const now = Date.now();
    const windowStart = now - 1000; // 1 second window

    // Clean old entries
    if (!this.rateLimiter.has(key)) {
      this.rateLimiter.set(key, []);
    }

    const userEvents = this.rateLimiter.get(key);

    // Remove old events
    const validEvents = userEvents.filter(timestamp => timestamp > windowStart);
    this.rateLimiter.set(key, validEvents);

    // Check limit
    if (validEvents.length >= this.config.maxEventsPerSecond) {
      this.logger.warn(`Rate limit exceeded for ${key}`);
      return false;
    }

    // Add current event
    validEvents.push(now);
    return true;
  }

  /**
   * Sanitize event data
   */
  sanitizeEvent(eventData) {
    const sanitized = { ...eventData };

    // Remove sensitive fields
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'key',
      'authorization',
      'cookie',
      'session'
    ];

    // Sanitize metadata
    if (sanitized.metadata) {
      for (const field of sensitiveFields) {
        if (sanitized.metadata[field]) {
          sanitized.metadata[field] = '[REDACTED]';
        }
      }
    }

    // Sanitize URL parameters
    if (sanitized.url) {
      sanitized.url = sanitized.url.replace(/([?&])(password|token|secret|key|auth)=[^&]*/gi, '$1$2=[REDACTED]');
    }

    // Sanitize user agent
    if (sanitized.userAgent) {
      sanitized.userAgent = sanitized.userAgent.replace(/Bearer\s+[A-Za-z0-9\-._~+\/]+=*/gi, 'Bearer [REDACTED]');
    }

    return sanitized;
  }

  /**
   * Flush buffer to Redis streams
   */
  async flushBuffer() {
    if (this.eventBuffer.length === 0) {
      return;
    }

    const eventsToFlush = [...this.eventBuffer];
    this.eventBuffer = [];

    try {
      const pipeline = this.redis.pipeline();

      for (const event of eventsToFlush) {
        const streamKey = `${this.config.redis.keyPrefix}${this.config.streams.securityEvents}`;

        // Add event to stream
        pipeline.xadd(streamKey, '*',
          'id', event.id,
          'type', event.type,
          'subtype', event.subtype,
          'userId', event.userId || '',
          'ip', event.ip || '',
          'userAgent', event.userAgent || '',
          'method', event.method || '',
          'url', event.url || '',
          'statusCode', event.statusCode || '',
          'responseTime', event.responseTime || '',
          'severity', event.severity,
          'message', event.message || '',
          'timestamp', event.timestamp,
          'collectedAt', event.collectedAt,
          'metadata', JSON.stringify(event.metadata || {})
        );

        // Generate metrics for the event
        this.generateEventMetrics(event, pipeline);
      }

      await pipeline.exec();
      this.metrics.eventsProcessed += eventsToFlush.length;

      this.logger.debug(`Flushed ${eventsToFlush.length} events to Redis streams`);

    } catch (error) {
      this.logger.error('Failed to flush events to Redis:', error);
      // Re-add events to buffer for retry
      this.eventBuffer.unshift(...eventsToFlush);
      this.metrics.eventsDropped += eventsToFlush.length;
    }
  }

  /**
   * Generate event metrics
   */
  generateEventMetrics(event, pipeline) {
    const metricsStreamKey = `${this.config.redis.keyPrefix}${this.config.streams.metrics}`;
    const timestamp = Date.now();

    // Event count metrics
    pipeline.xadd(metricsStreamKey, '*',
      'metricType', 'event_count',
      'eventType', event.type,
      'severity', event.severity,
      'value', '1',
      'timestamp', timestamp.toString()
    );

    // Response time metrics
    if (event.responseTime) {
      pipeline.xadd(metricsStreamKey, '*',
        'metricType', 'response_time',
        'eventType', event.type,
        'severity', event.severity,
        'value', event.responseTime.toString(),
        'timestamp', timestamp.toString()
      );
    }

    // Status code metrics
    if (event.statusCode) {
      pipeline.xadd(metricsStreamKey, '*',
        'metricType', 'status_code',
        'eventType', event.type,
        'severity', event.severity,
        'value', event.statusCode.toString(),
        'timestamp', timestamp.toString()
      );
    }
  }

  /**
   * Read events from stream
   */
  async readEvents(options = {}) {
    try {
      const streamKey = `${this.config.redis.keyPrefix}${this.config.streams.securityEvents}`;

      let readOptions = {
        COUNT: options.limit || 100,
        BLOCK: options.block || 1000
      };

      if (options.lastId) {
        readOptions = { ...readOptions, options.lastId };
      } else {
        readOptions = { ...readOptions, '$' };
      }

      const results = await this.redis.xreadgroup(
        'GROUP',
        'security-monitor',
        'consumer-1',
        'STREAMS',
        streamKey,
        readOptions
      );

      if (!results || results.length === 0) {
        return [];
      }

      const events = results[0][1].map(([id, fields]) => {
        const event = {
          id,
          streamId: id,
          ...this.parseFields(fields)
        };

        // Acknowledge processing
        this.redis.xack(streamKey, 'security-monitor', id);

        return event;
      });

      return events;

    } catch (error) {
      this.logger.error('Failed to read events from stream:', error);
      return [];
    }
  }

  /**
   * Parse Redis stream fields
   */
  parseFields(fields) {
    const event = {};

    for (let i = 0; i < fields.length; i += 2) {
      const key = fields[i];
      const value = fields[i + 1];

      // Parse numeric values
      if (['responseTime', 'statusCode'].includes(key)) {
        event[key] = value ? parseInt(value, 10) : null;
      }
      // Parse JSON values
      else if (key === 'metadata') {
        event[key] = value ? JSON.parse(value) : null;
      }
      // Parse timestamps
      else if (['timestamp', 'collectedAt'].includes(key)) {
        event[key] = value ? new Date(value) : null;
      }
      // Keep as string
      else {
        event[key] = value;
      }
    }

    return event;
  }

  /**
   * Generate security alert
   */
  async generateAlert(alertData) {
    try {
      const alert = {
        id: crypto.randomUUID(),
        type: alertData.type,
        severity: alertData.severity,
        title: alertData.title,
        description: alertData.description,
        source: alertData.source || 'event-collector',
        triggerEvent: alertData.triggerEvent,
        context: alertData.context || {},
        createdAt: new Date()
      };

      const alertsStreamKey = `${this.config.redis.keyPrefix}${this.config.streams.alerts}`;

      await this.redis.xadd(alertsStreamKey, '*',
        'id', alert.id,
        'type', alert.type,
        'severity', alert.severity,
        'title', alert.title,
        'description', alert.description,
        'source', alert.source,
        'triggerEvent', JSON.stringify(alert.triggerEvent),
        'context', JSON.stringify(alert.context),
        'createdAt', alert.createdAt.toISOString()
      );

      this.metrics.alertsGenerated++;

      // Also log to audit system
      if (auditLogger && auditLogger.isInitialized) {
        await auditLogger.log({
          type: 'security',
          subtype: 'alert_generated',
          severity: alert.severity,
          message: `Security alert: ${alert.title}`,
          metadata: {
            alertId: alert.id,
            alertType: alert.type,
            triggerEvent: alert.triggerEvent
          }
        });
      }

      this.logger.warn('Security alert generated:', alert);
      return alert.id;

    } catch (error) {
      this.logger.error('Failed to generate alert:', error);
      throw error;
    }
  }

  /**
   * Get event statistics
   */
  getStatistics() {
    const now = Date.now();
    const uptime = now - this.metrics.lastReset;

    return {
      uptime,
      eventsCollected: this.metrics.eventsCollected,
      eventsProcessed: this.metrics.eventsProcessed,
      eventsDropped: this.metrics.eventsDropped,
      alertsGenerated: this.metrics.alertsGenerated,
      bufferSize: this.eventBuffer.length,
      eventsPerSecond: (this.metrics.eventsCollected / uptime) * 1000,
      processingRate: this.metrics.eventsProcessed / Math.max(this.metrics.eventsCollected, 1)
    };
  }

  /**
   * Start periodic buffer flush
   */
  startBufferFlush() {
    setInterval(() => {
      this.flushBuffer();
    }, this.config.flushInterval);
  }

  /**
   * Clean up old events from streams
   */
  async cleanup() {
    try {
      const cutoffTime = Date.now() - this.config.retentionPeriod;
      const securityEventsKey = `${this.config.redis.keyPrefix}${this.config.streams.securityEvents}`;
      const alertsKey = `${this.config.redis.keyPrefix}${this.config.streams.alerts}`;
      const metricsKey = `${this.config.redis.keyPrefix}${this.config.streams.metrics}`;

      // Trim streams to remove old events
      await this.redis.xtrim(securityEventsKey, 'MINID', cutoffTime.toString());
      await this.redis.xtrim(alertsKey, 'MINID', cutoffTime.toString());
      await this.redis.xtrim(metricsKey, 'MINID', cutoffTime.toString());

      this.logger.info('Cleaned up old events from streams');

    } catch (error) {
      this.logger.error('Failed to cleanup old events:', error);
    }
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      eventsCollected: 0,
      eventsProcessed: 0,
      eventsDropped: 0,
      alertsGenerated: 0,
      lastReset: Date.now()
    };
  }

  /**
   * Close connections
   */
  async close() {
    try {
      // Flush remaining events
      await this.flushBuffer();

      // Close Redis connection
      if (this.redis) {
        await this.redis.quit();
      }

      this.logger.info('Event collector closed successfully');

    } catch (error) {
      this.logger.error('Failed to close event collector:', error);
      throw error;
    }
  }
}

module.exports = EventCollector;