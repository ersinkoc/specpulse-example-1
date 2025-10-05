const Redis = require('ioredis');
const logger = require('../shared/utils/logger');
const config = require('./environment');

/**
 * Redis Cluster Configuration
 * Provides high availability and scalable Redis setup with clustering support
 */
class RedisClusterManager {
  constructor() {
    this.isClusterEnabled = config.redis?.cluster?.enabled || false;
    this.cluster = null;
    this.standaloneClients = new Map();
    this.clusterNodes = config.redis?.cluster?.nodes || [];
    this.clusterOptions = {
      redisOptions: {
        password: config.redis?.password,
        db: config.redis?.db || 0,
        keyPrefix: config.redis?.keyPrefix || 'notifications:',
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keepAlive: 30000,
        connectTimeout: 10000,
        commandTimeout: 5000,
        enableReadyCheck: true,
        maxLoadingTimeout: 0,
        autoResubscribe: true,
        autoResendUnfulfilledCommands: true,
        offlineQueue: true,
        enableOfflineQueue: true,
        // Performance optimizations
        enableAutoPipelining: true,
        maxMemoryPolicy: config.redis?.maxMemoryPolicy || 'allkeys-lru',
        // Compression for large values
        compression: 'gzip',
        compressionThreshold: 1024
      },
      // Cluster-specific options
      slotsRefreshTimeout: 1000,
      slotsRefreshInterval: 5000,
      retryDelayOnClusterDown: 300,
      maxRetriesPerRequest: 3,
      scaleReads: 'slave',
      redisOptions: {
        password: config.redis?.password,
        db: config.redis?.db || 0
      }
    };

    // Monitoring and health check configuration
    this.healthCheckInterval = config.redis?.healthCheckInterval || 30000;
    this.metricsInterval = config.redis?.metricsInterval || 60000;
    this.connectionPoolSize = config.redis?.connectionPoolSize || 10;

    // Performance monitoring
    this.metrics = {
      connections: {
        active: 0,
        total: 0,
        failed: 0,
        reconnected: 0
      },
      operations: {
        commands: 0,
        errors: 0,
        latency: {
          min: Infinity,
          max: 0,
          avg: 0,
          total: 0,
          count: 0
        },
        throughput: {
          commands: 0,
          bytes: 0
        }
      },
      cluster: {
        nodes: 0,
        masterNodes: 0,
        slaveNodes: 0,
        slotsCovered: 0,
        failoverEvents: 0
      }
    };

    this.initializeCluster();
  }

  /**
   * Initialize Redis cluster or standalone clients
   */
  async initializeCluster() {
    try {
      if (this.isClusterEnabled && this.clusterNodes.length > 0) {
        await this.initializeRedisCluster();
      } else {
        await this.initializeStandaloneClients();
      }

      this.startHealthMonitoring();
      this.startMetricsCollection();

      logger.info('Redis cluster manager initialized', {
        mode: this.isClusterEnabled ? 'cluster' : 'standalone',
        nodes: this.isClusterEnabled ? this.clusterNodes.length : 1,
        connectionPoolSize: this.connectionPoolSize
      });

    } catch (error) {
      logger.error('Failed to initialize Redis cluster manager:', error);
      throw error;
    }
  }

  /**
   * Initialize Redis cluster
   */
  async initializeRedisCluster() {
    try {
      this.cluster = new Redis.Cluster(this.clusterNodes, this.clusterOptions);

      // Set up cluster event handlers
      this.setupClusterEventHandlers();

      // Wait for cluster to be ready
      await this.cluster.waitReady();

      // Get cluster information
      const clusterInfo = await this.cluster.info('cluster');
      this.parseClusterInfo(clusterInfo);

      logger.info('Redis cluster initialized successfully', {
        nodes: this.clusterNodes.length,
        slotsCovered: this.metrics.cluster.slotsCovered
      });

    } catch (error) {
      logger.error('Failed to initialize Redis cluster:', error);
      throw error;
    }
  }

