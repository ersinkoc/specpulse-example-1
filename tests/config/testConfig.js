/**
 * Test Configuration for WebSocket Notification System
 * Provides centralized test settings and utilities
 */

const path = require('path');
const dotenv = require('dotenv');

// Load test environment variables
dotenv.config({ path: path.join(__dirname, '../../.env.test') });

const testConfig = {
  // Server configuration
  server: {
    port: process.env.TEST_PORT || 3001,
    host: process.env.TEST_HOST || 'localhost',
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true
    }
  },

  // WebSocket configuration
  websocket: {
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true
  },

  // Authentication configuration
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'test-secret-key',
    jwtExpiration: '1h',
    algorithm: 'HS256'
  },

  // Redis configuration for testing
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    db: process.env.REDIS_TEST_DB || 15, // Use separate DB for tests
    password: process.env.REDIS_PASSWORD || null,
    connectTimeout: 10000,
    lazyConnect: true
  },

  // Database configuration for testing
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_TEST_NAME || 'notifications_test',
    username: process.env.DB_USER || 'test_user',
    password: process.env.DB_PASSWORD || 'test_password',
    ssl: false,
    maxConnections: 10,
    idleTimeoutMillis: 30000
  },

  // Test data configuration
  testData: {
    users: {
      count: 10,
      baseUser: {
        id: 'test-user-',
        username: 'testuser',
        email: 'test@example.com',
        role: 'user',
        preferences: {
          categories: {
            security: { enabled: true, priority: 'high' },
            system: { enabled: true, priority: 'medium' },
            social: { enabled: true, priority: 'low' },
            task: { enabled: true, priority: 'medium' }
          },
          quietHours: {
            enabled: false,
            start: '22:00',
            end: '08:00'
          }
        }
      }
    },
    notifications: {
      types: ['security', 'system', 'social', 'task'],
      priorities: ['low', 'medium', 'high', 'urgent'],
      categories: ['security', 'system', 'social', 'task'],
      templates: {
        security: {
          title: 'Security Alert',
          message: 'Security activity detected on your account'
        },
        system: {
          title: 'System Notification',
          message: 'System maintenance scheduled'
        },
        social: {
          title: 'Social Update',
          message: 'You have a new social notification'
        },
        task: {
          title: 'Task Update',
          message: 'Your task status has been updated'
        }
      }
    }
  },

  // Load testing configuration
  loadTesting: {
    small: {
      concurrentUsers: 10,
      duration: 10000,
      rampUpTime: 2000,
      messagesPerSecond: 5,
      connectionRate: 5
    },
    medium: {
      concurrentUsers: 100,
      duration: 30000,
      rampUpTime: 10000,
      messagesPerSecond: 20,
      connectionRate: 20
    },
    large: {
      concurrentUsers: 500,
      duration: 60000,
      rampUpTime: 20000,
      messagesPerSecond: 50,
      connectionRate: 50
    },
    stress: {
      concurrentUsers: 1000,
      duration: 120000,
      rampUpTime: 30000,
      messagesPerSecond: 100,
      connectionRate: 100
    }
  },

  // Performance thresholds
  performance: {
    latency: {
      average: 500, // ms
      p95: 1500, // ms
      p99: 3000 // ms
    },
    throughput: {
      messages: 50, // per second
      connections: 20 // per second
    },
    errorRate: 0.05, // 5%
    memory: {
      perConnection: 1024 * 1024, // 1MB per connection
      maxHeap: 1024 * 1024 * 1024 // 1GB max
    }
  },

  // Test timeouts
  timeouts: {
    connection: 5000, // 5 seconds
    message: 2000, // 2 seconds
    loadTest: 300000, // 5 minutes
    cleanup: 10000 // 10 seconds
  },

  // Test environment settings
  environment: {
    nodeEnv: 'test',
    logLevel: 'error', // Only show errors during tests
    enableMetrics: true,
    enableMonitoring: false, // Disable monitoring during tests
    enableCompression: true, // Enable compression for testing
    enableOptimization: true // Enable optimization for testing
  },

  // Mock services configuration
  mocks: {
    email: {
      enabled: process.env.MOCK_EMAIL !== 'false',
      provider: 'mock',
      sendGridApiKey: 'mock-key'
    },
    sms: {
      enabled: process.env.MOCK_SMS !== 'false',
      provider: 'mock',
      twilioAccountSid: 'mock-sid',
      twilioAuthToken: 'mock-token'
    }
  },

  // Cleanup configuration
  cleanup: {
    autoCleanup: true,
    cleanupAfterEach: true,
    cleanupAfterAll: true,
    retainData: false,
    cleanupTimeout: 10000
  },

  // Reporting configuration
  reporting: {
    generateReports: true,
    outputDir: path.join(__dirname, '../reports'),
    formats: ['json', 'html'],
    includeScreenshots: false,
    includeMetrics: true,
    includeCoverage: true
  }
};

