const { Server } = require('socket.io');
const { createServer } = require('http');
const Client = require('socket.io-client');
const jwt = require('jsonwebtoken');
const config = require('../../src/shared/config/environment');

/**
 * WebSocket Test Setup
 * Provides utilities for testing WebSocket functionality
 */

class WebSocketTestSetup {
  constructor() {
    this.httpServer = null;
    this.ioServer = null;
    this.serverUrl = null;
    this.connectedClients = [];
  }

  /**
   * Start a test WebSocket server
   */
  async startTestServer(options = {}) {
    const {
      port = 0, // Use random available port
      enableAuth = true,
      corsOrigin = 'http://localhost:3000'
    } = options;

    // Create HTTP server
    this.httpServer = createServer();

    // Create Socket.IO server
    this.ioServer = new Server(this.httpServer, {
      cors: {
        origin: corsOrigin,
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    // Setup authentication middleware if enabled
    if (enableAuth) {
      this.ioServer.use(async (socket, next) => {
        try {
          const token = socket.handshake.auth.token ||
                        socket.handshake.headers.authorization?.replace('Bearer ', '');

          if (!token) {
            return next(new Error('Authentication token required'));
          }

          // Verify token
          const decoded = jwt.verify(token, config.jwt.accessSecret);
          socket.userId = decoded.sub;
          socket.userEmail = decoded.email;
          socket.userRoles = decoded.roles || [];

          next();
        } catch (error) {
          next(new Error('Authentication failed'));
        }
      });
    }

    // Setup basic event handlers
    this.ioServer.on('connection', (socket) => {
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: new Date().toISOString() });
      });

      socket.on('test:echo', (data) => {
        socket.emit('test:echo:response', {
          ...data,
          serverTimestamp: new Date().toISOString(),
          socketId: socket.id
        });
      });

      socket.on('test:notification', (data) => {
        socket.emit('notification:receive', {
          id: `test_${Date.now()}`,
          title: data.title || 'Test Notification',
          message: data.message || 'This is a test notification',
          category: data.category || 'system',
          priority: data.priority || 'medium',
          timestamp: new Date().toISOString()
        });
      });

      socket.on('disconnect', (reason) => {
        // Handle disconnection
      });
    });

    // Start server
    return new Promise((resolve, reject) => {
      this.httpServer.listen(port, (err) => {
        if (err) {
          return reject(err);
        }

        const address = this.httpServer.address();
        this.serverUrl = `http://localhost:${address.port}`;

        resolve({
          port: address.port,
          url: this.serverUrl,
          io: this.ioServer
        });
      });
    });
  }

  /**
   * Stop the test server
   */
  async stopTestServer() {
    // Disconnect all clients
    this.connectedClients.forEach(client => {
      if (client && client.connected) {
        client.disconnect();
      }
    });
    this.connectedClients = [];

    // Close server
    if (this.ioServer) {
      this.ioServer.close();
    }

    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer.close(resolve);
      });
    }
  }

  /**
   * Create an authenticated client
   */
  async createAuthenticatedClient(userData = {}) {
    const defaultUser = {
      sub: 'test-user-id',
      email: 'test@example.com',
      roles: ['user'],
      ...userData
    };

    // Create JWT token
    const token = jwt.sign(defaultUser, config.jwt.accessSecret, {
      expiresIn: '1h',
      issuer: config.security?.jwt?.issuer || 'test',
      audience: config.security?.jwt?.audience || 'test'
    });

    return this.createClient({ token });
  }

  /**
   * Create an admin client
   */
  async createAdminClient(adminData = {}) {
    const defaultAdmin = {
      sub: 'test-admin-id',
      email: 'admin@example.com',
      roles: ['admin', 'user'],
      ...adminData
    };

    const token = jwt.sign(defaultAdmin, config.jwt.accessSecret, {
      expiresIn: '1h',
      issuer: config.security?.jwt?.issuer || 'test',
      audience: config.security?.jwt?.audience || 'test'
    });

    return this.createClient({ token });
  }

  /**
   * Create an anonymous client
   */
  async createAnonymousClient() {
    return this.createClient({});
  }

  /**
   * Create a WebSocket client
   */
  async createClient(options = {}) {
    if (!this.serverUrl) {
      throw new Error('Test server not started. Call startTestServer() first.');
    }

    const {
      token,
      transports = ['websocket'],
      timeout = 5000
    } = options;

    const clientOptions = {
      transports,
      timeout,
      forceNew: true
    };

    if (token) {
      clientOptions.auth = { token };
    }

    const client = Client(this.serverUrl, clientOptions);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Client connection timeout'));
      }, timeout);

      client.on('connect', () => {
        clearTimeout(timeoutId);
        this.connectedClients.push(client);
        resolve(client);
      });

      client.on('connect_error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });

      // Start connection
    });
  }

  /**
   * Create multiple clients for load testing
   */
  async createMultipleClients(count, clientOptions = {}) {
    const clients = [];
    const promises = [];

    for (let i = 0; i < count; i++) {
      const userData = {
        sub: `test-user-${i}`,
        email: `user${i}@example.com`,
        roles: ['user']
      };

      const promise = this.createAuthenticatedClient(userData)
        .then(client => {
          clients.push(client);
          return client;
        });

      promises.push(promise);
    }

    try {
      await Promise.all(promises);
      return clients;
    } catch (error) {
      // Cleanup any successfully created clients
      clients.forEach(client => {
        if (client.connected) {
          client.disconnect();
        }
      });
      throw error;
    }
  }

  /**
   * Wait for an event on a client
   */
  waitForEvent(client, eventName, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Event ${eventName} timeout`));
      }, timeout);

      client.once(eventName, (data) => {
        clearTimeout(timeoutId);
        resolve(data);
      });
    });
  }

  /**
   * Wait for multiple events
   */
  waitForEvents(client, events, timeout = 5000) {
    const promises = events.map(event =>
      this.waitForEvent(client, event, timeout)
    );
    return Promise.all(promises);
  }

  /**
   * Send a test notification from server
   */
  sendTestNotification(client, notification = {}) {
    const defaultNotification = {
      id: `test_${Date.now()}`,
      title: 'Test Notification',
      message: 'This is a test notification',
      category: 'system',
      priority: 'medium',
      timestamp: new Date().toISOString()
    };

    client.emit('notification:receive', { ...defaultNotification, ...notification });
  }

  /**
   * Get server statistics
   */
  getServerStats() {
    if (!this.ioServer) {
      return null;
    }

    const sockets = this.ioServer.sockets.sockets;
    return {
      connectedClients: sockets.size,
      clientIds: Array.from(sockets.keys())
    };
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    await this.stopTestServer();
    this.httpServer = null;
    this.ioServer = null;
    this.serverUrl = null;
    this.connectedClients = [];
  }
}

// Helper function to create test JWT tokens
function createTestToken(payload, expiresIn = '1h') {
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn,
    issuer: config.security?.jwt?.issuer || 'test',
    audience: config.security?.jwt?.audience || 'test'
  });
}

// Helper function to create test user data
function createTestUser(overrides = {}) {
  return {
    sub: 'test-user-id',
    email: 'test@example.com',
    roles: ['user'],
    iat: Math.floor(Date.now() / 1000),
    ...overrides
  };
}

// Helper function to create test admin data
function createTestAdmin(overrides = {}) {
  return {
    sub: 'test-admin-id',
    email: 'admin@example.com',
    roles: ['admin', 'user'],
    iat: Math.floor(Date.now() / 1000),
    ...overrides
  };
}

module.exports = {
  WebSocketTestSetup,
  createTestToken,
  createTestUser,
  createTestAdmin
};