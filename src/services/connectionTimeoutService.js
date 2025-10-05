const EventEmitter = require('events');
const logger = require('../shared/utils/logger');

/**
 * Connection Timeout and Cleanup Service
 * Manages connection timeouts, cleanup logic, and graceful disconnection
 */
class ConnectionTimeoutService extends EventEmitter {
  constructor() {
    super();

    this.timeouts = new Map(); // connectionId -> timeout info
    this.activeConnections = new Map(); // connectionId -> connection metadata
    this.cleanupInterval = 30000; // 30 seconds
    this.defaultTimeout = 30 * 60 * 1000; // 30 minutes
    this.maxConnections = 10000;

    // Configuration
    this.config = {
      idleTimeout: 30 * 60 * 1000, // 30 minutes
      heartbeatInterval: 25 * 1000, // 25 seconds
      heartbeatTimeout: 60 * 1000, // 1 minute
      maxRetries: 3,
      retryDelay: 5000, // 5 seconds
      cleanupBatchSize: 100,
      enableGracefulShutdown: true,
      shutdownTimeout: 10000 // 10 seconds
    };

    // Statistics
    this.stats = {
      timeouts: {
        triggered: 0,
        prevented: 0,
        errors: 0
      },
      cleanups: {
        connections: 0,
        timeouts: 0,
        errors: 0
      },
      connections: {
        total: 0,
        active: 0,
        expired: 0,
        maxReached: 0
      }
    };

    // Start cleanup service
    this.startCleanupService();
  }

  /**
   * Register a connection for timeout monitoring
   */
  registerConnection(connectionId, socket, options = {}) {
    try {
      const timeout = options.timeout || this.config.idleTimeout;
      const metadata = {
        connectionId,
        socket,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        lastPing: Date.now(),
        timeout,
        heartbeatInterval: options.heartbeatInterval || this.config.heartbeatInterval,
        heartbeatTimeout: options.heartbeatTimeout || this.config.heartbeatTimeout,
        maxRetries: options.maxRetries || this.config.maxRetries,
        retryCount: 0,
        isActive: true,
        closeReason: null,
        tags: options.tags || []
      };

      this.activeConnections.set(connectionId, metadata);
      this.stats.connections.total++;
      this.stats.connections.active++;

      if (this.stats.connections.active > this.stats.connections.maxReached) {
        this.stats.connections.maxReached = this.stats.connections.active;
      }

      // Set up heartbeat monitoring
      this.setupHeartbeatMonitoring(connectionId, metadata);

      // Set connection timeout
      this.setConnectionTimeout(connectionId, timeout);

      logger.debug(`Connection registered for timeout monitoring: ${connectionId}`);
      this.emit('connection:registered', { connectionId, metadata });

      return metadata;

    } catch (error) {
      logger.error(`Failed to register connection ${connectionId}:`, error);
      this.stats.timeouts.errors++;
      throw error;
    }
  }

  /**
   * Unregister a connection
   */
  unregisterConnection(connectionId, reason = 'manual_disconnect') {
    try {
      const metadata = this.activeConnections.get(connectionId);
      if (!metadata) {
        return;
      }

      // Clear timeout
      this.clearConnectionTimeout(connectionId);

      // Clear heartbeat
      this.clearHeartbeatMonitoring(connectionId);

      // Update metadata
      metadata.isActive = false;
      metadata.closeReason = reason;
      metadata.closedAt = Date.now();

      // Remove from active connections
      this.activeConnections.delete(connectionId);
      this.stats.connections.active--;

      const duration = Date.now() - metadata.createdAt;
      logger.debug(`Connection unregistered: ${connectionId} (${reason}, ${duration}ms)`);
      this.emit('connection:unregistered', { connectionId, reason, duration });

    } catch (error) {
      logger.error(`Failed to unregister connection ${connectionId}:`, error);
      this.stats.cleanups.errors++;
    }
  }

  /**
   * Set connection timeout
   */
  setConnectionTimeout(connectionId, timeout) {
    try {
      // Clear existing timeout
      this.clearConnectionTimeout(connectionId);

      const timeoutInfo = {
        connectionId,
        timeout,
        scheduledAt: Date.now(),
        expiresAt: Date.now() + timeout,
        timer: null
      };

      // Schedule timeout
      timeoutInfo.timer = setTimeout(() => {
        this.handleConnectionTimeout(connectionId);
      }, timeout);

      this.timeouts.set(connectionId, timeoutInfo);

    } catch (error) {
      logger.error(`Failed to set timeout for connection ${connectionId}:`, error);
      this.stats.timeouts.errors++;
    }
  }

