const tokenService = require('../auth/services/tokenService');
const authService = require('../auth/services/authService');
const logger = require('../shared/utils/logger');

/**
 * WebSocket Authentication Middleware
 * Authenticates WebSocket connections using JWT tokens
 */
class WebSocketAuthMiddleware {
  constructor() {
    this.authenticatedSockets = new Map(); // socketId -> user data
    this.userSockets = new Map(); // userId -> Set of socketIds
  }

  /**
   * Authenticate WebSocket connection
   */
  async authenticate(socket, next) {
    try {
      // Extract token from handshake
      const token = this.extractToken(socket.handshake);

      if (!token) {
        return next(new Error('Authentication token is required'));
      }

      // Verify the token
      const decoded = tokenService.verifyToken(token, 'access');

      // Get user information from database
      const user = await authService.getUserById(decoded.sub);

      if (!user) {
        return next(new Error('User not found'));
      }

      if (!user.isActive) {
        return next(new Error('User account is inactive'));
      }

      // Attach user information to socket
      socket.userId = user.id;
      socket.userEmail = user.email;
      socket.userRoles = user.roles || [];
      socket.user = user.toJSON();
      socket.token = decoded;

      // Track authenticated socket
      this.trackSocket(socket);

      logger.info('WebSocket connection authenticated', {
        socketId: socket.id,
        userId: user.id,
        email: user.email,
        roles: user.roles
      });

      next();

    } catch (error) {
      logger.warn('WebSocket authentication failed:', {
        socketId: socket.id,
        error: error.message
      });

      if (error.message.includes('expired')) {
        return next(new Error('Access token has expired'));
      }

      if (error.message.includes('Invalid token') || error.message.includes('blacklisted')) {
        return next(new Error('Invalid or expired access token'));
      }

      return next(new Error('Authentication failed'));
    }
  }

  /**
   * Optional authentication - doesn't block if token is invalid
   */
  async optionalAuthenticate(socket, next) {
    try {
      const token = this.extractToken(socket.handshake);

      if (!token) {
        // No token provided, allow connection as anonymous
        socket.userId = 'anonymous';
        socket.userRoles = ['anonymous'];
        return next();
      }

      // Try to verify the token
      const decoded = tokenService.verifyToken(token, 'access');
      const user = await authService.getUserById(decoded.sub);

      if (user && user.isActive) {
        socket.userId = user.id;
        socket.userEmail = user.email;
        socket.userRoles = user.roles || [];
        socket.user = user.toJSON();
        socket.token = decoded;

        this.trackSocket(socket);

        logger.info('WebSocket connection optionally authenticated', {
          socketId: socket.id,
          userId: user.id,
          email: user.email
        });
      } else {
        // Token invalid, allow as anonymous
        socket.userId = 'anonymous';
        socket.userRoles = ['anonymous'];
      }

      next();

    } catch (error) {
      // Log error but don't block the connection
      logger.debug('Optional WebSocket authentication failed:', {
        socketId: socket.id,
        error: error.message
      });

      // Allow connection as anonymous
      socket.userId = 'anonymous';
      socket.userRoles = ['anonymous'];
      next();
    }
  }

  /**
   * Check if user has required role
   */
  hasRole(socket, requiredRole) {
    if (!socket.userRoles) {
      return false;
    }

    return socket.userRoles.includes(requiredRole);
  }

  /**
   * Check if user has any of the required roles
   */
  hasAnyRole(socket, requiredRoles) {
    if (!socket.userRoles || !Array.isArray(requiredRoles)) {
      return false;
    }

    return requiredRoles.some(role => socket.userRoles.includes(role));
  }

  /**
   * Check if user is admin
   */
  isAdmin(socket) {
    return this.hasRole(socket, 'admin');
  }

  /**
   * Check if user can access resource (self or admin)
   */
  canAccessResource(socket, resourceUserId) {
    if (this.isAdmin(socket)) {
      return true;
    }

    return socket.userId === resourceUserId;
  }

  /**
   * Extract token from various sources
   */
  extractToken(handshake) {
    // Try Authorization header first
    const authHeader = handshake.headers.authorization;
    if (authHeader) {
      return tokenService.extractTokenFromHeader(authHeader);
    }

    // Try auth query parameter
    if (handshake.query && handshake.query.token) {
      return handshake.query.token;
    }

    // Try auth field in handshake data
    if (handshake.auth && handshake.auth.token) {
      return handshake.auth.token;
    }

    return null;
  }

  /**
   * Track authenticated socket
   */
  trackSocket(socket) {
    // Track socket by ID
    this.authenticatedSockets.set(socket.id, {
      userId: socket.userId,
      email: socket.userEmail,
      roles: socket.userRoles,
      connectedAt: new Date(),
      socket: socket
    });

    // Track user's sockets
    if (!this.userSockets.has(socket.userId)) {
      this.userSockets.set(socket.userId, new Set());
    }
    this.userSockets.get(socket.userId).add(socket.id);
  }

