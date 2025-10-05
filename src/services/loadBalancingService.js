const EventEmitter = require('events');
const logger = require('../shared/utils/logger');
const os = require('os');

/**
 * Load Balancing Service
 * Provides intelligent load balancing for WebSocket connections across multiple server instances
 */
class LoadBalancingService extends EventEmitter {
  constructor() {
    super();

    this.isEnabled = true;
    this.strategy = 'least_connections'; // least_connections, round_robin, weighted, hash
    this.stickySessions = true;
    this.healthCheckInterval = 30000; // 30 seconds
    this.maxRetries = 3;
    this.retryDelay = 1000;

    // Server pool
    this.servers = new Map(); // serverId -> server info
    this.serverGroups = new Map(); // groupName -> Set of serverIds
    this.currentServerIndex = 0;

    // Health and performance tracking
    this.serverHealth = new Map(); // serverId -> health status
    this.serverMetrics = new Map(); // serverId -> performance metrics
    this.connectionDistribution = new Map(); // serverId -> connection count

    // Load balancing algorithms
    this.algorithms = {
      round_robin: this.roundRobin.bind(this),
      least_connections: this.leastConnections.bind(this),
      weighted: this.weighted.bind(this),
      hash: this.hash.bind(this),
      random: this.random.bind(this),
     地理位置: this.geoLocation.bind(this)
    };

    // Configuration
    this.config = {
      maxConnectionsPerServer: 5000,
      healthCheckTimeout: 5000,
      unhealthyThreshold: 3,
      healthyThreshold: 2,
      weightUpdateInterval: 60000, // 1 minute
      sessionAffinityTimeout: 30 * 60 * 1000 // 30 minutes
    };

    // Initialize load balancer
    this.initialize();
  }

  /**
   * Initialize the load balancing service
   */
  initialize() {
    try {
      // Register current server
      this.registerCurrentServer();

      // Discover other servers (if in cluster mode)
      this.discoverServers();

      // Start health monitoring
      this.startHealthMonitoring();

      // Start metrics collection
      this.startMetricsCollection();

      // Start server discovery
      this.startServerDiscovery();

      logger.info('Load balancing service initialized', {
        strategy: this.strategy,
        serversCount: this.servers.size,
        stickySessions: this.stickySessions
      });

    } catch (error) {
      logger.error('Failed to initialize load balancing service:', error);
    }
  }

  /**
   * Register current server instance
   */
  registerCurrentServer() {
    const serverId = this.getServerId();
    const serverInfo = {
      id: serverId,
      host: this.getServerHost(),
      port: process.env.PORT || 3000,
      protocol: 'ws',
      region: process.env.AWS_REGION || 'us-east-1',
      availabilityZone: process.env.AWS_AVAILABILITY_ZONE || 'us-east-1a',
      instanceType: process.env.INSTANCE_TYPE || 'unknown',
      weight: 1,
      isActive: true,
      registeredAt: new Date().toISOString(),
      lastHealthCheck: new Date().toISOString(),
      connections: 0,
      maxConnections: this.config.maxConnectionsPerServer,
      cpuUsage: 0,
      memoryUsage: 0,
      responseTime: 0,
      errorRate: 0
    };

    this.servers.set(serverId, serverInfo);
    this.serverHealth.set(serverId, { status: 'healthy', lastCheck: Date.now() });
    this.connectionDistribution.set(serverId, 0);

    logger.info('Current server registered', { serverId, host: serverInfo.host });
  }

  /**
   * Discover other servers in the cluster
   */
  async discoverServers() {
    try {
      // In a real implementation, this would use service discovery (Consul, etcd, Kubernetes API, etc.)
      // For now, we'll simulate server discovery using environment variables or configuration

      const peerServers = process.env.PEER_SERVERS ?
        process.env.PEER_SERVERS.split(',') : [];

      for (const peerServer of peerServers) {
        const [host, port] = peerServer.split(':');
        if (host && port) {
          await this.addServer({
            host: host.trim(),
            port: parseInt(port.trim()),
            protocol: 'ws',
            weight: 1
          });
        }
      }

      logger.info(`Discovered ${peerServers.length} peer servers`);

    } catch (error) {
      logger.error('Failed to discover servers:', error);
    }
  }

