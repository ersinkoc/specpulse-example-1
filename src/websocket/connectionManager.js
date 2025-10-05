const EventEmitter = require('events');
const logger = require('../shared/utils/logger');
const config = require('./config');

/**
 * WebSocket Connection Manager
 * Handles connection pooling, rate limiting, and connection lifecycle management
 */
class ConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map(); // socketId -> connection data
    this.userConnections = new Map(); // userId -> Set of socketIds
    this.connectionPools = new Map(); // userId -> connection pool
    this.rateLimiters = new Map(); // userId -> rate limiter data
    this.connectionStats = {
      totalConnections: 0,
      activeConnections: 0,
      peakConnections: 0,
      totalDisconnections: 0,
      rejectedConnections: 0,
      connectionErrors: 0
    };
    this.maxConnections = config.connectionLimits.maxConnections;
    this.connectionTimeout = config.connectionLimits.connectionTimeout;
    this.heartbeatInterval = config.connectionLimits.heartbeatInterval;
    this.heartbeatTimeout = config.connectionLimits.heartbeatTimeout;

    // Start periodic cleanup
    this.startPeriodicCleanup();
  }

  /**
   * Add a new connection
   */
  addConnection(socket) {
    const connectionData = {
      socket,
      socketId: socket.id,
      userId: socket.userId,
      userEmail: socket.userEmail,
      userRoles: socket.userRoles || [],
      connectedAt: new Date(),
      lastActivity: new Date(),
      lastPing: new Date(),
      pingTimeout: null,
      heartbeatInterval: null,
      roomSubscriptions: new Set(),
      isActive: true,
      messageCount: 0,
      bytesReceived: 0,
      bytesSent: 0,
      remoteAddress: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      transport: socket.conn.transport.name
    };

    // Store connection data
    this.connections.set(socket.id, connectionData);

    // Track user connections
    if (!this.userConnections.has(socket.userId)) {
      this.userConnections.set(socket.userId, new Set());
    }
    this.userConnections.get(socket.userId).add(socket.id);

    // Update stats
    this.connectionStats.totalConnections++;
    this.connectionStats.activeConnections++;
    if (this.connectionStats.activeConnections > this.connectionStats.peakConnections) {
      this.connectionStats.peakConnections = this.connectionStats.activeConnections;
    }

    // Start heartbeat monitoring
    this.startHeartbeatMonitoring(socket);

    // Setup connection cleanup on disconnect
    this.setupConnectionCleanup(socket);

    // Emit connection event
    this.emit('connection:added', connectionData);

    logger.debug('Connection added', {
      socketId: socket.id,
      userId: socket.userId,
      totalConnections: this.connectionStats.activeConnections
    });

    return connectionData;
  }

  /**
   * Remove a connection
   */
  removeConnection(socket, reason = 'disconnect') {
    const connectionData = this.connections.get(socket.id);
    if (!connectionData) {
      return null;
    }

    // Mark as inactive
    connectionData.isActive = false;
    connectionData.disconnectedAt = new Date();
    connectionData.disconnectReason = reason;

    // Stop heartbeat monitoring
    this.stopHeartbeatMonitoring(socket);

    // Remove from user connections
    if (this.userConnections.has(socket.userId)) {
      this.userConnections.get(socket.userId).delete(socket.id);
      if (this.userConnections.get(socket.userId).size === 0) {
        this.userConnections.delete(socket.userId);
      }
    }

    // Remove from rate limiters
    this.rateLimiters.delete(socket.id);

    // Remove connection data
    this.connections.delete(socket.id);

    // Update stats
    this.connectionStats.activeConnections--;
    this.connectionStats.totalDisconnections++;

    // Emit disconnection event
    this.emit('connection:removed', { connectionData, reason });

    logger.debug('Connection removed', {
      socketId: socket.id,
      userId: connectionData.userId,
      reason,
      totalConnections: this.connectionStats.activeConnections,
      duration: connectionData.disconnectedAt - connectionData.connectedAt
    });

    return connectionData;
  }

  /**
   * Get connection data by socket ID
   */
  getConnection(socketId) {
    return this.connections.get(socketId);
  }

  /**
   * Get all connections for a user
   */
  getUserConnections(userId) {
    const socketIds = this.userConnections.get(userId);
    if (!socketIds) {
      return [];
    }

    return Array.from(socketIds)
      .map(socketId => this.connections.get(socketId))
      .filter(connection => connection && connection.isActive);
  }

  /**
   * Get user socket count
   */
  getUserConnectionCount(userId) {
    const connections = this.getUserConnections(userId);
    return connections.length;
  }

  /**
   * Check if user is connected
   */
  isUserConnected(userId) {
    return this.getUserConnectionCount(userId) > 0;
  }

  /**
   * Get all active connections
   */
  getActiveConnections() {
    const activeConnections = [];

    for (const [socketId, connectionData] of this.connections) {
      if (connectionData.isActive) {
        activeConnections.push(connectionData);
      }
    }

    return activeConnections;
  }

  /**
   * Get connection statistics
   */
  getConnectionStats() {
    return {
      ...this.connectionStats,
      activeConnections: this.connectionStats.activeConnections,
      userConnections: this.userConnections.size,
      averageConnectionsPerUser: this.userConnections.size > 0 ?
        this.connectionStats.activeConnections / this.userConnections.size : 0,
      transportStats: this.getTransportStats(),
      connectionDurationStats: this.getConnectionDurationStats()
    };
  }

  /**
   * Get transport statistics
   */
  getTransportStats() {
    const stats = {
      websocket: 0,
      polling: 0,
      unknown: 0
    };

    for (const connectionData of this.connections.values()) {
      if (connectionData.isActive) {
        switch (connectionData.transport) {
          case 'websocket':
            stats.websocket++;
            break;
          case 'polling':
            stats.polling++;
            break;
          default:
            stats.unknown++;
            break;
        }
      }
    }

    return stats;
  }

  /**
   * Get connection duration statistics
   */
  getConnectionDurationStats() {
    const durations = [];
    const now = new Date();

    for (const connectionData of this.connections.values()) {
      if (connectionData.isActive) {
        durations.push(now - connectionData.connectedAt);
      } else if (connectionData.disconnectedAt) {
        durations.push(connectionData.disconnectedAt - connectionData.connectedAt);
      }
    }

    if (durations.length === 0) {
      return { min: 0, max: 0, avg: 0, count: 0 };
    }

    durations.sort((a, b) => a - b);

    return {
      min: durations[0],
      max: durations[durations.length - 1],
      avg: durations.reduce((sum, duration) => sum + duration, 0) / durations.length,
      count: durations.length
    };
  }

  /**
   * Check if connection limit reached
   */
  isConnectionLimitReached() {
    return this.connectionStats.activeConnections >= this.maxConnections;
  }

  /**
   * Get connection rejection reason
   */
  getRejectionReason(socket) {
    if (this.isConnectionLimitReached()) {
      return 'Server at maximum connection limit';
    }

    if (wsAuthMiddleware && wsAuthMiddleware.isRateLimited(socket, 'connection')) {
      return 'Too many connection attempts';
    }

    return 'Unknown reason';
  }

  /**
   * Start heartbeat monitoring for a connection
   */
  startHeartbeatMonitoring(socket) {
    const connectionData = this.connections.get(socket.id);
    if (!connectionData) {
      return;
    }

    // Set up ping/pong handling
    socket.on('ping', () => {
      connectionData.lastPing = new Date();
      socket.emit('pong', {
        timestamp: new Date().toISOString(),
        serverTime: Date.now()
      });
    });

    // Start periodic heartbeat check
    connectionData.heartbeatInterval = setInterval(() => {
      this.checkConnectionHeartbeat(socket);
    }, this.heartbeatInterval);
  }

  /**
   * Stop heartbeat monitoring for a connection
   */
  stopHeartbeatMonitoring(socket) {
    const connectionData = this.connections.get(socket.id);
    if (!connectionData) {
      return;
    }

    if (connectionData.heartbeatInterval) {
      clearInterval(connectionData.heartbeatInterval);
      connectionData.heartbeatInterval = null;
    }

    if (connectionData.pingTimeout) {
      clearTimeout(connectionData.pingTimeout);
      connectionData.pingTimeout = null;
    }
  }

  /**
   * Check connection heartbeat
   */
  checkConnectionHeartbeat(socket) {
    const connectionData = this.connections.get(socket.id);
    if (!connectionData || !connectionData.isActive) {
      return;
    }

    const now = new Date();
    const timeSinceLastPing = now - connectionData.lastPing;

    if (timeSinceLastPing > this.heartbeatTimeout) {
      // Connection is stale, disconnect it
      logger.warn('Connection heartbeat timeout', {
        socketId: socket.id,
        userId: connectionData.userId,
        lastPing: connectionData.lastPing,
        timeout: this.heartbeatTimeout
      });

      socket.disconnect(true, 'heartbeat_timeout');
      this.removeConnection(socket, 'heartbeat_timeout');
    }
  }

  /**
   * Setup connection cleanup handlers
   */
  setupConnectionCleanup(socket) {
    const connectionData = this.connections.get(socket.id);
    if (!connectionData) {
      return;
    }

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      this.removeConnection(socket, reason);
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error('Socket error', {
        socketId: socket.id,
        userId: connectionData.userId,
        error: error.message
      });

      this.connectionStats.connectionErrors++;
      this.removeConnection(socket, 'error');
    });

    // Monitor message activity
    socket.onAny((eventName, ...args) => {
      connectionData.lastActivity = new Date();
      connectionData.messageCount++;

      // Calculate bytes (rough estimate)
      const messageSize = JSON.stringify(args).length;
      connectionData.bytesReceived += messageSize;
    });

    // Monitor outgoing messages
    const originalEmit = socket.emit;
    socket.emit = (eventName, ...args) => {
      connectionData.lastActivity = new Date();

      // Calculate bytes (rough estimate)
      const messageSize = JSON.stringify(args).length;
      connectionData.bytesSent += messageSize;

      return originalEmit.call(socket, eventName, ...args);
    };
  }

  /**
   * Start periodic cleanup of inactive connections
   */
  startPeriodicCleanup() {
    // Run cleanup every 5 minutes
    setInterval(() => {
      this.cleanupInactiveConnections();
    }, 5 * 60 * 1000);

    // Run cleanup every hour for rate limiters
    setInterval(() => {
      this.cleanupRateLimiters();
    }, 60 * 60 * 1000);
  }

  /**
   * Clean up inactive connections
   */
  cleanupInactiveConnections() {
    const now = new Date();
    const inactiveThreshold = this.connectionTimeout;
    let cleanedCount = 0;

    for (const [socketId, connectionData] of this.connections) {
      if (!connectionData.isActive) {
        continue; // Already inactive
      }

      const inactiveTime = now - connectionData.lastActivity;
      if (inactiveTime > inactiveThreshold) {
        logger.info('Cleaning up inactive connection', {
          socketId,
          userId: connectionData.userId,
          inactiveTime,
          threshold: inactiveThreshold
        });

        connectionData.socket.disconnect(true, 'inactive_cleanup');
        this.removeConnection(connectionData.socket, 'inactive_cleanup');
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} inactive connections`);
    }
  }

  /**
   * Clean up expired rate limiters
   */
  cleanupRateLimiters() {
    const now = Date.now();
    const rateLimitWindow = 15 * 60 * 1000; // 15 minutes
    let cleanedCount = 0;

    for (const [socketId, rateLimiter] of this.rateLimiters) {
      if (now - rateLimiter.lastReset > rateLimitWindow) {
        this.rateLimiters.delete(socketId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} expired rate limiters`);
    }
  }

  /**
   * Force disconnect all connections for a user
   */
  disconnectUser(userId, reason = 'force_disconnect') {
    const connections = this.getUserConnections(userId);
    let disconnectedCount = 0;

    connections.forEach(connectionData => {
      connectionData.socket.disconnect(true, reason);
      this.removeConnection(connectionData.socket, reason);
      disconnectedCount++;
    });

    logger.info(`Force disconnected user ${userId}`, {
      disconnectedCount,
      reason
    });

    return disconnectedCount;
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    logger.info('Shutting down connection manager...');

    // Stop periodic cleanup
    // (Intervals will be cleaned up automatically when process exits)

    // Disconnect all active connections
    const activeConnections = this.getActiveConnections();

    // Send shutdown notification
    activeConnections.forEach(connectionData => {
      if (connectionData.socket.connected) {
        connectionData.socket.emit('server:shutdown', {
          message: 'Server is shutting down',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Give clients time to receive shutdown notification
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Disconnect all connections
    activeConnections.forEach(connectionData => {
      if (connectionData.socket.connected) {
        connectionData.socket.disconnect(true, 'server_shutdown');
      }
    });

    // Clear all data structures
    this.connections.clear();
    this.userConnections.clear();
    this.connectionPools.clear();
    this.rateLimiters.clear();

    logger.info('Connection manager shutdown complete');
  }
}

module.exports = ConnectionManager;