  /**
   * Initialize standalone Redis clients with connection pooling
   */
  async initializeStandaloneClients() {
    try {
      // Create multiple connections for connection pooling
      const clientPromises = [];

      for (let i = 0; i < this.connectionPoolSize; i++) {
        const client = new Redis({
          host: config.redis?.host || 'localhost',
          port: config.redis?.port || 6379,
          password: config.redis?.password,
          db: config.redis?.db || 0,
          keyPrefix: config.redis?.keyPrefix || 'notifications:',
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
          lazyConnect: true,
          keepAlive: 30000,
          connectTimeout: 10000,
          commandTimeout: 5000,
          enableReadyCheck: true,
          enableAutoPipelining: true,
          compression: 'gzip',
          compressionThreshold: 1024
        });

        this.setupClientEventHandlers(client, `client-${i}`);
        clientPromises.push(client.connect());

        this.standaloneClients.set(`client-${i}`, client);
      }

      await Promise.all(clientPromises);

      logger.info('Standalone Redis clients initialized', {
        poolSize: this.connectionPoolSize
      });

    } catch (error) {
      logger.error('Failed to initialize standalone Redis clients:', error);
      throw error;
    }
  }

  /**
   * Set up cluster event handlers
   */
  setupClusterEventHandlers() {
    this.cluster.on('connect', () => {
      this.metrics.connections.active++;
      this.metrics.connections.total++;
      logger.debug('Redis cluster connected');
    });

    this.cluster.on('ready', () => {
      logger.info('Redis cluster ready');
    });

    this.cluster.on('error', (error) => {
      this.metrics.operations.errors++;
      logger.error('Redis cluster error:', error);
    });

    this.cluster.on('close', () => {
      this.metrics.connections.active--;
      logger.warn('Redis cluster connection closed');
    });

    this.cluster.on('reconnecting', () => {
      this.metrics.connections.reconnected++;
      logger.info('Redis cluster reconnecting');
    });

    this.cluster.on('node error', (error, node) => {
      logger.error('Redis cluster node error:', { error, node });
    });

    this.cluster.on('+node', (node) => {
      logger.info('Redis node added to cluster:', node);
      this.updateClusterNodeCount();
    });

    this.cluster.on('-node', (node) => {
      logger.warn('Redis node removed from cluster:', node);
      this.updateClusterNodeCount();
    });

    this.cluster.on('failover', (servers) => {
      this.metrics.cluster.failoverEvents++;
      logger.warn('Redis cluster failover:', servers);
    });

    // Monitor command performance
    this.cluster.on('command', (command) => {
      this.recordCommandLatency(command.name, Date.now());
    });

    this.cluster.on('commandError', (command, error) => {
      this.metrics.operations.errors++;
      logger.error('Redis command error:', { command: command.name, error });
    });
  }

  /**
   * Set up client event handlers for standalone clients
   */
  setupClientEventHandlers(client, clientId) {
    client.on('connect', () => {
      this.metrics.connections.active++;
      this.metrics.connections.total++;
      logger.debug(`Redis client ${clientId} connected`);
    });

    client.on('ready', () => {
      logger.debug(`Redis client ${clientId} ready`);
    });

    client.on('error', (error) => {
      this.metrics.operations.errors++;
      logger.error(`Redis client ${clientId} error:`, error);
    });

    client.on('close', () => {
      this.metrics.connections.active--;
      logger.warn(`Redis client ${clientId} connection closed`);
    });

    client.on('reconnecting', () => {
      this.metrics.connections.reconnected++;
      logger.info(`Redis client ${clientId} reconnecting`);
    });

    // Monitor command performance
    client.on('command', (command) => {
      this.recordCommandLatency(command.name, Date.now());
    });

    client.on('commandError', (command, error) => {
      this.metrics.operations.errors++;
      logger.error(`Redis client ${clientId} command error:`, { command: command.name, error });
    });
  }