  /**
   * Add a server to the load balancer pool
   */
  async addServer(serverInfo) {
    try {
      const serverId = serverInfo.id || this.generateServerId(serverInfo);

      const fullServerInfo = {
        id: serverId,
        host: serverInfo.host,
        port: serverInfo.port,
        protocol: serverInfo.protocol || 'ws',
        region: serverInfo.region || 'us-east-1',
        availabilityZone: serverInfo.availabilityZone || 'us-east-1a',
        instanceType: serverInfo.instanceType || 'unknown',
        weight: serverInfo.weight || 1,
        isActive: true,
        registeredAt: new Date().toISOString(),
        lastHealthCheck: new Date().toISOString(),
        connections: 0,
        maxConnections: serverInfo.maxConnections || this.config.maxConnectionsPerServer,
        cpuUsage: 0,
        memoryUsage: 0,
        responseTime: 0,
        errorRate: 0,
        ...serverInfo
      };

      this.servers.set(serverId, fullServerInfo);
      this.serverHealth.set(serverId, { status: 'unknown', lastCheck: 0 });
      this.connectionDistribution.set(serverId, 0);

      // Perform initial health check
      await this.checkServerHealth(serverId);

      logger.info('Server added to load balancer', {
        serverId,
        host: fullServerInfo.host,
        port: fullServerInfo.port
      });

      this.emit('server:added', { serverId, serverInfo: fullServerInfo });

      return serverId;

    } catch (error) {
      logger.error('Failed to add server:', error);
      throw error;
    }
  }

  /**
   * Remove a server from the load balancer pool
   */
  async removeServer(serverId) {
    try {
      if (this.servers.has(serverId)) {
        this.servers.delete(serverId);
        this.serverHealth.delete(serverId);
        this.connectionDistribution.delete(serverId);

        logger.info('Server removed from load balancer', { serverId });
        this.emit('server:removed', { serverId });
      }
    } catch (error) {
      logger.error(`Failed to remove server ${serverId}:`, error);
    }
  }

  /**
   * Select the best server for a new connection
   */
  selectServer(userId, connectionInfo = {}) {
    try {
      if (!this.isEnabled || this.servers.size === 0) {
        return this.getCurrentServer();
      }

      // Check for sticky session
      if (this.stickySessions && userId) {
        const stickyServer = this.getStickyServer(userId);
        if (stickyServer && this.isServerHealthy(stickyServer)) {
          return stickyServer;
        }
      }

      // Use configured load balancing algorithm
      const algorithm = this.algorithms[this.strategy];
      if (algorithm) {
        return algorithm(userId, connectionInfo);
      }

      // Fallback to round-robin
      return this.roundRobin(userId, connectionInfo);

    } catch (error) {
      logger.error('Failed to select server:', error);
      return this.getCurrentServer();
    }
  }

  /**
   * Round-robin load balancing
   */
  roundRobin(userId, connectionInfo) {
    const healthyServers = this.getHealthyServers();
    if (healthyServers.length === 0) {
      return this.getCurrentServer();
    }

    const server = healthyServers[this.currentServerIndex % healthyServers.length];
    this.currentServerIndex++;
    return server.id;
  }

  /**
   * Least connections load balancing
   */
  leastConnections(userId, connectionInfo) {
    const healthyServers = this.getHealthyServers();
    if (healthyServers.length === 0) {
      return this.getCurrentServer();
    }

    // Sort by connection count
    healthyServers.sort((a, b) => {
      const aConnections = this.connectionDistribution.get(a.id) || 0;
      const bConnections = this.connectionDistribution.get(b.id) || 0;
      return aConnections - bConnections;
    });

    return healthyServers[0].id;
  }

  /**
   * Weighted load balancing
   */
  weighted(userId, connectionInfo) {
    const healthyServers = this.getHealthyServers();
    if (healthyServers.length === 0) {
      return this.getCurrentServer();
    }

    // Calculate total weight
    const totalWeight = healthyServers.reduce((sum, server) => sum + server.weight, 0);
    let random = Math.random() * totalWeight;

    // Select server based on weight
    for (const server of healthyServers) {
      random -= server.weight;
      if (random <= 0) {
        return server.id;
      }
    }

    return healthyServers[0].id;
  }

