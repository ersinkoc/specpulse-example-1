/**
 * Database Query Performance Optimizer
 * Optimizes database queries for security operations with caching, indexing, and connection pooling
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const winston = require('winston');

class QueryOptimizer {
  constructor(config = {}) {
    this.config = {
      // Connection pool configuration
      minConnections: config.minConnections || 2,
      maxConnections: config.maxConnections || 20,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 10000,

      // Query caching configuration
      queryCacheEnabled: config.queryCacheEnabled !== false,
      queryCacheSize: config.queryCacheSize || 1000,
      queryCacheTTL: config.queryCacheTTL || 300000, // 5 minutes

      // Performance monitoring
      slowQueryThreshold: config.slowQueryThreshold || 1000, // 1 second
      maxQueryRetries: config.maxQueryRetries || 3,
      retryDelay: config.retryDelay || 1000,

      // Security-specific optimizations
      auditLogRetention: config.auditLogRetention || 7776000000, // 90 days
      vulnerabilityCacheTTL: config.vulnerabilityCacheTTL || 86400000, // 24 hours
      metricsAggregationInterval: config.metricsAggregationInterval || 300000, // 5 minutes

      ...config
    };

    // Initialize connection pool
    this.pool = new Pool({
      min: this.config.minConnections,
      max: this.config.maxConnections,
      idleTimeoutMillis: this.config.idleTimeoutMillis,
      connectionTimeoutMillis: this.config.connectionTimeoutMillis,
      ...config.database
    });

    // Query cache
    this.queryCache = new Map();
    this.cacheTimestamps = new Map();

    // Performance metrics
    this.metrics = {
      totalQueries: 0,
      slowQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageQueryTime: 0,
      connectionErrors: 0,
      lastCleanup: Date.now()
    };

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: 'logs/query-optimizer.log'
        })
      ]
    });

    this.initializeOptimizer();
  }

  /**
   * Initialize the optimizer with database optimizations
   */
  async initializeOptimizer() {
    try {
      await this.createOptimizedIndexes();
      await this.setupPartitionedTables();
      await this.setupMaterializedViews();
      await this.startCacheCleanup();

      this.logger.info('Query optimizer initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize query optimizer:', error);
      throw error;
    }
  }

  /**
   * Create optimized indexes for security queries
   */
  async createOptimizedIndexes() {
    const indexes = [
      // Audit log indexes
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id, timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type, timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity, timestamp DESC)',

      // Vulnerability indexes
      'CREATE INDEX IF NOT EXISTS idx_vulnerabilities_severity ON vulnerabilities(severity DESC, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_vulnerabilities_status ON vulnerabilities(status, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_vulnerabilities_package ON vulnerabilities(package_name, version)',
      'CREATE INDEX IF NOT EXISTS idx_vulnerabilities_scan_id ON vulnerabilities(scan_id)',

      // Security incident indexes
      'CREATE INDEX IF NOT EXISTS idx_security_incidents_status ON security_incidents(status, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_security_incidents_severity ON security_incidents(severity DESC, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_security_incidents_type ON security_incidents(incident_type, created_at DESC)',

      // Compliance report indexes
      'CREATE INDEX IF NOT EXISTS idx_compliance_reports_type ON compliance_reports(report_type, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_compliance_reports_status ON compliance_reports(status, created_at DESC)',

      // Performance optimization indexes
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_composite ON audit_logs(timestamp DESC, event_type, severity) WHERE severity >= 7',
      'CREATE INDEX IF NOT EXISTS idx_vulnerabilities_active ON vulnerabilities(status, severity DESC) WHERE status = \'open\''
    ];

    for (const indexSql of indexes) {
      try {
        await this.pool.query(indexSql);
        this.logger.debug('Index created/verified:', { sql: indexSql.split(' ')[5] });
      } catch (error) {
        this.logger.warn('Failed to create index:', { sql: indexSql, error: error.message });
      }
    }
  }

  /**
   * Setup partitioned tables for time-series data
   */
  async setupPartitionedTables() {
    try {
      // Create partitioned audit logs table (by month)
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS audit_logs_partitioned (
          LIKE audit_logs INCLUDING ALL
        ) PARTITION BY RANGE (timestamp)
      `);

      // Create current month partition
      const currentMonth = new Date();
      const nextMonth = new Date(currentMonth);
      nextMonth.setMonth(nextMonth.getMonth() + 1);

      const partitionName = `audit_logs_${currentMonth.getFullYear()}_${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ${partitionName}
        PARTITION OF audit_logs_partitioned
        FOR VALUES FROM ('${currentMonth.toISOString()}') TO ('${nextMonth.toISOString()}')
      `);

      this.logger.info('Partitioned tables setup completed');
    } catch (error) {
      this.logger.warn('Failed to setup partitioned tables:', error);
    }
  }

  /**
   * Setup materialized views for common queries
   */
  async setupMaterializedViews() {
    const views = [
      // Security dashboard metrics
      `CREATE MATERIALIZED VIEW IF NOT EXISTS security_dashboard_metrics AS
       SELECT
         COUNT(*) as total_vulnerabilities,
         COUNT(CASE WHEN severity >= 7 THEN 1 END) as high_vulnerabilities,
         COUNT(CASE WHEN severity >= 9 THEN 1 END) as critical_vulnerabilities,
         COUNT(CASE WHEN status = 'open' THEN 1 END) as open_vulnerabilities,
         MAX(created_at) as last_scan_time
       FROM vulnerabilities
       WHERE created_at > NOW() - INTERVAL '30 days'`,

      // Recent security incidents
      `CREATE MATERIALIZED VIEW IF NOT EXISTS recent_security_incidents AS
       SELECT
         id,
         incident_type,
         severity,
         status,
         title,
         created_at,
         updated_at
       FROM security_incidents
       WHERE created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC`,

      // Compliance status summary
      `CREATE MATERIALIZED VIEW IF NOT EXISTS compliance_status_summary AS
       SELECT
         report_type,
         status,
         COUNT(*) as count,
         MAX(created_at) as last_updated
       FROM compliance_reports
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY report_type, status`
    ];

    for (const viewSql of views) {
      try {
        await this.pool.query(viewSql);
        this.logger.debug('Materialized view created:', { sql: viewSql.split(' ')[5] });
      } catch (error) {
        this.logger.warn('Failed to create materialized view:', { sql: viewSql, error: error.message });
      }
    }

    // Create indexes on materialized views
    const mvIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_security_dashboard_metrics_updated ON security_dashboard_metrics(last_scan_time)',
      'CREATE INDEX IF NOT EXISTS idx_recent_incidents_severity ON recent_security_incidents(severity DESC, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_compliance_summary_type ON compliance_status_summary(report_type, status)'
    ];

    for (const indexSql of mvIndexes) {
      try {
        await this.pool.query(indexSql);
      } catch (error) {
        this.logger.warn('Failed to create MV index:', { sql: indexSql, error: error.message });
      }
    }
  }

  /**
   * Execute optimized query with caching and retry logic
   */
  async executeQuery(sql, params = [], options = {}) {
    const startTime = Date.now();
    const cacheKey = this.generateQueryCacheKey(sql, params);

    this.logger.debug('Executing query', { sql: sql.substring(0, 100), cacheKey });

    try {
      // Check cache first for SELECT queries
      if (this.config.queryCacheEnabled && sql.trim().toLowerCase().startsWith('select')) {
        const cachedResult = this.getCachedQuery(cacheKey);
        if (cachedResult && !options.skipCache) {
          this.metrics.cacheHits++;
          this.logger.debug('Query cache hit', { cacheKey });
          return cachedResult;
        }
        this.metrics.cacheMisses++;
      }

      // Execute query with retry logic
      let result = await this.executeQueryWithRetry(sql, params);

      // Cache SELECT query results
      if (this.config.queryCacheEnabled &&
          sql.trim().toLowerCase().startsWith('select') &&
          !options.skipCache) {
        this.cacheQuery(cacheKey, result);
      }

      // Update metrics
      const queryTime = Date.now() - startTime;
      this.updateMetrics(queryTime, false);

      // Log slow queries
      if (queryTime > this.config.slowQueryThreshold) {
        this.metrics.slowQueries++;
        this.logger.warn('Slow query detected', {
          sql: sql.substring(0, 200),
          params,
          queryTime,
          threshold: this.config.slowQueryThreshold
        });
      }

      this.logger.debug('Query executed successfully', {
        sql: sql.substring(0, 100),
        queryTime,
        rowCount: result.rowCount || 0
      });

      return result;

    } catch (error) {
      const queryTime = Date.now() - startTime;
      this.updateMetrics(queryTime, true);

      this.logger.error('Query execution failed', {
        sql: sql.substring(0, 200),
        params,
        queryTime,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Execute query with retry logic
   */
  async executeQueryWithRetry(sql, params, attempt = 1) {
    try {
      const client = await this.pool.connect();
      try {
        const result = await client.query(sql, params);
        return result;
      } finally {
        client.release();
      }
    } catch (error) {
      if (attempt < this.config.maxQueryRetries &&
          (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {

        this.logger.warn(`Query retry attempt ${attempt}`, {
          sql: sql.substring(0, 100),
          error: error.message
        });

        await this.sleep(this.config.retryDelay * attempt);
        return this.executeQueryWithRetry(sql, params, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Generate cache key for query
   */
  generateQueryCacheKey(sql, params) {
    const hash = crypto.createHash('sha256');
    hash.update(`${sql}:${JSON.stringify(params)}`);
    return `query_${hash.digest('hex')}`;
  }

  /**
   * Get cached query result
   */
  getCachedQuery(cacheKey) {
    const cached = this.queryCache.get(cacheKey);
    const timestamp = this.cacheTimestamps.get(cacheKey);

    if (cached && timestamp && (Date.now() - timestamp) < this.config.queryCacheTTL) {
      return cached;
    }

    if (cached) {
      this.queryCache.delete(cacheKey);
      this.cacheTimestamps.delete(cacheKey);
    }

    return null;
  }

  /**
   * Cache query result
   */
  cacheQuery(cacheKey, result) {
    // Implement LRU eviction if cache is full
    if (this.queryCache.size >= this.config.queryCacheSize) {
      const oldestKey = this.queryCache.keys().next().value;
      this.queryCache.delete(oldestKey);
      this.cacheTimestamps.delete(oldestKey);
    }

    this.queryCache.set(cacheKey, result);
    this.cacheTimestamps.set(cacheKey, Date.now());
  }

  /**
   * Execute optimized security-specific queries
   */
  async getSecurityMetrics(timeRange = '24h') {
    const intervals = {
      '1h': "INTERVAL '1 hour'",
      '24h': "INTERVAL '24 hours'",
      '7d': "INTERVAL '7 days'",
      '30d': "INTERVAL '30 days'"
    };

    const interval = intervals[timeRange] || intervals['24h'];

    const sql = `
      WITH recent_metrics AS (
        SELECT
          COUNT(*) as total_vulnerabilities,
          COUNT(CASE WHEN severity >= 7 THEN 1 END) as high_vulnerabilities,
          COUNT(CASE WHEN severity >= 9 THEN 1 END) as critical_vulnerabilities,
          COUNT(CASE WHEN status = 'open' THEN 1 END) as open_vulnerabilities,
          COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_vulnerabilities
        FROM vulnerabilities
        WHERE created_at > NOW() - ${interval}
      ),
      incident_metrics AS (
        SELECT
          COUNT(*) as total_incidents,
          COUNT(CASE WHEN severity >= 7 THEN 1 END) as high_incidents,
          COUNT(CASE WHEN status = 'open' THEN 1 END) as open_incidents
        FROM security_incidents
        WHERE created_at > NOW() - ${interval}
      ),
      audit_metrics AS (
        SELECT
          COUNT(*) as total_audit_events,
          COUNT(CASE WHEN severity >= 7 THEN 1 END) as high_severity_events
        FROM audit_logs
        WHERE timestamp > NOW() - ${interval}
      )
      SELECT
        vm.*,
        im.*,
        am.*,
        NOW() as generated_at
      FROM recent_metrics vm, incident_metrics im, audit_metrics am
    `;

    return this.executeQuery(sql, [], { skipCache: false });
  }

  /**
   * Get vulnerability trends with optimized query
   */
  async getVulnerabilityTrends(days = 30) {
    const sql = `
      SELECT
        DATE_TRUNC('day', created_at) as date,
        COUNT(*) as total_vulnerabilities,
        COUNT(CASE WHEN severity >= 7 THEN 1 END) as high_vulnerabilities,
        COUNT(CASE WHEN severity >= 9 THEN 1 END) as critical_vulnerabilities,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_vulnerabilities
      FROM vulnerabilities
      WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date DESC
    `;

    return this.executeQuery(sql, [], { skipCache: false });
  }

  /**
   * Refresh materialized views
   */
  async refreshMaterializedViews() {
    const views = [
      'security_dashboard_metrics',
      'recent_security_incidents',
      'compliance_status_summary'
    ];

    for (const view of views) {
      try {
        await this.pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
        this.logger.debug('Materialized view refreshed:', { view });
      } catch (error) {
        this.logger.warn('Failed to refresh materialized view:', { view, error: error.message });
      }
    }
  }

  /**
   * Clean up old audit logs
   */
  async cleanupOldAuditLogs() {
    try {
      const result = await this.pool.query(`
        DELETE FROM audit_logs
        WHERE timestamp < NOW() - INTERVAL '${this.config.auditLogRetention} milliseconds'
        RETURNING id
      `);

      this.logger.info('Old audit logs cleaned up', {
        deletedCount: result.rowCount,
        retentionMs: this.config.auditLogRetention
      });

      return result.rowCount;
    } catch (error) {
      this.logger.error('Failed to cleanup old audit logs:', error);
      throw error;
    }
  }

  /**
   * Update performance metrics
   */
  updateMetrics(queryTime, isError) {
    this.metrics.totalQueries++;

    if (!isError) {
      const totalQueries = this.metrics.totalQueries;
      this.metrics.averageQueryTime =
        ((this.metrics.averageQueryTime * (totalQueries - 1)) + queryTime) / totalQueries;
    }

    if (isError) {
      this.metrics.connectionErrors++;
    }
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      cacheHitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) || 0,
      poolStatus: {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount
      },
      cacheSize: this.queryCache.size
    };
  }

  /**
   * Start cache cleanup interval
   */
  startCacheCleanup() {
    setInterval(() => {
      this.cleanupCache();
    }, this.config.queryCacheTTL);
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > this.config.queryCacheTTL) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.queryCache.delete(key);
      this.cacheTimestamps.delete(key);
    }

    if (expiredKeys.length > 0) {
      this.logger.debug('Cache cleanup completed', {
        deletedEntries: expiredKeys.length,
        remainingEntries: this.queryCache.size
      });
    }

    this.metrics.lastCleanup = now;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Close connection pool
   */
  async close() {
    await this.pool.end();
    this.logger.info('Query optimizer connection pool closed');
  }
}

module.exports = QueryOptimizer;