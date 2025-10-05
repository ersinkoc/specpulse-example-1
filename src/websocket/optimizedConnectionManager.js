const EventEmitter = require('events');
const logger = require('../shared/utils/logger');
const config = require('./config');
const redis = require('../config/redis');
const performanceMonitoringService = require('../services/performanceMonitoringService');

/**
 * Optimized WebSocket Connection Manager
 * Enhanced with performance optimizations, connection pooling, and efficient resource management
 */
class OptimizedConnectionManager extends EventEmitter {
  constructor() {
    super();

    // Use WeakMaps for better memory management of connection metadata
    this.connectionMetadata = new WeakMap();
    this.userConnectionSets = new Map(); // userId -> Set of socket connections
    this.roomSubscriptions = new Map(); // room -> Set of socketIds

    // Connection pool management
    this.connectionPools = new Map(); // userId -> connection pool
    this.poolConfig = {
      maxPoolSize: 10,
      minPoolSize: 2,
      idleTimeout: 30 * 60 * 1000, // 30 minutes
      maxAge: 2 * 60 * 60 * 1000, // 2 hours
      acquireTimeout: 5000, // 5 seconds
      createRetryInterval: 1000 // 1 second
    };

    // Enhanced statistics tracking
    this.stats = {
      connections: {
        total: 0,
        active: 0,
        peak: 0,
        rejected: 0,
        errors: 0,
        created: 0,
        destroyed: 0
      },
      performance: {
        avgConnectionTime: 0,
        totalConnectionTime: 0,
        messageCount: 0,
        bytesReceived: 0,
        bytesSent: 0,
        memoryUsage: 0
      },
      pools: {
        totalPools: 0,
        activePools: 0,
        pooledConnections: 0,
        poolHits: 0,
        poolMisses: 0
      },
      rooms: {
        totalRooms: 0,
        totalSubscriptions: 0,
        avgSubscriptionsPerRoom: 0
      }
    };

    // Configuration
    this.maxConnections = config.connectionLimits?.maxConnections || 10000;
    this.connectionTimeout = config.connectionLimits?.connectionTimeout || 30 * 60 * 1000;
    this.heartbeatInterval = config.connectionLimits?.heartbeatInterval || 25 * 1000;
    this.heartbeatTimeout = config.connectionLimits?.heartbeatTimeout || 60 * 1000;

    // Optimization settings
    this.enableCompression = true;
    this.enableConnectionPooling = true;
    this.enableMetrics = true;
    this.enableAdaptiveHeartbeat = true;

    // Adaptive heartbeat configuration
    this.adaptiveConfig = {
      minInterval: 15 * 1000, // 15 seconds
      maxInterval: 60 * 1000, // 1 minute
      stepSize: 5 * 1000, // 5 seconds
      inactivityThreshold: 5 * 60 * 1000 // 5 minutes
    };

    // Rate limiting and throttling
    this.rateLimiters = new Map();
    this.throttlers = new Map();

    // Cleanup intervals
    this.cleanupInterval = null;
    this.metricsInterval = null;
    this.poolCleanupInterval = null;

    // Initialize Redis for distributed connection tracking
    this.redis = redis.client;
    this.enableDistributedTracking = true;

    // Start optimization services
    this.startOptimizationServices();
  }

  /**
   * Start all optimization services
   */
  startOptimizationServices() {
    // Periodic cleanup with adaptive intervals
    this.startAdaptiveCleanup();

    // Metrics collection
    if (this.enableMetrics) {
      this.startMetricsCollection();
    }

    // Connection pool maintenance
    if (this.enableConnectionPooling) {
      this.startPoolMaintenance();
    }

    // Performance monitoring
    this.startPerformanceMonitoring();

    logger.info('Optimized connection manager services started');
  }