  /**
   * Get Redis client (from cluster or connection pool)
   */
  getClient() {
    if (this.isClusterEnabled && this.cluster) {
      return this.cluster;
    }

    // Round-robin selection from connection pool
    const clientIds = Array.from(this.standaloneClients.keys());
    if (clientIds.length === 0) {
      throw new Error('No Redis clients available');
    }

    const selectedIndex = Math.floor(Math.random() * clientIds.length);
    const selectedClient = this.standaloneClients.get(clientIds[selectedIndex]);

    if (!selectedClient || selectedClient.status !== 'ready') {
      // Try to find another ready client
      for (const clientId of clientIds) {
        const client = this.standaloneClients.get(clientId);
        if (client && client.status === 'ready') {
          return client;
        }
      }
      throw new Error('No ready Redis clients available');
    }

    return selectedClient;
  }

  /**
   * Execute command with performance tracking
   */
  async executeCommand(command, ...args) {
    const startTime = Date.now();
    let client;

    try {
      client = this.getClient();
      this.metrics.operations.commands++;

      const result = await client[command](...args);

      // Record successful command
      const latency = Date.now() - startTime;
      this.recordCommandLatency(command, latency);
      this.metrics.operations.throughput.commands++;

      return result;

    } catch (error) {
      this.metrics.operations.errors++;
      logger.error('Redis command failed:', { command, args, error });
      throw error;
    }
  }

  /**
   * Publish message with performance tracking
   */
  async publish(channel, message) {
    const startTime = Date.now();
    try {
      const client = this.getClient();
      const result = await client.publish(channel, message);

      const latency = Date.now() - startTime;
      this.recordCommandLatency('publish', latency);

      return result;
    } catch (error) {
      logger.error('Redis publish failed:', error);
      throw error;
    }
  }

  /**
   * Subscribe to channel with performance tracking
   */
  async subscribe(channel, callback) {
    try {
      const client = this.getClient();
      await client.subscribe(channel, callback);

      logger.debug(`Subscribed to Redis channel: ${channel}`);
    } catch (error) {
      logger.error('Redis subscribe failed:', error);
      throw error;
    }
  }

  /**
   * Record command latency for metrics
   */
  recordCommandLatency(command, latency) {
    const latencyMetrics = this.metrics.operations.latency;

    latencyMetrics.min = Math.min(latencyMetrics.min, latency);
    latencyMetrics.max = Math.max(latencyMetrics.max, latency);
    latencyMetrics.total += latency;
    latencyMetrics.count++;
    latencyMetrics.avg = latencyMetrics.total / latencyMetrics.count;
  }

  /**
   * Parse cluster information
   */
  parseClusterInfo(clusterInfo) {
    const lines = clusterInfo.split('\r\n');

    for (const line of lines) {
      if (line.startsWith('cluster_known_nodes:')) {
        this.metrics.cluster.nodes = parseInt(line.split(':')[1]);
      } else if (line.startsWith('cluster_size:')) {
        this.metrics.cluster.masterNodes = parseInt(line.split(':')[1]);
      }
    }

    this.metrics.cluster.slotsCovered = 16384; // Redis has 16384 slots
  }

