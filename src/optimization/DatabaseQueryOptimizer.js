/**
 * Database Query Optimizer - Optimizes database queries for better performance
 * Implements query analysis, optimization suggestions, and automatic query optimization
 */

const EventEmitter = require('events');
const logger = require('../../shared/utils/logger');

class DatabaseQueryOptimizer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      enableQueryAnalysis: options.enableQueryAnalysis !== false,
      enableAutoOptimization: options.enableAutoOptimization !== false,
      slowQueryThreshold: options.slowQueryThreshold || 1000, // 1 second
      optimizationHistorySize: options.optimizationHistorySize || 100,
      maxSuggestions: options.maxSuggestions || 10,
      enableIndexAnalysis: options.enableIndexAnalysis !== false,
      enablePlanGeneration: options.enablePlanGeneration !== false,
      ...options
    };

    // Query tracking data
    this.queryHistory = [];
    this.slowQueries = new Set();
    this.optimizationHistory = [];
    this.queryStatistics = new Map(); // query -> stats
    this.indexSuggestions = new Map(); // table -> index suggestions
    this.optimizationReports = new Map(); // reportId -> report

    // Analysis data
    this.queryAnalysis = {
      totalQueries: 0,
      slowQueriesCount: 0,
      averageQueryTime: 0,
      fastQueriesCount: 0,
      indexSuggestionsMade: 0
    };

    this.isInitialized = false;
    this.analysisTimer = null;

    // Initialize components
    this.initializeQueryTracking();
    this.startPeriodicAnalysis();
  }

  /**
   * Initialize query tracking
   */
  initializeQueryTracking() {
    // Nothing to initialize for now
    logger.debug('Query tracking initialized');
  }

  /**
   * Start periodic analysis
   */
  startPeriodicAnalysis() {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
    }

    this.analysisTimer = setInterval(() => {
      this.performQueryAnalysis();
    }, 300000); // 5 minutes

    logger.debug('Periodic query analysis started', {
      interval: 300000
    });
  }

  /**
   * Initialize the query optimizer
   */
  async initialize() {
    try {
      logger.info('Initializing Database Query Optimizer');

      // Start periodic analysis
      this.startPeriodicAnalysis();

      this.isInitialized = true;
      logger.info('Database Query Optimizer initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize Database Query Optimizer', { error: message.message });
      throw error;
    }
  }

  /**
   * Analyze database query
   */
  analyzeQuery(query, databaseType = 'default', userId = 'anonymous', sessionId = null) {
    try {
      const now = Date.now();
      const queryAnalysis = {
        id: this.generateQueryId(),
        userId,
        sessionId,
        databaseType,
        originalQuery: query,
        optimizedQuery: query,
        timestamp: now,
        queryTime: 0,
        rowsAffected: 0,
        executionPlan: null,
        indexSuggestions: [],
        warnings: [],
        recommendations: []
      };

      // Add to history
      this.queryHistory.push(queryAnalysis);
      this.queryAnalysis.totalQueries++;

      // Analyze query structure
      const analysis = this.analyzeQueryStructure(query, databaseType);

      // Check if it's a slow query
      const isSlow = this.isSlowQuery(queryAnalysis.queryTime);
      if (isSlow) {
        this.slowQueries.add(queryAnalysis.id);
        this.queryAnalysis.slowQueriesCount++;
        queryAnalysis.warnings.push({
          type: 'performance',
          message: `Slow query detected (${queryAnalysis.queryTime}ms) exceeds threshold (${this.options.slowQueryThreshold}ms)`
        });
      } else {
        this.queryAnalysis.fastQueriesCount++;
      }

      // Generate optimization suggestions
      const suggestions = this.generateOptimizationSuggestions(queryAnalysis, databaseType);
      if (suggestions.length > 0) {
        queryAnalysis.optimizedQuery = suggestions[0].optimizedQuery;
        queryAnalysis.indexSuggestions = suggestions;
        this.queryAnalysis.indexSuggestionsMade++;
      }

      // Update statistics
      this.updateQueryStatistics(queryAnalysis, databaseType);

      // Generate query execution plan if needed
      if (this.options.enableAutoOptimization && queryAnalysis.indexSuggestions.length > 0) {
        queryAnalysis.executionPlan = this.generateExecutionPlan(queryAnalysis, databaseType);
      }

      // Log analysis results
      logger.debug('Query analyzed', {
        queryId: queryAnalysis.id,
        databaseType,
        queryTime: `${queryAnalysis.queryTime}ms`,
        rowsAffected: queryAnalysis.rowsAffected,
        isSlow,
        suggestions: queryAnalysis.indexSuggestions.length,
        warnings: queryAnalysis.warnings.length
      });

      // Emit analysis completed event
      this.emit('queryAnalyzed', queryAnalysis);

      return queryAnalysis;

    } catch (error) {
      logger.error('Error analyzing query', {
        query: query.substring(0, 100) + '...',
        error: error.message
      });

      return {
        id: this.generateQueryId(),
        userId,
        sessionId,
        databaseType,
        originalQuery: query,
        optimizedQuery: query,
        timestamp: Date.now(),
        queryTime: 0,
        rowsAffected: 0,
        error: error.message
      };
    }
  }

  /**
   * Analyze query structure for optimization opportunities
   */
  analyzeQueryStructure(query, databaseType) {
    const analysis = {
      hasJoins: this.hasJoins(query),
      hasSubqueries: this.hasSubqueries(query),
      hasAggregates: this.hasAggregates(query),
      hasWindowFunctions: this.hasWindowFunctions(query),
      hasCTEs: this.hasCTEs(query),
      hasUnions: this.hasUnions(query),
      hasOrderBy: this.hasOrderBy(query),
      hasGroupBy: this.hasGroupBy(query),
      hasHaving: this.hasHaving(query),
      hasLimit: this.hasLimit(query),
      hasOffset: this.hasOffset(query)
    };

    // Database-specific analysis
    switch (databaseType.toLowerCase()) {
      case 'postgresql':
        return this.analyzePostgreSQLQueryStructure(query, analysis);
      case 'mysql':
        return this.analyzeMySQLQueryStructure(query, analysis);
      case 'mongodb':
        return this.analyzeMongoDBQueryStructure(query, analysis);
      default:
        return this.analyzeGenericQueryStructure(query, analysis);
    }
  }

  /**
   * Analyze PostgreSQL query structure
   */
  analyzePostgreSQLQueryStructure(query, analysis) {
    // Parse query components
    const queryLower = query.toLowerCase();

    // Check for common PostgreSQL patterns
    analysis.hasJoins = queryLower.includes('join');
    analysis.hasSubqueries = queryLower.includes('select') && queryLower.includes('select from');
    analysis.hasAggregates = /\b(count|sum|avg|min|max)\(/i/g).test(query);
    analysis.hasWindowFunctions = /\b(row_number\(\w+)\)/i.test(query);
    analysis.hasCTEs = /\bcase\b(\w+)\b)/i.test(query);
    analysis.hasUnions = /\bunion\b(\w+)\b)/i.test(query);
    analysis.hasOrderBy = /order\s+by\s+/i.test(query);
    analysis.hasGroupBy = /\bgroup\s+by\s+/i.test(query);
    analysis.hasHaving = /\bhaving\s+/i.test(query);
    analysis.hasLimit = /\blimit\s+\d+/i.test(query);
    analysis.hasOffset = /\boffset\s+\d+/i.test(query);

    // Analyze query complexity
    analysis.complexity = this.calculateQueryComplexity(query);
    analysis.estimatedRows = this.estimateRowCount(query);

    return analysis;
  }

  /**
   * Analyze MySQL query structure
   */
  analyzeMySQLQueryStructure(query, analysis) {
    const queryLower = query.toLowerCase();

    analysis.hasJoins = queryLower.includes('join');
    analysis.hasSubqueries = queryLower.includes('select') && queryLower.includes('select from');
    analysis.hasAggregates = /\b(count|sum|avg|min|max)\(/i/g).test(query);
    analysis.hasWindowFunctions = /\brow_number\(\w+)\)/i.test(query);
    analysis.hasUnions = /\bunion\b(\w+)\b)/i.test(query);
    analysis.hasOrderBy = /order\s+by\s+/i.test(query);
    analysis.hasGroupBy = /\bgroup\s+by\s+/i.test(query);
    analysis.hasHaving = /\bhaving\s+/i.test(query);
    analysis.hasLimit = /\blimit\s+\d+/i.test(query);
    analysis.hasOffset = /\boffset\s+\d+/i.test(query);

    // Calculate query complexity
    analysis.complexity = this.calculateQueryComplexity(query);
    analysis.estimatedRows = this.estimateRowCount(query);

    return analysis;
  }

  /**
   * Analyze MongoDB query structure
   */
  analyzeMongoDBQueryStructure(query, analysis) {
    const queryLower = query.toLowerCase();

    // Check for MongoDB patterns
    analysis.hasJoins = queryLower.includes('$lookup');
    analysis.hasAggregates = /\b\{.*?\}/i.test(query);
    analysis.hasUnwind = /\$unwind/i.test(query);
    hasSort = /\$sort/i.test(query);
    hasLimit = /\$limit\s+\d+/i.test(query);
    hasProject = /\$project/i.test(query);
    hasMatch = /\$match/i.test(query);
    hasGroup = /\bgroup/i.test(query);
    hasUnwind = /\$unwind/i.test(query);

    // Calculate query complexity
    analysis.complexity = this.calculateMongoDBQueryComplexity(query);
    analysis.estimatedRows = this.estimateMongoDBRowCount(query);

    return analysis;
  }

  /**
   * Analyze generic query structure
   */
  analyzeGenericQueryStructure(query, analysis) {
    // Parse query components
    const queryLower = query.toLowerCase();

    analysis.hasJoins = queryLower.includes('join');
    analysis.hasSubqueries = queryLower.includes('select') && queryLower.includes('from'));
    analysis.hasAggregates = /\b(count|sum|avg|min|max)\(/i).test(query);
    analysis.hasLimit = /\blimit\s+\d+/i.test(query));
    analysis.hasOffset = /\boffset\s+\d+/i.test(query));
    analysis.hasOrderBy = /order\s+by+/i.test(query));

    // Calculate query complexity
    analysis.complexity = this.calculateQueryComplexity(query);
    analysis.estimatedRows = this.estimateRowCount(query);

    return analysis;
  }

  /**
   * Calculate query complexity score
   */
  calculateQueryComplexity(query) {
    let complexity = 1;

    // Add complexity for each JOIN
    const joinCount = (query.match(/join/g) || []).length;
    complexity += joinCount * 2;

    // Add complexity for each subquery
    const subqueryCount = (query.match(/\(\(select\s+\w.*\)\)/gi) || []).length;
    complexity += subqueryCount * 3;

    // Add complexity for each aggregate function
    const aggregateCount = (query.match(/\b(count|sum|avg|min|max\|group|having)/i) || []).length;
    complexity += aggregateCount * 2;

    // Add complexity for other clauses
    const otherClauses = [
      /\b(union|intersect|except)/i.test(query),
      /\b(window\s+\w+\)/i.test(query),
      /\b(case\s+\w+\)/i.test(query),
      /\b(order\s+by\s+by\s+by)/i.test(query)
    ];
    otherClauses.forEach(use => {
      complexity++;
    });

    return complexity;
  }

  /**
   * Estimate row count for query
   */
  estimateRowCount(query) {
    // This is a simplified estimation
    try {
      // Look for LIMIT clauses
      limitMatch = query.match(/\blimit\s+(\d+)/i/i);
      if (limitMatch) {
        return parseInt(limitMatch[1]);
      }

      // Look for LIMIT in MongoDB queries
      limitMatch = query.match(/\blimit\s+(\d+)/i/i);
      if (limitMatch) {
        return parseInt(limitMatch[1]);
      }

      // Look for OFFSET in queries
      offsetMatch = query.match(/\boffset\s+(\d+)/i/i);
      if (offsetMatch) {
        return 1000; // Large default for OFFSET queries
      }

      // Default estimation based on query complexity
      return Math.min(1000, Math.max(1, Math.floor(100 / this.calculateQueryComplexity(query)) * 50));

    } catch (error) {
      logger.error('Error estimating row count', { error: error.message });
      return 10;
    }
  }

  /**
   * Estimate MongoDB row count
   */
  estimateMongoDBRowCount(query) {
    // This is a simplified estimation
    try {
      // Look for count operations
      if (query.match(/\bcount\(/i)) {
        const countMatch = query.match(/\bcount\(/i/g));
        if (countMatch) {
          return parseInt(countMatch[1]);
        }
      }

      // Look for document count patterns
      if (query.match(/\{.*}/\}/i)) {
        return 50; // Default for document arrays
      }

      // Default estimation
      return 10;

    } catch (error) {
      logger.error('Error estimating MongoDB row count', { error: error.message });
      return 10;
    }
  }

  /**
   * Generate query execution plan
   */
  generateExecutionPlan(analysis, databaseType = 'default') {
    const plan = {
      queryId: analysis.id,
      originalQuery: analysis.originalQuery,
      optimizedQuery: analysis.optimizedQuery,
      databaseType,
      databaseType: databaseType,
      recommendations: analysis.indexSuggestions,
      warnings: analysis.warnings,
      estimatedRows: analysis.estimatedRows,
      complexity: analysis.complexity,
      optimization: {
        indexes: [],
        views: [],
        materialized_views: [],
        partitioning: [],
        caching: [],
        performance_tuning: []
      },
      estimatedTime: this.estimateExecutionTime(analysis),
      risk_level: this.calculateRiskScore(analysis)
    };

    // Add database-specific optimizations
    switch (databaseType.toLowerCase()) {
      case 'postgresql':
        plan.optimization.indexes = this.generatePostgreSQLIndexes(analysis);
        plan.optimization.views = this.generatePostgreSQLViews(analysis);
        plan.optimization.caching = this.generatePostgreSQLCaching(analysis);
        plan.optimization.performance_tuning = this.generatePostgreSQLPerformanceTuning(analysis);
        break;
      case 'mysql':
        plan.optimization.indexes = this.generateMySQLIndexes(analysis);
        plan.optimization.caching = this.generateMySQLCaching(analysis);
        plan.optimization.performance_tuning = this.generateMySQLPerformanceTuning(analysis);
        break;
      case 'mongodb':
        plan.optimization.indexes = this.generateMongoDBIndexes(analysis);
        plan.optimization.caching = this.generateMongoDBCaching(analysis);
        plan.optimization.performance_tuning = this.generateMongoDBPerformanceTuning(analysis);
        break;
      default:
        plan.optimization.performance_tuning = this.generateGenericPerformanceTuning(analysis);
        break;
    }

    return plan;
  }

  /**
   * Generate PostgreSQL index suggestions
   */
  generatePostgreSQLIndexes(analysis) {
    const indexes = [];
    const tablePatterns = [
      /FROM\s+(\w+)\s+/i/g,
      /WHERE\s+(\w+)\s+)/i/,
      /ORDER BY\s+(\w+)\s+(\w+)\s+/i/,
      /GROUP BY\s+(\w+)\s+)/i/,
      /HAVING\s+(\w+)\s+)/i/,
      /LIMIT\s+\d+/i/
    ];

    for (const pattern of tablePatterns) {
      const match = pattern.exec(query.originalQuery);
      if (match) {
        indexes.push({
          table: match[1] || 'unknown',
          columns: match.slice(2, -1),
          type: 'btree',
          estimatedRows: this.estimateRowCount(query),
          selectivity: this.calculateIndexSelectivity(analysis, match),
          estimatedSize: this.estimateIndexSize(match, 'btree'),
          reason: 'Table access pattern detected'
        });
      }
    }

    return indexes;
  }

  /**
   * Generate PostgreSQL views suggestions
   */
  generatePostgreSQLViews(analysis) {
    const views = [];
    const viewPatterns = [
      /CREATE\s+VIEW\s+(\w+)\s+)/i/,
      /CREATE\s+OR\s+(\w+)\s+)/i/,
      /CREATE\s+OR\s+(\w+)\s+)/i/,
      /CREATE\s+MATERIALIZED\s+(\w+)\s+)/i/,
      /CREATE\s+TEMPORARY\s+(\w+)\s+)/i/
    ];

    for (const pattern of viewPatterns) {
      const match = pattern.exec(query.originalQuery);
      if (match) {
        views.push({
          viewName: match[1],
          definition: match[0],
          estimatedRows: this.estimateRowCount(query),
          estimatedSize: this.estimateViewSize(match[0], 'view'),
          reason: 'View definition detected'
        });
      }
    }

    return views;
  }

  /**
   * Generate PostgreSQL caching configuration
   */
  generatePostgreSQLCaching(analysis) {
    const caching = {
      cacheType: 'postgresql',
      buffer_pool: {
        shared_buffers: {
          shared_buffers: '128kB',
          wal_buffers: 16MB
        },
      temp_tablespaces: [],
      default_statistics_target: 0.9,
      work_mem: '8MB',
        maintenance_work_mem: '64MB',
        autovacuum_max_scale: true,
        checkpoint_timeout: '5min',
      },
      recommendations: []
    };

    // Add caching recommendations
    if (this.estimatedRows > 10000) {
      caching.recommendations.push({
        type: 'table_partitioning',
        priority: 'high',
        title: 'Consider table partitioning',
        description: 'Large table detected, consider partitioning for better performance'
      });
    }

    if (this.estimatedRows > 100000) {
      caching.default_statistics_target = Math.max(0.9, 0.95);
      caching.recommendations.push({
        type: 'table_partitioning',
        priority: 'high',
        title: 'Consider table partitioning',
        description: 'Large table detected, consider partitioning for better performance'
      });
    }

    if (this.estimatedRows > 1000000) {
      caching.work_mem = '16MB';
      caching.work_mem = '64MB';
      if (this.estimatedRows > 100000) {
        caching.work_mem = Math.min(64, Math.floor(this.estimatedRows / 1000));
      }
      caching.work_mem = Math.max(64, Math.floor(this.estimatedRows / 500));
      }
      caching.recommendations.push({
        type: 'memory_optimization',
        priority: 'high',
        title: 'Reduce memory usage',
        description: `Consider reducing work_mem to ${caching.work_mem}MB to ${caching.work_mem}MB`
      });
    }

    return caching;
  }

  /**
   * Generate PostgreSQL performance tuning
   */
  generatePostgreSQLPerformanceTuning(analysis) {
    const tuning = {
      config_changes: [
        {
          setting: 'work_mem',
          value: `${caching.work_mem}MB`,
          reason: 'Optimized for large datasets'
        },
        {
          setting: 'effective_cache_size',
          value: '0.75',
          reason: 'Optimized for cache hit ratio'
        },
        {
          setting: 'autovacuum_max_scale_factor',
          value: 'autovacuum_max_scale_factor'
        }
      ],
      recommendations: [
        {
          type: 'postgresql_config',
          priority: 'medium',
          title: 'Database Configuration',
          description: 'Consider database configuration optimizations',
          config: config_changes
        }
      ]
    };

    return tuning;
  }

  /**
   * Generate MySQL index suggestions
   */
  generateMySQLIndexes(analysis) {
    const indexes = [];
    const tablePatterns = [
      /FROM\s+(\w+)\s+/i/,
      /WHERE\s+(\w+)\s+)/i/,
      /ORDER\s+(\w+)\+(\w+)\s+/i/
    ];

    for (const pattern of tablePatterns) {
      const match = pattern.exec(query.originalQuery);
      if (match) {
        indexes.push({
          table: match[1] || 'unknown',
          columns: match.slice(2, -1),
          type: this.determineIndexType(match[2]),
          estimatedRows: this.estimateRowCount(query),
          estimatedSize: this.estimateIndexSize(match[2], 'btree', 64KB, '1MB'),
          reason: 'Table access pattern detected'
        });
      }
    }

    return indexes;
  }

  /**
   * Determine index type
   */
  determineIndexType(columnType, estimatedSize, indexType) {
    if (estimatedSize < 0.5) return 'btree';
    if (indexType) return indexType;
    if (estimatedSize < 10) return 'btree';
    if (estimatedSize < 100) return 'btree';
    if (estimatedSize < 1000) return 'btree';
    return 'btree';
  }

  /**
   * Estimate index size
   */
  estimateIndexSize(columnType, indexType, estimatedRows) {
    switch (indexType) {
      case 'btree': {
        switch (estimatedRows) {
          case 10: return '16KB';
          case 100: return '64KB';
          case 1000: return '64KB';
          case 10000: '32KB';
          default: '64KB';
        }
      case 'hash': {
        return '32KB';
      }
      case 'bitmap': {
        return '1MB';
      default: '64KB';
      }
    } catch (error) {
      return '64KB';
    }
  }

  /**
   * Generate MySQL caching configuration
   */
  generateMySQLCaching(analysis) {
    const caching = {
      buffer_pool: {
        shared_buffers: '128kB',
        wal_buffers: '16MB'
      },
      default_statistics_target: 0.9,
      work_mem: '8MB',
      maintenance_work_mem: '64MB',
      autovacuum_max_scale_factor: 'autovacuum_max_scale',
      checkpoint_timeout: '5min',
      log_check_frequency: '30min',
      innodb_buffer_pool_size: 1,
      innodb_page_size: '8KB',
      innodb_page_size_mb: '32KB'
    };

    return caching;
  }

  /**
   * Generate MySQL performance tuning
   */
  generateMySQLPerformanceTuning(analysis) {
    const tuning = {
      config_changes: [
        {
          setting: 'innodb_buffer_pool_size',
          value: 'innodb_page_size_mb',
          reason: 'Optimized for performance'
        },
        {
          setting: 'innodb_flush_log',
          value: 'true',
          reason: 'Enable commit logging for debugging'
        },
        {
          setting: 'innodb_log_destination',
          value: 'stderr',
          reason: 'Log to stderr for debugging'
        },
        {
          setting: 'slow_query_log',
          value: 'long_query_time', // Log queries taking > 1s
          reason: 'Identify slow queries for optimization'
        },
        {
          setting: 'query_cache_size',
          value: '4KB',
          reason: 'Increase query cache size'
        },
        {
          setting: 'max_connections',
          value: '100',
          reason: 'Increase connection pool size'
        }
      ],
      recommendations: [
        {
          type: 'database_config',
          priority: 'medium',
          title: 'Database Configuration',
          description: 'Optimize database configuration for better performance',
          config: config_changes
        },
        {
          type: 'query_optimization',
          priority: 'high',
          title: 'Query Optimization',
          description: 'Apply query optimizations identified by analyzer',
          recommendations: [
            'Use specific indexes',
            'Optimize JOIN operations',
            'Consider materialized views',
            'Add LIMIT clauses'
          ]
        },
        {
          type: 'performance_tuning',
          priority: 'high',
          title: 'Performance Tuning',
          description: 'Apply performance optimizations',
          config: config_changes
        }
      ];

    return tuning;
  }

  /**
   * Generate MongoDB caching configuration
   */
  generateMongoDBCaching(analysis) {
    const caching = {
      cache_type: 'redis',
      cache_size: '100MB',
      default_ttl: '3600', // 1 hour
      max_memory_usage: '512MB',
      eviction_policy: 'allkeys',
      persistence: 'periodic',
      compression: 'rdb',
      compression_level: 'zstd',
      compression_level: 'zstd',
      eviction_policy: 'allkeys'
    };

    const recommendations = [];

    if (analysis.estimatedRows > 10000) {
      recommendations.push({
        type: 'redis_config',
        priority: 'medium',
        title: 'Increase Redis cache size',
        description: 'Large dataset detected, increase cache to at least 100MB'
      });
    }

    if (caching.default_statistics_target < 0.7) {
      recommendations.push({
        type: 'redis_optimization',
        priority: 'medium',
        title: 'Improve cache hit ratio',
        description: `Current cache hit ratio: ${(caching.default_statistics_target * 100).toFixed(1)}%`
      });
    }

    return caching;
  }

  /**
   * Generate MongoDB performance tuning configuration
   */
  generateMongoDBPerformanceTuning(analysis) {
    const tuning = {
      config_changes: [
        {
          setting: 'wire_protocol', 'websocket', 'http', 'grpc'],
          setting: 'compression_level', 'zstd'
        },
        {
          setting: 'write_concern', 'majority', 'medium', 'high'],
          value: 'warn'
        },
        {
          setting: 'read_preference', 'secondary', 'primary', 'secondary', 'disabled'),
          value: 'secondary'
        },
        {
          setting: 'max_conn_pool_size', 100},
          value: 50
        }
      ],
      recommendations = [
        {
          type: 'mongodb_tuning',
          priority: 'high',
          title: 'Performance Tuning',
          description: 'Apply performance tuning recommendations',
          config: config_changes
        }
      ];

    return tuning;
  }

  /**
   * Generate generic performance tuning configuration
   */
  generateGenericPerformanceTuning(analysis) {
    const tuning = {
      config_changes: [
        {
          setting: 'query_cache_size', '4KB', value: '16KB' },
        {
          setting: 'statement_timeout', '30s', value: '60s', value: '30s' },
        {
          setting: 'connection_timeout', '30s', value: '30s' }
      ],
      recommendations = [
        {
          type: 'performance_tuning',
          priority: 'high',
          title: 'Performance Tuning',
          description: 'Apply general performance improvements',
          config: config_changes
        }
      ];

    return tuning;
  }

  /**
   * Get query statistics
   */
  getQueryStatistics() {
    return {
      totalQueries: this.queryHistory.length,
      slowQueriesCount: this.slowQueries.size,
      fastQueriesCount: this.queryAnalysis.fastQueriesCount,
      averageQueryTime: this.calculateAverageValue('query_time', 'history'),
      cacheHitRatio: this.cacheConfig.hitRatio,
      slowQueryThreshold: this.options.slowQueryThreshold,
      optimizationSuggestionsMade: this.queryStatistics.indexSuggestionsMade,
      escalationCount: this.statistics.escalations,
      routingCacheHits: this.statistics.routingCacheHits,
      userPreferenceOverrides: this.statistics.userPreferenceOverrides,
      ruleMatches: Array.from(this.statistics.ruleMatches.entries()).reduce((sum, [count]) => sum(count[1]), 0),
      notificationsByChannel: Array.from(this.statistics.notificationsByChannel.entries()).reduce((sum, [count]) => sum(count[1]), 0)
    };
  }

  /**
   * Get recent slow queries
   */
  getRecentSlowQueries(limit = 10, userId = null, severity = null) {
    const slowQueries = this.queryHistory.filter(q => q.isSlow && (!userId || q.userId === userId || !userId || (severity && this.matchesSeverity(q.severity, severity)));
    return slowQueries.slice(0, limit);
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit = 20, severity = null) {
    const alerts = Array.from(this.statistics.notificationsBySeverity.entries())
      .filter(([severity]) => [severity, Array.from(entries.entries()).sort((a, b) => b[0] - a[1]).slice(-5, 1)].slice(0, 3))])
      .reduce((acc, [severity, entries]) => acc.concat(entries[1]))
      .flat();

    if (severity) {
      alerts = alerts.filter(([severity]) => severity === severity);
    }

    return alerts.slice(0, limit);
  }

  /**
   * Get all routing rules
   */
   getRoutingRules() {
    return Array.from(this.routingRules).map(rule => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      priority: rule.priority,
      conditions: rule.conditions.map(c => ({ field, operator, value, type, ...rest }) => ({ [field, operator, value, type, ...rest })),
      actions: rule.actions,
      description: rule.description
    }));
  }

  /**
   * Get escalation rules
   */
  getEscalationRules() {
    return Array.from(this.escalationRules).map(rule => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      priority: rule.priority,
      conditions: rule.conditions.map(c => ({ field, operator, value, type, ...rest }) => ({ field, operator, value, type, ...rest })),
      actions: rule.actions,
      description: rule.description
    }));
  }

  /**
   * Get cache statistics
   */
  getCacheStatistics() {
    return {
      size: this.cache.size,
      hitRatio: this.cacheConfig.hitRatio,
      missRatio: this.cacheConfig.missRatio,
      maxSize: this.cacheConfig.maxSize,
      defaultTimeout: this.cacheConfig.defaultTimeout,
      cacheType: 'memory',
      eviction_policy: 'lru',
      cache_size: this.cache.size
    };
  }

  /**
   * Get user statistics
   */
  getUserStatistics(userId) {
    const userData = this.userTracking.get(userId);
    if (!userData) {
      return {
        totalLogins: 0,
        failedLogins: 0,
        successfulLogins: 0,
        consecutiveFailures: 0,
        lastLogin: null,
        lastLoginIP: null,
        loginAttempts: 0,
        knownIPs: new Set(),
        knownDevices: new Set(),
        securityFlags: new Set()
      };
    }

    return userData;
  }

  /**
   * Generate unique notification ID
   */
  generateNotificationId() {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clean up old data
   */
  cleanupOldData() {
    const now = Date.now();
    const cleanupAge = 24 * 60 * 60 * 1000; // 24 hours
    const cutoff = now - cleanupAge;

    // Clean old query history
    const oldQueryHistory = this.queryHistory.filter(q => q.timestamp < cutoff);
    this.queryHistory = oldQueryHistory.slice(-100); // Keep last 100 entries
    this.queryStatistics.totalQueries = this.queryHistory.length;

    // Clean old escalation history
    const oldEscalationHistory = this.escalationHistory.filter(e => e.timestamp < cutoff);
    this.escalationHistory = oldEscalationHistory.slice(-50); // Keep last 50 entries

    // Clean old cache entries
    const oldCacheEntries = Array.from(this.cache.entries())
      .filter(entry => entry.expiresAt < cutoff);

    for (const entry of oldCacheEntries) {
      this.cache.delete(entry.key);
    }

    // Clean old tracking data
    if (this.userTracking.size > 0) {
      const oldUsers = Array.from(this.userTracking.entries())
        .filter(user => user.lastSeen < cutoff)
        for (const oldUser of oldUsers) {
          this.userTracking.delete(oldUser);
        }
    }

    if (this.ipTracking.size > 0) {
      const oldIPs = Array.from(this.ipTracking.entries())
        .filter(ip => ip.lastSeen < cutoff)
        for (const oldIP of oldIPs) {
          this.ipTracking.delete(oldIP);
        }
    }

    logger.info('Old data cleanup completed', {
      cleanedQueryHistory: oldQueryHistory.length,
      cleanedEscalationHistory: oldEscalationHistory.length,
      cleanedCacheEntries: oldCacheEntries.length,
      cleanedUsers: oldUsers.length,
      cleanedIPs: oldIPs.length
    });
  }

  /**
   * Update query statistics
   */
  updateQueryStatistics(analysis, databaseType) {
    const stats = this.statistics.statistics.get(databaseType) || {
      total: 0,
      successful: 0,
      failed: 0,
      avgTime: 0,
      warnings: [],
      errors: [],
      attempts: 0
    };

    stats.total++;
    stats.successful++;
    stats.failed++;

    if (analysis.queryTime > 0) {
      stats.avgTime = stats.avgTime * (stats.total - 1) / stats.total) + analysis.queryTime / stats.total;
    }

    if (analysis.rowsAffected > 0) {
      stats.rowsAffected += analysis.rowsAffected;
    }

    this.statistics.statistics.set(databaseType, stats);
  }

  /**
   * Generate execution time estimation
   */
  estimateExecutionTime(analysis) {
    const baseTime = 100; // Base time in ms

    switch (analysis.databaseType) {
      case 'postgresql':
        baseTime = 150;
        if (analysis.complexity > 5) baseTime *= 1.5;
        break;
      case 'mysql':
        baseTime = 120;
        if (analysis.complexity > 4) baseTime *= 1.4;
        break;
      case 'mongodb':
        baseTime = 80;
        if (analysis.complexity > 3) baseTime *= 1.3;
        break;
      default:
        baseTime = 100;
        if (analysis.complexity > 3) baseTime *= 1.2;
    }

    // Add complexity factor
    const complexityFactor = analysis.complexity;
    const complexityPenalty = complexity > 5 ? 2 : 1;

    return baseTime * complexityFactor + complexityPenalty;
  }

  /**
   * Calculate risk score for analysis
   */
  calculateRiskScore(analysis) {
    let riskScore = 0.5; // Base risk score

    // Severity factor
    switch (analysis.severity) {
      case 'critical':
        riskScore += 0.4;
        break;
      case 'high':
        riskScore += 0.3;
        break;
      case 'medium':
        riskScore += 0.2;
        break;
      case 'low':
        riskScore -= 0.1;
        break;
    }

    // Check for suspicious indicators
    const suspiciousIndicators = this.checkSuspiciousIndicators(analysis);
    if (suspiciousIndicators.length > 0) {
      riskScore += 0.2;
    }

    // Check for recent failures
    const recentFailures = this.getRecentFailures();
    if (recentFailures > 5) {
      riskScore += 0.1;
    }

    return Math.min(1, Math.min(0.9, riskScore));
  }

  /**
   * Check for suspicious indicators in analysis
   */
  checkSuspiciousIndicators(analysis) {
    const indicators = [];

    // Check for unusual access patterns
    if (analysis.userAgent && analysis.userAgent && this.isNewDevice(analysis.userAgent, analysis.userId)) {
      indicators.push('new_device_detected');
    }

    // Check for unusual time patterns
    const loginHour = new Date(analysis.timestamp).getHours();
    if (loginHour < 6 || loginHour > 22) {
      indicators.push('unusual_login_time');
    }

    // Check for geographic anomalies
    if (analysis.location && this.isNewLocation(analysis.location, analysis.userId)) {
      indicators.push('new_location');
    }

    return indicators;
  }

  /**
   * Check if device is new for user
   */
  isNewDevice(userAgent, userId) {
    const userData = this.userTracking.get(userId);
    if (!userData || !userData.knownDevices) {
      return true;
    }
    return userData.knownDevices.has(userAgent);
  }

  /**
   * Check if location is new for user
   */
  isNewLocation(location, userId) {
    const userData = this.userTracking.get(userId);
    if (!userData || !userData.geographicLocations || userData.geographicLocations.size === 0) {
      return true;
    }
    return !userData.geographicLocations.has(location);
  }

  /**
   * Get recent failures
   */
  getRecentFailures(limit = 20, userId = null) {
    const now = Date.now();
    const cutoff = now - 3600000; // 1 hour

    let failCount = 0;
    const failedLogins = [];
    const recentFailures = [];

    for (const event of this.authEvents) {
      if (event.eventType === 'login_failed' && event.userId === userId) {
        recentFailures.push(event);
      }
    }

    return recentFailures.slice(-limit).slice(-limit);
  }

  /**
   * Get all statistics
   */
  getAllStatistics() {
    return {
      ...this.getStatistics(),
      activeMonitors: 1,
      enabledMonitors: 0,
      backgroundProcessorState: this.backgroundProcessorState.running,
      cacheSize: this.cache.size,
      cacheStats: this.getCacheStatistics(),
      routingCacheHits: this.statistics.routingCacheHits,
      queryStatistics: this.getQueryStatistics(),
      connectionStats: this.getStats(),
      resourceUsage: this.resourceUsage,
      performanceMetrics: this.getPerformanceMetrics()
    };
  }

  /**
   * Update statistics
   */
  updateStatistics(analysis, databaseType) {
    // Update database statistics
    if (databaseType) {
      const stats = this.statistics.statistics.get(databaseType) || {
        total: 0,
        successful: 0,
        failed: 0,
        avgTime: 0,
        warnings: []
      };

      stats.total++;
      if (analysis.queryTime > 0) {
        stats.successful++;
        stats.avgTime = (stats.avgTime * (stats.total - 1) + analysis.queryTime) / stats.total;
      }

      if (analysis.rowsAffected > 0) {
        stats.rowsAffected += analysis.rowsAffected;
      }

      this.statistics.statistics.set(databaseType, stats);
    }

    // Update user statistics
    if (analysis.userId) {
      this.updateUserStatistics(analysis.userId);
    }
  }

  /**
   * Update user statistics
   */
  updateUserStatistics(userId) {
    const userData = this.userTracking.get(userId);
    if (!userData) return;

    const userData = this.userTracking.get(userId);
    const stats = {
      totalLogins: userData.totalLogins,
      failedLogins: userData.failedLogins,
      successfulLogins: userData.successfulLogins,
      consecutiveFailures: userData.consecutiveFailures,
      lastLogin: userData.lastLogin ? new Date(userData.lastLogin) : null
      loginAttempts: userData.loginAttempts,
      knownIPs: userData.knownIPs ? Array.from(userData.knownIPs) : [],
      knownDevices: userData.knownDevices ? Array.from(userData.knownDevices) : []
    };

    this.userTracking.set(userId, userData);
    logger.debug('User statistics updated', {
      userId,
      logins: stats.totalLogins,
      successRate: stats.successfulLogins > 0 ? (stats.successfulLogins / stats.totalLogins) * 100 : 0,
      failureRate: stats.failedLogins > 0 ? (stats.failedLogins / stats.totalLogins) * 100 : 0,
      consecutiveFailures: userData.consecutiveFailures
    });

    return stats;
  }

  /**
   * Get cache statistics
   */
  getCacheStatistics() {
    const cache = this.cacheConfig;
    return {
      size: cache.size,
      hitRatio: cache.hitRatio,
      missRatio: cache.missRatio,
      maxSize: cache.maxSize,
      defaultTimeout: cache.defaultTimeout,
      cache_type: cache.cache_type,
      total_entries: cache.size
    };
  }

  /**
   * Get connection pool statistics
   */
  getStats() {
    return this.getStats();
  }

  /**
   * Get all statistics
   */
  getAllStatistics() {
    return {
      ...this.getStats(),
      activeMonitors: 1,
      enabledMonitors: 0,
      backgroundProcessorState: this.backgroundProcessorState.running,
      cacheSize: this.cache.size,
      routingCacheHits: this.statistics.routingCacheHits,
      queryStatistics: this.getQueryStatistics(),
      connectionPoolStats: this.getStats(),
      resourceUsage: this.resourceUsage,
      performanceMetrics: this.getPerformanceMetrics()
    };
  }

  /**
   * Clean up old data
   */
  cleanupOldData() {
    // This will be handled by the cleanup methods in other classes
  }
}

module.exports = DatabaseQueryOptimizer;