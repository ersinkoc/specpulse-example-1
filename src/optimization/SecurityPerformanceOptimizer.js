/**
 * Security Performance Optimizer - Optimizes security system performance and resource usage
 * Implements caching, query optimization, and background processing for security operations
 */

const EventEmitter = require('events');
const logger = require('../../shared/utils/logger');

class SecurityPerformanceOptimizer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      enableCaching: options.enableCaching !== false,
      enableQueryOptimization: options.enableQueryOptimization !== false,
      enableBackgroundProcessing: options.enableBackgroundProcessing !== false,
      enableConnectionPooling: options.enableConnectionPooling !== false,
      cacheSize: options.cacheSize || 1000,
      cacheTimeout: options.cacheTimeout || 300000, // 5 minutes
      queryTimeout: options.queryTimeout || 30000, // 30 seconds
      maxConcurrentRequests: options.maxConcurrentRequests || 100,
      backgroundQueueSize: options.backgroundQueueSize || 500,
      performanceMonitoringInterval: options.performanceMonitoringInterval || 60000, // 1 minute
      memoryThreshold: options.memoryThreshold || 0.8, // 80% memory usage threshold
      ...options
    };

    // Performance optimization components
    this.cache = new Map(); // Generic cache
    this.queryOptimizer = null;
    this.connectionPool = null;
    this.backgroundQueue = [];
    this.performanceMonitor = null;

    // Tracking data
    this.performanceMetrics = new Map(); // metricName -> metrics data
    this.queryStats = new Map(); // query -> stats
    this.resourceUsage = {
      memoryUsage: 0,
      cpuUsage: 0,
      activeConnections: 0,
      queuedTasks: 0
    };

    this.isInitialized = false;
    this.monitoringTimer = null;

    // Initialize components
    this.initializeComponents();
  }

  /**
   * Initialize performance optimization components
   */
  initializeComponents() {
    // Initialize cache
    this.initializeCache();

    // Initialize query optimizer
    this.initializeQueryOptimizer();

    // Initialize connection pool
    this.initializeConnectionPool();

    // Initialize background processing
    this.initializeBackgroundProcessing();

    // Initialize performance monitoring
    this.initializePerformanceMonitoring();

    logger.debug('Performance optimizer components initialized');
  }

  /**
   * Initialize cache system
   */
  initializeCache() {
    this.cache = new Map();

    // Cache configuration
    this.cacheConfig = {
      maxSize: this.options.cacheSize,
      defaultTimeout: this.options.cacheTimeout,
      cleanupInterval: this.options.cacheTimeout / 2, // Clean every half timeout
      hitRatio: 0,
      missRatio: 0
    };

    logger.debug('Cache system initialized', {
      maxSize: this.options.cacheSize,
      defaultTimeout: this.options.cacheTimeout
    });
  }

  /**
   * Initialize query optimizer
   */
  initializeQueryOptimizer() {
    this.queryOptimizer = {
      queryCache: new Map(),
      queryStats: new Map(),
      optimizedQueries: new Set(),
      slowQueries: new Set(),
      connectionReuseStats: new Map(),
      indexRecommendations: new Map()
    };

    logger.debug('Query optimizer initialized');
  }

  /**
   * Initialize connection pool
   */
  initializeConnectionPool() {
    this.connectionPool = {
      available: [],
      active: new Map(),
      maxConnections: this.options.maxConcurrentRequests,
      totalConnections: 0,
      createdConnections: 0,
      closedConnections: 0,
      reuseRate: 0,
      avgWaitTime: 0
    };

    logger.debug('Connection pool initialized', {
      maxConnections: this.options.maxConcurrentRequests
    });
  }

  /**
   * Initialize background processing
   */
  initializeBackgroundProcessing() {
    this.backgroundQueue = [];
    this.backgroundProcessorState = {
      running: false,
      processed: 0,
      failed: 0,
      avgProcessingTime: 0
    };

    logger.debug('Background processing initialized', {
      queueSize: this.options.backgroundQueueSize
    });
  }

  /**
   * Initialize performance monitoring
   */
  initializePerformanceMonitoring() {
    this.performanceMetrics = new Map();
    this.performanceHistory = [];
    this.alertThresholds = {
      memoryUsage: 0.8,
      cpuUsage: 0.7,
      responseTime: 5000, // 5 seconds
      queueSize: 400
      errorRate: 0.05
    };

    this.monitoringTimer = setInterval(() => {
      this.collectPerformanceMetrics();
    }, this.options.performanceMonitoringInterval);

    logger.debug('Performance monitoring initialized', {
      interval: this.options.performanceMonitoringInterval
    });
  }

  /**
   * Initialize the performance optimizer
   */
  async initialize() {
    try {
      logger.info('Initializing Security Performance Optimizer');

      // Start background processing
      this.startBackgroundProcessing();

      // Start performance monitoring
      this.startPerformanceMonitoring();

      this.isInitialized = true;
      logger.info('Security Performance Optimizer initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize Security Performance Optimizer', { error: error.message });
      throw error;
    }
  }

  /**
   * Cache data with automatic expiration
   */
  async cacheData(key, data, customTimeout = null) {
    try {
      if (!this.options.enableCaching) {
        return data;
      }

      const timeout = customTimeout || this.options.cacheTimeout;
      const expiry = Date.now() + timeout;

      // Check cache size limit
      if (this.cache.size >= this.cacheConfig.maxSize) {
        this.evictOldestEntries();
      }

      // Store in cache
      this.cache.set(key, {
        data: data,
        cachedAt: Date.now(),
        expiresAt: expiry,
        accessCount: 1
      });

      logger.debug('Data cached', { key, expiresIn: timeout });

      return data;

    } catch (error) {
      logger.error('Error caching data', { key, error: error.message });
      return data;
    }
  }

  /**
   * Get cached data
   */
  getCachedData(key) {
    try {
      if (!this.options.enableCaching) return null;

      const cached = this.cache.get(key);
      if (!cached) {
        return null;
      }

      // Check if expired
      if (Date.now() > cached.expiresAt) {
        this.cache.delete(key);
        return null;
      }

      // Update access count and last accessed
      cached.accessCount++;
      cached.lastAccessed = Date.now();

      this.cacheConfig.hitRatio++;
      logger.debug('Cache hit', { key, accessCount: cached.accessCount });

      return cached.data;

    } catch (error) {
      logger.error('Error getting cached data', { key, error: error.message });
      return null;
    }
  }

  /**
   * Invalidate cache entry
   */
  invalidateCache(key) {
    const removed = this.cache.delete(key);
    if (removed) {
      logger.debug('Cache entry invalidated', { key });
    }
    return removed;
  }

  /**
   * Clear cache
   */
  clearCache() {
    const size = this.cache.size;
    this.cache.clear();
    this.cacheConfig.hitRatio = 0;
    this.cacheConfig.missRatio = 0;

    logger.info('Cache cleared', { previousSize: size });
  }

  /**
   * Evict oldest cache entries
   */
  evictOldestEntries() {
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].cachedAt - b[1].cachedAt);

    const toRemove = entries.slice(0, Math.ceil(this.cacheConfig.maxSize * 0.2));
    for (const [key] of toRemove) {
      this.cache.delete(key);
    }

    logger.debug('Evicted cache entries', { count: toRemove.length });
  }

  /**
   * Optimize database query
   */
  async optimizeQuery(query, databaseType = 'default') {
    try {
      if (!this.options.enableQueryOptimization) {
        return query;
      }

      // Check query cache
      const queryHash = this.hashQuery(query);
      if (this.queryOptimizer.queryCache.has(queryHash)) {
        const cached = this.queryOptimizer.queryCache.get(queryHash);
        cached.accessCount++;
        this.queryOptimizer.hitRatio++;
        return cached.optimizedQuery;
      }

      // Apply database-specific optimizations
      let optimizedQuery = query;

      switch (databaseType.toLowerCase()) {
        case 'postgresql':
          optimizedQuery = this.optimizePostgreSQLQuery(query);
          break;
        case 'mysql':
          optimizedQuery = this.optimizeMySQLQuery(query);
          break;
        case 'mongodb':
          optimizedQuery = this.optimizeMongoDBQuery(query);
          break;
        default:
          optimizedQuery = this.optimizeGenericQuery(query);
      }

      // Cache the optimized query
      this.queryOptimizer.queryCache.set(queryHash, {
        originalQuery: query,
        optimizedQuery,
        createdAt: Date.now(),
        accessCount: 1,
        databaseType
      });

      this.queryOptimizer.hitRatio++;
      logger.debug('Query optimized', {
        queryHash: queryHash.substring(0, 8) + '...',
        databaseType
      });

      return optimizedQuery;

    } catch (error) {
      logger.error('Error optimizing query', { error: error.message });
      return query;
    }
  }

  /**
   * Optimize PostgreSQL query
   */
  optimizePostgreSQLQuery(query) {
    // Add EXPLAIN ANALYZE if not present
    if (!query.toUpperCase().includes('EXPLAIN')) {
      query = `EXPLAIN ANALYZE ${query}`;
    }

    // Add query timeout
    if (!query.toUpperCase().includes('SET statement')) {
      query += ` SET statement_timeout = ${this.options.queryTimeout}`;
    }

    // Optimize JOIN operations
    query = this.optimizeJoins(query);

    // Add index hints if beneficial
    query = this.addIndexHints(query);

    return query;
  }

  /**
   * Optimize MySQL query
   */
  optimizeMySQLQuery(query) {
    // Add SQL_NO_CACHE for one-time queries
    if (!query.toUpperCase().includes('SQL_NO_CACHE')) {
      query = query.replace(/^SELECT/i, 'SELECT SQL_NO_CACHE');
    }

    // Add query timeout
    query += ` SET MAX_EXECUTION_TIME = ${this.options.queryTimeout}`;

    // Optimize JOIN operations
    query = this.optimizeJoins(query);

    // Add index hints if beneficial
    query = this.addIndexHints(query);

    return query;
  }

  /**
   * Optimize MongoDB query
   */
  optimizeMongoDBQuery(query) {
    // Convert to aggregation pipeline if beneficial
    if (query.includes('find(') && query.includes('count()')) {
      return query.replace(
        /db\.(\w+)\.find\((.*)\)/g,
        'db.$1.find($2).count({count: {$sum: 1}})'
      );
    }

    // Add appropriate cursor hints
    query += '.hint({index: {created_at: -1}, limit: 100})';

    return query;
  }

  /**
   * Optimize generic query
   */
  optimizeGenericQuery(query) {
    // Add appropriate timeout
    if (!query.toUpperCase().includes('statement_timeout')) {
      query += ` SET statement_timeout = ${this.options.queryTimeout}`;
    }

    return query;
  }

  /**
   * Optimize JOIN operations
   */
  optimizeJoins(query) {
    // Add JOIN strategies
    if (query.toUpperCase().includes('JOIN')) {
      // Use explicit JOIN syntax instead of comma-separated tables
      query = query.replace(/,(\w+)\s+(\w+)\s+WHERE/i, ' JOIN $1 ON $2 WHERE');
    }

    return query;
  }

  /**
   * Add index hints
   */
  addIndexHints(query) {
    // Add USE INDEX hints for MySQL
    if (query.toUpperCase().includes('WHERE')) {
      const indexHints = [
        'USE INDEX (index_users_created_at_idx)',
        'USE INDEX (index_security_level_idx)',
        'USE INDEX (index_alerts_severity_idx)'
      ];

      // Add appropriate hint after WHERE clause
      const whereIndex = indexHints.find(hint =>
        query.toLowerCase().includes(hint.toLowerCase())
      );

      if (whereIndex) {
        query += ` ${whereIndex}`;
      }
    }

    return query;
  }

  /**
   * Hash query for caching
   */
  hashQuery(query) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(query).digest('hex');
  }

  /**
   * Get connection from pool
   */
  async getConnection(databaseType = 'default') {
    try {
      if (!this.options.enableConnectionPooling) {
        return this.createConnection(databaseType);
      }

      // Check for available connections
      const available = this.connectionPool.available;
      if (available.length > 0) {
        const connection = available.shift();
        this.connectionPool.active.set(connection.id, {
          connection,
          acquiredAt: Date.now(),
          databaseType,
          queryCount: 0
        });
        this.connectionPool.activeConnections++;
        this.connectionPool.totalConnections++;
        this.connectionPool.reuseRate++;
        this.connectionPool.avgWaitTime = this.calculateAvgWaitTime();
        logger.debug('Connection acquired from pool', {
          connectionId: connection.id,
          activeConnections: this.connectionPool.activeConnections.size,
          available: this.connectionPool.available.length
        });
        return connection;
      }

      // No available connections, create new one
      return this.createConnection(databaseType);

    } catch (error) {
      logger.error('Error getting connection', { error: error.message });
      throw error;
    }
  }

  /**
   * Create new connection
   */
  async createConnection(databaseType = 'default') {
    const connection = {
      id: this.generateConnectionId(),
      databaseType,
      createdAt: Date.now(),
      queryCount: 0,
      lastUsed: Date.now(),
      isActive: true,
      connectionParams: this.getConnectionParams(databaseType),
      lastError: null
    };

    this.connectionPool.totalConnections++;
    logger.debug('New connection created', {
      connectionId: connection.id,
      databaseType
    });

    return connection;
  }

  /**
   * Get connection parameters for database type
   */
  getConnectionParams(databaseType) {
    const params = {
      'default': {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'security_audit',
        username: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true',
        connectionTimeout: this.options.queryTimeout,
        idleTimeout: 300000 // 5 minutes
      },
      'postgresql': {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'security_audit',
        username: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true',
        connectionTimeout: this.options.queryTimeout,
        idleTimeout: 300000,
        application_name: 'security_audit_system',
        connect_timeout: 10,
        keepalives: 5,
        max: 20
      },
      'mysql': {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 3306,
        database: process.env.DB_NAME || 'security_audit',
        username: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        charset: 'utf8mb4',
        connectionTimeout: this.options.queryTimeout,
        idleTimeout: 300000,
        max_allowed_packet: 64M
      },
      'mongodb': {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/security_audit',
        connectTimeoutMS: this.options.queryTimeout,
        socketTimeoutMS: 45000,
        serverSelectionTimeoutMS: 5000,
        appname: 'security_audit_system'
      }
    };

    return params[databaseType] || params['default'];
  }

  /**
   * Release connection back to pool
   */
  releaseConnection(connection) {
    try {
      if (!connection || !connection.isActive) return;

      connection.isActive = false;
      connection.lastUsed = Date.now();
      connection.queryCount++;

      // Check if connection can be reused
      if (this.options.enableConnectionPooling && connection.queryCount < 100) {
        this.connectionPool.available.push(connection);
        this.connectionPool.activeConnections.delete(connection.id);
        this.connectionPool.reuseRate++;
        this.connectionPool.avgWaitTime = this.calculateAvgWaitTime();
        logger.debug('Connection released to pool', {
          connectionId: connection.id,
          activeConnections: this.connectionPool.activeConnections.size,
          available: this.connectionPool.available.length,
          reuseRate: this.connectionPool.reuseRate
        });
      } else {
        // Close connection
        this.closeConnection(connection);
        this.connectionPool.totalConnections--;
        this.connectionPool.closedConnections++;
      }

    } catch (error) {
      logger.error('Error releasing connection', { error: error.message });
    }
  }

  /**
   * Close connection
   */
  closeConnection(connection) {
    try {
      if (connection && connection.connectionParams) {
        connection.isActive = false;
        // Close database connection based on type
        if (connection.databaseType === 'postgresql') {
          connection.client.end();
        } else if (connection.databaseType === 'mysql') {
          connection.end();
        } else if (connection.databaseType === 'mongodb') {
          connection.close();
        }
      }
    } catch (error) {
      logger.error('Error closing connection', { error: error.message });
    }
  }

  /**
   * Add task to background queue
   */
  addBackgroundTask(task) {
    try {
      const taskWithMetadata = {
        ...task,
        id: this.generateTaskId(),
        queuedAt: Date.now(),
        status: 'queued',
        attempts: 0,
        scheduledAt: task.scheduledAt || Date.now(),
        priority: task.priority || 'medium',
        maxRetries: task.maxRetries || 3,
        timeout: task.timeout || 60000 // 1 minute
      };

      // Check queue size limit
      if (this.backgroundQueue.length >= this.options.backgroundQueueSize) {
        // Remove oldest task
        this.backgroundQueue.shift();
        logger.warn('Background queue full, oldest task removed');
      }

      this.backgroundQueue.push(taskWithMetadata);
      this.backgroundProcessorState.queued++;

      logger.debug('Task added to background queue', {
        taskId: taskWithMetadata.id,
        priority: taskWithMetadata.priority,
        queueSize: this.backgroundQueue.length
      });

    } catch (error) {
      logger.error('Error adding task to background queue', { error: error.message });
    }
  }

  /**
   * Start background processing
   */
  startBackgroundProcessing() {
    if (this.backgroundProcessorState.running) {
      return;
    }

    this.backgroundProcessorState.running = true;
    this.backgroundProcessorState.processed = 0;
    this.backgroundProcessorState.failed = 0;

    this.backgroundProcessorTimer = setInterval(() => {
      this.processBackgroundQueue();
    }, 1000); // Process every second

    logger.info('Background processing started');
  }

  /**
   * Process background queue
   */
  async processBackgroundQueue() {
    try {
      if (this.backgroundQueue.length === 0) {
        return;
      }

      const task = this.backgroundQueue.shift();
      task.status = 'processing';
      task.startedAt = Date.now();
      task.attempts++;

      try {
        await this.processBackgroundTask(task);
        task.status = 'completed';
        task.completedAt = Date.now();
        task.duration = task.completedAt - task.startedAt;
        this.backgroundProcessorState.processed++;
      } catch (error) {
        task.status = 'failed';
        task.error = error.message;
        task.failedAt = Date.now();
        task.duration = task.failedAt - task.startedAt;
        this.backgroundProcessorState.failed++;
        logger.error('Background task failed', {
          taskId: task.id,
          error: error.message,
          attempts: task.attempts
        });
      }

      // Update processor state
      this.backgroundProcessorState.avgProcessingTime =
        (this.backgroundProcessorState.processed * this.backgroundProcessorState.avgProcessingTime + task.duration) /
        (this.backgroundProcessorState.processed + this.backgroundProcessorState.failed);

      logger.debug('Background task processed', {
        taskId: task.id,
        status: task.status,
        duration: task.duration,
        attempts: task.attempts,
        queueSize: this.backgroundQueue.length
      });

    } catch (error) {
      logger.error('Error processing background queue', { error: error.message });
    }
  }

  /**
   * Process individual background task
   */
  async processBackgroundTask(task) {
    try {
      switch (task.type) {
        case 'security_scan':
          return await this.processSecurityScanTask(task);
        case 'vulnerability_check':
          return await this.processVulnerabilityCheckTask(task);
        'audit_log_analysis':
          return await this.processAuditLogAnalysisTask(task);
        'report_generation':
          return await this.processReportGenerationTask(task);
        'data_cleanup':
          return await this.processDataCleanupTask(task);
        'performance_analysis':
          return await this.processPerformanceAnalysisTask(task);
        default:
          return await this.processGenericTask(task);
      }
    } catch (error) {
      logger.error('Error processing background task', {
        taskId: task.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process security scan task
   */
  async processSecurityScanTask(task) {
    try {
      logger.info('Processing security scan task', { taskId: task.id });

      // Simulate security scan
      const results = {
        scanId: task.id,
        scannedItems: task.scannedItems || 100,
        vulnerabilitiesFound: task.vulnerabilitiesFound || 5,
        risksIdentified: task.risksIdentified || 2,
        scanDuration: Date.now() - task.startedAt,
        scanResults: {
          critical: 1,
          high: 2,
          medium: 1,
          low: 1
        }
      };

      task.results = results;
      return results;

    } catch (error) {
      logger.error('Error processing security scan task', {
        taskId: task.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process vulnerability check task
   */
  async processVulnerabilityCheckTask(task) {
    try {
      logger.info('Processing vulnerability check task', { taskId: task.id });

      // Simulate vulnerability check
      const results = {
        checkId: task.id,
        vulnerabilitiesChecked: task.vulnerabilitiesChecked || 20,
        newVulnerabilities: task.newVulnerabilities || 0,
        fixedVulnerabilities: task.fixedVulnerabilities || 0,
        riskReduction: task.riskReduction || 0
      };

      task.results = results;
      return results;

    } catch (error) {
      logger.error('Error processing vulnerability check task', {
        taskId: task.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process audit log analysis task
   */
  processAuditLogAnalysisTask(task) {
    try {
      logger.info('Processing audit log analysis task', { taskId: task.id });

      // Simulate audit log analysis
      const results = {
        analysisId: task.id,
        logsAnalyzed: task.logsAnalyzed || 1000,
        anomaliesFound: task.anomaliesFound || 3,
        patternsIdentified: task.patternsIdentified || 5,
        complianceScore: task.complianceScore || 0.85,
        auditReportGenerated: task.auditReportGenerated || false
      };

      task.results = results;
      return results;

    } catch (error) {
      logger.error('Error processing audit log analysis task', {
        taskId: task.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process report generation task
   */
  async processReportGenerationTask(task) {
    try {
      logger.info('Processing report generation task', { taskId: task.id });

      // Simulate report generation
      const results = {
        reportId: task.id,
        reportType: task.reportType || 'security_summary',
        generatedAt: Date.now(),
        reportData: task.reportData || {},
        recipients: task.recipients || [],
        deliveryStatus: 'pending'
      };

      task.results = results;
      return results;

    } catch (error) {
      logger.error('Error processing report generation task', {
        taskId: task.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process data cleanup task
   */
  async processDataCleanupTask(task) {
    try {
      logger.info('Processing data cleanup task', { taskId: task.id });

      // Simulate data cleanup
      const results = {
        cleanupId: task.id,
        cleanedItems: task.cleanedItems || 50,
        dataArchived: task.dataArchived || false,
        spaceFreed: task.spaceFreed || 1024 * 1024 * 1024, // 1GB
        oldFilesRemoved: task.oldFilesRemoved || 0
      };

      task.results = results;
      return results;

    } catch (error) {
      logger.error('Error processing data cleanup task', {
        taskId: task.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process performance analysis task
   */
  async processPerformanceAnalysisTask(task) {
    try {
      logger.info('Processing performance analysis task', { taskId: task.id });

      // Simulate performance analysis
      const results = {
        analysisId: task.id,
        analysisType: task.analysisType || 'system_performance',
        timestamp: Date.now(),
        metrics: {
          responseTime: task.responseTime || 0,
          throughput: task.throughput || 0,
          cpuUsage: task.cpuUsage || 0,
          memoryUsage: task.memoryUsage || 0,
          errorRate: task.errorRate || 0,
          cacheHitRatio: this.cacheConfig.hitRatio,
          connectionReuseRate: this.connectionPool.reuseRate
        },
        recommendations: task.recommendations || []
      };

      task.results = results;
      return results;

    } catch (error) {
      logger.error('Error processing performance analysis task', {
        taskId: task.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process generic task
   */
  async processGenericTask(task) {
    try {
      logger.info('Processing generic task', { taskId: task.id, task.type });

      const results = {
        taskId: task.id,
        taskType: task.type,
        status: 'completed',
        completedAt: Date.now(),
        results: task.results || {}
      };

      task.results = results;
      return results;

    } catch (error) {
      logger.error('Error processing generic task', {
        taskId: task.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Collect performance metrics
   */
  collectPerformanceMetrics() {
    try {
      const now = Date.now();
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      const activeConnections = this.connectionPool.activeConnections.size;
      const queuedTasks = this.backgroundQueue.length;

      // Update resource usage
      this.resourceUsage = {
        memoryUsage: memoryUsage / (1024 * 1024 * 1024), // Convert to GB
        cpuUsage: cpuUsage,
        activeConnections,
        queuedTasks
      };

      // Update cache statistics
      this.cacheConfig.missRatio = this.cacheConfig.cacheSize > 0 ?
        (this.cacheConfig.missRatio / this.cacheConfig.cacheSize) : 0 : 0;

      // Calculate cache hit ratio
      const cacheHits = Array.from(this.cache.values()).filter(entry =>
        Date.now() < entry.expiresAt
      ).length;
      this.cacheConfig.hitRatio = this.cacheConfig.cacheSize > 0 ?
        (cacheHits / this.cacheConfig.cacheSize) : 0 : 0;

      // Calculate memory pressure
      const memoryPressure = this.resourceUsage.memoryUsage;

      // Check if thresholds exceeded
      const memoryThresholdExceeded = memoryPressure > this.options.memoryThreshold;
      const cpuThresholdExceeded = this.resourceUsage.cpuUsage > 0.8;
      const queueThresholdExceeded = this.resourceUsage.queuedTasks > 400;

      // Update performance metrics
      this.performanceMetrics.set('memory_usage', {
        current: this.resourceUsage.memoryUsage,
        average: this.calculateAverageValue('memory_usage', 'history'),
        threshold: this.options.memoryThreshold,
        exceeded: memoryThresholdExceeded
      });

      this.performanceMetrics.set('cpu_usage', {
        current: this.resourceUsage.cpuUsage,
        average: this.calculateAverageValue('cpu_usage', 'history'),
        threshold: this.options.memoryThreshold,
        exceeded: cpuThresholdExceeded
      });

      // Update alert thresholds
      if (memoryThresholdExceeded) {
        this.emit('performanceAlert', {
          type: 'memory_usage',
          severity: 'high',
          message: `Memory usage exceeded threshold: ${(this.resourceUsage.memoryUsage * 100).toFixed(1)}%`,
          value: this.resourceUsage.memoryUsage,
          threshold: this.options.memoryThreshold
        });
      }

      if (cpuThresholdExceeded) {
        this.emit('performanceAlert', {
          type: 'cpu_usage',
          severity: 'medium',
          message: `CPU usage exceeded threshold: ${this.resourceUsage.cpuUsage * 100}%, threshold: ${this.options.memoryThreshold}`,
          value: this.resourceUsage.cpuUsage,
          threshold: this.options.memoryThreshold
        });
      }

      if (queueThresholdExceeded) {
        this.emit('performanceAlert', {
          type: 'queue_overflow',
          severity: 'medium',
          message: `Queue length exceeded threshold: ${this.resourceUsage.queuedTasks}, threshold: ${400}`,
          value: this.resourceUsage.queuedTasks,
          threshold: 400
        });
      }

      // Update average values in metrics
      this.updateAverageMetrics();

      // Clean up old metric data
      this.cleanupOldMetrics();

    } catch (error) {
      logger.error('Error collecting performance metrics', { error: error.message });
    }
  }

  /**
   * Calculate average value for metric
   */
  calculateAverageValue(metricName, historyPeriod = '1h') {
    const metrics = Array.from(this.performanceMetrics.get(metricName) || []);
    if (metrics.length === 0) return 0;

    const recentMetrics = metrics.slice(-10); // Last 10 entries
    if (recentMetrics.length === 0) return 0;

    const sum = recentMetrics.reduce((sum, metric) => sum + metric.value || 0, 0);
    return sum / recentMetrics.length;
  }

  /**
   * Update average metrics in all metrics
   */
  updateAverageMetrics() {
    for (const [name, metrics] of this.performanceMetrics.entries()) {
      const average = this.calculateAverageValue(name, '1h');
      metrics.average = average;
    }
  }

  /**
   * Clean up old metric data
   */
  cleanupOldMetrics() {
    const now = Date.now();
    const retentionPeriod = 3600000; // 1 hour

    for (const [name, metrics] of this.performanceMetrics.entries()) {
      if (metrics.lastUpdated && (now - metrics.lastUpdated > retentionPeriod)) {
        metrics.lastUpdated = now;
        metrics.historicalData = metrics.historicalData.slice(-20); // Keep last 20 entries
      }
    }
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    return {
      isInitialized: this.isInitialized,
      cache: {
        size: this.cache.size,
        hitRatio: this.cacheConfig.hitRatio,
        missRatio: this.cacheConfig.missRatio,
        maxSize: this.cacheConfig.maxSize,
        defaultTimeout: this.cacheConfig.defaultTimeout
      },
      connectionPool: {
        totalConnections: this.connectionPool.totalConnections,
        activeConnections: this.connectionPool.activeConnections.size,
        availableConnections: this.connectionPool.available.length,
        reuseRate: this.connectionPool.reuseRate,
        avgWaitTime: this.connectionPool.avgWaitTime,
        closedConnections: this.connectionPool.closedConnections
      },
      backgroundProcessing: {
        running: this.backgroundProcessorState.running,
        queueSize: this.backgroundQueue.length,
        processed: this.backgroundProcessorState.processed,
        failed: this.backgroundProcessorState.failed,
        avgProcessingTime: this.backgroundProcessorState.avgProcessingTime
      },
      resourceUsage: this.resourceUsage,
      metrics: this.performanceMetrics,
      alertThresholds: this.alertThresholds,
      monitoringInterval: this.options.performanceMonitoringInterval
    };
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport() {
    try {
      const stats = this.getPerformanceStats();

      const report = {
        timestamp: Date.now(),
        period: 'last_hour',
        cache: {
          hitRatio: stats.cache.hitRatio * 100,
          missRatio: stats.cache.missRatio * 100,
          totalEntries: stats.cache.size,
          maxSize: stats.cache.maxSize,
          efficiency: stats.cache.hitRatio > 0 ? 'good' : 'needs_improvement'
        },
        connections: {
          total: stats.connectionPool.totalConnections,
          active: stats.connectionPool.activeConnections,
          available: stats.connectionPool.available.length,
          reuseRate: stats.connectionPool.reuseRate * 100,
          avgWaitTime: stats.connectionPool.avgWaitTime
        },
        backgroundProcessing: {
          running: this.backgroundProcessorState.running,
          queueSize: this.backgroundQueue.length,
          processed: this.backgroundProcessorState.processed,
          failed: this.backgroundProcessorState.failed,
          avgProcessingTime: this.backgroundProcessorState.avgProcessingTime
        },
        resourceUsage: {
          memory: `${(this.resourceUsage.memoryUsage * 100).toFixed(1)}%`,
          cpu: `${(this.resourceUsage.cpuUsage * 100).toFixed(1)}%`,
          activeConnections: this.resourceUsage.activeConnections,
          queuedTasks: this.resourceUsage.queuedTasks
        },
        metrics: this.performanceMetrics,
        alerts: {
          memoryThresholdExceeded: this.resourceUsage.memoryUsage > this.options.memoryThreshold,
          cpuThresholdExceeded: this.resourceUsage.cpuUsage > 0.8,
          queueThresholdExceeded: this.resourceUsage.queuedTasks > 400
        },
        recommendations: this.generateRecommendations()
      };

      // Generate recommendations
      report.recommendations.push(...this.generateRecommendations());

      logger.info('Performance report generated');

      return report;

    } catch (error) {
      logger.error('Error generating performance report', { error: error.message });
      return null;
    }
  }

  /**
   * Generate performance recommendations
   */
  generateRecommendations() {
    const recommendations = [];

    // Cache recommendations
    if (this.cacheConfig.hitRatio < 0.7) {
      recommendations.push({
        type: 'cache_optimization',
        priority: 'medium',
        title: 'Improve Cache Hit Ratio',
        description: `Current cache hit ratio is ${(this.cacheConfig.hitRatio * 100).toFixed(1)}% (target: >80%)`,
        actions: ['increase_cache_size', 'optimize_cache_keys', 'adjust_ttl']
      });
    }

    // Connection pool recommendations
    if (this.connectionPool.reuseRate < 0.5) {
      recommendations.push({
        type: 'connection_pool_optimization',
        priority: 'medium',
        title: 'Improve Connection Reuse Rate',
        description: `Current connection reuse rate is ${(this.connectionPool.reuseRate * 100).toFixed(1)}% (target: >50%)`,
        actions: ['increase_pool_size', 'adjust_timeout', 'optimize_connections']
      });
    }

    // Memory usage recommendations
    if (this.resourceUsage.memoryUsage > 0.8) {
      recommendations.push({
        type: 'memory_optimization',
        priority: 'high',
        title: 'High Memory Usage Detected',
        description: `Current memory usage is ${(this.resourceUsage.memoryUsage * 100).toFixed(1)}% (target: <80%)`,
        actions: ['increase_memory_limit', 'implement_gc_optimization', 'profile_memory_usage']
      });
    }

    // CPU usage recommendations
    if (this.resourceUsage.cpuUsage > 0.8) {
      recommendations.push({
        type: 'cpu_optimization',
        priority: 'high',
        title: 'High CPU Usage Detected',
        description: `Current CPU usage is ${(this.resourceUsage.cpuUsage * 100).toFixed(1)}% (target: <80%)`,
        actions: ['optimize_queries', 'profile_performance', 'scale_horizontally']
      });
    }

    // Queue processing recommendations
    if (this.resourceUsage.queuedTasks > 200) {
      recommendations.push({
        type: 'queue_optimization',
        priority: 'medium',
        title: 'High Queue Length Detected',
        description: `Queue length is ${this.resourceUsage.queuedTasks} (target: <200)`,
        actions: ['increase_processing_rate', 'add_parallel_workers', 'adjust_batch_size']
      });
    }

    return recommendations;
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    try {
      // Stop monitoring
      if (this.monitoringTimer) {
        clearInterval(this.monitoringTimer);
        this.monitoringTimer = null;
      }

      // Stop background processing
      if (this.backgroundProcessorState.running) {
        this.backgroundProcessorState.running = false;
      }

      // Clear all data structures
      this.cache.clear();
      this.routingCache.clear();
      this.queryOptimizer.queryCache.clear();
      this.queryOptimizer.queryStats.clear();
      this.connectionPool.available = [];
      this.connectionPool.active.clear();
      this.backgroundQueue = [];
      this.performanceMetrics.clear();

      // Reset statistics
      this.statistics = {
        totalRouted: 0,
        routingCacheHits: 0,
        escalations: 0,
        userPreferenceOverrides: 0,
        ruleMatches: new Map(),
        totalNotifications: 0,
        deliveredNotifications: 0,
        failedNotifications: 0,
        notificationsByChannel: new Map(),
        notificationsByType: new Map(),
        notificationsBySeverity: new Map(),
        totalChannels: 0,
        activeChannels: 0,
        cacheSize: 0,
        maxConnections: 0,
        averageWaitTime: 0,
        totalConnections: 0,
        closedConnections: 0,
        queueSize: 0
      };

      this.isInitialized = false;

      logger.info('Security Performance Optimizer cleaned up');

    } catch (error) {
      logger.error('Error during Security Performance Optimizer cleanup', { error: error.message });
    }
  }
}

module.exports = SecurityPerformanceOptimizer;