  /**
   * Clear connection timeout
   */
  clearConnectionTimeout(connectionId) {
    try {
      const timeoutInfo = this.timeouts.get(connectionId);
      if (timeoutInfo && timeoutInfo.timer) {
        clearTimeout(timeoutInfo.timer);
        this.timeouts.delete(connectionId);
      }
    } catch (error) {
      logger.error(`Failed to clear timeout for connection ${connectionId}:`, error);
    }
  }

  /**
   * Handle connection timeout
   */
  handleConnectionTimeout(connectionId) {
    try {
      const metadata = this.activeConnections.get(connectionId);
      const timeoutInfo = this.timeouts.get(connectionId);

      if (!metadata || !metadata.isActive) {
        this.clearConnectionTimeout(connectionId);
        return;
      }

      // Check if connection should really timeout
      const now = Date.now();
      const idleTime = now - metadata.lastActivity;

      if (idleTime < metadata.timeout) {
        // Connection had activity, reschedule timeout
        this.stats.timeouts.prevented++;
        this.setConnectionTimeout(connectionId, metadata.timeout - idleTime);
        return;
      }

      // Connection has timed out
      this.stats.timeouts.triggered++;
      this.stats.connections.expired++;

      logger.info(`Connection timeout: ${connectionId} (idle for ${idleTime}ms)`);

      // Close the connection gracefully
      this.closeConnectionGracefully(connectionId, 'timeout');

      this.emit('connection:timeout', {
        connectionId,
        idleTime,
        metadata,
        timeoutInfo
      });

    } catch (error) {
      logger.error(`Failed to handle timeout for connection ${connectionId}:`, error);
      this.stats.timeouts.errors++;
    }
  }