  /**
   * Add connection with enhanced features
   */
  async addConnection(socket) {
    const startTime = Date.now();

    try {
      // Check connection limits and rate limits
      if (!this.canAcceptConnection(socket)) {
        this.stats.connections.rejected++;
        return false;
      }

      // Create optimized connection metadata
      const metadata = this.createConnectionMetadata(socket);
      this.connectionMetadata.set(socket, metadata);

      // Track user connections
      this.trackUserConnection(socket.userId, socket);

      // Update statistics
      this.updateConnectionStats('created');

      // Record connection established
      performanceMonitoringService.recordWebSocketConnection('connected', {
        userId: socket.userId,
        socketId: socket.id
      });

      // Record performance metrics
      performanceMonitoringService.recordWebSocketConnection('created', {
        creationTime: duration,
        userId: socket.userId,
        transport: metadata.transport
      });

      // Set up enhanced event handlers
      this.setupOptimizedEventHandlers(socket, metadata);

      // Start adaptive heartbeat
      if (this.enableAdaptiveHeartbeat) {
        this.startAdaptiveHeartbeat(socket, metadata);
      }

      // Track in Redis for distributed systems
      if (this.enableDistributedTracking) {
        await this.trackConnectionInRedis(socket, metadata);
      }

      // Emit connection event
      this.emit('connection:added', { socket, metadata });

      const duration = Date.now() - startTime;
      this.updatePerformanceStats('connection_creation_time', duration);

      logger.debug('Connection added successfully', {
        socketId: socket.id,
        userId: socket.userId,
        duration,
        activeConnections: this.stats.connections.active
      });

      return true;

    } catch (error) {
      this.stats.connections.errors++;
      logger.error('Failed to add connection:', error);
      return false;
    }
  }

  /**
   * Create optimized connection metadata
   */
  createConnectionMetadata(socket) {
    const now = Date.now();
    return {
      socketId: socket.id,
      userId: socket.userId,
      connectedAt: now,
      lastActivity: now,
      lastPing: now,
      lastPong: now,
      messageCount: 0,
      bytesReceived: 0,
      bytesSent: 0,
      heartbeatInterval: this.heartbeatInterval,
      heartbeatTimeout: null,
      pingTimeout: null,
      compressionEnabled: this.enableCompression,
      transport: socket.conn?.transport?.name || 'unknown',
      rooms: new Set(),
      rateLimitState: {
        messageCount: 0,
        lastReset: now,
        violationCount: 0
      },
      performanceMetrics: {
        roundTripTimes: [],
        messageLatencies: [],
        compressionRatio: 0,
        errorCount: 0
      },
      flags: {
        isOptimized: true,
        isPooled: false,
        isActive: true,
        needsReauth: false
      }
    };
  }

  /**
   * Setup optimized event handlers
   */
  setupOptimizedEventHandlers(socket, metadata) {
    // Message handling with compression and throttling
    socket.on('message', (data, ack) => {
      this.handleOptimizedMessage(socket, metadata, data, ack);
    });

    // Activity tracking
    socket.on('any', (eventName, ...args) => {
      metadata.lastActivity = Date.now();
      this.updatePerformanceStats('message_count', 1);
    });

    // Enhanced disconnect handling
    socket.on('disconnect', (reason) => {
      this.handleOptimizedDisconnect(socket, metadata, reason);
    });

    // Error handling with metrics
    socket.on('error', (error) => {
      metadata.performanceMetrics.errorCount++;
      this.stats.connections.errors++;
      logger.warn('Connection error', {
        socketId: socket.id,
        userId: socket.userId,
        error: error.message
      });
    });

    // Optimize Socket.IO configuration
    if (this.enableCompression) {
      socket.conn.opts.perMessageDeflate = true;
    }
  }