  /**
   * Update cluster node count
   */
  async updateClusterNodeCount() {
    if (this.cluster) {
      try {
        const nodes = this.cluster.nodes();
        this.metrics.cluster.nodes = nodes.length;
        this.metrics.cluster.masterNodes = nodes.filter(node => node.options.readOnly !== true).length;
        this.metrics.cluster.slaveNodes = nodes.filter(node => node.options.readOnly === true).length;
      } catch (error) {
        logger.error('Failed to update cluster node count:', error);
      }
    }
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('Redis health check failed:', error);
      }
    }, this.healthCheckInterval);
  }

  /**
   * Perform health check
   */
  async performHealthCheck() {
    const healthCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      cluster: this.isClusterEnabled,
      nodes: 0,
      connections: {
        active: this.metrics.connections.active,
        total: this.metrics.connections.total
      },
      performance: {
        avgLatency: this.metrics.operations.latency.avg,
        errorRate: this.calculateErrorRate(),
        throughput: this.calculateThroughput()
      }
    };

    if (this.isClusterEnabled && this.cluster) {
      try {
        // Test cluster connectivity
        await this.cluster.ping();
        healthCheck.nodes = this.cluster.nodes().length;
        healthCheck.status = 'healthy';
      } catch (error) {
        healthCheck.status = 'unhealthy';
        logger.error('Cluster health check failed:', error);
      }
    } else {
      // Test standalone clients
      let healthyClients = 0;
      for (const [id, client] of this.standaloneClients) {
        try {
          await client.ping();
          healthyClients++;
        } catch (error) {
          logger.warn(`Client ${id} health check failed:`, error);
        }
      }

      healthCheck.nodes = healthyClients;
      healthCheck.status = healthyClients > 0 ? 'healthy' : 'unhealthy';
    }

    // Emit health status
    process.emit('redis:health', healthCheck);
  }

  /**
   * Start metrics collection
   */
  startMetricsCollection() {
    setInterval(() => {
      try {
        this.collectDetailedMetrics();
      } catch (error) {
        logger.error('Redis metrics collection failed:', error);
      }
    }, this.metricsInterval);
  }

  /**
   * Collect detailed metrics
   */
  async collectDetailedMetrics() {
    const metrics = {
      timestamp: Date.now(),
      connections: this.metrics.connections,
      operations: this.metrics.operations,
      cluster: this.metrics.cluster,
      memory: await this.getMemoryInfo(),
      performance: await this.getPerformanceInfo()
    };

    // Emit metrics event
    process.emit('redis:metrics', metrics);
  }

  /**
   * Get memory information
   */
  async getMemoryInfo() {
    try {
      const client = this.getClient();
      const info = await client.info('memory');
      const memoryInfo = {};

      info.split('\r\n').forEach(line => {
        if (line.includes('used_memory:')) {
          memoryInfo.used = parseInt(line.split(':')[1]);
        } else if (line.includes('used_memory_human:')) {
          memoryInfo.usedHuman = line.split(':')[1];
        } else if (line.includes('used_memory_rss:')) {
          memoryInfo.rss = parseInt(line.split(':')[1]);
        }
      });

      return memoryInfo;
    } catch (error) {
      logger.error('Failed to get Redis memory info:', error);
      return {};
    }
  }

  /**
   * Get performance information
   */
  async getPerformanceInfo() {
    try {
      const client = this.getClient();
      const info = await client.info('stats');
      const performanceInfo = {};

      info.split('\r\n').forEach(line => {
        if (line.includes('instantaneous_ops_per_sec:')) {
          performanceInfo.opsPerSec = parseInt(line.split(':')[1]);
        } else if (line.includes('total_commands_processed:')) {
          performanceInfo.totalCommands = parseInt(line.split(':')[1]);
        }
      });

      return performanceInfo;
    } catch (error) {
      logger.error('Failed to get Redis performance info:', error);
      return {};
    }
  }

  /**
   * Calculate error rate
   */
  calculateErrorRate() {
    const total = this.metrics.operations.commands;
    const errors = this.metrics.operations.errors;
    return total > 0 ? errors / total : 0;
  }

  /**
   * Calculate throughput
   */
  calculateThroughput() {
    return this.metrics.operations.throughput.commands;
  }

  /**
   * Get comprehensive metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      errorRate: this.calculateErrorRate(),
      throughput: this.calculateThroughput(),
      timestamp: Date.now()
    };
  }

  /**
   * Shutdown Redis connections
   */
  async shutdown() {
    logger.info('Shutting down Redis cluster manager');

    try {
      if (this.cluster) {
        await this.cluster.disconnect();
      }

      for (const [id, client] of this.standaloneClients) {
        await client.disconnect();
      }

      this.standaloneClients.clear();

      logger.info('Redis cluster manager shutdown complete');
    } catch (error) {
      logger.error('Error during Redis shutdown:', error);
    }
  }
}

// Create singleton instance
const redisClusterManager = new RedisClusterManager();

module.exports = redisClusterManager;