  /**
   * Close connection gracefully
   */
  closeConnectionGracefully(connectionId, reason) {
    try {
      const metadata = this.activeConnections.get(connectionId);
      if (!metadata || !metadata.socket) {
        this.unregisterConnection(connectionId, reason);
        return;
      }

      // Send close reason to client
      try {
        metadata.socket.emit('close_reason', {
          reason,
          code: this.getCloseCode(reason),
          message: this.getCloseMessage(reason),
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        // Socket might already be closed
      }

      // Close the socket
      setTimeout(() => {
        try {
          if (metadata.socket && metadata.socket.connected) {
            metadata.socket.disconnect(true);
          }
        } catch (error) {
          // Socket might already be closed
        }

        this.unregisterConnection(connectionId, reason);
      }, this.config.shutdownTimeout);

    } catch (error) {
      logger.error(`Failed to close connection gracefully ${connectionId}:`, error);
      this.stats.cleanups.errors++;
    }
  }

  /**
   * Setup heartbeat monitoring
   */
  setupHeartbeatMonitoring(connectionId, metadata) {
    try {
      // Listen for ping/pong
      if (metadata.socket) {
        metadata.socket.on('ping', () => {
          this.updateHeartbeat(connectionId);
        });

        metadata.socket.on('pong', () => {
          this.updateHeartbeat(connectionId);
        });
      }

      // Start heartbeat checks
      this.startHeartbeatChecks(connectionId, metadata);

    } catch (error) {
      logger.error(`Failed to setup heartbeat monitoring for ${connectionId}:`, error);
    }
  }

  /**
   * Start heartbeat checks
   */
  startHeartbeatChecks(connectionId, metadata) {
    const checkHeartbeat = () => {
      const connection = this.activeConnections.get(connectionId);
      if (!connection || !connection.isActive) {
        return;
      }

      const now = Date.now();
      const timeSinceLastPing = now - connection.lastPing;

      if (timeSinceLastPing > metadata.heartbeatTimeout) {
        // Heartbeat timeout
        this.handleHeartbeatTimeout(connectionId);
        return;
      }

      // Send ping
      try {
        if (metadata.socket && metadata.socket.connected) {
          metadata.socket.emit('ping', {
            timestamp: now,
            connectionId
          });
        }
      } catch (error) {
        logger.error(`Failed to send ping for connection ${connectionId}:`, error);
        this.handleHeartbeatTimeout(connectionId);
        return;
      }

      // Schedule next check
      setTimeout(checkHeartbeat, metadata.heartbeatInterval);
    };

    // Start heartbeat checks
    setTimeout(checkHeartbeat, metadata.heartbeatInterval);
  }

  /**
   * Update heartbeat timestamp
   */
  updateHeartbeat(connectionId) {
    const connection = this.activeConnections.get(connectionId);
    if (connection) {
      connection.lastPing = Date.now();
      connection.lastActivity = Date.now();

      // Reset connection timeout if active
      if (connection.isActive) {
        this.setConnectionTimeout(connectionId, connection.timeout);
      }
    }
  }

  /**
   * Handle heartbeat timeout
   */
  handleHeartbeatTimeout(connectionId) {
    try {
      const metadata = this.activeConnections.get(connectionId);
      if (!metadata) {
        return;
      }

      metadata.retryCount++;

      if (metadata.retryCount < metadata.maxRetries) {
        // Retry the connection
        logger.warn(`Heartbeat timeout for ${connectionId}, retrying (${metadata.retryCount}/${metadata.maxRetries})`);

        // Reset retry timeout
        setTimeout(() => {
          this.updateHeartbeat(connectionId);
        }, this.config.retryDelay);

      } else {
        // Max retries reached, close connection
        logger.error(`Max heartbeat retries reached for ${connectionId}, closing connection`);
        this.closeConnectionGracefully(connectionId, 'heartbeat_timeout');
      }

    } catch (error) {
      logger.error(`Failed to handle heartbeat timeout for ${connectionId}:`, error);
    }
  }

  /**
   * Clear heartbeat monitoring
   */
  clearHeartbeatMonitoring(connectionId) {
    // Heartbeat monitoring will be automatically cleaned up when socket is closed
  }

  /**
   * Update connection activity
   */
  updateActivity(connectionId) {
    const connection = this.activeConnections.get(connectionId);
    if (connection) {
      connection.lastActivity = Date.now();
      // Reset timeout
      this.setConnectionTimeout(connectionId, connection.timeout);
    }
  }

  /**
   * Get connection metadata
   */
  getConnectionInfo(connectionId) {
    return this.activeConnections.get(connectionId);
  }

  /**
   * Check if connection is active
   */
  isConnectionActive(connectionId) {
    const connection = this.activeConnections.get(connectionId);
    return connection && connection.isActive;
  }

  /**
   * Get active connections count
   */
  getActiveConnectionsCount() {
    return this.stats.connections.active;
  }

  /**
   * Get connection statistics
   */
  getConnectionStats() {
    return {
      ...this.stats,
      timeOutsActive: this.timeouts.size,
      averageConnectionDuration: this.calculateAverageConnectionDuration(),
      connectionDistribution: this.getConnectionDistribution()
    };
  }

  /**
   * Calculate average connection duration
   */
  calculateAverageConnectionDuration() {
    try {
      const now = Date.now();
      let totalDuration = 0;
      let count = 0;

      for (const connection of this.activeConnections.values()) {
        const duration = now - connection.createdAt;
        totalDuration += duration;
        count++;
      }

      return count > 0 ? totalDuration / count : 0;

    } catch (error) {
      logger.error('Failed to calculate average connection duration:', error);
      return 0;
    }
  }

  /**
   * Get connection distribution by duration
   */
  getConnectionDistribution() {
    try {
      const now = Date.now();
      const distribution = {
        '0-1m': 0,
        '1-5m': 0,
        '5-15m': 0,
        '15-30m': 0,
        '30m+': 0
      };

      for (const connection of this.activeConnections.values()) {
        const duration = now - connection.createdAt;
        const minutes = duration / (60 * 1000);

        if (minutes < 1) {
          distribution['0-1m']++;
        } else if (minutes < 5) {
          distribution['1-5m']++;
        } else if (minutes < 15) {
          distribution['5-15m']++;
        } else if (minutes < 30) {
          distribution['15-30m']++;
        } else {
          distribution['30m']++;
        }
      }

      return distribution;

    } catch (error) {
      logger.error('Failed to get connection distribution:', error);
      return {};
    }
  }

  /**
   * Start cleanup service
   */
  startCleanupService() {
    setInterval(() => {
      this.performCleanup();
    }, this.cleanupInterval);
  }

  /**
   * Perform cleanup operations
   */
  performCleanup() {
    try {
      this.cleanupExpiredTimeouts();
      this.cleanupInactiveConnections();
      this.cleanupOrphanedTimeouts();

      this.stats.cleanups.connections++;
      logger.debug('Connection cleanup completed');

    } catch (error) {
      logger.error('Failed to perform connection cleanup:', error);
      this.stats.cleanups.errors++;
    }
  }

  /**
   * Clean up expired timeouts
   */
  cleanupExpiredTimeouts() {
    try {
      const now = Date.now();
      const expiredTimeouts = [];

      for (const [connectionId, timeoutInfo] of this.timeouts) {
        if (now > timeoutInfo.expiresAt) {
          expiredTimeouts.push(connectionId);
        }
      }

      for (const connectionId of expiredTimeouts) {
        this.clearConnectionTimeout(connectionId);
        this.stats.cleanups.timeouts++;
      }

      if (expiredTimeouts.length > 0) {
        logger.debug(`Cleaned up ${expiredTimeouts.length} expired timeouts`);
      }

    } catch (error) {
      logger.error('Failed to cleanup expired timeouts:', error);
    }
  }

  /**
   * Clean up inactive connections
   */
  cleanupInactiveConnections() {
    try {
      const now = Date.now();
      const inactiveConnections = [];
      const maxIdleTime = this.config.idleTimeout * 2; // Double the normal timeout

      for (const [connectionId, connection] of this.activeConnections.values()) {
        const idleTime = now - connection.lastActivity;
        if (idleTime > maxIdleTime && connection.isActive) {
          inactiveConnections.push(connectionId);
        }
      }

      // Process in batches to avoid blocking
      const batchSize = this.config.cleanupBatchSize;
      for (let i = 0; i < inactiveConnections.length; i += batchSize) {
        const batch = inactiveConnections.slice(i, i + batchSize);

        setTimeout(() => {
          for (const connectionId of batch) {
            this.closeConnectionGracefully(connectionId, 'inactive_cleanup');
          }
        }, 0);
      }

      if (inactiveConnections.length > 0) {
        logger.info(`Cleaning up ${inactiveConnections.length} inactive connections`);
      }

    } catch (error) {
      logger.error('Failed to cleanup inactive connections:', error);
    }
  }

  /**
   * Clean up orphaned timeouts
   */
  cleanupOrphanedTimeouts() {
    try {
      const orphanedTimeouts = [];

      for (const [connectionId, timeoutInfo] of this.timeouts) {
        // Check if connection still exists
        if (!this.activeConnections.has(connectionId)) {
          orphanedTimeouts.push(connectionId);
        }
      }

      for (const connectionId of orphanedTimeouts) {
        this.clearConnectionTimeout(connectionId);
        this.stats.cleanups.timeouts++;
      }

      if (orphanedTimeouts.length > 0) {
        logger.debug(`Cleaned up ${orphanedTimeouts.length} orphaned timeouts`);
      }

    } catch (error) {
      logger.error('Failed to cleanup orphaned timeouts:', error);
    }
  }

  /**
   * Get close code for reason
   */
  getCloseCode(reason) {
    const codes = {
      'timeout': 4000,
      'heartbeat_timeout': 4001,
      'server_shutdown': 4002,
      'idle_cleanup': 4003,
      'manual_disconnect': 1000,
      'normal': 1000
    };

    return codes[reason] || 4000;
  }

  /**
   * Get close message for reason
   */
  getCloseMessage(reason) {
    const messages = {
      'timeout': 'Connection timed out due to inactivity',
      'heartbeat_timeout': 'Connection lost due to heartbeat timeout',
      'server_shutdown': 'Server is shutting down',
      'idle_cleanup': 'Connection closed due to inactivity',
      'manual_disconnect': 'Connection closed by client',
      'normal': 'Connection closed'
    };

    return messages[reason] || 'Connection closed';
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    logger.info('Connection timeout configuration updated', newConfig);
  }

  /**
   * Force cleanup of all connections
   */
  async forceCleanupAllConnections(reason = 'force_cleanup') {
    try {
      logger.info(`Force cleaning up all connections: ${reason}`);

      const connectionIds = Array.from(this.activeConnections.keys());

      for (const connectionId of connectionIds) {
        this.closeConnectionGracefully(connectionId, reason);
      }

      // Wait for connections to close
      await new Promise(resolve => setTimeout(resolve, this.config.shutdownTimeout));

      // Clear remaining data
      this.activeConnections.clear();
      this.timeouts.clear();

      logger.info(`Force cleanup completed: ${connectionIds.length} connections`);

    } catch (error) {
      logger.error('Failed to force cleanup all connections:', error);
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeConnections: this.activeConnections.size,
      pendingTimeouts: this.timeouts.size,
      config: this.config,
      timestamp: Date.now()
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown() {
    logger.info('Shutting down connection timeout service');

    // Stop accepting new connections
    this.removeAllListeners();

    // Gracefully close all connections
    if (this.config.enableGracefulShutdown) {
      await this.forceCleanupAllConnections('service_shutdown');
    }

    logger.info('Connection timeout service shutdown complete');
  }
}

// Create singleton instance
const connectionTimeoutService = new ConnectionTimeoutService();

module.exports = connectionTimeoutService;