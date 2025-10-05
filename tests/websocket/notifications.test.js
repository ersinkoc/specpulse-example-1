const { WebSocketTestSetup, createTestUser } = require('./setup');
const notificationService = require('../../src/notifications/notificationService');

describe('Notification Service', () => {
  let testSetup;
  let client;
  let mockWsServer;

  beforeAll(async () => {
    testSetup = new WebSocketTestSetup();
  });

  beforeEach(async () => {
    // Mock WebSocket server
    mockWsServer = {
      sendToUser: jest.fn(),
      sendToUsers: jest.fn(),
      broadcast: jest.fn(),
      getStats: jest.fn(() => ({
        connectedUsers: 1,
        totalConnections: 1
      }))
    };

    // Override global wsServer
    global.wsServer = mockWsServer;
  });

  afterEach(async () => {
    if (client && client.connected) {
      client.disconnect();
    }
    await testSetup.stopTestServer();
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    test('should initialize notification service', () => {
      expect(notificationService).toBeDefined();
      expect(notificationService.wsServer).toBe(mockWsServer);
    });

    test('should get service statistics', () => {
      const stats = notificationService.getStats();

      expect(stats).toHaveProperty('queuedNotifications');
      expect(stats).toHaveProperty('retryQueueSize');
      expect(stats).toHaveProperty('batchTimerActive');
      expect(stats).toHaveProperty('websocketAvailable');
    });
  });

  describe('Notification Validation', () => {
    test('should validate notification structure', () => {
      const validNotification = {
        title: 'Test Notification',
        message: 'This is a test message',
        category: 'system',
        priority: 'medium'
      };

      const validated = notificationService.validateNotification(validNotification);

      expect(validated).toHaveProperty('id');
      expect(validated).toHaveProperty('title', 'Test Notification');
      expect(validated).toHaveProperty('message', 'This is a test message');
      expect(validated).toHaveProperty('category', 'system');
      expect(validated).toHaveProperty('priority', 'medium');
      expect(validated).toHaveProperty('timestamp');
    });

    test('should reject invalid notification', () => {
      const invalidNotification = {
        title: '',
        message: 'This has no title',
        category: 'system',
        priority: 'medium'
      };

      expect(() => {
        notificationService.validateNotification(invalidNotification);
      }).toThrow('Notification title is required');
    });

    test('should reject invalid category', () => {
      const invalidNotification = {
        title: 'Test',
        message: 'Test message',
        category: 'invalid-category',
        priority: 'medium'
      };

      expect(() => {
        notificationService.validateNotification(invalidNotification);
      }).toThrow('Invalid notification category');
    });

    test('should reject invalid priority', () => {
      const invalidNotification = {
        title: 'Test',
        message: 'Test message',
        category: 'system',
        priority: 'invalid-priority'
      };

      expect(() => {
        notificationService.validateNotification(invalidNotification);
      }).toThrow('Invalid notification priority');
    });
  });

  describe('Sending Notifications', () => {
    test('should send notification to online user via WebSocket', async () => {
      // Mock WebSocket server to return true (user online)
      mockWsServer.sendToUser.mockReturnValue(true);

      const notification = {
        title: 'Test Notification',
        message: 'Test message',
        category: 'system',
        priority: 'medium'
      };

      const result = await notificationService.sendToUser('user-123', notification);

      expect(result.success).toBe(true);
      expect(result.channel).toBe('websocket');
      expect(result.notificationId).toBeDefined();
      expect(mockWsServer.sendToUser).toHaveBeenCalledWith('user-123', expect.any(Object));
    });

    test('should handle offline user', async () => {
      // Mock WebSocket server to return false (user offline)
      mockWsServer.sendToUser.mockReturnValue(false);

      const notification = {
        title: 'Test Notification',
        message: 'Test message',
        category: 'system',
        priority: 'medium'
      };

      const result = await notificationService.sendToUser('user-123', notification);

      expect(result.success).toBe(true);
      expect(result.channel).toBe('offline');
      expect(result.message).toBe('User offline - notification queued');
    });

    test('should send notifications to multiple users', async () => {
      // Mock WebSocket server to return different results for different users
      mockWsServer.sendToUser.mockImplementation((userId) => {
        return userId !== 'user-offline'; // All online except one
      });

      const notification = {
        title: 'Broadcast Notification',
        message: 'This is a broadcast',
        category: 'administrative',
        priority: 'high'
      };

      const userIds = ['user-1', 'user-2', 'user-offline', 'user-4'];
      const result = await notificationService.sendToUsers(userIds, notification);

      expect(result.success).toBe(true);
      expect(result.totalRecipients).toBe(4);
      expect(result.websocketDelivered).toBe(3);
      expect(result.offlineQueued).toBe(1);
    });

    test('should broadcast to all users', async () => {
      const notification = {
        title: 'System Announcement',
        message: 'Important system announcement',
        category: 'administrative',
        priority: 'high'
      };

      const result = await notificationService.broadcast(notification);

      expect(result.success).toBe(true);
      expect(result.channel).toBe('websocket');
      expect(mockWsServer.broadcast).toHaveBeenCalledWith(expect.any(Object));
    });
  });

  describe('Notification Queuing', () => {
    test('should queue notification for batch processing', async () => {
      const notification = {
        title: 'Queued Notification',
        message: 'This will be queued',
        category: 'task',
        priority: 'medium'
      };

      await notificationService.queueNotification('user-123', notification);

      const stats = notificationService.getStats();
      expect(stats.queuedNotifications).toBe(1);
    });

    test('should process batch notifications', async () => {
      // Mock WebSocket server
      mockWsServer.sendToUser.mockReturnValue(true);

      // Queue multiple notifications
      const notifications = [
        { title: 'Test 1', message: 'Message 1', category: 'system', priority: 'medium' },
        { title: 'Test 2', message: 'Message 2', category: 'task', priority: 'high' },
        { title: 'Test 3', message: 'Message 3', category: 'security', priority: 'low' }
      ];

      for (const notification of notifications) {
        await notificationService.queueNotification('user-123', notification);
      }

      // Process batch
      await notificationService.processBatch();

      // Verify notifications were sent
      expect(mockWsServer.sendToUser).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error Handling', () => {
    test('should handle WebSocket server errors gracefully', async () => {
      // Mock WebSocket server to throw error
      mockWsServer.sendToUser.mockImplementation(() => {
        throw new Error('WebSocket connection failed');
      });

      const notification = {
        title: 'Test Notification',
        message: 'Test message',
        category: 'system',
        priority: 'medium'
      };

      await expect(
        notificationService.sendToUser('user-123', notification)
      ).rejects.toThrow('WebSocket connection failed');
    });

    test('should handle invalid notification data', async () => {
      const invalidNotification = {
        title: '', // Empty title
        message: 'Test message',
        category: 'system',
        priority: 'medium'
      };

      await expect(
        notificationService.sendToUser('user-123', invalidNotification)
      ).rejects.toThrow('Notification title is required');
    });
  });

  describe('Utility Functions', () => {
    test('should generate unique notification IDs', () => {
      const id1 = notificationService.generateNotificationId();
      const id2 = notificationService.generateNotificationId();

      expect(id1).toMatch(/^notif_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^notif_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    test('should check if user is online', () => {
      mockWsServer.getStats.mockReturnValue({
        connectedUsers: 5,
        totalConnections: 5
      });

      const isOnline = notificationService.isUserOnline('user-123');
      expect(typeof isOnline).toBe('boolean');
    });

    test('should cleanup expired notifications', () => {
      const cleanedCount = notificationService.cleanupExpiredNotifications();
      expect(typeof cleanedCount).toBe('number');
    });
  });

  describe('Integration with WebSocket Server', () => {
    beforeEach(async () => {
      await testSetup.startTestServer();
      client = await testSetup.createAuthenticatedClient();
    });

    test('should integrate with real WebSocket server', async () => {
      // Create a simple notification service that uses the real server
      const realService = {
        sendToUser: (userId, notification) => {
          const socket = testSetup.ioServer.sockets.sockets.values().next().value;
          if (socket) {
            socket.emit('notification:receive', {
              ...notification,
              timestamp: new Date().toISOString()
            });
            return { success: true, channel: 'websocket' };
          }
          return { success: false, channel: 'none' };
        }
      };

      const notificationPromise = testSetup.waitForEvent(client, 'notification:receive');

      realService.sendToUser('test-user', {
        title: 'Integration Test',
        message: 'This is an integration test',
        category: 'system',
        priority: 'medium'
      });

      const receivedNotification = await notificationPromise;
      expect(receivedNotification.title).toBe('Integration Test');
      expect(receivedNotification.message).toBe('This is an integration test');
    });
  });
});