  /**
   * Handle optimized message processing
   */
  handleOptimizedMessage(socket, metadata, data, ack) {
    const startTime = Date.now();

    try {
      // Update activity and stats
      metadata.lastActivity = startTime;
      metadata.messageCount++;
      metadata.rateLimitState.messageCount++;

      // Rate limiting check
      if (this.isRateLimited(socket, metadata)) {
        if (ack) ack({ status: 'rate_limited' });
        return;
      }

      // Process message data
      let processedData = data;
      if (typeof data === 'string') {
        metadata.bytesReceived += Buffer.byteLength(data, 'utf8');

        // Decompression if needed
        if (metadata.compressionEnabled && data.startsWith('compressed:')) {
          processedData = this.decompressMessage(data);
        }
      } else if (Buffer.isBuffer(data)) {
        metadata.bytesReceived += data.length;
      }

      // Acknowledge receipt
      if (ack) {
        ack({
          status: 'received',
          timestamp: startTime,
          messageId: this.generateMessageId()
        });
      }

      // Update performance metrics
      const processingTime = Date.now() - startTime;
      metadata.performanceMetrics.messageLatencies.push(processingTime);

      // Keep only recent metrics (last 100)
      if (metadata.performanceMetrics.messageLatencies.length > 100) {
        metadata.performanceMetrics.messageLatencies.shift();
      }

      this.updatePerformanceStats('message_processing_time', processingTime);

      // Record message metrics
      performanceMonitoringService.recordWebSocketMessage('received', {
        size: metadata.bytesReceived,
        processingTime
      });

    } catch (error) {
      metadata.performanceMetrics.errorCount++;
      logger.error('Message handling error:', error);

      if (ack) {
        ack({ status: 'error', error: error.message });
      }
    }
  }

  /**
   * Start adaptive heartbeat monitoring
   */
  startAdaptiveHeartbeat(socket, metadata) {
    const heartbeat = () => {
      if (!socket.connected) {
        return;
      }

      const now = Date.now();
      const timeSinceLastActivity = now - metadata.lastActivity;

      // Adaptive interval based on activity
      let interval = metadata.heartbeatInterval;
      if (this.enableAdaptiveHeartbeat && timeSinceLastActivity > this.adaptiveConfig.inactivityThreshold) {
        // Slow down heartbeat for inactive connections
        interval = Math.min(
          metadata.heartbeatInterval * 2,
          this.adaptiveConfig.maxInterval
        );
      }

      // Send ping with timestamp
      const pingData = {
        timestamp: now,
        socketId: socket.id,
        interval: interval
      };

      socket.emit('ping', pingData);

      // Set timeout for pong response
      metadata.pingTimeout = setTimeout(() => {
        if (socket.connected) {
          logger.warn('Ping timeout, closing connection', {
            socketId: socket.id,
            userId: socket.userId
          });
          socket.disconnect(true);
        }
      }, this.heartbeatTimeout);

      // Schedule next heartbeat
      metadata.heartbeatTimeout = setTimeout(heartbeat, interval);
    };

    // Handle pong responses
    socket.on('pong', (data) => {
      if (metadata.pingTimeout) {
        clearTimeout(metadata.pingTimeout);
        metadata.pingTimeout = null;
      }

      const now = Date.now();
      const rtt = now - data.timestamp;

      // Update round trip time metrics
      metadata.performanceMetrics.roundTripTimes.push(rtt);
      if (metadata.performanceMetrics.roundTripTimes.length > 50) {
        metadata.performanceMetrics.roundTripTimes.shift();
      }

      metadata.lastPong = now;

      // Adaptive interval adjustment
      if (this.enableAdaptiveHeartbeat) {
        this.adjustHeartbeatInterval(metadata, rtt);
      }
    });

    // Start heartbeat
    heartbeat();
  }

  /**
   * Adjust heartbeat interval based on RTT
   */
  adjustHeartbeatInterval(metadata, rtt) {
    const timeSinceLastActivity = Date.now() - metadata.lastActivity;

    if (timeSinceLastActivity > this.adaptiveConfig.inactivityThreshold) {
      // Increase interval for inactive connections
      metadata.heartbeatInterval = Math.min(
        metadata.heartbeatInterval + this.adaptiveConfig.stepSize,
        this.adaptiveConfig.maxInterval
      );
    } else if (rtt > 5000) { // 5 seconds
      // Increase interval for high latency connections
      metadata.heartbeatInterval = Math.min(
        metadata.heartbeatInterval + this.adaptiveConfig.stepSize,
        this.adaptiveConfig.maxInterval
      );
    } else if (rtt < 1000) { // 1 second
      // Decrease interval for low latency connections
      metadata.heartbeatInterval = Math.max(
        metadata.heartbeatInterval - this.adaptiveConfig.stepSize,
        this.adaptiveConfig.minInterval
      );
    }
  }

