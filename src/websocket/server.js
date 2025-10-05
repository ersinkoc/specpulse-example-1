const { Server } = require('socket.io');
const config = require('./config');
const logger = require('../shared/utils/logger');
const wsAuthMiddleware = require('./authMiddleware');
const ConnectionManager = require('./connectionManager');
const OptimizedConnectionManager = require('./optimizedConnectionManager');
const notificationService = require('../services/notificationService');

/**
 * WebSocket Server
 * Handles real-time communication for notifications
 */
class WebSocketServer {
  constructor(httpServer) {
    this.io = new Server(httpServer, {
      cors: config.cors,
      pingTimeout: config.connectionLimits.heartbeatTimeout,
      pingInterval: config.connectionLimits.heartbeatInterval,
      maxHttpBufferSize: config.security.maxPayloadSize,
      compression: config.security.enableCompression
    });

    // Initialize optimized connection manager with fallback
    this.useOptimizedManager = config.performance?.enableOptimizedConnectionManager !== false;
    this.connectionManager = this.useOptimizedManager ?
      new OptimizedConnectionManager() :
      new ConnectionManager();

    // Legacy data structures (for backward compatibility)
    this.connectedUsers = new Map(); // userId -> socket[]
    this.userSockets = new Map(); // socketId -> userId
    this.connectionCount = 0;
    this.maxConnections = config.connectionLimits.maxConnections;

    this.setupMiddleware();
    this.setupEventHandlers();
    this.setupConnectionManagerEvents();
  }

  /**
   * Setup middleware for authentication and error handling
   */
  setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        if (!config.security.enableAuthentication) {
          // Skip authentication in development if disabled
          socket.userId = 'anonymous';
          socket.userRoles = ['anonymous'];
          return next();
        }