  /**
   * Hash-based load balancing (consistent hashing)
   */
  hash(userId, connectionInfo) {
    const healthyServers = this.getHealthyServers();
    if (healthyServers.length === 0) {
      return this.getCurrentServer();
    }

    // Simple hash implementation (in production, use consistent hashing ring)
    const hash = this.simpleHash(userId.toString());
    const index = hash % healthyServers.length;
    return healthyServers[index].id;
  }

  /**
   * Random load balancing
   */
  random(userId, connectionInfo) {
    const healthyServers = this.getHealthyServers();
    if (healthyServers.length === 0) {
      return this.getCurrentServer();
    }

    const randomIndex = Math.floor(Math.random() * healthyServers.length);
    return healthyServers[randomIndex].id;
  }

  /**
   * Geographic location-based load balancing
   */
  geoLocation(userId, connectionInfo) {
    // This would use geolocation data to route to nearest server
    // For now, fallback to least connections
    return this.leastConnections(userId, connectionInfo);
  }

  /**
   * Get sticky server for a user
   */
  getStickyServer(userId) {
    try {
      // Use Redis or distributed cache for sticky sessions
      // For now, use a simple in-memory map with hashing
      const hash = this.simpleHash(userId.toString());
      const serverIds = Array.from(this.servers.keys());

      if (serverIds.length === 0) {
        return null;
      }

      const index = hash % serverIds.length;
      return serverIds[index];
    } catch (error) {
      logger.error('Failed to get sticky server:', error);
      return null;
    }
  }

  /**
   * Set sticky server for a user
   */
  setStickyServer(userId, serverId) {
    try {
      // In a real implementation, store in Redis or distributed cache
      logger.debug(`Sticky session set for user ${userId} -> server ${serverId}`);
    } catch (error) {
      logger.error('Failed to set sticky server:', error);
    }
  }

  /**
   * Record connection assignment
   */
  recordConnection(serverId, userId) {
    try {
      const currentCount = this.connectionDistribution.get(serverId) || 0;
      this.connectionDistribution.set(serverId, currentCount + 1);

      // Update server info
      const server = this.servers.get(serverId);
      if (server) {
        server.connections = currentCount + 1;
      }

      // Set sticky session if enabled
      if (this.stickySessions && userId) {
        this.setStickyServer(userId, serverId);
      }

      this.emit('connection:assigned', { serverId, userId });

    } catch (error) {
      logger.error('Failed to record connection:', error);
    }
  }

  /**
   * Record connection removal
   */
  recordDisconnection(serverId, userId) {
    try {
      const currentCount = this.connectionDistribution.get(serverId) || 0;
      this.connectionDistribution.set(serverId, Math.max(0, currentCount - 1));

      // Update server info
      const server = this.servers.get(serverId);
      if (server) {
        server.connections = Math.max(0, server.connections - 1);
      }

      this.emit('connection:removed', { serverId, userId });

    } catch (error) {
      logger.error('Failed to record disconnection:', error);
    }
  }

  /**
   * Get list of healthy servers
   */
  getHealthyServers() {
    const healthyServers = [];

    for (const [serverId, server] of this.servers) {
      const health = this.serverHealth.get(serverId);
      if (health && health.status === 'healthy' && server.isActive) {
        // Check if server has capacity
        const connections = this.connectionDistribution.get(serverId) || 0;
        if (connections < server.maxConnections) {
          healthyServers.push(server);
        }
      }
    }

    return healthyServers;
  }

  /**
   * Check if a server is healthy
   */
  isServerHealthy(serverId) {
    const health = this.serverHealth.get(serverId);
    return health && health.status === 'healthy';
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    setInterval(async () => {
      for (const serverId of this.servers.keys()) {
        await this.checkServerHealth(serverId);
      }
    }, this.healthCheckInterval);
  }

