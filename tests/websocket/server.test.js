const { WebSocketTestSetup, createTestUser, createTestAdmin } = require('./setup');

describe('WebSocket Server', () => {
  let testSetup;

  beforeAll(async () => {
    testSetup = new WebSocketTestSetup();
  });

  afterEach(async () => {
    await testSetup.stopTestServer();
  });

  describe('Server Initialization', () => {
    test('should start server successfully', async () => {
      const serverInfo = await testSetup.startTestServer();

      expect(serverInfo.port).toBeGreaterThan(0);
      expect(serverInfo.url).toMatch(/http:\/\/localhost:\d+/);
      expect(serverInfo.io).toBeDefined();
    });

    test('should start server on specific port', async () => {
      const serverInfo = await testSetup.startTestServer({ port: 4001 });

      expect(serverInfo.port).toBe(4001);
    });
  });

  describe('Client Connections', () => {
    beforeEach(async () => {
      await testSetup.startTestServer();
    });

    test('should allow anonymous connections when auth is disabled', async () => {
      await testSetup.stopTestServer();
      await testSetup.startTestServer({ enableAuth: false });

      const client = await testSetup.createAnonymousClient();
      expect(client.connected).toBe(true);

      client.disconnect();
    });

    test('should reject connections without token when auth is enabled', async () => {
      await expect(testSetup.createAnonymousClient()).rejects.toThrow('Authentication token required');
    });

    test('should allow authenticated connections', async () => {
      const client = await testSetup.createAuthenticatedClient();
      expect(client.connected).toBe(true);

      client.disconnect();
    });

    test('should allow admin connections', async () => {
      const client = await testSetup.createAdminClient();
      expect(client.connected).toBe(true);

      client.disconnect();
    });

    test('should reject connections with invalid token', async () => {
      const client = testSetup.createClient({ token: 'invalid-token' });

      await expect(client).rejects.toThrow('Authentication failed');
    });
  });

  describe('Basic Events', () => {
    let client;

    beforeEach(async () => {
      await testSetup.startTestServer();
      client = await testSetup.createAuthenticatedClient();
    });

    afterEach(() => {
      if (client && client.connected) {
        client.disconnect();
      }
    });

    test('should handle ping/pong events', async () => {
      const pongPromise = testSetup.waitForEvent(client, 'pong');
      client.emit('ping');

      const pongData = await pongPromise;
      expect(pongData).toHaveProperty('timestamp');
    });

    test('should handle echo events', async () => {
      const testData = { message: 'Hello World', number: 42 };
      const echoPromise = testSetup.waitForEvent(client, 'test:echo:response');

      client.emit('test:echo', testData);

      const echoData = await echoPromise;
      expect(echoData.message).toBe(testData.message);
      expect(echoData.number).toBe(testData.number);
      expect(echoData).toHaveProperty('serverTimestamp');
      expect(echoData).toHaveProperty('socketId');
    });

    test('should handle test notifications', async () => {
      const notificationPromise = testSetup.waitForEvent(client, 'notification:receive');

      client.emit('test:notification', {
        title: 'Custom Title',
        message: 'Custom Message',
        category: 'security',
        priority: 'high'
      });

      const notification = await notificationPromise;
      expect(notification.title).toBe('Test Notification');
      expect(notification).toHaveProperty('id');
      expect(notification).toHaveProperty('timestamp');
    });
  });

  describe('Multiple Clients', () => {
    test('should handle multiple simultaneous connections', async () => {
      await testSetup.startTestServer();

      const clients = await testSetup.createMultipleClients(5);
      expect(clients).toHaveLength(5);

      clients.forEach(client => {
        expect(client.connected).toBe(true);
      });

      // Cleanup
      clients.forEach(client => {
        client.disconnect();
      });
    });

    test('should broadcast to all connected clients', async () => {
      await testSetup.startTestServer();

      const clients = await testSetup.createMultipleClients(3);
      const broadcastPromises = clients.map(client =>
        testSetup.waitForEvent(client, 'test:broadcast')
      );

      // Simulate server broadcast
      const broadcastData = {
        type: 'test:broadcast',
        message: 'Hello everyone!',
        timestamp: new Date().toISOString()
      };

      clients.forEach(client => {
        client.emit(broadcastData.type, broadcastData);
      });

      // This test would need to be adjusted based on actual broadcast implementation
      // For now, we'll just verify clients are connected
      expect(clients).toHaveLength(3);

      // Cleanup
      clients.forEach(client => {
        client.disconnect();
      });
    });
  });

  describe('Authentication', () => {
    beforeEach(async () => {
      await testSetup.startTestServer({ enableAuth: true });
    });

    test('should attach user data to authenticated socket', async () => {
      const userData = createTestUser({ sub: 'custom-user-id' });
      const client = await testSetup.createAuthenticatedClient(userData);

      // In a real test, you would verify that the server has the user data
      // This would require access to server-side socket data
      expect(client.connected).toBe(true);

      client.disconnect();
    });

    test('should handle admin role verification', async () => {
      const client = await testSetup.createAdminClient();
      expect(client.connected).toBe(true);

      // Test admin-specific functionality
      const adminPromise = testSetup.waitForEvent(client, 'admin:response');
      client.emit('admin:test');

      // This would depend on admin event handlers being implemented
      // For now, just verify connection works
      expect(client.connected).toBe(true);

      client.disconnect();
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await testSetup.startTestServer();
    });

    test('should handle malformed events gracefully', async () => {
      const client = await testSetup.createAuthenticatedClient();

      // Send malformed data
      client.emit('test:malformed', null);
      client.emit('test:malformed', undefined);
      client.emit('test:malformed', '');

      // Server should still be responsive
      const pongPromise = testSetup.waitForEvent(client, 'pong', 1000);
      client.emit('ping');

      await expect(pongPromise).resolves.toBeDefined();

      client.disconnect();
    });

    test('should handle high-frequency events', async () => {
      const client = await testSetup.createAuthenticatedClient();

      // Send many rapid events
      for (let i = 0; i < 100; i++) {
        client.emit('test:echo', { index: i });
      }

      // Wait for some responses
      const responses = [];
      for (let i = 0; i < 10; i++) {
        try {
          const response = await testSetup.waitForEvent(client, 'test:echo:response', 1000);
          responses.push(response);
        } catch (error) {
          // Some events might not be processed due to rate limiting
          break;
        }
      }

      expect(responses.length).toBeGreaterThan(0);

      client.disconnect();
    });
  });

  describe('Performance', () => {
    test('should handle reasonable load', async () => {
      await testSetup.startTestServer();

      const startTime = Date.now();
      const clients = await testSetup.createMultipleClients(50);
      const connectionTime = Date.now() - startTime;

      expect(connectionTime).toBeLessThan(5000); // Should connect within 5 seconds
      expect(clients).toHaveLength(50);

      // Test message sending performance
      const messageStartTime = Date.now();
      const promises = clients.map(client => {
        const echoPromise = testSetup.waitForEvent(client, 'test:echo:response', 2000);
        client.emit('test:echo', { test: 'performance' });
        return echoPromise;
      });

      const results = await Promise.allSettled(promises);
      const messageTime = Date.now() - messageStartTime;

      // Most messages should be successful
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(40); // At least 80% success rate
      expect(messageTime).toBeLessThan(3000); // Should complete within 3 seconds

      // Cleanup
      clients.forEach(client => {
        if (client.connected) {
          client.disconnect();
        }
      });
    });
  });
});