// Test utilities
const testUtils = {
  /**
   * Generate test user data
   */
  generateTestUser: (index = 0) => {
    const baseUser = testConfig.testData.users.baseUser;
    return {
      ...baseUser,
      id: `${baseUser.id}${index}`,
      username: `${baseUser.username}${index}`,
      email: baseUser.email.replace('@', `${index}@`),
      preferences: JSON.parse(JSON.stringify(baseUser.preferences))
    };
  },

  /**
   * Generate test notification data
   */
  generateTestNotification: (type = 'system', priority = 'medium') => {
    const template = testConfig.testData.notifications.templates[type];
    return {
      type,
      title: template.title,
      message: template.message,
      priority,
      category: type,
      timestamp: new Date().toISOString(),
      id: `test-notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
  },

  /**
   * Generate JWT token for test user
   */
  generateTestToken: (user) => {
    const jwt = require('jsonwebtoken');
    return jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      },
      testConfig.auth.jwtSecret,
      {
        expiresIn: testConfig.auth.jwtExpiration,
        algorithm: testConfig.auth.algorithm
      }
    );
  },

  /**
   * Wait for specified time
   */
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Create test Redis client
   */
  createTestRedisClient: () => {
    const redis = require('redis');
    return redis.createClient({
      socket: {
        host: testConfig.redis.host,
        port: testConfig.redis.port
      },
      database: testConfig.redis.db,
      password: testConfig.redis.password
    });
  },

  /**
   * Clean up test data
   */
  cleanupTestData: async (redisClient) => {
    if (redisClient) {
      await redisClient.flushDb();
      await redisClient.quit();
    }
  },

  /**
   * Create test server
   */
  createTestServer: () => {
    const { createServer } = require('http');
    const { Server } = require('socket.io');

    const httpServer = createServer();
    const io = new Server(httpServer, {
      cors: testConfig.server.cors,
      transports: testConfig.websocket.transports,
      pingTimeout: testConfig.websocket.pingTimeout,
      pingInterval: testConfig.websocket.pingInterval
    });

    return { httpServer, io };
  },

  /**
   * Validate performance metrics
   */
  validatePerformance: (metrics, thresholds = testConfig.performance) => {
    const errors = [];

    if (metrics.avgLatency > thresholds.latency.average) {
      errors.push(`Average latency ${metrics.avgLatency}ms exceeds threshold ${thresholds.latency.average}ms`);
    }

    if (metrics.p95Latency > thresholds.latency.p95) {
      errors.push(`P95 latency ${metrics.p95Latency}ms exceeds threshold ${thresholds.latency.p95}ms`);
    }

    if (metrics.errorRate > thresholds.errorRate) {
      errors.push(`Error rate ${metrics.errorRate} exceeds threshold ${thresholds.errorRate}`);
    }

    if (metrics.messagesPerSecond < thresholds.throughput.messages) {
      errors.push(`Message throughput ${metrics.messagesPerSecond}/s below threshold ${thresholds.throughput.messages}/s`);
    }

    return {
      passed: errors.length === 0,
      errors
    };
  }
};

module.exports = {
  testConfig,
  testUtils
};