  /**
   * Check health of a specific server
   */
  async checkServerHealth(serverId) {
    try {
      const server = this.servers.get(serverId);
      if (!server) {
        return;
      }

      // Skip health check for current server (it's always healthy)
      if (serverId === this.getServerId()) {
        this.serverHealth.set(serverId, {
          status: 'healthy',
          lastCheck: Date.now()
        });
        return;
      }

      const health = await this.performHealthCheck(server);
      const currentHealth = this.serverHealth.get(serverId);
      const previousStatus = currentHealth ? currentHealth.status : 'unknown';

      // Update health status with thresholds
      let newStatus = health.isHealthy ? 'healthy' : 'unhealthy';

      if (previousStatus === 'unhealthy' && health.isHealthy) {
        // Server was unhealthy, now healthy - check healthy threshold
        const consecutiveHealthy = (currentHealth?.consecutiveHealthy || 0) + 1;
        if (consecutiveHealthy >= this.config.healthyThreshold) {
          newStatus = 'healthy';
          this.serverHealth.set(serverId, {
            status: newStatus,
            lastCheck: Date.now(),
            consecutiveHealthy: 0,
            consecutiveUnhealthy: 0
          });
        } else {
          this.serverHealth.set(serverId, {
            status: 'unhealthy',
            lastCheck: Date.now(),
            consecutiveHealthy: consecutiveHealthy,
            consecutiveUnhealthy: currentHealth?.consecutiveUnhealthy || 0
          });
        }
      } else if (previousStatus === 'healthy' && !health.isHealthy) {
        // Server was healthy, now unhealthy - check unhealthy threshold
        const consecutiveUnhealthy = (currentHealth?.consecutiveUnhealthy || 0) + 1;
        if (consecutiveUnhealthy >= this.config.unhealthyThreshold) {
          newStatus = 'unhealthy';
          this.serverHealth.set(serverId, {
            status: newStatus,
            lastCheck: Date.now(),
            consecutiveHealthy: 0,
            consecutiveUnhealthy: 0
          });
        } else {
          this.serverHealth.set(serverId, {
            status: 'healthy',
            lastCheck: Date.now(),
            consecutiveHealthy: currentHealth?.consecutiveHealthy || 0,
            consecutiveUnhealthy: consecutiveUnhealthy
          });
        }
      } else {
        // Update status normally
        this.serverHealth.set(serverId, {
          status: newStatus,
          lastCheck: Date.now(),
          consecutiveHealthy: 0,
          consecutiveUnhealthy: 0
        });
      }

      server.lastHealthCheck = new Date().toISOString();

      // Emit health status change
      if (previousStatus !== newStatus) {
        logger.info(`Server ${serverId} health status changed: ${previousStatus} -> ${newStatus}`);
        this.emit('server:health_changed', { serverId, previousStatus, newStatus });
      }

    } catch (error) {
      logger.error(`Failed to check health for server ${serverId}:`, error);
      this.serverHealth.set(serverId, {
        status: 'unknown',
        lastCheck: Date.now(),
        error: error.message
      });
    }
  }

