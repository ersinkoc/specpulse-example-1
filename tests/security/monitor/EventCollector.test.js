/**
 * Security Tests: Event Collector
 * Tests for security event monitoring and collection
 */

const EventCollector = require('../../../src/security/monitor/EventCollector');
const Redis = require('ioredis');

// Mock Redis
jest.mock('ioredis');

describe('EventCollector', () => {
  let collector;
  let mockRedis;

  beforeEach(() => {
    mockRedis = {
      xadd: jest.fn(),
      xrange: jest.fn(),
      xlen: jest.fn(),
      xtrim: jest.fn(),
      del: jest.fn(),
      exists: jest.fn()
    };
    Redis.mockImplementation(() => mockRedis);

    collector = new EventCollector({
      redis: { host: 'localhost', port: 6379 },
      streamKey: 'security-events'
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should initialize with default configuration', () => {
      expect(collector.config).toBeDefined();
      expect(collector.config.redis.host).toBe('localhost');
      expect(collector.config.redis.port).toBe(6379);
      expect(collector.config.streamKey).toBe('security-events');
    });

    test('should accept custom configuration', () => {
      const customConfig = {
        redis: { host: 'custom-host', port: 1234 },
        streamKey: 'custom-stream'
      };

      const customCollector = new EventCollector(customConfig);
      expect(customCollector.config.redis.host).toBe('custom-host');
      expect(customCollector.config.redis.port).toBe(1234);
      expect(customCollector.config.streamKey).toBe('custom-stream');
    });
  });

  describe('collectEvent', () => {
    test('should collect security event successfully', async () => {
      const event = {
        type: 'authentication',
        subtype: 'login_attempt',
        userId: 'user123',
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0...',
        timestamp: new Date().toISOString(),
        severity: 'info',
        metadata: { loginMethod: 'password' }
      };

      mockRedis.xadd.mockResolvedValue('1234567890123-0');

      const eventId = await collector.collectEvent(event);

      expect(eventId).toBe('1234567890123-0');
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'security-events',
        '*',
        'type', event.type,
        'subtype', event.subtype,
        'userId', event.userId,
        'ip', event.ip,
        'userAgent', event.userAgent,
        'timestamp', event.timestamp,
        'severity', event.severity,
        'metadata', JSON.stringify(event.metadata)
      );
    });

    test('should validate required event fields', async () => {
      const invalidEvent = {
        // Missing required fields
        metadata: {}
      };

      await expect(collector.collectEvent(invalidEvent)).rejects.toThrow('Missing required event fields');
    });

    test('should sanitize event data', async () => {
      const eventWithSensitiveData = {
        type: 'authentication',
        subtype: 'login_attempt',
        userId: 'user123',
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0...',
        timestamp: new Date().toISOString(),
        severity: 'info',
        password: 'secret123', // Should be removed
        token: 'token456', // Should be removed
        metadata: {}
      };

      mockRedis.xadd.mockResolvedValue('1234567890123-0');

      await collector.collectEvent(eventWithSensitiveData);

      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'security-events',
        '*',
        'type', 'authentication',
        'subtype', 'login_attempt',
        'userId', 'user123',
        'ip', '192.168.1.1',
        'userAgent', 'Mozilla/5.0...',
        'timestamp', expect.any(String),
        'severity', 'info',
        expect.not.stringContaining('password'),
        expect.not.stringContaining('token')
      );
    });

    test('should handle Redis connection errors', async () => {
      const event = {
        type: 'authentication',
        subtype: 'login_attempt',
        userId: 'user123',
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0...',
        timestamp: new Date().toISOString(),
        severity: 'info',
        metadata: {}
      };

      mockRedis.xadd.mockRejectedValue(new Error('Redis connection failed'));

      await expect(collector.collectEvent(event)).rejects.toThrow('Redis connection failed');
    });
  });

  describe('getEvents', () => {
    test('should retrieve events within time range', async () => {
      const mockEvents = [
        [
          '1234567890123-0',
          'type', 'authentication',
          'subtype', 'login_attempt',
          'userId', 'user123',
          'severity', 'info'
        ],
        [
          '1234567890123-1',
          'type', 'authorization',
          'subtype', 'access_denied',
          'userId', 'user456',
          'severity', 'warning'
        ]
      ];

      mockRedis.xrange.mockResolvedValue(mockEvents);

      const startTime = new Date('2023-01-01T00:00:00Z').getTime();
      const endTime = new Date('2023-01-02T00:00:00Z').getTime();

      const events = await collector.getEvents(startTime, endTime);

      expect(mockRedis.xrange).toHaveBeenCalledWith(
        'security-events',
        startTime,
        endTime,
        'COUNT', '100'
      );
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        id: '1234567890123-0',
        type: 'authentication',
        subtype: 'login_attempt',
        userId: 'user123',
        severity: 'info'
      });
    });

    test('should handle empty event stream', async () => {
      mockRedis.xrange.mockResolvedValue([]);

      const events = await collector.getEvents(0, Date.now());

      expect(events).toEqual([]);
    });

    test('should support pagination', async () => {
      const mockEvents = [['1234567890123-0', 'type', 'test']];
      mockRedis.xrange.mockResolvedValue(mockEvents);

      await collector.getEvents(0, Date.now(), { limit: 50, offset: '1234567890123-0' });

      expect(mockRedis.xrange).toHaveBeenCalledWith(
        'security-events',
        '1234567890123-0',
        '+',
        'COUNT', '50'
      );
    });
  });

  describe('getEventStats', () => {
    test('should calculate event statistics', async () => {
      const mockEvents = [
        ['1234567890123-0', 'type', 'authentication', 'severity', 'info'],
        ['1234567890123-1', 'type', 'authentication', 'severity', 'warning'],
        ['1234567890123-2', 'type', 'authorization', 'severity', 'critical'],
        ['1234567890123-3', 'type', 'data', 'severity', 'error']
      ];

      mockRedis.xrange.mockResolvedValue(mockEvents);

      const stats = await collector.getEventStats(
        new Date('2023-01-01').getTime(),
        new Date('2023-01-02').getTime()
      );

      expect(stats).toEqual({
        total: 4,
        byType: {
          authentication: 2,
          authorization: 1,
          data: 1
        },
        bySeverity: {
          info: 1,
          warning: 1,
          critical: 1,
          error: 1
        },
        timeRange: {
          start: expect.any(Number),
          end: expect.any(Number)
        }
      });
    });

    test('should handle no events in time range', async () => {
      mockRedis.xrange.mockResolvedValue([]);

      const stats = await collector.getEventStats(0, Date.now());

      expect(stats.total).toBe(0);
      expect(stats.byType).toEqual({});
      expect(stats.bySeverity).toEqual({});
    });
  });

  describe('cleanupOldEvents', () => {
    test('should trim old events from stream', async () => {
      const cutoffTime = new Date().getTime() - (7 * 24 * 60 * 60 * 1000); // 7 days ago

      mockRedis.xtrim.mockResolvedValue(100); // Removed 100 events

      const removedCount = await collector.cleanupOldEvents(cutoffTime);

      expect(mockRedis.xtrim).toHaveBeenCalledWith(
        'security-events',
        'MINID',
        cutoffTime.toString()
      );
      expect(removedCount).toBe(100);
    });

    test('should handle cleanup errors gracefully', async () => {
      mockRedis.xtrim.mockRejectedValue(new Error('Cleanup failed'));

      await expect(collector.cleanupOldEvents(0)).rejects.toThrow('Cleanup failed');
    });
  });

  describe('event validation', () => {
    test('should validate event structure', () => {
      const validEvent = {
        type: 'authentication',
        subtype: 'login_attempt',
        userId: 'user123',
        ip: '192.168.1.1',
        timestamp: new Date().toISOString(),
        severity: 'info',
        metadata: {}
      };

      expect(collector.validateEvent(validEvent)).toBe(true);
    });

    test('should reject invalid event types', () => {
      const invalidEvent = {
        type: 'invalid_type',
        subtype: 'test',
        userId: 'user123',
        ip: '192.168.1.1',
        timestamp: new Date().toISOString(),
        severity: 'info',
        metadata: {}
      };

      expect(collector.validateEvent(invalidEvent)).toBe(false);
    });

    test('should reject invalid severity levels', () => {
      const invalidEvent = {
        type: 'authentication',
        subtype: 'login_attempt',
        userId: 'user123',
        ip: '192.168.1.1',
        timestamp: new Date().toISOString(),
        severity: 'invalid_severity',
        metadata: {}
      };

      expect(collector.validateEvent(invalidEvent)).toBe(false);
    });
  });

  describe('performance monitoring', () => {
    test('should track collection performance metrics', async () => {
      const event = {
        type: 'authentication',
        subtype: 'login_attempt',
        userId: 'user123',
        ip: '192.168.1.1',
        timestamp: new Date().toISOString(),
        severity: 'info',
        metadata: {}
      };

      mockRedis.xadd.mockResolvedValue('1234567890123-0');

      const startTime = Date.now();
      await collector.collectEvent(event);
      const endTime = Date.now();

      expect(collector.metrics.collectionCount).toBe(1);
      expect(collector.metrics.averageCollectionTime).toBeGreaterThan(0);
      expect(collector.metrics.averageCollectionTime).toBeLessThan(endTime - startTime + 100);
    });
  });

  describe('integration with other services', () => {
    test('should emit events to notification system', async () => {
      const criticalEvent = {
        type: 'authentication',
        subtype: 'privilege_escalation',
        userId: 'user123',
        ip: '192.168.1.1',
        timestamp: new Date().toISOString(),
        severity: 'critical',
        metadata: {}
      };

      const mockEmitter = {
        emit: jest.fn()
      };

      collector.setEventEmitter(mockEmitter);
      mockRedis.xadd.mockResolvedValue('1234567890123-0');

      await collector.collectEvent(criticalEvent);

      expect(mockEmitter.emit).toHaveBeenCalledWith(
        'security:critical_event',
        expect.objectContaining({
          type: 'authentication',
          severity: 'critical'
        })
      );
    });
  });
});