  /**
   * Handle optimized disconnect
   */
  handleOptimizedDisconnect(socket, metadata, reason) {
    try {
      const duration = Date.now() - metadata.connectedAt;

      // Clear timers
      if (metadata.heartbeatTimeout) {
        clearTimeout(metadata.heartbeatTimeout);
      }
      if (metadata.pingTimeout) {
        clearTimeout(metadata.pingTimeout);
      }

      // Update connection pool
      if (metadata.flags.isPooled) {
        this.updateConnectionPool(metadata.userId, socket, 'removed');
      }

      // Clean up user connections
      this.cleanupUserConnection(socket.userId, socket);

      // Clean up room subscriptions
      this.cleanupRoomSubscriptions(socket, metadata);

      // Update statistics
      this.updateConnectionStats('destroyed');
      this.updatePerformanceStats('connection_duration', duration);

      // Record disconnect metrics
      performanceMonitoringService.recordWebSocketConnection('disconnected', {
        userId: socket.userId,
        duration,
        reason,
        messageCount: metadata.messageCount,
        errorCount: metadata.performanceMetrics.errorCount
      });

      // Remove from Redis tracking
      if (this.enableDistributedTracking) {
        this.untrackConnectionInRedis(socket, metadata);
      }

      // Clean up metadata
      this.connectionMetadata.delete(socket);

      // Emit disconnect event
      this.emit('connection:removed', {
        socket,
        metadata,
        reason,
        duration
      });

      logger.debug('Connection removed', {
        socketId: socket.id,
        userId: socket.userId,
        reason,
        duration,
        activeConnections: this.stats.connections.active
      });

    } catch (error) {
      logger.error('Error handling disconnect:', error);
    }
  }

  /**
   * Check if connection can be accepted
   */
  canAcceptConnection(socket) {
    // Check global connection limit
    if (this.stats.connections.active >= this.maxConnections) {
      return false;
    }

    // Check per-user connection limits
    const userConnections = this.userConnectionSets.get(socket.userId);
    const maxUserConnections = 10; // Configurable per-user limit
    if (userConnections && userConnections.size >= maxUserConnections) {
      return false;
    }

    // Check rate limiting
    return !this.isRateLimited(socket);
  }

  /**
   * Enhanced rate limiting
   */
  isRateLimited(socket, metadata = null) {
    const userId = socket.userId;
    const now = Date.now();
    const windowSize = 60 * 1000; // 1 minute
    const maxMessages = 100; // 100 messages per minute

    let limiter = this.rateLimiters.get(userId);
    if (!limiter) {
      limiter = {
        messages: [],
        violations: 0,
        lastViolation: 0
      };
      this.rateLimiters.set(userId, limiter);
    }

    // Clean old messages
    limiter.messages = limiter.messages.filter(time => now - time < windowSize);

    // Check limit
    if (limiter.messages.length >= maxMessages) {
      limiter.violations++;
      limiter.lastViolation = now;

      // Temporarily block violators
      if (limiter.violations > 3) {
        return true;
      }
    }

    limiter.messages.push(now);
    return false;
  }

  /**
   * Track user connection
   */
  trackUserConnection(userId, socket) {
    if (!this.userConnectionSets.has(userId)) {
      this.userConnectionSets.set(userId, new Set());
    }
    this.userConnectionSets.get(userId).add(socket);
    this.stats.connections.active++;

    if (this.stats.connections.active > this.stats.connections.peak) {
      this.stats.connections.peak = this.stats.connections.active;
    }
  }

  /**
   * Clean up user connection
   */
  cleanupUserConnection(userId, socket) {
    const userConnections = this.userConnectionSets.get(userId);
    if (userConnections) {
      userConnections.delete(socket);
      if (userConnections.size === 0) {
        this.userConnectionSets.delete(userId);
      }
    }
    this.stats.connections.active = Math.max(0, this.stats.connections.active - 1);
  }