  /**
   * Perform actual health check on a server
   */
  async performHealthCheck(server) {
    try {
      const startTime = Date.now();

      // Create WebSocket connection for health check
      const wsUrl = `${server.protocol}://${server.host}:${server.port}/health`;

      // In a real implementation, this would make an actual HTTP/WebSocket request
      // For now, we'll simulate the health check
      const healthResponse = await this.simulateHealthCheck(server);

      const responseTime = Date.now() - startTime;

      return {
        isHealthy: healthResponse.isHealthy,
        responseTime,
        timestamp: new Date().toISOString(),
        details: healthResponse.details
      };

    } catch (error) {
      return {
        isHealthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Simulate health check (for demonstration)
   */
  async simulateHealthCheck(server) {
    // In a real implementation, this would make an actual request
    // For now, simulate based on random factors

    const isHealthy = Math.random() > 0.1; // 90% chance of being healthy

    return {
      isHealthy,
      details: {
        connections: this.connectionDistribution.get(server.id) || 0,
        maxConnections: server.maxConnections,
        loadPercentage: ((this.connectionDistribution.get(server.id) || 0) / server.maxConnections * 100).toFixed(2)
      }
    };
  }

  /**
   * Start metrics collection
   */
  startMetricsCollection() {
    setInterval(() => {
      this.collectMetrics();
    }, 60000); // Every minute
  }

  /**
   * Collect performance metrics
   */
  collectMetrics() {
    try {
      const metrics = {
        timestamp: Date.now(),
        servers: this.servers.size,
        healthyServers: this.getHealthyServers().length,
        totalConnections: Array.from(this.connectionDistribution.values()).reduce((a, b) => a + b, 0),
        strategy: this.strategy,
        stickySessions: this.stickySessions,
        distribution: Object.fromEntries(this.connectionDistribution)
      };

      this.emit('metrics:collected', metrics);

    } catch (error) {
      logger.error('Failed to collect metrics:', error);
    }
  }

  /**
   * Start server discovery
   */
  startServerDiscovery() {
    // In a real implementation, this would integrate with service discovery systems
    // For now, we'll just log that discovery is active
    logger.info('Server discovery started');
  }

  /**
   * Update server weights based on performance
   */
  updateServerWeights() {
    try {
      for (const [serverId, server] of this.servers) {
        const health = this.serverHealth.get(serverId);
        if (health && health.status === 'healthy') {
          // Calculate weight based on performance metrics
          const connections = this.connectionDistribution.get(serverId) || 0;
          const capacityRatio = connections / server.maxConnections;

          // Higher weight for less loaded servers
          server.weight = Math.max(1, Math.floor((1 - capacityRatio) * 10));
        }
      }
    } catch (error) {
      logger.error('Failed to update server weights:', error);
    }
  }

  /**
   * Get load balancer statistics
   */
  getStats() {
    const healthyServers = this.getHealthyServers();

    return {
      isEnabled: this.isEnabled,
      strategy: this.strategy,
      stickySessions: this.stickySessions,
      servers: {
        total: this.servers.size,
        healthy: healthyServers.length,
        unhealthy: this.servers.size - healthyServers.length
      },
      connections: {
        total: Array.from(this.connectionDistribution.values()).reduce((a, b) => a + b, 0),
        distribution: Object.fromEntries(this.connectionDistribution)
      },
      healthChecks: {
        interval: this.healthCheckInterval,
        lastCheck: new Date().toISOString()
      },
      timestamp: Date.now()
    };
  }

  /**
   * Get detailed server information
   */
  getServerInfo(serverId) {
    const server = this.servers.get(serverId);
    const health = this.serverHealth.get(serverId);
    const connections = this.connectionDistribution.get(serverId) || 0;

    return {
      server,
      health,
      connections,
      loadPercentage: server ? (connections / server.maxConnections * 100).toFixed(2) : 0
    };
  }

  /**
   * Update load balancing strategy
   */
  setStrategy(strategy) {
    if (this.algorithms[strategy]) {
      this.strategy = strategy;
      logger.info(`Load balancing strategy changed to: ${strategy}`);
      this.emit('strategy:changed', { strategy });
    } else {
      throw new Error(`Unknown load balancing strategy: ${strategy}`);
    }
  }

  /**
   * Enable/disable sticky sessions
   */
  setStickySessions(enabled) {
    this.stickySessions = enabled;
    logger.info(`Sticky sessions ${enabled ? 'enabled' : 'disabled'}`);
    this.emit('sticky_sessions:changed', { enabled });
  }

  /**
   * Utility methods
   */
  getServerId() {
    return process.env.SERVER_ID || `${os.hostname()}-${process.pid}`;
  }

  getServerHost() {
    return process.env.SERVER_HOST || os.hostname();
  }

  getCurrentServer() {
    return this.getServerId();
  }

  generateServerId(serverInfo) {
    return `${serverInfo.host}:${serverInfo.port}-${Date.now()}`;
  }

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Shutdown the load balancing service
   */
  shutdown() {
    logger.info('Shutting down load balancing service');
    this.isEnabled = false;
    this.removeAllListeners();
  }
}

// Create singleton instance
const loadBalancingService = new LoadBalancingService();

module.exports = loadBalancingService;