        // Use the WebSocket authentication middleware
        await wsAuthMiddleware.authenticate(socket, next);
      } catch (error) {
        logger.warn('WebSocket authentication failed:', error.message);
        next(error);
      }
    });

    // Connection limiting middleware
    this.io.use((socket, next) => {
      if (this.connectionCount >= this.maxConnections) {
        return next(new Error('Server at maximum connection limit'));
      }
      next();
    });

    // Rate limiting middleware
    this.io.use((socket, next) => {
      // Check if user is rate limited for initial connection
      if (wsAuthMiddleware.isRateLimited(socket, 'connection')) {
        return next(new Error('Too many connection attempts'));
      }
      next();
    });

    // Error handling middleware
    this.io.use((socket, next) => {
      socket.on('error', (error) => {
        logger.error('Socket error:', error);
      });
      next();
    });
  }

  /**
   * Setup event handlers for connections and disconnections
   */
  setupEventHandlers() {
    this.io.on('connection', async (socket) => {
      // Add connection to connection manager (async for optimized version)
      let connectionData;
      if (this.useOptimizedManager) {
        connectionData = await this.connectionManager.addConnection(socket);
      } else {
        connectionData = this.connectionManager.addConnection(socket);
      }

      // Only proceed if connection was accepted
      if (connectionData === false) {
        socket.disconnect(true);
        return;
      }

      // Update legacy data structures for backward compatibility
      this.connectionCount++;
      if (!this.connectedUsers.has(socket.userId)) {
        this.connectedUsers.set(socket.userId, []);
      }
      this.connectedUsers.get(socket.userId).push(socket);
      this.userSockets.set(socket.id, socket.userId);

      if (config.debug.logConnections) {
        logger.info(`User connected: ${socket.userId} (${socket.id}) - Total connections: ${this.connectionCount}`);
      }

      // Join user to their personal room
      socket.join(`user:${socket.userId}`);

      // Setup event handlers for this socket
      this.setupSocketEventHandlers(socket);

      // Send welcome message with connection info
      socket.emit('connected', {
        message: 'Connected to notification server',
        userId: socket.userId,
        socketId: socket.id,
        serverTime: new Date().toISOString(),
        transport: connectionData.transport,
        connectedUsers: this.getStats().connectedUsers
      });

      // Log user connection
      logger.info('WebSocket connection established', {
        userId: socket.userId,
        socketId: socket.id,
        userAgent: connectionData.userAgent,
        transport: connectionData.transport,
        remoteAddress: connectionData.remoteAddress
      });
    });

    this.io.on('disconnect', (reason) => {
      this.connectionCount--;

      if (config.debug.logConnections) {
        logger.info(`Connection closed: ${reason} - Total connections: ${this.connectionCount}`);
      }
    });
  }

  /**
   * Setup connection manager event listeners
   */
  setupConnectionManagerEvents() {
    // Listen to connection events
    this.connectionManager.on('connection:added', (connectionData) => {
      this.emit('user:connected', {
        userId: connectionData.userId,
        socketId: connectionData.socketId,
        userEmail: connectionData.userEmail,
        connectedAt: connectionData.connectedAt
      });
    });

    this.connectionManager.on('connection:removed', ({ connectionData, reason }) => {
      // Update legacy data structures
      if (this.userSockets.has(connectionData.socketId)) {
        const userId = this.userSockets.get(connectionData.socketId);
        this.userSockets.delete(connectionData.socketId);

        if (this.connectedUsers.has(userId)) {
          const userConnections = this.connectedUsers.get(userId);
          const index = userConnections.indexOf(connectionData.socket);
          if (index > -1) {
            userConnections.splice(index, 1);
          }
          if (userConnections.length === 0) {
            this.connectedUsers.delete(userId);
          }
        }
      }

      this.connectionCount = this.connectionManager.getConnectionStats().activeConnections;

      // Emit user disconnection event
      this.emit('user:disconnected', {
        userId: connectionData.userId,
        socketId: connectionData.socketId,
        reason,
        connectedAt: connectionData.connectedAt,
        disconnectedAt: connectionData.disconnectedAt,
        duration: connectionData.disconnectedAt ?
          connectionData.disconnectedAt - connectionData.connectedAt : null,
        messageCount: connectionData.messageCount
      });

      // Log user disconnection
      logger.info('WebSocket connection closed', {
        userId: connectionData.userId,
        socketId: connectionData.socketId,
        reason,
        duration: connectionData.disconnectedAt ?
          connectionData.disconnectedAt - connectionData.connectedAt : null,
        messageCount: connectionData.messageCount
      });
    });
  }

  /**
   * Setup event handlers for individual socket events
   */
  setupSocketEventHandlers(socket) {
    // Handle disconnection
    socket.on('disconnect', (reason) => {
      this.handleUserDisconnection(socket, reason);
    });

    // Handle connection errors
    socket.on('error', (error) => {
      this.handleSocketError(socket, error);
    });

    // Handle reconnection attempts
    socket.on('reconnect_attempt', (attemptNumber) => {
      this.handleReconnectionAttempt(socket, attemptNumber);
    });

    socket.on('reconnect', (attemptNumber) => {
      this.handleReconnectionSuccess(socket, attemptNumber);
    });

    socket.on('reconnect_failed', (attemptNumber) => {
      this.handleReconnectionFailure(socket, attemptNumber);
    });

    // Handle notification read status
    socket.on('notification:read', (data) => {
      this.handleNotificationRead(socket, data);
    });

    // Handle preference updates
    socket.on('preferences:update', (data) => {
      this.handlePreferenceUpdate(socket, data);
    });

    // Handle admin broadcasts (if user has admin role)
    socket.on('admin:broadcast', (data) => {
      if (wsAuthMiddleware.isAdmin(socket)) {
        this.handleAdminBroadcast(socket, data);
      } else {
        socket.emit('error', {
          message: 'Unauthorized: Admin access required',
          code: 'UNAUTHORIZED'
        });
      }
    });

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      this.handlePing(socket);
    });

    // Handle pong responses
    socket.on('pong', (data) => {
      this.handlePong(socket, data);
    });

    // Handle subscription management
    socket.on('subscribe', (data) => {
      this.handleSubscription(socket, data);
    });

    socket.on('unsubscribe', (data) => {
      this.handleUnsubscription(socket, data);
    });

    // Handle room management
    socket.on('join:room', (room) => {
      this.handleJoinRoom(socket, room);
    });

    socket.on('leave:room', (room) => {
      this.handleLeaveRoom(socket, room);
    });

    // Handle custom events with validation
    socket.onAny((eventName, ...args) => {
      this.handleCustomEvent(socket, eventName, args);
    });

    // Handle connection state queries
    socket.on('get:connection_info', () => {
      this.handleConnectionInfoRequest(socket);
    });

    socket.on('get:stats', () => {
      this.handleStatsRequest(socket);
    });

    // Handle notification-related events
    socket.on('notifications:get', (data) => {
      this.handleGetNotifications(socket, data);
    });

    socket.on('notifications:mark_all_read', (data) => {
      this.handleMarkAllAsRead(socket, data);
    });

    socket.on('notifications:delete', (data) => {
      this.handleDeleteNotification(socket, data);
    });

    socket.on('notifications:get_stats', () => {
      this.handleGetNotificationStats(socket);
    });

    socket.on('notifications:action_click', (data) => {
      this.handleNotificationActionClick(socket, data);
    });
  }

  /**
   * Handle user disconnection
   */
  handleUserDisconnection(socket, reason) {
    const userId = this.userSockets.get(socket.id);

    if (userId) {
      // Remove socket from user connections
      const userConnections = this.connectedUsers.get(userId);
      if (userConnections) {
        const index = userConnections.indexOf(socket);
        if (index > -1) {
          userConnections.splice(index, 1);
        }

        // Clean up empty user entries
        if (userConnections.length === 0) {
          this.connectedUsers.delete(userId);
        }
      }

      this.userSockets.delete(socket.id);
    }

    // Untrack socket from authentication middleware
    wsAuthMiddleware.untrackSocket(socket);

    if (config.debug.logConnections) {
      logger.info(`User disconnected: ${userId} (${socket.id}) - Reason: ${reason}`);
    }
  }

  /**
   * Handle socket errors
   */
  handleSocketError(socket, error) {
    logger.error('Socket error occurred', {
      socketId: socket.id,
      userId: socket.userId,
      error: error.message,
      stack: error.stack
    });

    // Log auth event for security monitoring
    wsAuthMiddleware.logAuthEvent(socket, 'socket_error', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    // Emit error back to client with sanitized details
    socket.emit('error', {
      message: 'An error occurred on the connection',
      code: 'SOCKET_ERROR',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle reconnection attempts
   */
  handleReconnectionAttempt(socket, attemptNumber) {
    if (config.debug.logConnections) {
      logger.info(`Reconnection attempt ${attemptNumber} for user ${socket.userId} (${socket.id})`);
    }

    // Update connection data in connection manager
    const connectionData = this.connectionManager.getConnection(socket.id);
    if (connectionData) {
      connectionData.reconnectAttempts = attemptNumber;
      connectionData.lastReconnectAttempt = new Date();
    }

    // Check rate limiting for reconnection attempts
    if (wsAuthMiddleware.isRateLimited(socket, 'reconnection')) {
      logger.warn('Reconnection rate limit exceeded', {
        userId: socket.userId,
        socketId: socket.id,
        attemptNumber
      });
      socket.disconnect(true, 'rate_limit_exceeded');
      return;
    }

    // Emit reconnection status to client
    socket.emit('reconnect_attempt', {
      attemptNumber,
      maxAttempts: 5,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle successful reconnection
   */
  handleReconnectionSuccess(socket, attemptNumber) {
    logger.info(`Reconnection successful for user ${socket.userId} after ${attemptNumber} attempts`, {
      socketId: socket.id,
      userId: socket.userId,
      attemptNumber
    });

    // Update connection data
    const connectionData = this.connectionManager.getConnection(socket.id);
    if (connectionData) {
      connectionData.reconnectedAt = new Date();
      connectionData.reconnectAttempts = attemptNumber;
    }

    // Log successful reconnection for security monitoring
    wsAuthMiddleware.logAuthEvent(socket, 'reconnection_success', {
      attemptNumber,
      timestamp: new Date().toISOString()
    });

    // Emit success confirmation to client
    socket.emit('reconnected', {
      message: 'Successfully reconnected',
      attemptNumber,
      serverTime: new Date().toISOString(),
      connectedUsers: this.getStats().connectedUsers
    });
  }

  /**
   * Handle reconnection failure
   */
  handleReconnectionFailure(socket, attemptNumber) {
    logger.warn(`Reconnection failed for user ${socket.userId} after ${attemptNumber} attempts`, {
      socketId: socket.id,
      userId: socket.userId,
      attemptNumber
    });

    // Log failed reconnection for security monitoring
    wsAuthMiddleware.logAuthEvent(socket, 'reconnection_failed', {
      attemptNumber,
      timestamp: new Date().toISOString()
    });

    // Emit failure notification to client
    socket.emit('reconnect_failed', {
      message: 'Failed to reconnect to server',
      attemptNumber,
      maxAttempts: 5,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle ping from client
   */
  handlePing(socket) {
    const connectionData = this.connectionManager.getConnection(socket.id);
    if (connectionData) {
      connectionData.lastPing = new Date();
    }

    // Respond with pong
    socket.emit('pong', {
      timestamp: new Date().toISOString(),
      serverTime: Date.now(),
      latency: Date.now() - (connectionData?.lastPing?.getTime() || Date.now())
    });

    if (config.debug.logEvents) {
      logger.debug(`Ping received from user ${socket.userId} (${socket.id})`);
    }
  }

  /**
   * Handle pong response from client
   */
  handlePong(socket, data) {
    const connectionData = this.connectionManager.getConnection(socket.id);
    if (connectionData) {
      connectionData.lastPong = new Date();
      if (data && data.serverTime) {
        connectionData.latency = Date.now() - data.serverTime;
      }
    }

    if (config.debug.logEvents) {
      logger.debug(`Pong received from user ${socket.userId} (${socket.id})`);
    }
  }

  /**
   * Handle subscription requests
   */
  handleSubscription(socket, data) {
    try {
      const { channel, filters } = data;

      if (!channel) {
        socket.emit('error', {
          message: 'Channel is required for subscription',
          code: 'INVALID_SUBSCRIPTION'
        });
        return;
      }

      // Validate channel
      const validChannels = ['notifications', 'system', 'updates', 'alerts'];
      if (!validChannels.includes(channel)) {
        socket.emit('error', {
          message: 'Invalid channel',
          code: 'INVALID_CHANNEL'
        });
        return;
      }

      // Join socket to channel room
      socket.join(`channel:${channel}`);

      // Update connection data
      const connectionData = this.connectionManager.getConnection(socket.id);
      if (connectionData) {
        connectionData.roomSubscriptions.add(`channel:${channel}`);
        if (filters) {
          connectionData.subscriptionFilters = {
            ...connectionData.subscriptionFilters,
            [`channel:${channel}`]: filters
          };
        }
      }

      if (config.debug.logEvents) {
        logger.debug(`User ${socket.userId} subscribed to channel ${channel}`, filters);
      }

      // Confirm subscription
      socket.emit('subscribed', {
        channel,
        message: 'Successfully subscribed',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Subscription error', {
        userId: socket.userId,
        socketId: socket.id,
        error: error.message
      });

      socket.emit('error', {
        message: 'Failed to process subscription',
        code: 'SUBSCRIPTION_ERROR'
      });
    }
  }

  /**
   * Handle unsubscription requests
   */
  handleUnsubscription(socket, data) {
    try {
      const { channel } = data;

      if (!channel) {
        socket.emit('error', {
          message: 'Channel is required for unsubscription',
          code: 'INVALID_UNSUBSCRIPTION'
        });
        return;
      }

      // Leave socket from channel room
      socket.leave(`channel:${channel}`);

      // Update connection data
      const connectionData = this.connectionManager.getConnection(socket.id);
      if (connectionData) {
        connectionData.roomSubscriptions.delete(`channel:${channel}`);
        if (connectionData.subscriptionFilters) {
          delete connectionData.subscriptionFilters[`channel:${channel}`];
        }
      }

      if (config.debug.logEvents) {
        logger.debug(`User ${socket.userId} unsubscribed from channel ${channel}`);
      }

      // Confirm unsubscription
      socket.emit('unsubscribed', {
        channel,
        message: 'Successfully unsubscribed',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Unsubscription error', {
        userId: socket.userId,
        socketId: socket.id,
        error: error.message
      });

      socket.emit('error', {
        message: 'Failed to process unsubscription',
        code: 'UNSUBSCRIPTION_ERROR'
      });
    }
  }

  /**
   * Handle room join requests
   */
  handleJoinRoom(socket, room) {
    try {
      if (!room || typeof room !== 'string') {
        socket.emit('error', {
          message: 'Valid room name is required',
          code: 'INVALID_ROOM'
        });
        return;
      }

      // Validate room name for security
      const validRoomPattern = /^[a-zA-Z0-9_-]+$/;
      if (!validRoomPattern.test(room)) {
        socket.emit('error', {
          message: 'Invalid room name format',
          code: 'INVALID_ROOM_FORMAT'
        });
        return;
      }

      // Join the room
      socket.join(room);

      // Update connection data
      const connectionData = this.connectionManager.getConnection(socket.id);
      if (connectionData) {
        connectionData.roomSubscriptions.add(room);
      }

      if (config.debug.logEvents) {
        logger.debug(`User ${socket.userId} joined room ${room}`);
      }

      // Confirm room join
      socket.emit('room:joined', {
        room,
        message: `Successfully joined room: ${room}`,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Room join error', {
        userId: socket.userId,
        socketId: socket.id,
        room,
        error: error.message
      });

      socket.emit('error', {
        message: 'Failed to join room',
        code: 'ROOM_JOIN_ERROR'
      });
    }
  }

  /**
   * Handle room leave requests
   */
  handleLeaveRoom(socket, room) {
    try {
      if (!room || typeof room !== 'string') {
        socket.emit('error', {
          message: 'Valid room name is required',
          code: 'INVALID_ROOM'
        });
        return;
      }

      // Leave the room
      socket.leave(room);

      // Update connection data
      const connectionData = this.connectionManager.getConnection(socket.id);
      if (connectionData) {
        connectionData.roomSubscriptions.delete(room);
      }

      if (config.debug.logEvents) {
        logger.debug(`User ${socket.userId} left room ${room}`);
      }

      // Confirm room leave
      socket.emit('room:left', {
        room,
        message: `Successfully left room: ${room}`,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Room leave error', {
        userId: socket.userId,
        socketId: socket.id,
        room,
        error: error.message
      });

      socket.emit('error', {
        message: 'Failed to leave room',
        code: 'ROOM_LEAVE_ERROR'
      });
    }
  }

  /**
   * Handle custom events with validation
   */
  handleCustomEvent(socket, eventName, args) {
    try {
      // Validate event name for security
      const validEventPattern = /^[a-zA-Z0-9_:.-]+$/;
      if (!validEventPattern.test(eventName)) {
        logger.warn('Invalid event name attempted', {
          userId: socket.userId,
          socketId: socket.id,
          eventName
        });
        return;
      }

      // Check rate limiting for custom events
      if (wsAuthMiddleware.isRateLimited(socket, 'custom_event')) {
        socket.emit('error', {
          message: 'Too many custom events',
          code: 'RATE_LIMIT_EXCEEDED'
        });
        return;
      }

      // Log custom event for monitoring
      if (config.debug.logEvents) {
        logger.debug(`Custom event received: ${eventName} from user ${socket.userId}`, {
          argsCount: args.length,
          argSize: JSON.stringify(args).length
        });
      }

      // Update connection activity
      const connectionData = this.connectionManager.getConnection(socket.id);
      if (connectionData) {
        connectionData.lastActivity = new Date();
        connectionData.customEventCount = (connectionData.customEventCount || 0) + 1;
      }

      // Log for security monitoring
      wsAuthMiddleware.logAuthEvent(socket, 'custom_event', {
        eventName,
        argsCount: args.length
      });

    } catch (error) {
      logger.error('Custom event handling error', {
        userId: socket.userId,
        socketId: socket.id,
        eventName,
        error: error.message
      });
    }
  }

  /**
   * Handle connection info requests
   */
  handleConnectionInfoRequest(socket) {
    try {
      const connectionData = this.connectionManager.getConnection(socket.id);
      const stats = this.connectionManager.getConnectionStats();

      const connectionInfo = {
        socketId: socket.id,
        userId: socket.userId,
        userEmail: socket.userEmail,
        userRoles: socket.userRoles,
        connectedAt: connectionData?.connectedAt,
        lastActivity: connectionData?.lastActivity,
        transport: connectionData?.transport,
        remoteAddress: connectionData?.remoteAddress,
        userAgent: connectionData?.userAgent,
        roomSubscriptions: Array.from(connectionData?.roomSubscriptions || []),
        messageCount: connectionData?.messageCount || 0,
        bytesReceived: connectionData?.bytesReceived || 0,
        bytesSent: connectionData?.bytesSent || 0,
        latency: connectionData?.latency || 0,
        serverStats: {
          totalConnections: stats.activeConnections,
          connectedUsers: stats.userConnections,
          uptime: process.uptime()
        },
        timestamp: new Date().toISOString()
      };

      socket.emit('connection_info', connectionInfo);

    } catch (error) {
      logger.error('Connection info request error', {
        userId: socket.userId,
        socketId: socket.id,
        error: error.message
      });

      socket.emit('error', {
        message: 'Failed to retrieve connection info',
        code: 'INFO_REQUEST_ERROR'
      });
    }
  }

  /**
   * Handle stats requests
   */
  handleStatsRequest(socket) {
    try {
      const stats = this.connectionManager.getConnectionStats();
      const serverStats = this.getStats();

      const fullStats = {
        connection: {
          total: stats.totalConnections,
          active: stats.activeConnections,
          peak: stats.peakConnections,
          disconnected: stats.totalDisconnections,
          rejected: stats.rejectedConnections,
          errors: stats.connectionErrors
        },
        users: {
          connected: stats.userConnections,
          averageConnections: stats.averageConnectionsPerUser
        },
        transport: stats.transportStats,
        duration: stats.connectionDurationStats,
        server: {
          uptime: serverStats.uptime,
          maxConnections: serverStats.maxConnections,
          timestamp: serverStats.timestamp
        },
        timestamp: new Date().toISOString()
      };

      socket.emit('stats', fullStats);

      if (config.debug.logEvents) {
        logger.debug(`Stats requested by user ${socket.userId}`);
      }

    } catch (error) {
      logger.error('Stats request error', {
        userId: socket.userId,
        socketId: socket.id,
        error: error.message
      });

      socket.emit('error', {
        message: 'Failed to retrieve stats',
        code: 'STATS_REQUEST_ERROR'
      });
    }
  }

  /**
   * Handle notification read status updates
   */
  async handleNotificationRead(socket, data) {
    try {
      const { notificationId, markMultiple = false, notificationIds } = data;

      if (markMultiple && notificationIds && Array.isArray(notificationIds)) {
        // Mark multiple notifications as read
        await notificationService.markMultipleAsRead(notificationIds, socket.userId);

        if (config.debug.logEvents) {
          logger.debug(`Multiple notifications marked as read: ${socket.userId} -> ${notificationIds.length} notifications`);
        }
      } else if (notificationId) {
        // Mark single notification as read
        await notificationService.markAsRead(notificationId, socket.userId);

        if (config.debug.logEvents) {
          logger.debug(`Notification marked as read: ${socket.userId} -> ${notificationId}`);
        }
      }

      // Emit confirmation back to user
      socket.emit('notification:read:confirmed', {
        notificationId: notificationId || null,
        notificationIds: notificationIds || null,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to handle notification read:', error);

      socket.emit('error', {
        message: 'Failed to mark notification as read',
        code: 'NOTIFICATION_READ_ERROR',
        details: error.message
      });
    }
  }

  /**
   * Handle preference updates
   */
  handlePreferenceUpdate(socket, data) {
    // This will be implemented when we create the preferences service
    if (config.debug.logEvents) {
      logger.debug(`Preferences updated: ${socket.userId}`, data);
    }

    socket.emit('preferences:updated', {
      message: 'Preferences updated successfully',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle admin broadcasts
   */
  async handleAdminBroadcast(socket, data) {
    try {
      if (config.debug.logEvents) {
        logger.debug(`Admin broadcast: ${socket.userId}`, data);
      }

      // Log admin action
      wsAuthMiddleware.logAuthEvent(socket, 'admin_broadcast', {
        recipientCount: this.connectionCount,
        notificationTitle: data.title
      });

      // Create notification using notification service
      const notification = await notificationService.broadcast({
        title: data.title,
        message: data.message,
        category: data.category || 'administrative',
        priority: data.priority || 'medium',
        type: data.type || 'admin_broadcast',
        data: {
          ...data.data,
          fromAdmin: socket.userId,
          fromAdminEmail: socket.userEmail
        },
        actions: data.actions
      }, {
        includeRoles: data.includeRoles || [],
        excludeUsers: data.excludeUsers || []
      });

      // Send confirmation to admin
      socket.emit('admin:broadcast:sent', {
        message: 'Broadcast sent successfully',
        recipientCount: notification.successCount,
        failedCount: notification.errorCount,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to handle admin broadcast:', error);

      socket.emit('error', {
        message: 'Failed to send broadcast',
        code: 'BROADCAST_ERROR',
        details: error.message
      });
    }
  }

  /**
   * Send notification to specific user
   */
  sendToUser(userId, notification) {
    const userConnections = this.connectedUsers.get(userId);

    if (userConnections && userConnections.length > 0) {
      userConnections.forEach(socket => {
        socket.emit('notification:receive', {
          ...notification,
          timestamp: new Date().toISOString()
        });
      });

      if (config.debug.logEvents) {
        logger.debug(`Notification sent to user ${userId}:`, notification.title);
      }

      return true;
    }

    return false;
  }

  /**
   * Send notification to multiple users
   */
  sendToUsers(userIds, notification) {
    let successCount = 0;

    userIds.forEach(userId => {
      if (this.sendToUser(userId, notification)) {
        successCount++;
      }
    });

    if (config.debug.logEvents) {
      logger.debug(`Bulk notification sent: ${successCount}/${userIds.length} users reached`);
    }

    return successCount;
  }

  /**
   * Broadcast to all connected users
   */
  broadcast(notification) {
    this.io.emit('notification:receive', {
      ...notification,
      timestamp: new Date().toISOString()
    });

    if (config.debug.logEvents) {
      logger.debug(`Broadcast sent to ${this.connectionCount} users:`, notification.title);
    }
  }

  /**
   * Get server statistics
   */
  getStats() {
    return {
      connectedUsers: this.connectedUsers.size,
      totalConnections: this.connectionCount,
      maxConnections: this.maxConnections,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handle get notifications request
   */
  async handleGetNotifications(socket, data) {
    try {
      const {
        limit = 50,
        offset = 0,
        category,
        priority,
        unreadOnly = false,
        includeExpired = false
      } = data || {};

      const notifications = await notificationService.getUserNotifications(socket.userId, {
        limit,
        offset,
        category,
        priority,
        unreadOnly,
        includeExpired
      });

      socket.emit('notifications:list', {
        notifications: notifications.notifications,
        total: notifications.total,
        limit: notifications.limit,
        offset: notifications.offset,
        timestamp: new Date().toISOString()
      });

      if (config.debug.logEvents) {
        logger.debug(`Retrieved notifications for user ${socket.userId}: ${notifications.notifications.length} notifications`);
      }

    } catch (error) {
      logger.error('Failed to get notifications:', error);

      socket.emit('error', {
        message: 'Failed to retrieve notifications',
        code: 'GET_NOTIFICATIONS_ERROR',
        details: error.message
      });
    }
  }

  /**
   * Handle mark all notifications as read
   */
  async handleMarkAllAsRead(socket, data) {
    try {
      const filters = data || {};
      const updatedNotifications = await notificationService.markAllAsRead(socket.userId, filters);

      socket.emit('notifications:all_read', {
        count: updatedNotifications.length,
        filters,
        timestamp: new Date().toISOString()
      });

      if (config.debug.logEvents) {
        logger.debug(`Marked all notifications as read for user ${socket.userId}: ${updatedNotifications.length} notifications`);
      }

    } catch (error) {
      logger.error('Failed to mark all notifications as read:', error);

      socket.emit('error', {
        message: 'Failed to mark all notifications as read',
        code: 'MARK_ALL_READ_ERROR',
        details: error.message
      });
    }
  }

  /**
   * Handle delete notification
   */
  async handleDeleteNotification(socket, data) {
    try {
      const { notificationId } = data;

      if (!notificationId) {
        socket.emit('error', {
          message: 'Notification ID is required',
          code: 'INVALID_NOTIFICATION_ID'
        });
        return;
      }

      const result = await notificationService.deleteNotification(notificationId, socket.userId);

      socket.emit('notification:deleted', {
        notificationId: result.notificationId,
        timestamp: new Date().toISOString()
      });

      if (config.debug.logEvents) {
        logger.debug(`Deleted notification ${notificationId} for user ${socket.userId}`);
      }

    } catch (error) {
      logger.error('Failed to delete notification:', error);

      socket.emit('error', {
        message: 'Failed to delete notification',
        code: 'DELETE_NOTIFICATION_ERROR',
        details: error.message
      });
    }
  }

  /**
   * Handle get notification statistics
   */
  async handleGetNotificationStats(socket) {
    try {
      const stats = await notificationService.getUserNotificationStats(socket.userId);

      socket.emit('notifications:stats', {
        stats,
        timestamp: new Date().toISOString()
      });

      if (config.debug.logEvents) {
        logger.debug(`Retrieved notification stats for user ${socket.userId}`);
      }

    } catch (error) {
      logger.error('Failed to get notification stats:', error);

      socket.emit('error', {
        message: 'Failed to retrieve notification statistics',
        code: 'GET_NOTIFICATION_STATS_ERROR',
        details: error.message
      });
    }
  }

  /**
   * Handle notification action click
   */
  async handleNotificationActionClick(socket, data) {
    try {
      const { notificationId, actionId } = data;

      if (!notificationId || !actionId) {
        socket.emit('error', {
          message: 'Notification ID and Action ID are required',
          code: 'INVALID_ACTION_DATA'
        });
        return;
      }

      const action = await notificationService.updateActionClick(notificationId, actionId, socket.userId);

      socket.emit('notification:action:clicked', {
        notificationId,
        actionId,
        clickedAt: action.clicked_at,
        timestamp: new Date().toISOString()
      });

      if (config.debug.logEvents) {
        logger.debug(`Notification action clicked: ${socket.userId} -> ${notificationId}:${actionId}`);
      }

    } catch (error) {
      logger.error('Failed to handle notification action click:', error);

      socket.emit('error', {
        message: 'Failed to process action click',
        code: 'ACTION_CLICK_ERROR',
        details: error.message
      });
    }
  }

  /**
   * Graceful shutdown
   */
  shutdown() {
    logger.info('Shutting down WebSocket server...');

    this.io.close(() => {
      logger.info('WebSocket server shut down complete');
    });

    // Close all connections
    this.connectedUsers.clear();
    this.userSockets.clear();
  }
}

module.exports = WebSocketServer;