  /**
   * Untrack socket when disconnected
   */
  untrackSocket(socket) {
    const socketId = socket.id;
    const userId = socket.userId;

    // Remove from authenticated sockets
    this.authenticatedSockets.delete(socketId);

    // Remove from user's sockets
    if (this.userSockets.has(userId)) {
      this.userSockets.get(userId).delete(socketId);
      if (this.userSockets.get(userId).size === 0) {
        this.userSockets.delete(userId);
      }
    }

    logger.debug('Socket untracked', {
      socketId,
      userId
    });
  }

  /**
   * Get all sockets for a user
   */
  getUserSockets(userId) {
    const socketIds = this.userSockets.get(userId);
    if (!socketIds) {
      return [];
    }

    return Array.from(socketIds).map(socketId => {
      const socketData = this.authenticatedSockets.get(socketId);
      return socketData ? socketData.socket : null;
    }).filter(socket => socket !== null);
  }

  /**
   * Get socket count for a user
   */
  getUserSocketCount(userId) {
    const socketIds = this.userSockets.get(userId);
    return socketIds ? socketIds.size : 0;
  }

  /**
   * Get all authenticated users
   */
  getAuthenticatedUsers() {
    const users = new Map();

    for (const [socketId, socketData] of this.authenticatedSockets) {
      const userId = socketData.userId;
      if (!users.has(userId)) {
        users.set(userId, {
          userId,
          email: socketData.email,
          roles: socketData.roles,
          socketCount: 0,
          connectedAt: socketData.connectedAt,
          socketIds: []
        });
      }

      const user = users.get(userId);
      user.socketCount++;
      user.socketIds.push(socketId);
    }

    return Array.from(users.values());
  }

  /**
   * Get authentication statistics
   */
  getStats() {
    return {
      totalAuthenticatedSockets: this.authenticatedSockets.size,
      totalAuthenticatedUsers: this.userSockets.size,
      anonymousConnections: this.getAnonymousConnectionCount(),
      userConnections: this.authenticatedSockets.size - this.getAnonymousConnectionCount()
    };
  }

  /**
   * Get anonymous connection count
   */
  getAnonymousConnectionCount() {
    let count = 0;
    for (const [socketId, socketData] of this.authenticatedSockets) {
      if (socketData.userId === 'anonymous') {
        count++;
      }
    }
    return count;
  }

  /**
   * Check if user is rate limited for WebSocket events
   */
  isRateLimited(socket, eventType) {
    // Basic rate limiting - in production, use Redis for distributed rate limiting
    const userId = socket.userId;
    const key = `${userId}:${eventType}`;
    const windowMs = 60000; // 1 minute
    const maxEvents = 100; // 100 events per minute per user

    // This is a simple in-memory implementation
    // In production, replace with Redis-based rate limiting
    if (!this.rateLimitMap) {
      this.rateLimitMap = new Map();
    }

    const now = Date.now();
    const userEvents = this.rateLimitMap.get(key) || [];

    // Remove events outside the time window
    const validEvents = userEvents.filter(timestamp => now - timestamp < windowMs);

    if (validEvents.length >= maxEvents) {
      return true;
    }

    // Add current event
    validEvents.push(now);
    this.rateLimitMap.set(key, validEvents);

    return false;
  }

  /**
   * Log authentication event
   */
  logAuthEvent(socket, event, data = {}) {
    logger.info(`WebSocket auth event: ${event}`, {
      socketId: socket.id,
      userId: socket.userId,
      email: socket.userEmail,
      roles: socket.userRoles,
      timestamp: new Date().toISOString(),
      ...data
    });
  }

  /**
   * Validate WebSocket connection health
   */
  validateConnection(socket) {
    // Check if socket is still connected
    if (!socket.connected) {
      return false;
    }

    // Check if user is still active (for authenticated sockets)
    if (socket.userId !== 'anonymous') {
      // In a real implementation, you might check against a database
      // to ensure the user account is still active
      return true;
    }

    return true;
  }

  /**
   * Clean up inactive connections
   */
  cleanupInactiveConnections() {
    const now = Date.now();
    const inactiveThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [socketId, socketData] of this.authenticatedSockets) {
      const timeSinceConnection = now - socketData.connectedAt.getTime();

      if (timeSinceConnection > inactiveThreshold) {
        const socket = socketData.socket;
        if (socket && !socket.connected) {
          this.untrackSocket(socket);
          logger.debug('Cleaned up inactive socket', { socketId });
        }
      }
    }
  }

  /**
   * Refresh user data for all user's sockets
   */
  async refreshUserData(userId) {
    try {
      const user = await authService.getUserById(userId);
      if (!user || !user.isActive) {
        // User no longer exists or is inactive, disconnect all sockets
        const sockets = this.getUserSockets(userId);
        sockets.forEach(socket => {
          socket.emit('force_disconnect', {
            reason: 'user_account_inactive',
            message: 'Your account is no longer active'
          });
          socket.disconnect(true);
        });
        return;
      }

      // Update user data on all sockets
      const sockets = this.getUserSockets(userId);
      sockets.forEach(socket => {
        socket.user = user.toJSON();
        socket.userRoles = user.roles || [];
      });

      logger.info(`Refreshed user data for ${sockets.length} sockets`, { userId });

    } catch (error) {
      logger.error('Failed to refresh user data:', error);
    }
  }
}

// Create singleton instance
const wsAuthMiddleware = new WebSocketAuthMiddleware();

module.exports = wsAuthMiddleware;