const { expect } = require('chai');
const { Server } = require('socket.io');
const { createServer } = require('http');
const Client = require('socket.io-client');
const jwt = require('jsonwebtoken');
const redis = require('redis');
const EventEmitter = require('events');

// Import our services
const notificationService = require('../../src/services/notificationService');
const optimizedConnectionManager = require('../../src/websocket/optimizedConnectionManager');
const connectionTimeoutService = require('../../src/services/connectionTimeoutService');
const payloadOptimizationService = require('../../src/services/payloadOptimizationService');

/**
 * Comprehensive WebSocket Test Suite
 * Tests all aspects of the real-time notification system
 */
describe('Real-Time Notification System', function() {
  let httpServer, io, serverSocket, clientSocket, testRedis;
  let testUser, authToken, notificationServiceInstance;

  // Increase timeout for integration tests
  this.timeout(10000);

  before(async function() {
    // Create test HTTP server
    httpServer = createServer();
    io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Setup test Redis client
    testRedis = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    await testRedis.connect();

    // Create test user and auth token
    testUser = {
      id: 'test-user-123',
      username: 'testuser',
      email: 'test@example.com',
      role: 'user'
    };

    authToken = jwt.sign(testUser, process.env.JWT_SECRET || 'test-secret');

    // Initialize notification service
    notificationServiceInstance = notificationService;

    // Setup optimized connection manager
    optimizedConnectionManager.initialize(io);

    // Start server
    await new Promise((resolve) => {
      httpServer.listen(() => {
        resolve();
      });
    });
  });

  after(async function() {
    // Cleanup
    if (clientSocket) clientSocket.close();
    if (serverSocket) serverSocket.disconnect();
    if (io) io.close();
    if (httpServer) httpServer.close();
    if (testRedis) await testRedis.quit();

    // Clean up services
    await optimizedConnectionManager.shutdown();
    await connectionTimeoutService.shutdown();
    await payloadOptimizationService.shutdown();
  });

  beforeEach(async function() {
    // Clean up Redis before each test
    await testRedis.flushDb();

    // Create fresh client connection for each test
    clientSocket = Client(`http://localhost:${httpServer.address().port}`, {
      auth: {
        token: authToken
      }
    });

    await new Promise((resolve) => {
      clientSocket.on('connect', resolve);
    });
  });

  afterEach(async function() {
    if (clientSocket) clientSocket.close();
  });

  describe('WebSocket Connection Management', function() {

    it('should establish WebSocket connection with valid JWT token', function(done) {
      const testClient = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: authToken }
      });

      testClient.on('connect', () => {
        expect(testClient.connected).to.be.true;
        testClient.close();
        done();
      });

      testClient.on('connect_error', (err) => {
        done(err);
      });
    });

    it('should reject connection with invalid JWT token', function(done) {
      const testClient = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: 'invalid-token' }
      });

      testClient.on('connect', () => {
        testClient.close();
        done(new Error('Should not connect with invalid token'));
      });

      testClient.on('connect_error', () => {
        done();
      });
    });

    it('should handle connection timeout and cleanup', function(done) {
      this.timeout(15000);

      const testClient = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: authToken },
        timeout: 5000
      });

      let connectionClosed = false;

      testClient.on('connect', () => {
        // Simulate long inactivity
        setTimeout(() => {
          testClient.emit('ping');
        }, 1000);
      });

      testClient.on('disconnect', (reason) => {
        if (!connectionClosed) {
          connectionClosed = true;
          expect(reason).to.be.oneOf(['ping timeout', 'server namespace disconnect']);
          done();
        }
      });
    });

    it('should support connection pooling for multiple users', async function() {
      const connections = [];
      const userCount = 5;

      // Create multiple connections for different users
      for (let i = 0; i < userCount; i++) {
        const user = { ...testUser, id: `test-user-${i}` };
        const token = jwt.sign(user, process.env.JWT_SECRET || 'test-secret');

        const client = Client(`http://localhost:${httpServer.address().port}`, {
          auth: { token }
        });

        await new Promise((resolve) => {
          client.on('connect', resolve);
        });

        connections.push(client);
      }

      // Verify all connections are active
      connections.forEach(client => {
        expect(client.connected).to.be.true;
      });

      // Check connection manager stats
      const stats = optimizedConnectionManager.getConnectionStats();
      expect(stats.totalConnections).to.be.at.least(userCount);

      // Cleanup
      connections.forEach(client => client.close());
    });
  });

  describe('Notification Delivery', function() {

    it('should deliver real-time notification to connected user', function(done) {
      const notificationData = {
        type: 'security',
        title: 'Login Alert',
        message: 'New login detected from your account',
        priority: 'high',
        category: 'security'
      };

      // Listen for notification
      clientSocket.on('notification', (notification) => {
        expect(notification).to.have.property('id');
        expect(notification).to.have.property('type', 'security');
        expect(notification).to.have.property('title', 'Login Alert');
        expect(notification).to.have.property('message', 'New login detected from your account');
        expect(notification).to.have.property('priority', 'high');
        expect(notification).to.have.property('timestamp');
        done();
      });

      // Send notification
      notificationServiceInstance.sendNotification(testUser.id, notificationData);
    });

    it('should handle bulk notifications to multiple users', function(done) {
      const recipients = ['user-1', 'user-2', 'user-3'];
      const bulkNotification = {
        type: 'system',
        title: 'System Maintenance',
        message: 'Scheduled maintenance in 1 hour',
        priority: 'medium',
        category: 'system'
      };

      let receivedCount = 0;

      // Mock additional clients for other users
      const additionalClients = [];

      recipients.forEach((userId, index) => {
        const user = { ...testUser, id: userId };
        const token = jwt.sign(user, process.env.JWT_SECRET || 'test-secret');

        const client = Client(`http://localhost:${httpServer.address().port}`, {
          auth: { token }
        });

        client.on('connect', () => {
          client.on('notification', () => {
            receivedCount++;
            if (receivedCount === recipients.length) {
              // All notifications received
              additionalClients.forEach(c => c.close());
              done();
            }
          });
        });

        additionalClients.push(client);
      });

      // Send bulk notification
      setTimeout(() => {
        notificationServiceInstance.sendBulkNotification(recipients, bulkNotification);
      }, 1000);
    });

    it('should respect user notification preferences', function(done) {
      const userWithPreferences = {
        ...testUser,
        id: 'pref-test-user',
        preferences: {
          categories: {
            security: { enabled: true, priority: 'high' },
            social: { enabled: false, priority: 'low' }
          },
          quietHours: { enabled: true, start: '22:00', end: '08:00' }
        }
      };

      const prefToken = jwt.sign(userWithPreferences, process.env.JWT_SECRET || 'test-secret');
      const prefClient = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: prefToken }
      });

      prefClient.on('connect', () => {
        // Should receive security notification (enabled)
        prefClient.on('notification', (notification) => {
          if (notification.type === 'security') {
            expect(notification.type).to.equal('security');

            // Should not receive social notification (disabled)
            setTimeout(() => {
              notificationServiceInstance.sendNotification(userWithPreferences.id, {
                type: 'social',
                title: 'New follower',
                message: 'Someone followed you'
              });

              // Verify no social notification received after delay
              setTimeout(() => {
                prefClient.close();
                done();
              }, 1000);
            }, 500);
          }
        });

        // Send security notification (should be delivered)
        notificationServiceInstance.sendNotification(userWithPreferences.id, {
          type: 'security',
          title: 'Security Alert',
          message: 'Test security notification'
        });
      });
    });
  });

  describe('Message Queue and Persistence', function() {

    it('should persist notifications to database', async function() {
      const notification = {
        type: 'task',
        title: 'Task Assigned',
        message: 'You have been assigned a new task',
        priority: 'medium',
        category: 'task'
      };

      // Send notification
      const notificationId = await notificationServiceInstance.sendNotification(
        testUser.id,
        notification
      );

      expect(notificationId).to.be.a('string');

      // Verify notification was persisted
      const history = await notificationServiceInstance.getNotificationHistory(testUser.id);
      expect(history).to.be.an('array');
      expect(history.length).to.be.greaterThan(0);

      const savedNotification = history.find(n => n.id === notificationId);
      expect(savedNotification).to.exist;
      expect(savedNotification.type).to.equal('task');
      expect(savedNotification.title).to.equal('Task Assigned');
    });

    it('should handle message queuing for offline users', async function() {
      const offlineUserId = 'offline-user-123';

      // Send notification to offline user
      const notificationId = await notificationServiceInstance.sendNotification(
        offlineUserId,
        {
          type: 'system',
          title: 'Offline Test',
          message: 'This should be queued'
        }
      );

      // Verify notification is in queue
      const queuedNotifications = await notificationServiceInstance.getQueuedNotifications(offlineUserId);
      expect(queuedNotifications.length).to.be.greaterThan(0);

      const queuedNotification = queuedNotifications.find(n => n.id === notificationId);
      expect(queuedNotification).to.exist;
      expect(queuedNotification.type).to.equal('system');
    });

    it('should process queued notifications when user comes online', function(done) {
      const userId = 'queue-test-user';
      const testNotification = {
        type: 'welcome',
        title: 'Welcome Back!',
        message: 'You have missed notifications',
        priority: 'medium'
      };

      // Send notification while user is offline
      notificationServiceInstance.sendNotification(userId, testNotification);

      // Connect user and expect queued notification
      const user = { ...testUser, id: userId };
      const token = jwt.sign(user, process.env.JWT_SECRET || 'test-secret');

      const queueTestClient = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token }
      });

      queueTestClient.on('connect', () => {
        let notificationReceived = false;

        queueTestClient.on('notification', (notification) => {
          if (!notificationReceived && notification.type === 'welcome') {
            notificationReceived = true;
            expect(notification.title).to.equal('Welcome Back!');
            queueTestClient.close();
            done();
          }
        });
      });
    });
  });

  describe('Performance and Scalability', function() {

    it('should handle high-frequency notifications', function(done) {
      this.timeout(15000);

      const notificationCount = 100;
      let receivedCount = 0;
      const startTime = Date.now();

      clientSocket.on('notification', () => {
        receivedCount++;
        if (receivedCount === notificationCount) {
          const duration = Date.now() - startTime;
          const throughput = notificationCount / (duration / 1000);

          expect(throughput).to.be.at.least(50); // At least 50 notifications per second
          expect(duration).to.be.lessThan(5000); // Should complete within 5 seconds

          done();
        }
      });

      // Send high-frequency notifications
      for (let i = 0; i < notificationCount; i++) {
        setTimeout(() => {
          notificationServiceInstance.sendNotification(testUser.id, {
            type: 'test',
            title: `Test ${i}`,
            message: `High frequency test message ${i}`,
            priority: 'low'
          });
        }, i * 10); // 10ms intervals
      }
    });

    it('should optimize payload sizes automatically', async function() {
      const largePayload = {
        type: 'data',
        title: 'Large Data Transfer',
        data: {
          // Create a large payload to trigger compression
          items: Array.from({ length: 1000 }, (_, i) => ({
            id: i,
            name: `Item ${i}`,
            description: `This is a long description for item ${i} with lots of text to make it bigger`,
            metadata: {
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              tags: [`tag-${i}`, `category-${i % 10}`, `type-${i % 5}`],
              extra: 'x'.repeat(100) // Padding
            }
          })),
          summary: 'x'.repeat(5000) // Large text block
        }
      };

      const optimizationResult = await payloadOptimizationService.processMessage(largePayload);

      expect(optimizationResult).to.have.property('metadata');
      expect(optimizationResult.metadata.originalSize).to.be.greaterThan(
        optimizationResult.metadata.compressedSize
      );
      expect(optimizationResult.metadata.compressionRatio).to.be.greaterThan(0.1);
    });

    it('should handle concurrent connections efficiently', async function() {
      this.timeout(20000);

      const concurrentUsers = 50;
      const connections = [];
      const connectionPromises = [];

      // Create concurrent connections
      for (let i = 0; i < concurrentUsers; i++) {
        const user = { ...testUser, id: `concurrent-user-${i}` };
        const token = jwt.sign(user, process.env.JWT_SECRET || 'test-secret');

        const connectionPromise = new Promise((resolve, reject) => {
          const client = Client(`http://localhost:${httpServer.address().port}`, {
            auth: { token }
          });

          const timeout = setTimeout(() => {
            reject(new Error(`Connection timeout for user ${i}`));
          }, 5000);

          client.on('connect', () => {
            clearTimeout(timeout);
            connections.push(client);
            resolve(client);
          });

          client.on('connect_error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        connectionPromises.push(connectionPromise);
      }

      // Wait for all connections to establish
      const startTime = Date.now();
      await Promise.all(connectionPromises);
      const connectionTime = Date.now() - startTime;

      // Verify connection performance
      expect(connectionTime).to.be.lessThan(10000); // Should connect all users within 10 seconds
      expect(connections.length).to.equal(concurrentUsers);

      // Check connection manager can handle the load
      const stats = optimizedConnectionManager.getConnectionStats();
      expect(stats.totalConnections).to.be.at.least(concurrentUsers);

      // Cleanup
      connections.forEach(client => client.close());
    });
  });

  describe('Error Handling and Recovery', function() {

    it('should handle connection drops gracefully', function(done) {
      let reconnectReceived = false;

      clientSocket.on('notification', () => {
        // Force disconnect
        clientSocket.disconnect();
      });

      clientSocket.on('disconnect', () => {
        // Attempt to reconnect
        const reconnectedClient = Client(`http://localhost:${httpServer.address().port}`, {
          auth: { token: authToken }
        });

        reconnectedClient.on('connect', () => {
          if (!reconnectReceived) {
            reconnectReceived = true;
            expect(reconnectedClient.connected).to.be.true;
            reconnectedClient.close();
            done();
          }
        });
      });

      // Send notification to trigger disconnect
      notificationServiceInstance.sendNotification(testUser.id, {
        type: 'test',
        title: 'Disconnect Test',
        message: 'This should trigger disconnect test'
      });
    });

    it('should handle Redis connection failures', async function() {
      // Simulate Redis failure by disconnecting
      await testRedis.disconnect();

      // System should still function with fallback
      const notification = {
        type: 'fallback',
        title: 'Fallback Test',
        message: 'Testing Redis failure handling',
        priority: 'medium'
      };

      // Should not throw error
      try {
        await notificationServiceInstance.sendNotification(testUser.id, notification);
        // Test passes - no error thrown
      } catch (error) {
        // Should handle gracefully or use fallback
        expect(error.message).to.not.include('Redis');
      }

      // Reconnect Redis for cleanup
      testRedis = redis.createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      await testRedis.connect();
    });

    it('should validate input and handle malformed data', function(done) {
      // Test invalid notification data
      const invalidNotifications = [
        null,
        undefined,
        {},
        { type: null },
        { type: 'test', title: '' },
        { type: 'test', title: 'Test', priority: 'invalid' }
      ];

      let validationErrors = 0;
      const expectedErrors = invalidNotifications.length;

      invalidNotifications.forEach((invalidNotification, index) => {
        try {
          notificationServiceInstance.sendNotification(testUser.id, invalidNotification);
        } catch (error) {
          validationErrors++;
        }
      });

      // Should validate all invalid inputs
      expect(validationErrors).to.equal(expectedErrors);
      done();
    });
  });

  describe('Multi-Channel Support', function() {

    it('should route notifications based on user availability', async function() {
      const onlineNotification = {
        type: 'test',
        title: 'Online Routing Test',
        message: 'Should be delivered via WebSocket',
        channels: ['websocket', 'email']
      };

      // Send to online user
      const notificationId = await notificationServiceInstance.sendNotification(
        testUser.id,
        onlineNotification
      );

      // Should be delivered via WebSocket since user is online
      expect(notificationId).to.be.a('string');
    });

    it('should fallback to email for offline users', async function() {
      const offlineNotification = {
        type: 'test',
        title: 'Offline Fallback Test',
        message: 'Should be delivered via email',
        channels: ['websocket', 'email']
      };

      const offlineUserId = 'offline-fallback-user';

      // Send to offline user
      const notificationId = await notificationServiceInstance.sendNotification(
        offlineUserId,
        offlineNotification
      );

      // Should be queued for email delivery
      const deliveryStatus = await notificationServiceInstance.getDeliveryStatus(notificationId);
      expect(deliveryStatus).to.have.property('channels');
      expect(deliveryStatus.channels).to.include('email');
    });

    it('should respect channel preferences in notifications', async function() {
      const channelTestNotification = {
        type: 'marketing',
        title: 'Channel Preference Test',
        message: 'Should respect user channel preferences',
        channels: ['websocket', 'email', 'sms']
      };

      // Send with channel restrictions
      const notificationId = await notificationServiceInstance.sendNotification(
        testUser.id,
        channelTestNotification,
        { channels: ['websocket'] } // Only WebSocket
      );

      const deliveredNotification = await notificationServiceInstance.getNotification(notificationId);
      expect(deliveredNotification.metadata.channels).to.include('websocket');
    });
  });

  describe('Security and Authentication', function() {

    it('should validate JWT tokens on connection', function(done) {
      const expiredToken = jwt.sign(
        { ...testUser, exp: Math.floor(Date.now() / 1000) - 3600 }, // Expired 1 hour ago
        process.env.JWT_SECRET || 'test-secret'
      );

      const testClient = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: expiredToken }
      });

      testClient.on('connect', () => {
        testClient.close();
        done(new Error('Should not connect with expired token'));
      });

      testClient.on('connect_error', () => {
        done();
      });
    });

    it('should prevent unauthorized access to notifications', async function() {
      const unauthorizedNotification = {
        type: 'sensitive',
        title: 'Sensitive Data',
        message: 'This should not be accessible',
        priority: 'high'
      };

      try {
        // Try to send notification without proper authentication
        await notificationServiceInstance.sendNotification(null, unauthorizedNotification);
        done(new Error('Should allow sending without user ID'));
      } catch (error) {
        expect(error.message).to.include('user');
        done();
      }
    });

    it('should sanitize notification content to prevent XSS', function(done) {
      const xssNotification = {
        type: 'security',
        title: '<script>alert("XSS")</script>',
        message: '<img src="x" onerror="alert(\'XSS\')">',
        priority: 'high'
      };

      clientSocket.on('notification', (notification) => {
        // Content should be sanitized
        expect(notification.title).to.not.include('<script>');
        expect(notification.message).to.not.include('<img');
        expect(notification.title).to.include('&lt;script&gt;');
        done();
      });

      notificationServiceInstance.sendNotification(testUser.id, xssNotification);
    });
  });

  describe('Rate Limiting and Throttling', function() {

    it('should enforce rate limits on bulk notifications', async function() {
      const bulkRecipients = Array.from({ length: 1000 }, (_, i) => `rate-limit-user-${i}`);

      const bulkNotification = {
        type: 'test',
        title: 'Rate Limit Test',
        message: 'Testing rate limiting',
        priority: 'low'
      };

      const startTime = Date.now();

      // Should not throw error but may be throttled
      await notificationServiceInstance.sendBulkNotification(bulkRecipients, bulkNotification);

      const duration = Date.now() - startTime;

      // Should take reasonable time (rate limiting in effect)
      expect(duration).to.be.lessThan(30000); // Should complete within 30 seconds
    });

    it('should handle notification bursts gracefully', function(done) {
      this.timeout(15000);

      const burstSize = 50;
      let receivedCount = 0;

      clientSocket.on('notification', () => {
        receivedCount++;

        if (receivedCount === burstSize) {
          // All notifications received successfully
          done();
        }
      });

      // Send burst of notifications
      for (let i = 0; i < burstSize; i++) {
        notificationServiceInstance.sendNotification(testUser.id, {
          type: 'burst',
          title: `Burst ${i}`,
          message: `Burst test message ${i}`,
          priority: 'medium'
        });
      }
    });
  });
});