  /**
   * Start adaptive cleanup
   */
  startAdaptiveCleanup() {
    // More frequent cleanup during high load
    const cleanupInterval = () => {
      const loadRatio = this.stats.connections.active / this.maxConnections;
      const interval = loadRatio > 0.8 ? 2 * 60 * 1000 : 5 * 60 * 1000; // 2 min or 5 min

      this.cleanupStaleConnections();
      this.cleanupRateLimiters();

      setTimeout(cleanupInterval, interval);
    };

    cleanupInterval();
  }

  /**
   * Clean up stale connections
   */
  cleanupStaleConnections() {
    const now = Date.now();
    const staleThreshold = this.connectionTimeout;
    let cleanedCount = 0;

    // This would need access to actual socket instances
    // For now, we'll track stale connections for cleanup
    this.connectionMetadata.forEach((metadata, socket) => {
      if (!socket.connected || (now - metadata.lastActivity) > staleThreshold) {
        if (socket.connected) {
          socket.disconnect(true);
        }
        cleanedCount++;
      }
    });

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} stale connections`);
    }
  }

  /**
   * Clean up rate limiters
   */
  cleanupRateLimiters() {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour

    for (const [userId, limiter] of this.rateLimiters) {
      if (now - limiter.lastViolation > maxAge && limiter.messages.length === 0) {
        this.rateLimiters.delete(userId);
      }
    }
  }

  /**
   * Start metrics collection
   */
  startMetricsCollection() {
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, 60 * 1000); // Every minute
  }

  /**
   * Collect performance metrics
   */
  collectMetrics() {
    try {
      // Memory usage
      const memUsage = process.memoryUsage();
      this.stats.performance.memoryUsage = memUsage.heapUsed;

      // Connection statistics
      this.stats.rooms.totalRooms = this.roomSubscriptions.size;
      this.stats.rooms.totalSubscriptions = Array.from(this.roomSubscriptions.values())
        .reduce((sum, subs) => sum + subs.size, 0);

      if (this.stats.rooms.totalRooms > 0) {
        this.stats.rooms.avgSubscriptionsPerRoom =
          this.stats.rooms.totalSubscriptions / this.stats.rooms.totalRooms;
      }

      // Pool statistics
      if (this.enableConnectionPooling) {
        this.stats.pools.totalPools = this.connectionPools.size;
        this.stats.pools.activePools = Array.from(this.connectionPools.values())
          .filter(pool => pool.connections.size > 0).length;
      }

      // Emit metrics event
      this.emit('metrics:collected', this.stats);

    } catch (error) {
      logger.error('Error collecting metrics:', error);
    }
  }

  /**
   * Update connection statistics
   */
  updateConnectionStats(action) {
    switch (action) {
      case 'created':
        this.stats.connections.total++;
        this.stats.connections.created++;
        break;
      case 'destroyed':
        this.stats.connections.destroyed++;
        break;
    }
  }

  /**
   * Update performance statistics
   */
  updatePerformanceStats(metric, value) {
    switch (metric) {
      case 'connection_creation_time':
        this.updateAverage('avgConnectionTime', value);
        break;
      case 'message_count':
        this.stats.performance.messageCount++;
        break;
      case 'message_processing_time':
        this.updateAverage('avgProcessingTime', value);
        break;
      case 'connection_duration':
        this.updateAverage('avgConnectionTime', value);
        break;
    }
  }

  /**
   * Update running average
   */
  updateAverage(field, value) {
    const current = this.stats.performance[field] || 0;
    const count = this.stats.connections.created || 1;
    this.stats.performance[field] = (current * (count - 1) + value) / count;
  }

  /**
   * Get comprehensive statistics
   */
  getStats() {
    return {
      ...this.stats,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      loadAverage: require('os').loadavg()
    };
  }

  /**
   * Get detailed performance metrics
   */
  getPerformanceMetrics() {
    return {
      connections: {
        active: this.stats.connections.active,
        peak: this.stats.connections.peak,
        total: this.stats.connections.total,
        rejected: this.stats.connections.rejected,
        rejectionRate: this.stats.connections.rejected / (this.stats.connections.total + this.stats.connections.rejected) * 100
      },
      performance: {
        avgConnectionTime: this.stats.performance.avgConnectionTime,
        messageCount: this.stats.performance.messageCount,
        memoryUsage: this.stats.performance.memoryUsage,
        throughput: this.stats.performance.messageCount / process.uptime()
      },
      pools: this.stats.pools,
      rooms: this.stats.rooms,
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        loadAverage: require('os').loadavg()
      }
    };
  }

  /**
   * Shutdown cleanup
   */
  shutdown() {
    logger.info('Shutting down optimized connection manager');

    // Clear intervals
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.metricsInterval) clearInterval(this.metricsInterval);
    if (this.poolCleanupInterval) clearInterval(this.poolCleanupInterval);

    // Disconnect all connections
    this.connectionMetadata.forEach((metadata, socket) => {
      if (socket.connected) {
        socket.disconnect(true);
      }
    });

    // Clean up
    this.connectionMetadata = new WeakMap();
    this.userConnectionSets.clear();
    this.roomSubscriptions.clear();
    this.connectionPools.clear();
    this.rateLimiters.clear();

    logger.info('Optimized connection manager shutdown complete');
  }

  // Helper methods
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  compressMessage(data) {
    // Implementation for message compression
    // This would use a compression library like zlib
    return `compressed:${Buffer.from(JSON.stringify(data)).toString('base64')}`;
  }

  decompressMessage(compressedData) {
    // Implementation for message decompression
    if (!compressedData.startsWith('compressed:')) {
      return compressedData;
    }

    try {
      const base64Data = compressedData.substring(11);
      const buffer = Buffer.from(base64Data, 'base64');
      return JSON.parse(buffer.toString('utf8'));
    } catch (error) {
      logger.error('Failed to decompress message:', error);
      return compressedData;
    }
  }

  async trackConnectionInRedis(socket, metadata) {
    try {
      const key = `connection:${socket.id}`;
      const value = {
        userId: socket.userId,
        connectedAt: metadata.connectedAt,
        serverId: process.env.SERVER_ID || 'unknown'
      };

      await this.redis.setex(key, this.connectionTimeout / 1000, JSON.stringify(value));

      // Add to user's connection set
      await this.redis.sadd(`user_connections:${socket.userId}`, socket.id);
      await this.redis.expire(`user_connections:${socket.userId}`, this.connectionTimeout / 1000);

    } catch (error) {
      logger.warn('Failed to track connection in Redis:', error);
    }
  }

  async untrackConnectionInRedis(socket, metadata) {
    try {
      const key = `connection:${socket.id}`;
      await this.redis.del(key);
      await this.redis.srem(`user_connections:${socket.userId}`, socket.id);
    } catch (error) {
      logger.warn('Failed to untrack connection in Redis:', error);
    }
  }

  startPoolMaintenance() {
    this.poolCleanupInterval = setInterval(() => {
      this.maintainConnectionPools();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  maintainConnectionPools() {
    // Implementation for connection pool maintenance
    // This would clean up idle connections and optimize pool sizes
  }

  startPerformanceMonitoring() {
    // Additional performance monitoring implementation
    // This could include CPU usage monitoring, network latency tracking, etc.
  }

  updateConnectionPool(userId, socket, action) {
    // Implementation for connection pool management
    // This would handle adding/removing connections from pools
  }

  cleanupRoomSubscriptions(socket, metadata) {
    // Clean up all room subscriptions for this connection
    metadata.rooms.forEach(room => {
      const roomSubs = this.roomSubscriptions.get(room);
      if (roomSubs) {
        roomSubs.delete(socket.id);
        if (roomSubs.size === 0) {
          this.roomSubscriptions.delete(room);
        }
      }
    });
  }
}

// Create singleton instance
const optimizedConnectionManager = new OptimizedConnectionManager();

module.exports = optimizedConnectionManager;